/* SPDX-License-Identifier: AGPL-3.0-only */

/** Guided-workflow selection and honest aggregate-request execution, separate from operation-v1. */

import {
	ASSISTANCE_GUIDED_WORKFLOW_IDS,
	normalizeAssistanceWorkflowId,
	type AssistanceGuidedWorkflowId,
} from '../assistance/workflow-recipes.ts';
import {
	defaultAssistanceWorkflowSettingsV1,
	validateAssistanceWorkflowSettingsV1,
	type AssistanceWorkflowSettingsV1,
} from '../assistance/workflow-settings-v1.ts';
import {
	validateAssistanceWorkflow,
	type AssistanceWorkflowProgressV1,
} from '../assistance/workflow.ts';
import type {
	LocalAssistanceSelectedMediaPreparationPort,
} from './local-assistance-preparation.ts';
import type {
	LocalAssistanceWorkflowBridge,
	LocalAssistanceWorkflowOutcome,
	LocalAssistanceWorkflowUnavailableReason,
} from './local-assistance-workflow-bridge.ts';

export type LocalAssistanceDialogSurface = 'guided' | 'advanced';
export type LocalAssistanceGuidedPhase =
	| 'selection-required' | 'ready' | 'preparing' | 'running' | 'completed'
	| 'cancelled' | 'unavailable' | 'error';
export type LocalAssistanceGuidedUnavailableReason =
	| LocalAssistanceWorkflowUnavailableReason
	| 'workflow-bridge-unavailable'
	| 'aggregate-preparation-unavailable';

export interface LocalAssistanceGuidedSnapshot {
	readonly surface: LocalAssistanceDialogSurface;
	readonly phase: LocalAssistanceGuidedPhase;
	readonly workflowIds: readonly AssistanceGuidedWorkflowId[];
	readonly selectedWorkflowId: AssistanceGuidedWorkflowId | null;
	readonly settings: AssistanceWorkflowSettingsV1 | null;
	readonly progress: AssistanceWorkflowProgressV1 | null;
	readonly result: LocalAssistanceWorkflowOutcome | null;
	readonly unavailableReason: LocalAssistanceGuidedUnavailableReason | null;
	readonly error: string | null;
	readonly canRun: boolean;
	readonly canCancel: boolean;
}

export interface LocalAssistanceGuidedSessionStore {
	getSnapshot(): LocalAssistanceGuidedSnapshot;
	subscribe(listener: () => void): () => void;
	selectSurface(surface: LocalAssistanceDialogSurface): void;
	selectWorkflow(workflowId: AssistanceGuidedWorkflowId): void;
	run(): Promise<void>;
	cancel(): Promise<void>;
	dispose(): Promise<void>;
}

interface Options {
	readonly workflow: LocalAssistanceWorkflowBridge | null;
	readonly preparation: LocalAssistanceSelectedMediaPreparationPort | null;
}

const GUIDED_IDS = new Set<unknown>(ASSISTANCE_GUIDED_WORKFLOW_IDS);
export const INITIAL_LOCAL_ASSISTANCE_GUIDED_SNAPSHOT: LocalAssistanceGuidedSnapshot = freezeSnapshot({
	surface: 'guided', phase: 'selection-required', workflowIds: ASSISTANCE_GUIDED_WORKFLOW_IDS,
	selectedWorkflowId: null, settings: null, progress: null, result: null,
	unavailableReason: null, error: null,
});

