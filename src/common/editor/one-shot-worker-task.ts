/* SPDX-License-Identifier: AGPL-3.0-only */

type WorkerEvent = Readonly<{ data?: unknown; error?: unknown; message?: string }>;
type Listener = (event: WorkerEvent) => void;
export interface OneShotWorkerPort {
	addEventListener(type: 'message' | 'messageerror' | 'error', listener: Listener): void;
	removeEventListener(type: 'message' | 'messageerror' | 'error', listener: Listener): void;
	postMessage(message: unknown, transfer?: readonly Transferable[]): void;
	terminate(): void;
}

let sequence = 0;

/** Dedicated jobs can be cancelled while their synchronous DSP loop is running. */
export function runOneShotWorkerTask<Result>(
	request: Readonly<Record<string, unknown>>,
	workerFactory: () => OneShotWorkerPort,
	client: Readonly<{ signal?: AbortSignal; transfer?: readonly Transferable[] }> = {},
): Promise<Result> {
	if (client.signal?.aborted) return Promise.reject(client.signal.reason);
	const worker = workerFactory();
	const requestId = `worker-task-${++sequence}`;
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
		const unreadable = (): void => settle(() => reject(new Error('Unreadable worker response.')));
		const failure = (event: WorkerEvent): void => settle(() => reject(
			event.error instanceof Error ? event.error : new Error(event.message || 'Worker task failed.'),
		));
		const message = (event: WorkerEvent): void => {
			const response = event.data as Readonly<{ requestId?: string; type?: string; result?: unknown; error?: unknown }> | null;
			if (!response || response.requestId !== requestId) return;
			if (response.type === 'result' && 'result' in response) {
				settle(() => resolve(response.result as Result));
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
		try { worker.postMessage({ ...request, requestId }, client.transfer); }
		catch (error) { settle(() => reject(error)); }
	});
}
