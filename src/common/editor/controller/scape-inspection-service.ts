/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectScapeProject as inspectScapeArchive } from '../scape-project.js';
import { restoreNormalizedScapeAbortReason } from '../scape-abort.ts';
import type { EditorControllerLifetime, EditorTaskScope } from './lifecycle.ts';
import {
	createScapeInspectionQuiescence,
	type ScapeInspectionOutcome,
	type ScapeInspectionQuiescence,
} from './scape-inspection-quiescence.ts';

export const SCAPE_INSPECTION_TASK = 'scape-inspection';

export type ScapeInspectionOptions = Readonly<Record<string, unknown>> & Readonly<{
	signal?: AbortSignal;
}>;

export interface ScapeInspectionStore {
	loadProject?(
		projectId: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): PromiseLike<unknown> | unknown;
}

export interface ScapeInspectionRetention {
	retain(settlement: PromiseLike<unknown>): void;
}

export type ScapeProjectInspector<Result> = (
	file: Blob,
	store: ScapeInspectionStore | null,
	options: Readonly<Record<string, unknown>> & Readonly<{ signal: AbortSignal }>,
	retention: ScapeInspectionRetention,
) => PromiseLike<Result> | Result;

export interface ScapeInspectionService<Result> {
	inspect(file: Blob, options?: ScapeInspectionOptions): Promise<Result>;
}

export interface ScapeInspectionServiceRuntime<Result> {
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask'>;
	readonly scapeInspectionQuiescence?: Pick<ScapeInspectionQuiescence, 'admit'>;
	readonly store: ScapeInspectionStore | null;
	readonly providerOptions?: Readonly<Record<string, unknown>>;
	readonly inspectScapeProject?: ScapeProjectInspector<Result>;
}

export function createScapeInspectionService<Result = unknown>(
	runtime: ScapeInspectionServiceRuntime<Result>,
): ScapeInspectionService<Result> {
	const inspectProject = runtime.inspectScapeProject
		?? (inspectScapeArchive as ScapeProjectInspector<Result>);
	const quiescence = runtime.scapeInspectionQuiescence ?? createScapeInspectionQuiescence();
	const providerOptions = Object.freeze({ ...runtime.providerOptions });
	return Object.freeze({ inspect });

	async function inspect(file: Blob, options: ScapeInspectionOptions = {}): Promise<Result> {
		const admission = quiescence.admit();
		const retention = Object.freeze({
			retain: (settlement: PromiseLike<unknown>) => { admission.retain(settlement); },
		});
		let task: EditorTaskScope | null = null;
		let signal: AbortSignal = admission.signal;
		let outcome: ScapeInspectionOutcome = Object.freeze({ status: 'fulfilled' });
		const cancelAdmission = () => { admission.cancel(signal.reason); };
		try {
			task = runtime.lifetime.startTask(SCAPE_INSPECTION_TASK);
			const snapshot = { ...options };
			signal = AbortSignal.any([
				admission.signal,
				task.signal,
				...(snapshot.signal ? [snapshot.signal] : []),
			]);
			signal.addEventListener('abort', cancelAdmission, { once: true });
			if (signal.aborted) cancelAdmission();
			const ownedOptions = Object.freeze({ ...snapshot, ...providerOptions, signal });
			throwIfAborted(signal);
			const result = await inspectProject(file, runtime.store, ownedOptions, retention);
			throwIfAborted(signal);
			task.assertCurrent();
			return result;
		} catch (error) {
			outcome = Object.freeze({
				status: 'rejected',
				reason: quiescenceOutcomeReason(error, signal),
			});
			throw error;
		} finally {
			signal.removeEventListener('abort', cancelAdmission);
			try {
				task?.finish();
			} finally {
				admission.finish(outcome);
			}
		}
	}
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason;
}

function quiescenceOutcomeReason(error: unknown, signal: AbortSignal): unknown {
	const restoredReason = restoreNormalizedScapeAbortReason(error);
	if (signal.aborted && Object.is(restoredReason, signal.reason)) return restoredReason;
	return error;
}
