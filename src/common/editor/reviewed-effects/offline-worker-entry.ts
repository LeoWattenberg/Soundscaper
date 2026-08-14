/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	executeReviewedEffectWorkerRequest,
	reviewedEffectResponseTransferables,
} from './offline-worker-runtime.ts';

interface ReviewedEffectWorkerScope {
	onmessage: ((event: Readonly<{ data: unknown }>) => void) | null;
	postMessage(message: unknown, transfer?: readonly Transferable[]): void;
}

const scope = globalThis as unknown as ReviewedEffectWorkerScope;
scope.onmessage = (event): void => {
	void handleMessage(event.data);
};

async function handleMessage(value: unknown): Promise<void> {
	const response = await executeReviewedEffectWorkerRequest(value);
	scope.postMessage(response, reviewedEffectResponseTransferables(response));
}
