/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	NYQUIST_DEFAULT_TIMEOUT_MS,
	normalizeNyquistRequest,
	normalizeNyquistResult,
} from './protocol.js';

const MAXIMUM_TIMEOUT_MS = 30 * 60 * 1_000;
let nextJobId = 1;

export class NyquistEvaluationClient {
	constructor(options = {}) {
		this.workerFactory = options.workerFactory || defaultWorkerFactory;
		this.wasmUrl = options.wasmUrl == null ? null : String(options.wasmUrl);
		this.defaultTimeoutMs = normalizeTimeout(options.timeoutMs ?? NYQUIST_DEFAULT_TIMEOUT_MS);
		this.worker = null;
		this.jobs = new Map();
		this.disposed = false;
	}

	evaluate(request, options = {}) {
		if (this.disposed) return Promise.reject(new Error('NyquistEvaluationClient is disposed.'));
		let normalized;
		let timeoutMs;
		try {
			normalized = normalizeNyquistRequest(request);
			timeoutMs = normalizeTimeout(options.timeoutMs ?? this.defaultTimeoutMs);
		} catch (error) {
			return Promise.reject(error);
		}
		if (options.signal?.aborted) return Promise.reject(abortError());
		let worker;
		try {
			worker = this.getWorker();
		} catch (error) {
			return Promise.reject(error);
		}
		const id = `nyquist-${nextJobId++}`;
		return new Promise((resolve, reject) => {
			const job = {
				id,
				resolve,
				reject,
				onProgress: typeof options.onProgress === 'function' ? options.onProgress : null,
				signal: options.signal || null,
				onAbort: null,
				timer: null,
				timeoutMs,
			};
			if (job.signal) {
				job.onAbort = () => this.abortJob(job);
				job.signal.addEventListener('abort', job.onAbort, { once: true });
			}
			job.timer = setTimeout(() => this.timeoutJob(job), timeoutMs);
			this.jobs.set(id, job);
			const transfer = options.transferInput === true
				? [...new Set(normalized.channels.map((channel) => channel.buffer))]
					.filter((buffer) => buffer instanceof ArrayBuffer)
				: [];
			try {
				worker.postMessage({
					type: 'evaluate',
					id,
					request: normalized,
					wasmUrl: this.wasmUrl,
				}, transfer);
			} catch (error) {
				this.finishJob(job, error);
			}
		});
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		const worker = this.worker;
		this.worker = null;
		try { worker?.terminate(); } catch {}
		for (const job of Array.from(this.jobs.values())) {
			this.finishJob(job, new Error('NyquistEvaluationClient was disposed.'));
		}
	}

	getWorker() {
		if (this.worker) return this.worker;
		const worker = this.workerFactory();
		if (!worker || typeof worker.postMessage !== 'function'
			|| typeof worker.addEventListener !== 'function'
			|| typeof worker.terminate !== 'function') {
			throw new TypeError('workerFactory must return a Worker-like object.');
		}
		worker.addEventListener('message', (event) => this.handleMessage(event.data));
		worker.addEventListener('error', (event) => {
			this.handleWorkerFailure(worker, event.error || new Error(event.message || 'Nyquist worker failed.'));
		});
		worker.addEventListener('messageerror', () => {
			this.handleWorkerFailure(worker, new Error('Nyquist worker sent an unreadable message.'));
		});
		this.worker = worker;
		return worker;
	}

	handleMessage(message) {
		if (!message || typeof message !== 'object') return;
		const job = this.jobs.get(message.id);
		if (!job) return;
		if (message.type === 'progress') {
			const progress = Number(message.progress);
			if (!Number.isFinite(progress)) {
				this.finishJob(job, new Error('Nyquist worker returned invalid progress.'));
				return;
			}
			try {
				job.onProgress?.(Math.max(0, Math.min(1, progress)));
			} catch (error) {
				this.finishJob(job, error);
			}
			return;
		}
		if (message.type === 'result') {
			try {
				this.finishJob(job, null, normalizeNyquistResult(message.result));
			} catch (error) {
				this.finishJob(job, error);
			}
			return;
		}
		if (message.type === 'cancelled') {
			this.finishJob(job, abortError());
			return;
		}
		if (message.type === 'error') this.finishJob(job, deserializeError(message.error));
	}

	abortJob(job) {
		if (!this.jobs.has(job.id)) return;
		try { this.worker?.postMessage({ type: 'cancel', id: job.id }); } catch {}
		this.terminateWorker(job, abortError(), 'Nyquist worker was restarted after an evaluation was cancelled.');
	}

	timeoutJob(job) {
		if (!this.jobs.has(job.id)) return;
		const error = new Error(`Nyquist evaluation exceeded its ${formatTimeout(job.timeoutMs)} time limit.`);
		error.name = 'TimeoutError';
		error.code = 'NYQUIST_TIMEOUT';
		this.terminateWorker(job, error, 'Nyquist worker was restarted after another evaluation timed out.');
	}

	terminateWorker(primaryJob, primaryError, collateralMessage) {
		const worker = this.worker;
		this.worker = null;
		try { worker?.terminate(); } catch {}
		for (const job of Array.from(this.jobs.values())) {
			this.finishJob(job, job === primaryJob ? primaryError : new Error(collateralMessage));
		}
	}

	finishJob(job, error, result) {
		if (!this.jobs.has(job.id)) return;
		this.jobs.delete(job.id);
		clearTimeout(job.timer);
		if (job.signal && job.onAbort) job.signal.removeEventListener('abort', job.onAbort);
		if (error) job.reject(error);
		else job.resolve(result);
	}

	handleWorkerFailure(worker, error) {
		if (worker !== this.worker) return;
		this.worker = null;
		try { worker.terminate(); } catch {}
		for (const job of Array.from(this.jobs.values())) this.finishJob(job, error);
	}
}

export async function evaluateNyquistInWorker(request, options = {}) {
	const client = new NyquistEvaluationClient(options);
	try {
		return await client.evaluate(request, options);
	} finally {
		client.dispose();
	}
}

function defaultWorkerFactory() {
	return new Worker(new URL('./worker.js', import.meta.url), {
		type: 'module',
		name: 'audacity-nyquist-evaluation',
	});
}

function normalizeTimeout(value) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1 || number > MAXIMUM_TIMEOUT_MS) {
		throw new RangeError(`Nyquist timeout must be between 1 and ${MAXIMUM_TIMEOUT_MS} milliseconds.`);
	}
	return number;
}

function formatTimeout(milliseconds) {
	return milliseconds < 1_000 ? `${milliseconds} millisecond` : `${milliseconds / 1_000} second`;
}

function deserializeError(value) {
	const error = new Error(typeof value?.message === 'string' ? value.message : 'Nyquist worker failed.');
	error.name = typeof value?.name === 'string' ? value.name : 'Error';
	if (typeof value?.code === 'string') error.code = value.code;
	if (typeof value?.output === 'string') error.output = value.output;
	if (typeof value?.stack === 'string' && value.stack) error.stack = value.stack;
	return error;
}

function abortError() {
	const error = new Error('Nyquist evaluation was cancelled.');
	error.name = 'AbortError';
	return error;
}
