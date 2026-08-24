/* SPDX-License-Identifier: AGPL-3.0-only */

/** Runs one native speech job in a terminateable thread inside its utility process. */

import { Worker } from 'node:worker_threads';

export function createAssistanceSpeechJobRunner({ WorkerImpl = Worker } = {}) {
	return ({ grant, onProgress }) => {
		let settled = false;
		const worker = new WorkerImpl(new URL('./assistance-inference-worker.js', import.meta.url), {
			workerData: grant,
		});
		const completion = new Promise((resolve, reject) => {
			worker.on('message', (message) => {
				if (settled) return;
				if (message?.type === 'progress' && typeof message.value === 'number') {
					onProgress(message.value);
					return;
				}
				settled = true;
				if (message?.type === 'result') resolve(message.result);
				else reject(reviveWorkerError(message?.error));
			});
			worker.once('error', (error) => {
				if (settled) return;
				settled = true;
				reject(error);
			});
			worker.once('exit', (code) => {
				if (settled) return;
				settled = true;
				reject(new Error(`The speech inference worker exited before answering (code ${String(code)}).`));
			});
		});
		return Object.freeze({
			completion,
			cancel: async () => {
				if (settled) return;
				await worker.terminate();
			},
		});
	};
}

function reviveWorkerError(value) {
	const error = new Error(typeof value?.message === 'string' ? value.message : 'The speech inference worker failed.');
	if (typeof value?.name === 'string') error.name = value.name;
	return error;
}
