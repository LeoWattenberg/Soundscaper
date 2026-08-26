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
	type AssistanceWorkflowV1,
} from '../assistance/workflow.ts';
import {
	validateAssistanceWorkflowReviewAuthorityV1,
	type AssistanceWorkflowReviewAuthorityV1,
} from '../assistance/workflow-review-authority-v1.ts';
import type {
	LocalAssistanceBridge,
} from './local-assistance-bridge.ts';
import {
	LOCAL_ASSISTANCE_GUIDED_PREPARATION_UNAVAILABLE_REASONS,
	type LocalAssistanceGuidedPreparationUnavailableReason,
	type LocalAssistanceSelectedMediaPreparationPort,
} from './local-assistance-preparation.ts';
import type {
	LocalAssistanceWorkflowOutcome,
	LocalAssistanceWorkflowUnavailableReason,
} from './local-assistance-workflow-bridge.ts';
import {
	reviewLocalAssistanceGuidedResult,
	type LocalAssistanceGuidedReviewedResult,
} from './local-assistance-guided-result-review.ts';

export type LocalAssistanceDialogSurface = 'guided' | 'advanced';
export type LocalAssistanceGuidedPhase =
	| 'selection-required' | 'ready' | 'preparing' | 'running' | 'completed'
	| 'reviewing' | 'review-ready' | 'cancelled' | 'unavailable' | 'error';
export type LocalAssistanceGuidedUnavailableReason =
	| LocalAssistanceWorkflowUnavailableReason
	| LocalAssistanceGuidedPreparationUnavailableReason
	| 'workflow-bridge-unavailable'
	| 'aggregate-preparation-unavailable'
	| 'aggregate-custody-unavailable';

export interface LocalAssistanceGuidedSnapshot {
	readonly surface: LocalAssistanceDialogSurface;
	readonly phase: LocalAssistanceGuidedPhase;
	readonly workflowIds: readonly AssistanceGuidedWorkflowId[];
	readonly selectedWorkflowId: AssistanceGuidedWorkflowId | null;
	readonly settings: AssistanceWorkflowSettingsV1 | null;
	readonly progress: AssistanceWorkflowProgressV1 | null;
	readonly result: LocalAssistanceWorkflowOutcome | null;
	readonly review: LocalAssistanceGuidedReviewedResult | null;
	readonly selectedChoiceIds: readonly string[];
	readonly unavailableReason: LocalAssistanceGuidedUnavailableReason | null;
	readonly error: string | null;
	readonly canRun: boolean;
	readonly canCancel: boolean;
	readonly canReview: boolean;
}

export interface LocalAssistanceGuidedSessionStore {
	getSnapshot(): LocalAssistanceGuidedSnapshot;
	subscribe(listener: () => void): () => void;
	selectSurface(surface: LocalAssistanceDialogSurface): void;
	selectWorkflow(workflowId: AssistanceGuidedWorkflowId): void;
	setSettings(settings: AssistanceWorkflowSettingsV1): void;
	setReviewChoiceSelected(choiceId: string, selected: boolean): void;
	run(): Promise<void>;
	review(): Promise<void>;
	cancel(): Promise<void>;
	dispose(): Promise<void>;
}

interface Options {
	readonly bridge: Pick<LocalAssistanceBridge, 'models' | 'workflow'> | null;
	readonly preparation: LocalAssistanceSelectedMediaPreparationPort | null;
}

