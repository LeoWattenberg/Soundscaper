/* SPDX-License-Identifier: AGPL-3.0-only */

import { parentPort } from 'node:worker_threads';

export interface ParallelWorkerMessage {
	readonly type: string;
	readonly workerIndex?: number;
	readonly generation?: number;
}

Object.defineProperty(globalThis, 'postMessage', {
	value: (message: unknown) => { parentPort?.postMessage(message); }, configurable: true,
});
Object.defineProperty(globalThis, 'addEventListener', {
	value: (_type: string, listener: (event: MessageEvent<unknown>) => void) => {
		parentPort?.on('message', (data: unknown) => { listener({ data } as MessageEvent<unknown>); });
	}, configurable: true,
});
await import('../../src/common/editor/engine/parallel-stack-worker.ts');
parentPort?.postMessage({ type: 'installed' } satisfies ParallelWorkerMessage);
