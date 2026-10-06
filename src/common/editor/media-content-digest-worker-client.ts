/* SPDX-License-Identifier: AGPL-3.0-only */

import { runOneShotWorkerTask, type OneShotWorkerPort } from './one-shot-worker-task.ts';
import { canonicalMediaContentBlob, digestMediaContent } from './storage/media-content-digest.ts';

/** Hash immutable media off the renderer without materializing its complete bytes. */
export function digestMediaContentInWorker(
	input: Blob,
	options: Readonly<{ signal?: AbortSignal; workerFactory?: () => OneShotWorkerPort }> = {},
): Promise<string> {
	const blob = canonicalMediaContentBlob(input);
	if (typeof Worker === 'undefined' && !options.workerFactory) return digestMediaContent(blob, { signal: options.signal });
	return runOneShotWorkerTask<string>({ blob }, options.workerFactory ?? (() => (
		new Worker(new URL('./media-content-digest-worker-entry.ts', import.meta.url), { type: 'module', name: 'soundscaper-media-digest' }) as unknown as OneShotWorkerPort
	)), options);
}
