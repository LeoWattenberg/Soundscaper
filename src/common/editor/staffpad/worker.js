/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeStaffPadRenderRequest } from './parameters.js';
import { loadStaffPadWasm, renderStaffPad } from './runtime.js';
import { createStaffPadRuntimeLoader } from './runtime-loader.js';
import { createWorkerAbortError, serializeWorkerError } from '../worker-error-transport.ts';

const jobs = new Map();
let renderQueue = Promise.resolve();
const getRuntime = createStaffPadRuntimeLoader(loadStaffPadWasm);

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
			self.postMessage({ type: 'error', id, error: serializeWorkerError(error) });
		}
	} finally {
		jobs.delete(id);
	}
}

function abortError() {
	return createWorkerAbortError('StaffPad render was cancelled.');
}