const GUIDED_IDS = new Set<unknown>(ASSISTANCE_GUIDED_WORKFLOW_IDS);
export const INITIAL_LOCAL_ASSISTANCE_GUIDED_SNAPSHOT: LocalAssistanceGuidedSnapshot = freezeSnapshot({
	surface: 'guided', phase: 'selection-required', workflowIds: ASSISTANCE_GUIDED_WORKFLOW_IDS,
	selectedWorkflowId: null, settings: null, progress: null, result: null,
	review: null, selectedChoiceIds: Object.freeze([]), unavailableReason: null, error: null,
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
	const retainedJobs = new Map<string, Readonly<{
		workflow: AssistanceWorkflowV1;
		reviewAuthority: AssistanceWorkflowReviewAuthorityV1;
	}>>();
	const workflow = options.bridge?.workflow ?? null;

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
			progress: null, result: null, review: null, selectedChoiceIds: Object.freeze([]), error: null });
	};
	const setSettings = (settingsValue: AssistanceWorkflowSettingsV1): void => {
		if (snapshot.canCancel) throw new Error('The active Guided workflow settings are immutable.');
		if (snapshot.selectedWorkflowId === null) {
			throw new Error('Choose a Guided workflow before changing its settings.');
		}
		const settings = validateAssistanceWorkflowSettingsV1(
			settingsValue, snapshot.selectedWorkflowId,
		);
		const unavailableReason = availability(options);
		update({ settings, phase: unavailableReason ? 'unavailable' : 'ready', unavailableReason,
			progress: null, result: null, review: null, selectedChoiceIds: Object.freeze([]), error: null });
	};

	const execute = async (): Promise<void> => {
		if (!snapshot.canRun || !workflow?.custody || !options.bridge
			|| !options.preparation?.prepareGuidedWorkflow) {
			throw new Error('The Guided assistance workflow is not ready or is unavailable.');
		}
		const workflowId = snapshot.selectedWorkflowId!;
		const settings = validateAssistanceWorkflowSettingsV1(snapshot.settings, workflowId);
		cancelRequested = false;
		update({ phase: 'preparing', progress: null, result: null, review: null,
			selectedChoiceIds: Object.freeze([]),
			unavailableReason: null, error: null });
		let outcome: LocalAssistanceWorkflowOutcome | null = null;
		let failure: unknown = null;
		let progressDisconnect: (() => void) | null = null;
		try {
			controller = new AbortController();
			const job = await workflow.createJob();
			activeJobId = job.jobId;
			const models = await options.bridge.models();
			const preparedValue = await options.preparation.prepareGuidedWorkflow({
				jobId: job.jobId, workflowId, settings, models,
				custody: workflow.custody, signal: controller.signal,
			});
			const prepared = normalizePreparationOutcome(preparedValue);
			if (prepared.outcome === 'unavailable') {
				await workflow.custody.release(job.jobId);
				activeJobId = null;
				throw new GuidedPreparationUnavailableError(prepared.reason);
			}
			const request = validateAssistanceWorkflow(prepared.workflow);
			if (request.jobId !== job.jobId || request.workflowId !== workflowId
				|| request.recipeVersion !== 1 || request.settingsVersion !== settings.settingsVersion) {
				throw new TypeError('Prepared Guided assistance lost its exact recipe or settings authority.');
			}
			if (cancelRequested) throw new GuidedCancelledError();
			progressDisconnect = workflow.onProgress((progress) => {
				if (progress.jobId === activeJobId && progress.workflowId === workflowId) {
					update({ phase: 'running', progress });
				}
			});
			update({ phase: 'running' });
			outcome = await workflow.run(request);
			if (outcome.outcome === 'completed') retainedJobs.set(job.jobId, Object.freeze({
				workflow: request, reviewAuthority: prepared.reviewAuthority,
			}));
			else await workflow.custody.release(job.jobId);
			activeJobId = null;
		} catch (error) {
			failure = error;
		} finally {
			controller = null;
			progressDisconnect?.();
			if (activeJobId) {
				try { await workflow.cancel(activeJobId); } catch { /* Original failure remains authoritative. */ }
				activeJobId = null;
			}
		}
		if (disposed) return;
		if (cancelRequested || failure instanceof GuidedCancelledError) {
			update({ phase: 'cancelled', progress: null, result: null,
				unavailableReason: null, error: null });
		} else if (failure instanceof GuidedPreparationUnavailableError) {
			update({ phase: 'unavailable', progress: null, result: null,
				unavailableReason: failure.reason, error: null });
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
	const review = async (): Promise<void> => {
		if (!snapshot.canReview || snapshot.result?.outcome !== 'completed'
			|| !workflow?.readOutput) throw new Error('The Guided result is not ready for review.');
		const retained = retainedJobs.get(snapshot.result.jobId);
		if (!retained) throw new Error('The Guided result custody has expired.');
		update({ phase: 'reviewing', review: null, error: null });
		try {
			const reviewed = await reviewLocalAssistanceGuidedResult({ workflow: retained.workflow,
				result: snapshot.result.result, authority: retained.reviewAuthority,
				readOutput: (request) => workflow.readOutput!(request) });
			if (!disposed) update({ phase: 'review-ready', review: reviewed,
				selectedChoiceIds: Object.freeze([]), error: null });
		} catch (error) {
			if (!disposed) update({ phase: 'error', review: null,
				error: error instanceof Error ? error.message : 'The Guided result review failed.' });
		}
	};
	const setReviewChoiceSelected = (choiceId: string, selected: boolean): void => {
		if (snapshot.phase !== 'review-ready' || !snapshot.review) {
			throw new Error('The Guided review is not open.');
		}
		const choice = snapshot.review.choices.find(({ id }) => id === choiceId);
		if (!choice || !choice.enabled) throw new RangeError('The Guided review choice is unavailable.');
		const ids = new Set(snapshot.selectedChoiceIds);
		if (selected) ids.add(choiceId); else ids.delete(choiceId);
		update({ selectedChoiceIds: Object.freeze(snapshot.review.choices
			.filter(({ id }) => ids.has(id)).map(({ id }) => id)) });
	};
	const cancel = async (): Promise<void> => {
		if (!running || !snapshot.canCancel || !workflow) return;
		cancelRequested = true;
		controller?.abort(new GuidedCancelledError());
		if (activeJobId) {
			try { await workflow.cancel(activeJobId); } catch { /* Execute owns the final state. */ }
		}
		await running;
	};
	const dispose = async (): Promise<void> => {
		disposed = true;
		cancelRequested = true;
		controller?.abort(new GuidedCancelledError());
		if (activeJobId && workflow) {
			try { await workflow.cancel(activeJobId); } catch { /* Best-effort disposal. */ }
		}
		await running;
		if (workflow?.custody) {
			const custody = workflow.custody;
			await Promise.allSettled([...retainedJobs.keys()].map((jobId) => custody.release(jobId)));
			retainedJobs.clear();
		}
		listeners.clear();
	};

	return Object.freeze({
		getSnapshot: () => snapshot,
		subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
		selectSurface, selectWorkflow, setSettings, setReviewChoiceSelected,
		run, review, cancel, dispose,
	});
}

function availability(options: Options): LocalAssistanceGuidedUnavailableReason | null {
	if (!options.bridge?.workflow) return 'workflow-bridge-unavailable';
	if (!options.bridge.workflow.custody) return 'aggregate-custody-unavailable';
	if (typeof options.preparation?.prepareGuidedWorkflow !== 'function') {
		return 'aggregate-preparation-unavailable';
	}
	return null;
}

function freezeSnapshot(
	value: Omit<LocalAssistanceGuidedSnapshot, 'canRun' | 'canCancel' | 'canReview'>,
): LocalAssistanceGuidedSnapshot {
	const unavailableReason = value.selectedWorkflowId ? value.unavailableReason : null;
	return Object.freeze({ ...value, unavailableReason,
		canRun: value.phase === 'ready' && value.selectedWorkflowId !== null
			&& value.settings !== null && unavailableReason === null,
		canCancel: value.phase === 'preparing' || value.phase === 'running',
		canReview: value.phase === 'completed' && value.result?.outcome === 'completed',
	});
}

class GuidedCancelledError extends Error {}

class GuidedPreparationUnavailableError extends Error {
	readonly reason: LocalAssistanceGuidedPreparationUnavailableReason;
	constructor(reason: LocalAssistanceGuidedPreparationUnavailableReason) {
		super(`Guided preparation is unavailable: ${reason}`); this.reason = reason;
	}
}

function normalizePreparationOutcome(value: unknown): Readonly<{
	outcome: 'prepared'; workflow: unknown; reviewAuthority: AssistanceWorkflowReviewAuthorityV1;
}> | Readonly<{
	outcome: 'unavailable'; reason: LocalAssistanceGuidedPreparationUnavailableReason;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError('Guided preparation returned an invalid outcome.');
	}
	const row = value as Record<string, unknown>;
	if (row.outcome === 'prepared' && Object.keys(row).length === 3 && Object.hasOwn(row, 'workflow')
		&& Object.hasOwn(row, 'reviewAuthority')) {
		return Object.freeze({ outcome: 'prepared', workflow: row.workflow,
			reviewAuthority: validateAssistanceWorkflowReviewAuthorityV1(row.reviewAuthority) });
	}
	if (row.outcome === 'unavailable' && Object.keys(row).length === 2
		&& LOCAL_ASSISTANCE_GUIDED_PREPARATION_UNAVAILABLE_REASONS.includes(
			row.reason as LocalAssistanceGuidedPreparationUnavailableReason,
		)) {
		return Object.freeze({ outcome: 'unavailable',
			reason: row.reason as LocalAssistanceGuidedPreparationUnavailableReason });
	}
	throw new TypeError('Guided preparation returned an invalid outcome.');
}
