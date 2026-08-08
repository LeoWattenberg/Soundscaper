/* SPDX-License-Identifier: AGPL-3.0-only */

import { serializeOpfsWorkerError } from './opfs-sync-worker-protocol.ts';
import { OpfsSyncWorkerRuntime } from './opfs-sync-worker-runtime.ts';

interface WorkerScope {
	onmessage: ((event: MessageEvent) => void) | null;
	postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;
const runtime = new OpfsSyncWorkerRuntime();

scope.onmessage = (event): void => {
	const request = event.data as { readonly id?: unknown; readonly type?: unknown };
	if (request?.type === 'cancel') {
		void runtime.handle(request).catch(() => undefined);
		return;
	}
	const id = typeof request?.id === 'string' ? request.id : '';
	void runtime.handle(request).then(
		(result) => {
			const bytes = result.bytes;
			const transfer = bytes instanceof ArrayBuffer ? [bytes] : [];
			scope.postMessage({ id, type: 'result', result }, transfer);
		},
		(error) => scope.postMessage({ id, type: 'error', error: serializeOpfsWorkerError(error) }),
	);
};
