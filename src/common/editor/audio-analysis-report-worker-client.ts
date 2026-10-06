/* SPDX-License-Identifier: AGPL-3.0-only */

import { runOneShotWorkerTask, type OneShotWorkerPort } from './one-shot-worker-task.ts';
import type { AudioAnalysisReportRequest, calculateAudioAnalysisReport } from './audio-analysis-report-worker-runtime.ts';

/** The render is also consumed by generic meters and visuals; copy only this job's PCM. */
export async function calculateAudioAnalysisReportInWorker(
	request: AudioAnalysisReportRequest,
	client: Readonly<{ signal?: AbortSignal; workerFactory?: () => OneShotWorkerPort }> = {},
): Promise<ReturnType<typeof calculateAudioAnalysisReport>> {
	if (client.signal?.aborted) throw client.signal.reason;
	const channels = request.channels.map(channel => channel.slice());
	const result = await runOneShotWorkerTask<ReturnType<typeof calculateAudioAnalysisReport>>({ ...request, channels },
		client.workerFactory ?? defaultWorkerFactory, { signal: client.signal, transfer: channels.map(channel => channel.buffer) });
	return freezeReport(result);
}

function freezeReport<Value>(value: Value): Value {
	if (!value || typeof value !== 'object') return value;
	for (const child of Object.values(value)) freezeReport(child);
	return Object.freeze(value);
}

function defaultWorkerFactory(): OneShotWorkerPort {
	return new Worker(new URL('./audio-analysis-report-worker-entry.ts', import.meta.url), {
		type: 'module', name: 'soundscaper-analysis-report',
	}) as unknown as OneShotWorkerPort;
}
