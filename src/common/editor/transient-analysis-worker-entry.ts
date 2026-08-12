/* SPDX-License-Identifier: AGPL-3.0-only */

import { executeTransientAnalysisWorkerRequest } from './transient-analysis-worker-runtime.ts';

interface TransientAnalysisWorkerScope {
	onmessage: ((event: Readonly<{ data: unknown }>) => void) | null;
	postMessage(message: unknown): void;
}

const scope = globalThis as unknown as TransientAnalysisWorkerScope;
scope.onmessage = (event): void => {
	scope.postMessage(executeTransientAnalysisWorkerRequest(event.data));
};
