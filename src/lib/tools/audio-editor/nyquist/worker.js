/* SPDX-License-Identifier: AGPL-3.0-only */

import { nyquistTransferableBuffers } from './protocol.js';
import { evaluateNyquist, loadNyquistWasm } from './runtime.js';

const jobs = new Map();
const runtimePromises = new Map();
const fatalRuntimeCodes = new Set([
	'NYQUIST_MEMORY_LIMIT',
	'NYQUIST_WASM_ABORT',
	'NYQUIST_WASM_EXIT',
	'NYQUIST_WASM_TRAP',
]);
let evaluationQueue = Promise.resolve();

self.addEventListener('message', (event) => {
	const message = event.data;
	if (!message || typeof message !== 'object') return;
	if (message.type === 'cancel') {
		const job = jobs.get(message.id);
		if (job) job.cancelled = true;
		return;
	}
	if (message.type !== 'evaluate' || typeof message.id !== 'string' || jobs.has(message.id)) return;
	const job = { cancelled: false };
	jobs.set(message.id, job);
	evaluationQueue = evaluationQueue
		.then(() => runEvaluation(message, job))
		.catch(() => {});
});

async function runEvaluation(message, job) {
	const { id } = message;
	try {
		if (job.cancelled) throw abortError();
		const runtime = await getRuntime(message.wasmUrl);
		const result = await evaluateNyquist(message.request, runtime, {
			isCancelled: () => job.cancelled,
			onProgress(progress) {
				self.postMessage({ type: 'progress', id, progress });
			},
		});
		if (job.cancelled) throw abortError();
		self.postMessage({ type: 'result', id, result }, nyquistTransferableBuffers(result));
	} catch (error) {
		if (isFatalRuntimeError(error)) runtimePromises.delete(runtimeKey(message.wasmUrl));
		if (error?.name === 'AbortError' || job.cancelled) self.postMessage({ type: 'cancelled', id });
		else self.postMessage({ type: 'error', id, error: serializeError(error) });
	} finally {
		jobs.delete(id);
	}
}

function getRuntime(wasmUrl) {
	const key = runtimeKey(wasmUrl);
	let promise = runtimePromises.get(key);
	if (!promise) {
		promise = loadNyquistWasm(key === 'default' ? undefined : key);
		runtimePromises.set(key, promise);
		promise.catch(() => runtimePromises.delete(key));
	}
	return promise;
}

function runtimeKey(wasmUrl) {
	return typeof wasmUrl === 'string' && wasmUrl ? wasmUrl : 'default';
}

function isFatalRuntimeError(error) {
	return fatalRuntimeCodes.has(error?.code);
}

function serializeError(error) {
	return {
		name: typeof error?.name === 'string' ? error.name : 'Error',
		message: typeof error?.message === 'string' ? error.message : String(error),
		code: typeof error?.code === 'string' ? error.code : null,
		output: typeof error?.output === 'string' ? error.output : '',
		stack: typeof error?.stack === 'string' ? error.stack : '',
	};
}

function abortError() {
	const error = new Error('Nyquist evaluation was cancelled.');
	error.name = 'AbortError';
	return error;
}
