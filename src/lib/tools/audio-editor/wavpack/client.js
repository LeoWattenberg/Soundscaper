/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PCM_ENCODING_WAVPACK_F32_V1,
	exactArrayBuffer,
	normalizePcmSampleRate,
	pcmRawByteLength,
	validatePcmGeometry,
} from './pcm.js';

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
		this.worker?.terminate();
		this.worker = null;
		const error = new Error('WavPack codec client is closed.');
		for (const request of [...this.foregroundQueue, ...this.migrationQueue]) {
			this.#finish(request, error);
		}
		this.foregroundQueue.length = 0;
		this.migrationQueue.length = 0;
		if (this.active) this.#finish(this.active, error);
		this.active = null;
	}

	#enqueue(type, message, options) {
		if (this.closed) return Promise.reject(new Error('WavPack codec client is closed.'));
		if (options.signal?.aborted) return Promise.reject(abortError());
		const transferInput = options.transferInput === true;
		const source = exactArrayBuffer(message.payload);
		const payload = transferInput ? source : source.slice(0);
		return new Promise((resolve, reject) => {
			const request = {
				id: `wavpack-${nextRequestId++}`,
				type,
				message: { ...message, payload },
				resolve,
				reject,
				signal: options.signal || null,
				onAbort: null,
				finished: false,
			};
			if (request.signal) {
				request.onAbort = () => {
					if (request === this.active) {
						request.aborted = true;
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
		worker.addEventListener('message', (event) => this.#handleMessage(event.data));
		worker.addEventListener('error', (event) => {
			this.#handleWorkerFailure(event.error || new Error(event.message || 'WavPack worker failed.'));
		});
		worker.addEventListener('messageerror', () => {
			this.#handleWorkerFailure(new Error('WavPack worker sent an unreadable message.'));
		});
		this.worker = worker;
		return worker;
	}

	#handleMessage(message) {
		if (!message || typeof message !== 'object' || message.id !== this.active?.id) return;
		const request = this.active;
		this.active = null;
		if (request.aborted) this.#finish(request, abortError());
		else if (message.type === 'result') this.#finish(request, null, message.result);
		else if (message.type === 'error') this.#finish(request, deserializeError(message.error));
		else this.#finish(request, new Error('WavPack worker returned an invalid response.'));
		this.#dispatch();
	}

	#handleWorkerFailure(error) {
		const active = this.active;
		this.active = null;
		this.worker?.terminate();
		this.worker = null;
		if (active) this.#finish(active, error);
		this.#dispatch();
	}

	#finish(request, error, result) {
		if (request.finished) return;
		request.finished = true;
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
