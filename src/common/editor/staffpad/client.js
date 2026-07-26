/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeStaffPadRenderRequest } from './parameters.js';
import { WorkerRequestBroker } from '../worker-request-broker.ts';
import { createWorkerRequestId } from '../worker-protocol.ts';

let nextJobId = 1;

export class StaffPadRenderClient {
	constructor(options = {}) {
		this.workerFactory = options.workerFactory || defaultWorkerFactory;
		this.wasmUrl = options.wasmUrl == null ? null : String(options.wasmUrl);
		this.worker = null;
		this.requests = new WorkerRequestBroker({
			timeoutMs: options.timeoutMs,
			setTimeout: options.setTimeout,
			clearTimeout: options.clearTimeout,
		});
		this.jobs = this.requests.entries;
		this.disposed = false;
	}

	render(request, options = {}) {
		if (this.disposed) return Promise.reject(new Error('StaffPadRenderClient is disposed.'));
		const normalized = normalizeStaffPadRenderRequest(request);
		if (options.signal?.aborted) return Promise.reject(abortError());
		const id = createWorkerRequestId('staffpad', nextJobId++);
		const output = Array.from(
			{ length: normalized.channels.length },
			() => new Float32Array(normalized.outputFrames),
		);
		const worker = this.getWorker();
		const job = {
			id,
			output,
			nextFrame: 0,
			onChunk: typeof options.onChunk === 'function' ? options.onChunk : null,
			onProgress: typeof options.onProgress === 'function' ? options.onProgress : null,
		};
		const transfer = options.transferInput === true
			? [...new Set(normalized.channels.map((channel) => channel.buffer))]
				.filter((buffer) => buffer instanceof ArrayBuffer)
			: [];
		return this.requests.request({
			id,
			context: job,
			signal: options.signal,
			timeoutMs: options.timeoutMs,
			abortError,
			onAbort: () => worker.postMessage({ type: 'cancel', id }),
			onTimeout: () => worker.postMessage({ type: 'cancel', id }),
			post: () => worker.postMessage({
				type: 'render',
				id,
				request: normalized,
				cacheKey: typeof options.cacheKey === 'string' ? options.cacheKey : null,
				wasmUrl: this.wasmUrl,
			}, transfer),
		});
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		const worker = this.worker;
		this.worker = null;
		try {
			worker?.terminate();
		} finally {
			this.requests.dispose(new Error('StaffPadRenderClient was disposed.'));
		}
	}

	getWorker() {
		if (this.worker) return this.worker;
		const worker = this.workerFactory();
		if (!worker || typeof worker.postMessage !== 'function') throw new TypeError('workerFactory must return a Worker-like object.');
		worker.addEventListener('message', (event) => this.handleMessage(event.data));
		worker.addEventListener('error', (event) => this.handleWorkerFailure(
			worker,
			event.error || new Error(event.message || 'StaffPad worker failed.'),
		));
		worker.addEventListener('messageerror', () => this.handleWorkerFailure(
			worker,
			new Error('StaffPad worker sent an unreadable message.'),
		));
		this.worker = worker;
		return worker;
	}

	handleMessage(message) {
		if (!message || typeof message !== 'object') return;
		const entry = this.requests.get(message.id);
		const job = entry?.context;
		if (!job) return;
		if (message.type === 'progress') {
			this.requests.touch(job.id);
			try {
				job.onProgress?.(Math.max(0, Math.min(1, Number(message.progress) || 0)));
			} catch (error) {
				try { this.worker?.postMessage({ type: 'cancel', id: job.id }); } catch {}
				this.finishJob(job, error);
			}
			return;
		}
		if (message.type === 'chunk') {
			this.requests.touch(job.id);
			try {
				this.acceptChunk(job, message);
			} catch (error) {
				try { this.worker?.postMessage({ type: 'cancel', id: job.id }); } catch {}
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
		if (error) this.requests.reject(job.id, error);
		else this.requests.resolve(job.id, result);
	}

	handleWorkerFailure(worker, error) {
		if (worker !== this.worker) return;
		this.worker = null;
		try {
			worker.terminate();
		} finally {
			this.requests.rejectAll(error);
		}
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
