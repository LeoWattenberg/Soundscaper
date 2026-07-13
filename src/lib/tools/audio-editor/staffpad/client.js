/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeStaffPadRenderRequest } from './parameters.js';

let nextJobId = 1;

export class StaffPadRenderClient {
	constructor(options = {}) {
		this.workerFactory = options.workerFactory || defaultWorkerFactory;
		this.wasmUrl = options.wasmUrl == null ? null : String(options.wasmUrl);
		this.worker = null;
		this.jobs = new Map();
		this.disposed = false;
	}

	render(request, options = {}) {
		if (this.disposed) return Promise.reject(new Error('StaffPadRenderClient is disposed.'));
		const normalized = normalizeStaffPadRenderRequest(request);
		if (options.signal?.aborted) return Promise.reject(abortError());
		const id = `staffpad-${nextJobId++}`;
		const output = Array.from(
			{ length: normalized.channels.length },
			() => new Float32Array(normalized.outputFrames),
		);
		const worker = this.getWorker();
		return new Promise((resolve, reject) => {
			const job = {
				id,
				output,
				nextFrame: 0,
				resolve,
				reject,
				onChunk: typeof options.onChunk === 'function' ? options.onChunk : null,
				onProgress: typeof options.onProgress === 'function' ? options.onProgress : null,
				signal: options.signal || null,
				onAbort: null,
			};
			if (job.signal) {
				job.onAbort = () => {
					worker.postMessage({ type: 'cancel', id });
					this.finishJob(job, abortError());
				};
				job.signal.addEventListener('abort', job.onAbort, { once: true });
			}
			this.jobs.set(id, job);
			const transfer = options.transferInput === true
				? [...new Set(normalized.channels.map((channel) => channel.buffer))]
					.filter((buffer) => buffer instanceof ArrayBuffer)
				: [];
			worker.postMessage({
				type: 'render',
				id,
				request: normalized,
				cacheKey: typeof options.cacheKey === 'string' ? options.cacheKey : null,
				wasmUrl: this.wasmUrl,
			}, transfer);
		});
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.worker?.terminate();
		this.worker = null;
		for (const job of this.jobs.values()) this.finishJob(job, new Error('StaffPadRenderClient was disposed.'));
	}

	getWorker() {
		if (this.worker) return this.worker;
		const worker = this.workerFactory();
		if (!worker || typeof worker.postMessage !== 'function') throw new TypeError('workerFactory must return a Worker-like object.');
		worker.addEventListener('message', (event) => this.handleMessage(event.data));
		worker.addEventListener('error', (event) => this.handleWorkerFailure(event.error || new Error(event.message || 'StaffPad worker failed.')));
		worker.addEventListener('messageerror', () => this.handleWorkerFailure(new Error('StaffPad worker sent an unreadable message.')));
		this.worker = worker;
		return worker;
	}

	handleMessage(message) {
		if (!message || typeof message !== 'object') return;
		const job = this.jobs.get(message.id);
		if (!job) return;
		if (message.type === 'progress') {
			job.onProgress?.(Math.max(0, Math.min(1, Number(message.progress) || 0)));
			return;
		}
		if (message.type === 'chunk') {
			try {
				this.acceptChunk(job, message);
			} catch (error) {
				this.worker?.postMessage({ type: 'cancel', id: job.id });
				this.finishJob(job, error);
			}
			return;
		}
		if (message.type === 'result') {
			if (job.nextFrame !== job.output[0].length) {
				this.finishJob(job, new Error(`StaffPad worker returned ${job.nextFrame} of ${job.output[0].length} frames.`));
				return;
			}
			this.finishJob(job, null, {
				channels: job.output,
				...message.metadata,
				cacheKey: message.cacheKey || null,
			});
			return;
		}
		if (message.type === 'cancelled') {
			this.finishJob(job, abortError());
			return;
		}
		if (message.type === 'error') this.finishJob(job, deserializeError(message.error));
	}

	acceptChunk(job, message) {
		if (!Number.isSafeInteger(message.frameOffset) || message.frameOffset !== job.nextFrame) {
			throw new Error('StaffPad worker returned a non-contiguous chunk.');
		}
		if (!Array.isArray(message.channels) || message.channels.length !== job.output.length) {
			throw new Error('StaffPad worker returned an invalid channel count.');
		}
		let frames = null;
		for (let channel = 0; channel < message.channels.length; channel += 1) {
			const source = message.channels[channel];
			if (!(source instanceof Float32Array)) throw new TypeError('StaffPad worker chunks must use Float32Array channels.');
			if (frames == null) frames = source.length;
			else if (source.length !== frames) throw new RangeError('StaffPad worker chunk channels must have matching lengths.');
			if (message.frameOffset + source.length > job.output[channel].length) {
				throw new RangeError('StaffPad worker chunk exceeds the requested output length.');
			}
			job.output[channel].set(source, message.frameOffset);
		}
		if (!frames) throw new RangeError('StaffPad worker chunks must not be empty.');
		job.nextFrame += frames;
		job.onChunk?.(message.channels, message.frameOffset);
	}

	finishJob(job, error, result) {
		if (!this.jobs.has(job.id)) return;
		this.jobs.delete(job.id);
		if (job.signal && job.onAbort) job.signal.removeEventListener('abort', job.onAbort);
		if (error) job.reject(error);
		else job.resolve(result);
	}

	handleWorkerFailure(error) {
		for (const job of Array.from(this.jobs.values())) this.finishJob(job, error);
		this.worker?.terminate();
		this.worker = null;
	}
}

export async function renderStaffPadInWorker(request, options = {}) {
	const client = new StaffPadRenderClient(options);
	try {
		return await client.render(request, options);
	} finally {
		client.dispose();
	}
}

function defaultWorkerFactory() {
	return new Worker(new URL('./worker.js', import.meta.url), {
		type: 'module',
		name: 'audacity-staffpad-render',
	});
}

function deserializeError(value) {
	const error = new Error(typeof value?.message === 'string' ? value.message : 'StaffPad worker failed.');
	error.name = typeof value?.name === 'string' ? value.name : 'Error';
	if (typeof value?.stack === 'string' && value.stack) error.stack = value.stack;
	return error;
}

function abortError() {
	const error = new Error('StaffPad render was cancelled.');
	error.name = 'AbortError';
	return error;
}
