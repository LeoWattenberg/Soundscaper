/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PCM_ENCODING_WAVPACK_F32_V1,
	exactArrayBuffer,
	normalizePcmSampleRate,
	pcmRawByteLength,
	validatePcmGeometry,
} from './pcm.js';
import { WorkerRequestBroker } from '../worker-request-broker.ts';
import { WORKER_TIMEOUT_CODE, createWorkerRequestId } from '../worker-protocol.ts';
import { createWorkerAbortError, deserializeWorkerError } from '../worker-error-transport.ts';

const WAVPACK_ERROR_FIELDS = ['code'];
let nextRequestId = 1;

/**
 * One lazy worker with strict foreground-first scheduling. Only a single
 * request is posted at a time, so migration work can never get ahead of a
 * foreground read or write already waiting in this client.
 *
 * The shared broker owns each request's deadline, abort wiring and
 * exactly-once settlement; what stays here is the part it has no opinion
 * about — the two priority lanes, and the policy that a cancelled or expired
 * request takes the worker down with it because a WavPack codec call cannot be
 * interrupted once it is running.
 */
export class WavPackCodecClient {
	constructor(options = {}) {
		this.workerFactory = options.workerFactory || defaultWorkerFactory;
		this.wasmUrl = options.wasmUrl == null ? null : String(options.wasmUrl);
		this.worker = null;
		this.foregroundQueue = [];
		this.migrationQueue = [];
		this.activeId = null;
		this.closed = false;
		this.requests = new WorkerRequestBroker({
			timeoutMs: options.timeoutMs,
			setTimeout: options.setTimeout,
			clearTimeout: options.clearTimeout,
		});
	}

	encode(payload, options = {}) {
		const geometry = normalizeRequestGeometry(payload, options, false);
		return this.#enqueue('encode', geometry, options);
	}

