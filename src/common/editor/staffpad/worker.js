/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeStaffPadRenderRequest } from './parameters.js';
import { loadStaffPadWasm, renderStaffPad } from './runtime.js';

const jobs = new Map();
let renderQueue = Promise.resolve();
let runtimePromise;

self.addEventListener('message', (event) => {
	const message = event.data;
	if (!message || typeof message !== 'object') return;
	if (message.type === 'cancel') {
		const job = jobs.get(message.id);
		if (job) job.cancelled = true;
		return;
	}
	if (message.type !== 'render' || typeof message.id !== 'string' || jobs.has(message.id)) return;
	const job = { cancelled: false };
	jobs.set(message.id, job);
	renderQueue = renderQueue
		.then(() => runRender(message, job))
		.catch(() => {});
});

async function runRender(message, job) {
	const { id } = message;
	try {
		if (job.cancelled) throw abortError();
		const request = normalizeStaffPadRenderRequest(message.request);
		const runtime = await getRuntime(message.wasmUrl);
		let lastProgress = -1;
		const metadata = await renderStaffPad(request, runtime, {
			isCancelled: () => job.cancelled,
			onProgress(progress) {
				if (progress !== 1 && progress - lastProgress < 0.01) return;
				lastProgress = progress;
				self.postMessage({ type: 'progress', id, progress });
			},
			onChunk(channels, frameOffset) {
				self.postMessage(
					{ type: 'chunk', id, frameOffset, channels },
					channels.map((channel) => channel.buffer),
				);
			},
		});
		if (job.cancelled) throw abortError();
		self.postMessage({
			type: 'result',
			id,
			metadata,
			cacheKey: typeof message.cacheKey === 'string' ? message.cacheKey : null,
		});
	} catch (error) {
		if (error?.name === 'AbortError' || job.cancelled) {
			self.postMessage({ type: 'cancelled', id });
		} else {
			self.postMessage({ type: 'error', id, error: serializeError(error) });
		}
	} finally {
		jobs.delete(id);
	}
}

function getRuntime(wasmUrl) {
	if (!runtimePromise) runtimePromise = loadStaffPadWasm(wasmUrl || undefined);
	return runtimePromise;
}

function serializeError(error) {
	return {
		name: typeof error?.name === 'string' ? error.name : 'Error',
		message: typeof error?.message === 'string' ? error.message : String(error),
		stack: typeof error?.stack === 'string' ? error.stack : '',
	};
}

function abortError() {
	const error = new Error('StaffPad render was cancelled.');
	error.name = 'AbortError';
	return error;
}
