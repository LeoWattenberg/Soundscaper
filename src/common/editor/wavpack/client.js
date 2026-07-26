/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PCM_ENCODING_WAVPACK_F32_V1,
	exactArrayBuffer,
	normalizePcmSampleRate,
	pcmRawByteLength,
	validatePcmGeometry,
} from './pcm.js';
import {
	DEFAULT_WORKER_REQUEST_TIMEOUT_MS,
	normalizeWorkerRequestTimeout,
} from '../worker-request-broker.ts';
import { createWorkerRequestId } from '../worker-protocol.ts';

let nextRequestId = 1;

/**
 * One lazy worker with strict foreground-first scheduling. Only a single
 * request is posted at a time, so migration work can never get ahead of a
 * foreground read or write already waiting in this client.
 */
export class WavPackCodecClient {
	constructor(options = {}) {
		this.workerFactory = options.workerFactory || defaultWorkerFactory;
		this.wasmUrl = options.wasmUrl == null ? null : String(options.wasmUrl);
		this.worker = null;
		this.foregroundQueue = [];
		this.migrationQueue = [];
		this.active = null;
		this.closed = false;
		this.defaultTimeoutMs = normalizeWorkerRequestTimeout(
			options.timeoutMs ?? DEFAULT_WORKER_REQUEST_TIMEOUT_MS,
		);
		this.setTimeout = options.setTimeout ?? globalThis.setTimeout?.bind(globalThis);
		this.clearTimeout = options.clearTimeout ?? globalThis.clearTimeout?.bind(globalThis);
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
		const worker = this.worker;
		this.worker = null;
		const error = new Error('WavPack codec client is closed.');
		try {
			worker?.terminate();
		} catch { /* Worker termination is best effort. */ }
		try {
			for (const request of [...this.foregroundQueue, ...this.migrationQueue]) {
				this.#finish(request, error);
			}
			this.foregroundQueue.length = 0;
			this.migrationQueue.length = 0;
			if (this.active) this.#finish(this.active, error);
		} finally {
			this.active = null;
		}
	}

	#enqueue(type, message, options) {
		if (this.closed) return Promise.reject(new Error('WavPack codec client is closed.'));
		if (options.signal?.aborted) return Promise.reject(abortError());
		const transferInput = options.transferInput === true;
		const timeoutMs = normalizeWorkerRequestTimeout(options.timeoutMs ?? this.defaultTimeoutMs);
		const source = exactArrayBuffer(message.payload);
		const payload = transferInput ? source : source.slice(0);
		return new Promise((resolve, reject) => {
			const request = {
				id: createWorkerRequestId('wavpack', nextRequestId++),
				type,
				message: { ...message, payload },
				resolve,
				reject,
				signal: options.signal || null,
				onAbort: null,
				finished: false,
				timer: null,
				timeoutMs,
			};
			if (request.signal) {
				request.onAbort = () => {
					if (request === this.active) {
						this.#terminateActive(request, abortError());
					} else {
						removeQueued(this.foregroundQueue, request);
						removeQueued(this.migrationQueue, request);
						this.#finish(request, abortError());
					}
				};
				request.signal.addEventListener('abort', request.onAbort, { once: true });
			}
			const queue = options.priority === 'migration'
				? this.migrationQueue
				: this.foregroundQueue;
			queue.push(request);
			this.#dispatch();
		});
	}

	#dispatch() {
		if (this.active || this.closed) return;
		const request = this.foregroundQueue.shift() || this.migrationQueue.shift();
		if (!request) return;
		let worker;
		try {
			worker = this.#worker();
		} catch (error) {
			this.#finish(request, error);
			queueMicrotask(() => this.#dispatch());
			return;
		}
		this.active = request;
		this.#armTimeout(request);
		const message = {
			type: request.type,
			id: request.id,
			...request.message,
			wasmUrl: this.wasmUrl,
		};
		try {
			worker.postMessage(message, [request.message.payload]);
		} catch (error) {
			this.active = null;
			this.#finish(request, error);
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
		if (worker !== this.worker) return;
		if (!message || typeof message !== 'object' || message.id !== this.active?.id) return;
		const request = this.active;
		this.active = null;
		if (request.aborted) this.#finish(request, abortError());
		else if (message.type === 'result') this.#finish(request, null, message.result);
		else if (message.type === 'error') this.#finish(request, deserializeError(message.error));
		else this.#finish(request, new Error('WavPack worker returned an invalid response.'));
		this.#dispatch();
	}

	#handleWorkerFailure(worker, error) {
		if (worker !== this.worker) return;
		const active = this.active;
		this.active = null;
		try { worker.terminate(); } catch {}
		this.worker = null;
		if (active) this.#finish(active, error);
		this.#dispatch();
	}

	#armTimeout(request) {
		if (typeof this.setTimeout !== 'function') return;
		request.timer = this.setTimeout(() => {
			if (request !== this.active || request.finished) return;
			request.timer = null;
			const error = new Error(`WavPack worker received no activity for ${request.timeoutMs} milliseconds.`);
			error.name = 'TimeoutError';
			error.code = 'WORKER_INACTIVITY_TIMEOUT';
			this.#terminateActive(request, error);
		}, request.timeoutMs);
		request.timer?.unref?.();
	}

	#terminateActive(request, error) {
		if (request !== this.active || request.finished) return;
		const worker = this.worker;
		this.active = null;
		this.worker = null;
		try { worker?.terminate(); } catch {}
		this.#finish(request, error);
		queueMicrotask(() => this.#dispatch());
	}

	#finish(request, error, result) {
		if (request.finished) return;
		request.finished = true;
		if (request.timer != null && typeof this.clearTimeout === 'function') this.clearTimeout(request.timer);
		request.timer = null;
		if (request.signal && request.onAbort) {
			request.signal.removeEventListener('abort', request.onAbort);
		}
		if (error) request.reject(error);
		else request.resolve(result);
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

function removeQueued(queue, request) {
	const index = queue.indexOf(request);
	if (index >= 0) queue.splice(index, 1);
}

function deserializeError(value) {
	const error = new Error(typeof value?.message === 'string' ? value.message : 'WavPack worker failed.');
	error.name = typeof value?.name === 'string' ? value.name : 'Error';
	if (typeof value?.code === 'string' && value.code) error.code = value.code;
	if (typeof value?.stack === 'string' && value.stack) error.stack = value.stack;
	return error;
}

function abortError() {
	const error = new Error('PCM codec work was cancelled.');
	error.name = 'AbortError';
	return error;
}
