/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	NYQUIST_DEFAULT_TIMEOUT_MS,
	NYQUIST_ERROR_FIELDS,
	normalizeNyquistRequest,
	normalizeNyquistResult,
} from './protocol.js';
import { WorkerRequestBroker, normalizeWorkerRequestTimeout } from '../worker-request-broker.ts';
import { createWorkerRequestId } from '../worker-protocol.ts';
import { createWorkerAbortError, deserializeWorkerError } from '../worker-error-transport.ts';

let nextJobId = 1;

/**
 * Nyquist has no way to interrupt an interpreter mid-form, so cancellation and
 * timeouts are enforced by discarding the whole worker. The shared broker owns
 * registration, deadlines, abort wiring and exactly-once settlement; this client
 * keeps only the message interpretation and that hard-restart policy.
 */
export class NyquistEvaluationClient {
	constructor(options = {}) {
		this.workerFactory = options.workerFactory || defaultWorkerFactory;
		this.wasmUrl = options.wasmUrl == null ? null : String(options.wasmUrl);
		this.requests = new WorkerRequestBroker({
			timeoutMs: options.timeoutMs ?? NYQUIST_DEFAULT_TIMEOUT_MS,
			setTimeout: options.setTimeout,
			clearTimeout: options.clearTimeout,
		});
		this.jobs = this.requests.entries;
		this.worker = null;
		this.disposed = false;
	}

	evaluate(request, options = {}) {
		if (this.disposed) return Promise.reject(new Error('NyquistEvaluationClient is disposed.'));
		let normalized;
		let timeoutMs;
		try {
			normalized = normalizeNyquistRequest(request);
			timeoutMs = normalizeWorkerRequestTimeout(options.timeoutMs ?? this.requests.defaultTimeoutMs);
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
		const id = createWorkerRequestId('nyquist', nextJobId++);
		const job = {
			id,
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
			timeoutMs,
			abortError,
			timeoutError: nyquistTimeoutError,
			onAbort: () => {
				try { this.worker?.postMessage({ type: 'cancel', id }); } catch { /* Cancellation is best effort. */ }
				this.restartWorker('Nyquist worker was restarted after an evaluation was cancelled.');
			},
			onTimeout: () => this.restartWorker('Nyquist worker was restarted after another evaluation timed out.'),
			post: () => worker.postMessage({
				type: 'evaluate',
				id,
				request: normalized,
				wasmUrl: this.wasmUrl,
			}, transfer),
		});
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		const worker = this.worker;
		this.worker = null;
		try { worker?.terminate(); } catch { /* Termination is best effort. */ }
		this.requests.dispose(new Error('NyquistEvaluationClient was disposed.'));
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
		const job = this.requests.get(message.id)?.context;
		if (!job) return;
		if (message.type === 'progress') {
			const progress = Number(message.progress);
			if (!Number.isFinite(progress)) {
				this.requests.reject(job.id, new Error('Nyquist worker returned invalid progress.'));
				return;
			}
			try {
				job.onProgress?.(Math.max(0, Math.min(1, progress)));
			} catch (error) {
				this.requests.reject(job.id, error);
			}
			return;
		}
		if (message.type === 'result') {
			try {
				this.requests.resolve(job.id, normalizeNyquistResult(message.result));
			} catch (error) {
				this.requests.reject(job.id, error);
			}
			return;
		}
		if (message.type === 'cancelled') {
			this.requests.reject(job.id, abortError());
			return;
		}
		if (message.type === 'error') this.requests.reject(job.id, deserializeError(message.error));
	}

	/**
	 * Drops the interpreter and fails every evaluation still riding on it. The
	 * request that triggered the restart has already been settled by the broker,
	 * so only its collateral is reported here.
	 */
	restartWorker(collateralMessage) {
		const worker = this.worker;
		this.worker = null;
		try { worker?.terminate(); } catch { /* Termination is best effort. */ }
		this.requests.rejectAll(new Error(collateralMessage));
	}

	handleWorkerFailure(worker, error) {
		if (worker !== this.worker) return;
		this.worker = null;
		try { worker.terminate(); } catch { /* Termination is best effort. */ }
		this.requests.rejectAll(error);
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

function nyquistTimeoutError(timeoutMs) {
	const error = new Error(`Nyquist evaluation exceeded its ${formatTimeout(timeoutMs)} time limit.`);
	error.name = 'TimeoutError';
	error.code = 'NYQUIST_TIMEOUT';
	return error;
}

function formatTimeout(milliseconds) {
	return milliseconds < 1_000 ? `${milliseconds} millisecond` : `${milliseconds / 1_000} second`;
}

function deserializeError(value) {
	return deserializeWorkerError(value, 'Nyquist worker failed.', NYQUIST_ERROR_FIELDS);
}

function abortError() {
	return createWorkerAbortError('Nyquist evaluation was cancelled.');
}
