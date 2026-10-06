/* SPDX-License-Identifier: AGPL-3.0-only */

import { runOneShotWorkerTask, type OneShotWorkerPort } from './one-shot-worker-task.ts';
import type { TimelineSpectrogramWorkerTile, TimelineSpectrogramTileColumns } from './timeline-spectrogram-worker-runtime.ts';

/** Borrow PCM: only owned exact-span copies cross the transfer boundary. */
export function analyzeTimelineSpectrogramTileInWorker(
	request: TimelineSpectrogramWorkerTile,
	client: Readonly<{ signal?: AbortSignal; workerFactory?: () => OneShotWorkerPort }> = {},
): Promise<TimelineSpectrogramTileColumns> {
	client.signal?.throwIfAborted();
	const channels = request.channels.map(channel => channel.slice());
	return runOneShotWorkerTask<TimelineSpectrogramTileColumns>({ ...request, channels, type: 'timeline-spectrogram/v1' },
		client.workerFactory ?? (() => new Worker(new URL('./timeline-spectrogram-worker-entry.ts', import.meta.url),
			{ type: 'module', name: 'soundscaper-timeline-spectrum' }) as unknown as OneShotWorkerPort),
		{ signal: client.signal, transfer: channels.map(channel => channel.buffer as ArrayBuffer) });
}
