/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectScapeProject as inspectScapeArchive } from '../scape-project.js';
import type { EditorControllerLifetime } from './lifecycle.ts';

export const SCAPE_INSPECTION_TASK = 'scape-inspection';

export type ScapeInspectionOptions = Readonly<Record<string, unknown>> & Readonly<{
	signal?: AbortSignal;
}>;

export interface ScapeInspectionStore {
	loadProject?(projectId: string): PromiseLike<unknown> | unknown;
}

export type ScapeProjectInspector<Result> = (
	file: Blob,
	store: ScapeInspectionStore | null,
	options: Readonly<Record<string, unknown>> & Readonly<{ signal: AbortSignal }>,
) => PromiseLike<Result> | Result;

export interface ScapeInspectionService<Result> {
	inspect(file: Blob, options?: ScapeInspectionOptions): Promise<Result>;
}

export interface ScapeInspectionServiceRuntime<Result> {
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask'>;
	readonly store: ScapeInspectionStore | null;
	readonly inspectScapeProject?: ScapeProjectInspector<Result>;
}

export function createScapeInspectionService<Result = unknown>(
	runtime: ScapeInspectionServiceRuntime<Result>,
): ScapeInspectionService<Result> {
	const inspectProject = runtime.inspectScapeProject
		?? (inspectScapeArchive as ScapeProjectInspector<Result>);
	return Object.freeze({ inspect });

	async function inspect(file: Blob, options: ScapeInspectionOptions = {}): Promise<Result> {
		const task = runtime.lifetime.startTask(SCAPE_INSPECTION_TASK);
		try {
			const snapshot = { ...options };
			const signal = snapshot.signal
				? AbortSignal.any([task.signal, snapshot.signal])
				: task.signal;
			const ownedOptions = Object.freeze({ ...snapshot, signal });
			throwIfAborted(signal);
			const result = await inspectProject(file, runtime.store, ownedOptions);
			throwIfAborted(signal);
			task.assertCurrent();
			return result;
		} finally {
			task.finish();
		}
	}
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason;
}