export function createLocalAssistanceGuidedSessionStore(
	options: Options,
): LocalAssistanceGuidedSessionStore {
	const listeners = new Set<() => void>();
	let snapshot = INITIAL_LOCAL_ASSISTANCE_GUIDED_SNAPSHOT;
	let controller: AbortController | null = null;
	let activeJobId: string | null = null;
	let running: Promise<void> | null = null;
	let cancelRequested = false;
	let disposed = false;

	const emit = (): void => listeners.forEach((listener) => listener());
	const update = (change: Partial<LocalAssistanceGuidedSnapshot>): void => {
		snapshot = freezeSnapshot({ ...snapshot, ...change });
		emit();
	};
	const selectSurface = (surface: LocalAssistanceDialogSurface): void => {
		if (surface !== 'guided' && surface !== 'advanced') {
			throw new TypeError('The Local Assistance surface is unsupported.');
		}
		if (snapshot.canCancel) throw new Error('The active Guided workflow must finish or cancel first.');
		update({ surface });
	};
	const selectWorkflow = (workflowIdValue: AssistanceGuidedWorkflowId): void => {
		if (snapshot.canCancel) throw new Error('The active Guided workflow selection is immutable.');
		const workflowId = normalizeAssistanceWorkflowId(workflowIdValue);
		if (!GUIDED_IDS.has(workflowId)) throw new TypeError('The Guided assistance workflow is unsupported.');
		const selected = workflowId as AssistanceGuidedWorkflowId;
		const settings = validateAssistanceWorkflowSettingsV1(
			defaultAssistanceWorkflowSettingsV1(selected), selected,
		);
		const unavailableReason = availability(options);
		update({ selectedWorkflowId: selected, settings,
			phase: unavailableReason ? 'unavailable' : 'ready', unavailableReason,
			progress: null, result: null, error: null });
	};

	const execute = async (): Promise<void> => {
		if (!snapshot.canRun || !options.workflow || !options.preparation?.prepareGuidedWorkflow) {
			throw new Error('The Guided assistance workflow is not ready or is unavailable.');
		}
		const workflowId = snapshot.selectedWorkflowId!;
		const settings = validateAssistanceWorkflowSettingsV1(snapshot.settings, workflowId);
		cancelRequested = false;
		update({ phase: 'preparing', progress: null, result: null,
			unavailableReason: null, error: null });
		let outcome: LocalAssistanceWorkflowOutcome | null = null;
		let failure: unknown = null;
		let progressDisconnect: (() => void) | null = null;
		try {
			controller = new AbortController();
			const job = await options.workflow.createJob();
			activeJobId = job.jobId;
			const preparedValue = await options.preparation.prepareGuidedWorkflow({
				jobId: job.jobId, workflowId, settings, signal: controller.signal,
			});
			const request = validateAssistanceWorkflow(preparedValue);
			if (request.jobId !== job.jobId || request.workflowId !== workflowId
				|| request.recipeVersion !== 1 || request.settingsVersion !== settings.settingsVersion) {
				throw new TypeError('Prepared Guided assistance lost its exact recipe or settings authority.');
			}
			if (cancelRequested) throw new GuidedCancelledError();
			progressDisconnect = options.workflow.onProgress((progress) => {
				if (progress.jobId === activeJobId && progress.workflowId === workflowId) {
					update({ phase: 'running', progress });
				}
			});
			update({ phase: 'running' });
			outcome = await options.workflow.run(request);
			activeJobId = null;
		} catch (error) {
			failure = error;
		} finally {
			controller = null;
			progressDisconnect?.();
			if (activeJobId && options.workflow) {
				try { await options.workflow.cancel(activeJobId); } catch { /* Original failure remains authoritative. */ }
				activeJobId = null;
			}
		}
		if (disposed) return;
		if (cancelRequested || failure instanceof GuidedCancelledError) {
			update({ phase: 'cancelled', progress: null, result: null,
				unavailableReason: null, error: null });
		} else if (failure) {
			update({ phase: 'error', progress: null, result: null, unavailableReason: null,
				error: failure instanceof Error ? failure.message : 'The Guided workflow failed.' });
		} else if (outcome?.outcome === 'unavailable') {
			update({ phase: 'unavailable', progress: null, result: outcome,
				unavailableReason: outcome.reason, error: null });
		} else if (outcome?.outcome === 'consent-declined') {
			update({ phase: 'cancelled', progress: null, result: null,
				unavailableReason: null, error: null });
		} else if (outcome?.outcome === 'completed') {
			update({ phase: 'completed', progress: null, result: outcome,
				unavailableReason: null, error: null });
		} else {
			update({ phase: 'error', progress: null, result: null,
				unavailableReason: null, error: 'The Guided workflow returned no result.' });
		}
	};
	const run = async (): Promise<void> => {
		if (running) return running;
		running = execute().finally(() => { running = null; });
		return running;
	};
	const cancel = async (): Promise<void> => {
		if (!running || !snapshot.canCancel || !options.workflow) return;
		cancelRequested = true;
		controller?.abort(new GuidedCancelledError());
		if (activeJobId) {
			try { await options.workflow.cancel(activeJobId); } catch { /* Execute owns the final state. */ }
		}
		await running;
	};
	const dispose = async (): Promise<void> => {
		disposed = true;
		cancelRequested = true;
		controller?.abort(new GuidedCancelledError());
		if (activeJobId && options.workflow) {
			try { await options.workflow.cancel(activeJobId); } catch { /* Best-effort disposal. */ }
		}
		await running;
		listeners.clear();
	};

	return Object.freeze({
		getSnapshot: () => snapshot,
		subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
		selectSurface, selectWorkflow, run, cancel, dispose,
	});
}

function availability(options: Options): LocalAssistanceGuidedUnavailableReason | null {
	if (!options.workflow) return 'workflow-bridge-unavailable';
	if (typeof options.preparation?.prepareGuidedWorkflow !== 'function') {
		return 'aggregate-preparation-unavailable';
	}
	return null;
}

function freezeSnapshot(
	value: Omit<LocalAssistanceGuidedSnapshot, 'canRun' | 'canCancel'>,
): LocalAssistanceGuidedSnapshot {
	const unavailableReason = value.selectedWorkflowId ? value.unavailableReason : null;
	return Object.freeze({ ...value, unavailableReason,
		canRun: value.phase === 'ready' && value.selectedWorkflowId !== null
			&& value.settings !== null && unavailableReason === null,
		canCancel: value.phase === 'preparing' || value.phase === 'running',
	});
}

class GuidedCancelledError extends Error {}