	decode(payload, options = {}) {
		if (options.encoding !== PCM_ENCODING_WAVPACK_F32_V1) {
			return Promise.reject(new TypeError('WavPack decode requires wavpack-f32-v1 encoding.'));
		}
		const geometry = normalizeRequestGeometry(payload, options, true);
		return this.#enqueue('decode', {
			...geometry,
			encoding: options.encoding,
			pcmCrc32: Number(options.pcmCrc32) >>> 0,
		}, options);
	}

	close() {
		if (this.closed) return;
		this.closed = true;
		this.activeId = null;
		this.foregroundQueue.length = 0;
		this.migrationQueue.length = 0;
		this.#dropWorker();
		this.requests.dispose(new Error('WavPack codec client is closed.'));
	}

	#enqueue(type, message, options) {
		if (this.closed) return Promise.reject(new Error('WavPack codec client is closed.'));
		if (options.signal?.aborted) return Promise.reject(abortError());
		const source = exactArrayBuffer(message.payload);
		const payload = options.transferInput === true ? source : source.slice(0);
		const id = createWorkerRequestId('wavpack', nextRequestId++);
		const pending = this.requests.request({
			id,
			context: { type, message: { ...message, payload } },
			signal: options.signal,
			timeoutMs: options.timeoutMs,
			// The deadline measures worker inactivity, so it starts at dispatch
			// rather than here; a request must not expire for waiting its turn.
			armOnRequest: false,
			abortError,
			timeoutError: inactivityError,
			onAbort: () => this.#retire(id),
			onTimeout: () => this.#retire(id),
		});
		(options.priority === 'migration' ? this.migrationQueue : this.foregroundQueue).push(id);
		this.#dispatch();
		return pending;
	}

	#dispatch() {
		if (this.activeId || this.closed) return;
		const id = this.foregroundQueue.shift() || this.migrationQueue.shift();
		if (!id) return;
		const request = this.requests.get(id)?.context;
		if (!request) {
			this.#dispatch();
			return;
		}
		let worker;
		try {
			worker = this.#worker();
		} catch (error) {
			this.requests.reject(id, error);
			queueMicrotask(() => this.#dispatch());
			return;
		}
		this.activeId = id;
		this.requests.touch(id);
		try {
			worker.postMessage({
				type: request.type,
				id,
				...request.message,
				wasmUrl: this.wasmUrl,
			}, [request.message.payload]);
		} catch (error) {
			this.activeId = null;
			this.requests.reject(id, error);
			queueMicrotask(() => this.#dispatch());
		}
	}

	#worker() {
		if (this.worker) return this.worker;
		const worker = this.workerFactory();
		if (!worker || typeof worker.postMessage !== 'function') {
			throw new TypeError('workerFactory must return a Worker-like object.');
		}
		worker.addEventListener('message', (event) => this.#handleMessage(worker, event.data));
		worker.addEventListener('error', (event) => {
			this.#handleWorkerFailure(worker, event.error || new Error(event.message || 'WavPack worker failed.'));
		});
		worker.addEventListener('messageerror', () => {
			this.#handleWorkerFailure(worker, new Error('WavPack worker sent an unreadable message.'));
		});
		this.worker = worker;
		return worker;
	}

	#handleMessage(worker, message) {
		if (worker !== this.worker || !this.activeId) return;
		if (!message || typeof message !== 'object' || message.id !== this.activeId) return;
		const id = this.activeId;
		this.activeId = null;
		if (message.type === 'result') this.requests.resolve(id, message.result);
		else if (message.type === 'error') this.requests.reject(id, deserializeError(message.error));
		else this.requests.reject(id, new Error('WavPack worker returned an invalid response.'));
		this.#dispatch();
	}

	#handleWorkerFailure(worker, error) {
		if (worker !== this.worker) return;
		const id = this.activeId;
		this.activeId = null;
		this.worker = null;
		try { worker.terminate(); } catch { /* Termination is best effort. */ }
		if (id) this.requests.reject(id, error);
		this.#dispatch();
	}

	/**
	 * Runs after the broker has already settled a cancelled or expired request.
	 * A queued request only has to leave its lane; a running one has to take the
	 * worker with it, since the codec call cannot be stopped any other way.
	 */
	#retire(id) {
		if (this.activeId === id) {
			this.activeId = null;
			this.#dropWorker();
		} else {
			removeQueued(this.foregroundQueue, id);
			removeQueued(this.migrationQueue, id);
		}
		queueMicrotask(() => this.#dispatch());
	}

	#dropWorker() {
		const worker = this.worker;
		this.worker = null;
		try { worker?.terminate(); } catch { /* Termination is best effort. */ }
	}
}

function normalizeRequestGeometry(payload, options, compressed) {
	const { frames, channelCount } = validatePcmGeometry(options.frames, options.channelCount);
	const sampleRate = normalizePcmSampleRate(options.sampleRate);
	const buffer = exactArrayBuffer(payload);
	const rawBytes = pcmRawByteLength(frames, channelCount);
	if ((!compressed && buffer.byteLength !== rawBytes)
		|| (compressed && (!buffer.byteLength || buffer.byteLength > rawBytes))) {
		throw new RangeError('PCM codec payload does not match its bounded geometry.');
	}
	return {
		payload: buffer,
		frames,
		channelCount,
		sampleRate,
	};
}

function defaultWorkerFactory() {
	if (typeof Worker !== 'function') {
		throw new Error('WavPack Web Worker is unavailable in this environment.');
	}
	return new Worker(new URL('./worker.js', import.meta.url), {
		type: 'module',
		name: 'soundscaper-wavpack-pcm',
	});
}

function removeQueued(queue, id) {
	const index = queue.indexOf(id);
	if (index >= 0) queue.splice(index, 1);
}

function inactivityError(timeoutMs) {
	const error = new Error(`WavPack worker received no activity for ${timeoutMs} milliseconds.`);
	error.name = 'TimeoutError';
	error.code = WORKER_TIMEOUT_CODE;
	return error;
}

function deserializeError(value) {
	return deserializeWorkerError(value, 'WavPack worker failed.', WAVPACK_ERROR_FIELDS);
}

function abortError() {
	return createWorkerAbortError('PCM codec work was cancelled.');
}
