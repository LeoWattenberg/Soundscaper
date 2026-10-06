/* SPDX-License-Identifier: AGPL-3.0-only */

import type { GeneratedWorkerSignal, SignalGeneratorResponse } from './signal-generator-worker-runtime.ts';

type WorkerEvent = Readonly<{ data?: unknown; error?: unknown; message?: string }>;
type Listener = (event: WorkerEvent) => void;
export interface SignalGeneratorWorkerPort {
	addEventListener(type: 'message' | 'messageerror' | 'error', listener: Listener): void;
	removeEventListener(type: 'message' | 'messageerror' | 'error', listener: Listener): void;
	postMessage(message: unknown): void;
	terminate(): void;
}

let sequence = 0;

/** Dedicated jobs can be cancelled while their synchronous DSP loop is running. */
export function generateAudioEditorSignalInWorker(
	type: string,
	options: Readonly<Record<string, unknown>> = {},
	client: Readonly<{ signal?: AbortSignal; workerFactory?: () => SignalGeneratorWorkerPort }> = {},
): Promise<GeneratedWorkerSignal> {
	if (client.signal?.aborted) return Promise.reject(client.signal.reason);
	const worker = (client.workerFactory ?? defaultWorkerFactory)();
	const requestId = `generator-${++sequence}`;
	return new Promise((resolve, reject) => {
		let settled = false;
		const settle = (action: () => void): void => {
			if (settled) return;
			settled = true;
			client.signal?.removeEventListener('abort', abort);
			worker.removeEventListener('message', message);
			worker.removeEventListener('messageerror', unreadable);
			worker.removeEventListener('error', failure);
			worker.terminate();
			action();
		};
		const abort = (): void => settle(() => reject(client.signal?.reason));
		const unreadable = (): void => settle(() => reject(new Error('Unreadable generator response.')));
		const failure = (event: WorkerEvent): void => settle(() => reject(
			event.error instanceof Error ? event.error : new Error(event.message || 'Generator worker failed.'),
		));
		const message = (event: WorkerEvent): void => {
			const response = event.data as Partial<SignalGeneratorResponse> | null;
			if (!response || response.requestId !== requestId) return;
			if (response.type === 'result' && 'result' in response) {
				settle(() => resolve(response.result as GeneratedWorkerSignal));
			} else if (response.type === 'error' && 'error' in response) {
				const detail = response.error as Readonly<{ name: string; message: string }>;
				const error = new Error(detail.message);
				error.name = detail.name;
				settle(() => reject(error));
			}
		};
		worker.addEventListener('message', message);
		worker.addEventListener('messageerror', unreadable);
		worker.addEventListener('error', failure);
		client.signal?.addEventListener('abort', abort, { once: true });
		if (client.signal?.aborted) { abort(); return; }
		try { worker.postMessage({ type: 'generate-signal/v1', requestId, generator: type, options }); }
		catch (error) { settle(() => reject(error)); }
	});
}

function defaultWorkerFactory(): SignalGeneratorWorkerPort {
	return new Worker(new URL('./signal-generator-worker-entry.ts', import.meta.url), {
		type: 'module', name: 'soundscaper-generator',
	}) as unknown as SignalGeneratorWorkerPort;
}
