/* SPDX-License-Identifier: AGPL-3.0-only */

import { runOneShotWorkerTask, type OneShotWorkerPort } from './one-shot-worker-task.ts';
import type { GeneratedWorkerSignal } from './signal-generator-worker-runtime.ts';

export type SignalGeneratorWorkerPort = OneShotWorkerPort;

export function generateAudioEditorSignalInWorker(
	type: string,
	options: Readonly<Record<string, unknown>> = {},
	client: Readonly<{ signal?: AbortSignal; workerFactory?: () => SignalGeneratorWorkerPort }> = {},
): Promise<GeneratedWorkerSignal> {
	return runOneShotWorkerTask({ type: 'generate-signal/v1', generator: type, options },
		client.workerFactory ?? defaultWorkerFactory, { signal: client.signal });
}

function defaultWorkerFactory(): OneShotWorkerPort {
	return new Worker(new URL('./signal-generator-worker-entry.ts', import.meta.url), {
		type: 'module', name: 'soundscaper-generator',
	}) as unknown as OneShotWorkerPort;
}
