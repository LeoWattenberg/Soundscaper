/* SPDX-License-Identifier: AGPL-3.0-only */

import { executeAudioAnalysisReportRequest } from './audio-analysis-report-worker-runtime.ts';

const scope = globalThis as unknown as {
	onmessage: ((event: Readonly<{ data: unknown }>) => void) | null;
	postMessage(message: unknown): void;
};
scope.onmessage = (event): void => { scope.postMessage(executeAudioAnalysisReportRequest(event.data)); };
