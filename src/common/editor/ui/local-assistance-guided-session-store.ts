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
	type AssistanceWorkflowReviewMediaAssetV1,
	type AssistanceWorkflowReviewAuthorityV1,
} from '../assistance/workflow-review-authority-v1.ts';
import type {
	LocalAssistanceBridge,
} from '../assistance/local-assistance-bridge.ts';
import type { AssistanceOwnedHighlightProposalsV1 } from
	'../assistance/owned-video-highlight-transform-types-v1.ts';
import type { AssistanceOwnedReframePathV1 } from
	'../assistance/owned-video-highlight-transform-types-v1.ts';
import {
	createLocalAssistanceGuidedHighlightDraftV1,
	setLocalAssistanceGuidedHighlightCropV1,
	setLocalAssistanceGuidedHighlightTitleV1,
	setLocalAssistanceGuidedHighlightTrimV1,
} from '../controller/local-assistance-guided-highlight-edits.ts';
import { readLocalAssistanceGuidedHighlightSourceTimeAuthorityV1 } from
	'../controller/local-assistance-guided-highlight-preview.ts';
import type { LocalAssistanceSelectedVideoSourceTimeDescriptorV1 } from
	'../controller/local-assistance-selected-video-source-time.ts';
import {
	createLocalAssistanceGuidedReframeDraftV1,
	setLocalAssistanceGuidedReframeCropV1,
} from '../controller/local-assistance-guided-reframe-edits.ts';
import { verifyLocalAssistanceGuidedReviewMediaAuthority as verifyReviewMediaAuthority } from
	'../controller/local-assistance-guided-review-media-verification.ts';
import {
	LOCAL_ASSISTANCE_GUIDED_PREPARATION_UNAVAILABLE_REASONS,
	type LocalAssistanceGuidedPreparationUnavailableReason,
	type LocalAssistanceSelectedMediaPreparationPort,
} from '../assistance/local-assistance-preparation.ts';
import type {
	LocalAssistanceWorkflowOutcome,
	LocalAssistanceWorkflowUnavailableReason,
} from '../assistance/local-assistance-workflow-bridge.ts';
import {
	reviewLocalAssistanceGuidedResult,
	type LocalAssistanceGuidedReviewedResult,
} from '../assistance/local-assistance-guided-result-review.ts';
import { createLocalAssistanceGuidedCustodyReleaseTracker } from
	'./local-assistance-guided-custody-release.ts';

export type LocalAssistanceDialogSurface = 'guided' | 'advanced';
export type LocalAssistanceGuidedPhase =
	| 'selection-required' | 'ready' | 'preparing' | 'running' | 'completed'
	| 'reviewing' | 'review-ready' | 'accepting' | 'accepted'
	| 'cancelled' | 'unavailable' | 'error';
export type LocalAssistanceGuidedUnavailableReason =
	| LocalAssistanceWorkflowUnavailableReason
	| LocalAssistanceGuidedPreparationUnavailableReason
	| 'workflow-bridge-unavailable'
	| 'aggregate-preparation-unavailable'
	| 'aggregate-custody-unavailable';

export function localAssistanceGuidedConfigurationLocked(
	phase: LocalAssistanceGuidedPhase,
): boolean {
	return phase === 'preparing' || phase === 'running' || phase === 'reviewing' || phase === 'accepting';
}

export interface LocalAssistanceGuidedSnapshot {
	readonly surface: LocalAssistanceDialogSurface;
	readonly phase: LocalAssistanceGuidedPhase;
	readonly workflowIds: readonly AssistanceGuidedWorkflowId[];
	readonly selectedWorkflowId: AssistanceGuidedWorkflowId | null;
	readonly settings: AssistanceWorkflowSettingsV1 | null;
	readonly progress: AssistanceWorkflowProgressV1 | null;
	readonly result: LocalAssistanceWorkflowOutcome | null;
	readonly review: LocalAssistanceGuidedReviewedResult | null;
	readonly auditionAudio: Blob | null;
	readonly auditionSourceStartFrame: number | null;
	readonly auditionSourceSampleRate: number | null;
	readonly previewVideo: Blob | null;
	readonly highlightSourceTimeAuthority: LocalAssistanceSelectedVideoSourceTimeDescriptorV1 | null;
	readonly reframeDraft: AssistanceOwnedReframePathV1 | null;
	readonly highlightDraft: AssistanceOwnedHighlightProposalsV1 | null;
	readonly selectedChoiceIds: readonly string[];
	readonly unavailableReason: LocalAssistanceGuidedUnavailableReason | null;
	readonly error: string | null;
	readonly canRun: boolean;
	readonly canCancel: boolean;
	readonly canReview: boolean;
	readonly canAccept: boolean;
}

export interface LocalAssistanceGuidedSessionStore {
	getSnapshot(): LocalAssistanceGuidedSnapshot;
	subscribe(listener: () => void): () => void;
	selectSurface(surface: LocalAssistanceDialogSurface): void;
	selectWorkflow(workflowId: AssistanceGuidedWorkflowId): void;
	setSettings(settings: AssistanceWorkflowSettingsV1): void;
	setReviewChoiceSelected(choiceId: string, selected: boolean): void;
	setReframeCrop(sourceFrame: number,
		crop: Readonly<{ left: number; top: number; right: number; bottom: number }>): void;
	setHighlightTitle(proposalId: string, title: string): void;
	setHighlightTrim(proposalId: string, startFrame: number, endFrame: number): void;
	setHighlightCrop(proposalId: string, sourceFrame: number,
		crop: Readonly<{ left: number; top: number; right: number; bottom: number }>): void;
	run(): Promise<void>;
	review(): Promise<void>;
	accept(): Promise<void>;
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
	review: null, auditionAudio: null, auditionSourceStartFrame: null,
	auditionSourceSampleRate: null, previewVideo: null, highlightSourceTimeAuthority: null,
	reframeDraft: null, highlightDraft: null,
	selectedChoiceIds: Object.freeze([]),
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
	const retainedJobs = new Map<string, Readonly<{
		workflow: AssistanceWorkflowV1;
		reviewAuthority: AssistanceWorkflowReviewAuthorityV1;
	}>>();
	const workflow = options.bridge?.workflow ?? null;
	const custodyReleases = workflow?.custody
		? createLocalAssistanceGuidedCustodyReleaseTracker(
			(jobId) => workflow.custody!.release(jobId),
		) : null;

	const emit = (): void => listeners.forEach((listener) => listener());
	const update = (change: Partial<LocalAssistanceGuidedSnapshot>): void => {
		snapshot = freezeSnapshot({ ...snapshot, ...change });
		emit();
	};
	const releaseRetainedJobs = (): void => {
		const jobIds = [...retainedJobs.keys()];
		retainedJobs.clear();
		custodyReleases?.releaseLater(jobIds);
	};
	const selectSurface = (surface: LocalAssistanceDialogSurface): void => {
		if (surface !== 'guided' && surface !== 'advanced') {
			throw new TypeError('The Local Assistance surface is unsupported.');
		}
		if (snapshot.canCancel) throw new Error('The active Guided workflow must finish or cancel first.');
		update({ surface });
	};
	const selectWorkflow = (workflowIdValue: AssistanceGuidedWorkflowId): void => {
		if (localAssistanceGuidedConfigurationLocked(snapshot.phase)) {
			throw new Error('The active Guided workflow selection is immutable.');
		}
		const workflowId = normalizeAssistanceWorkflowId(workflowIdValue);
		if (!GUIDED_IDS.has(workflowId)) throw new TypeError('The Guided assistance workflow is unsupported.');
		const selected = workflowId as AssistanceGuidedWorkflowId;
		const settings = validateAssistanceWorkflowSettingsV1(
			defaultAssistanceWorkflowSettingsV1(selected), selected,
		);
		releaseRetainedJobs();
		const unavailableReason = availability(options);
		update({ selectedWorkflowId: selected, settings,
			phase: unavailableReason ? 'unavailable' : 'ready', unavailableReason,
			progress: null, result: null, review: null, auditionAudio: null,
			auditionSourceStartFrame: null, auditionSourceSampleRate: null, previewVideo: null,
			highlightSourceTimeAuthority: null,
			reframeDraft: null,
			highlightDraft: null,
			selectedChoiceIds: Object.freeze([]), error: null });
	};
	const setSettings = (settingsValue: AssistanceWorkflowSettingsV1): void => {
		if (localAssistanceGuidedConfigurationLocked(snapshot.phase)) {
			throw new Error('The active Guided workflow settings are immutable.');
		}
		if (snapshot.selectedWorkflowId === null) {
			throw new Error('Choose a Guided workflow before changing its settings.');
		}
		const settings = validateAssistanceWorkflowSettingsV1(
			settingsValue, snapshot.selectedWorkflowId,
		);
		releaseRetainedJobs();
		const unavailableReason = availability(options);
		update({ settings, phase: unavailableReason ? 'unavailable' : 'ready', unavailableReason,
			progress: null, result: null, review: null, auditionAudio: null,
			auditionSourceStartFrame: null, auditionSourceSampleRate: null, previewVideo: null,
			highlightSourceTimeAuthority: null,
			reframeDraft: null,
			highlightDraft: null,
			selectedChoiceIds: Object.freeze([]), error: null });
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
			auditionAudio: null, auditionSourceStartFrame: null, auditionSourceSampleRate: null,
			previewVideo: null, highlightSourceTimeAuthority: null,
			reframeDraft: null, highlightDraft: null,
			selectedChoiceIds: Object.freeze([]),
			unavailableReason: null, error: null });
		let outcome: LocalAssistanceWorkflowOutcome | null = null;
		let failure: unknown = null;
		let progressDisconnect: (() => void) | null = null;
		try {
			if (custodyReleases && custodyReleases.pendingCount() > 0
				&& !await custodyReleases.releaseAll()) {
				throw new Error('Prior Guided native custody must release before another workflow can run.');
			}
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
				if (!await custodyReleases!.release(job.jobId)) {
					throw new Error('Guided native custody could not be released.');
				}
				activeJobId = null;
				throw new GuidedPreparationUnavailableError(prepared.reason);
			}
			const request = validateAssistanceWorkflow(prepared.workflow);
			if (request.jobId !== job.jobId || request.workflowId !== workflowId
				|| request.recipeVersion !== 1 || request.settingsVersion !== settings.settingsVersion) {
				throw new TypeError('Prepared Guided assistance lost its exact recipe or settings authority.');
			}
			await verifyReviewMediaAuthority(
				request, prepared.reviewAuthority, controller.signal,
			);
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
			else if (!await custodyReleases!.release(job.jobId)) {
				throw new Error('Guided native custody could not be released.');
			}
			activeJobId = null;
		} catch (error) {
			failure = error;
		} finally {
			controller = null;
			progressDisconnect?.();
			if (activeJobId) {
				const failedJobId = activeJobId;
				try { await workflow.cancel(failedJobId); } catch { /* Original failure remains authoritative. */ }
				await custodyReleases!.release(failedJobId);
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
		update({ phase: 'reviewing', review: null, auditionAudio: null,
			auditionSourceStartFrame: null, auditionSourceSampleRate: null, previewVideo: null,
			highlightSourceTimeAuthority: null, reframeDraft: null, highlightDraft: null, error: null });
		try {
			const reviewed = await reviewLocalAssistanceGuidedResult({ workflow: retained.workflow,
				result: snapshot.result.result, authority: retained.reviewAuthority,
				readOutput: (request) => workflow.readOutput!(request) });
			const audition = auditionAuthority(retained.workflow, retained.reviewAuthority.media.audio);
			const highlightSourceTimeAuthority = retained.workflow.workflowId === 'make-highlights'
				? await readLocalAssistanceGuidedHighlightSourceTimeAuthorityV1(retained.workflow,
					retained.reviewAuthority.highlightVideoSignals?.body ?? new Blob()) : null;
			if (!disposed) update({ phase: 'review-ready', review: reviewed,
				auditionAudio: retained.reviewAuthority.media.audio?.body ?? null,
				auditionSourceStartFrame: audition?.sourceStartFrame ?? null,
				auditionSourceSampleRate: audition?.sourceSampleRate ?? null,
				previewVideo: retained.reviewAuthority.media.video?.body ?? null,
				highlightSourceTimeAuthority,
				reframeDraft: reframeResult(reviewed),
				highlightDraft: highlightResult(reviewed),
				selectedChoiceIds: Object.freeze([]), error: null });
		} catch (error) {
			retainedJobs.delete(snapshot.result.jobId);
			const released = await custodyReleases?.release(snapshot.result.jobId) ?? false;
			if (!disposed) update({ phase: 'error', review: null, auditionAudio: null,
				auditionSourceStartFrame: null, auditionSourceSampleRate: null,
				previewVideo: null, highlightSourceTimeAuthority: null, reframeDraft: null,
				error: released ? error instanceof Error ? error.message
					: 'The Guided result review failed.'
					: 'Guided review failed and native custody remains pending for retry.' });
		}
	};
	const setReviewChoiceSelected = (choiceId: string, selected: boolean): void => {
		if (snapshot.phase !== 'review-ready' || !snapshot.review) {
			throw new Error('The Guided review is not open.');
		}
		const choice = snapshot.review.choices.find(({ id }) => id === choiceId);
		if (!choice || !choice.enabled) throw new RangeError('The Guided review choice is unavailable.');
		const ids = new Set(snapshot.selectedChoiceIds);
		if (snapshot.review.workflowId === 'separate-dialogue-music-effects') {
			for (const candidate of snapshot.review.choices) {
				if (candidate.enabled && selected) ids.add(candidate.id); else ids.delete(candidate.id);
			}
		} else if (selected) ids.add(choiceId); else ids.delete(choiceId);
		update({ selectedChoiceIds: Object.freeze(snapshot.review.choices
			.filter(({ id }) => ids.has(id)).map(({ id }) => id)) });
	};
	const setReframeCrop = (sourceFrame: number,
		crop: Readonly<{ left: number; top: number; right: number; bottom: number }>): void => {
		const draft = openReframeDraft(snapshot);
		update({ reframeDraft: setLocalAssistanceGuidedReframeCropV1(draft, sourceFrame, crop) });
	};
	const setHighlightTitle = (proposalId: string, title: string): void => {
		const draft = openHighlightDraft(snapshot);
		update({ highlightDraft: setLocalAssistanceGuidedHighlightTitleV1(draft, proposalId, title) });
	};
	const setHighlightTrim = (proposalId: string, startFrame: number, endFrame: number): void => {
		const draft = openHighlightDraft(snapshot);
		update({ highlightDraft: setLocalAssistanceGuidedHighlightTrimV1(
			highlightOriginal(snapshot.review!), draft, proposalId, startFrame, endFrame,
			snapshot.highlightSourceTimeAuthority,
		) });
	};
	const setHighlightCrop = (proposalId: string, sourceFrame: number,
		crop: Readonly<{ left: number; top: number; right: number; bottom: number }>): void => {
		const draft = openHighlightDraft(snapshot);
		update({ highlightDraft: setLocalAssistanceGuidedHighlightCropV1(
			draft, proposalId, sourceFrame, crop, snapshot.highlightSourceTimeAuthority,
		) });
	};
	const accept = async (): Promise<void> => {
		if (!snapshot.canAccept || !snapshot.review || !workflow?.readOutput
			|| !options.preparation?.acceptGuidedWorkflowResult) {
			throw new Error('The Guided result has no selected publication ready for acceptance.');
		}
		const retained = retainedJobs.get(snapshot.review.jobId);
		if (!retained) throw new Error('The Guided result custody has expired.');
		const selectedChoiceIds = Object.freeze([...snapshot.selectedChoiceIds]);
		update({ phase: 'accepting', error: null });
		try {
			const outcome = await options.preparation.acceptGuidedWorkflowResult({
				workflow: retained.workflow, reviewedResult: snapshot.review, selectedChoiceIds,
				...(snapshot.reframeDraft ? { reframeDraft: snapshot.reframeDraft } : {}),
				...(snapshot.highlightDraft ? { highlightDraft: snapshot.highlightDraft } : {}),
				...(snapshot.highlightSourceTimeAuthority
					? { highlightSourceTimeAuthority: snapshot.highlightSourceTimeAuthority } : {}),
				readOutput: (request) => workflow.readOutput!(request),
			});
			if (isUnsupportedAcceptance(outcome)) {
				update({ phase: 'error', error: `Guided publication is unavailable: ${outcome.reason}.` });
				return;
			}
			if (!isAccepted(outcome, selectedChoiceIds)) {
				throw new TypeError('Guided acceptance returned an invalid decision outcome.');
			}
			retainedJobs.delete(snapshot.review.jobId);
			const released = await custodyReleases?.release(snapshot.review.jobId) ?? false;
			if (!disposed) update({ phase: 'accepted', error: released ? null
				: 'Accepted output custody did not release and will retry during disposal.' });
		} catch (error) {
			if (!disposed) update({ phase: 'review-ready',
				error: error instanceof Error ? error.message : 'Guided result acceptance failed.' });
		}
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
		for (const jobId of retainedJobs.keys()) custodyReleases?.track(jobId);
		retainedJobs.clear();
		await custodyReleases?.releaseAll();
		listeners.clear();
	};

	return Object.freeze({
		getSnapshot: () => snapshot,
		subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
		selectSurface, selectWorkflow, setSettings, setReviewChoiceSelected,
		setReframeCrop,
		setHighlightTitle, setHighlightTrim, setHighlightCrop,
		run, review, accept, cancel, dispose,
	});
}

function auditionAuthority(
	workflow: AssistanceWorkflowV1,
	asset: AssistanceWorkflowReviewMediaAssetV1 | null,
): Readonly<{ sourceStartFrame: number; sourceSampleRate: number }> | null {
	if (asset === null) return null;
	const ranges = workflow.fence.sourceRanges.filter(({ mediaKind }) => mediaKind === 'audio');
	if (ranges.length !== 1 || ranges[0]!.sourceSampleRate === null) {
		throw new TypeError('Guided audio audition lost its exact source-time authority.');
	}
	return Object.freeze({ sourceStartFrame: ranges[0]!.sourceStartFrame,
		sourceSampleRate: ranges[0]!.sourceSampleRate });
}

function reframeResult(
	review: LocalAssistanceGuidedReviewedResult,
): AssistanceOwnedReframePathV1 | null {
	if (review.workflowId !== 'reframe') return null;
	return createLocalAssistanceGuidedReframeDraftV1(reframeOriginal(review));
}

function reframeOriginal(review: LocalAssistanceGuidedReviewedResult): unknown {
	const matches = review.outputs.filter(({ slotId }) => slotId === 'reframe-path');
	if (matches.length !== 1) {
		throw new TypeError('The Guided Reframe review lost its exact path terminal.');
	}
	return matches[0]!.semantic;
}

function openReframeDraft(value: LocalAssistanceGuidedSnapshot): AssistanceOwnedReframePathV1 {
	if (value.phase !== 'review-ready' || value.review?.workflowId !== 'reframe'
		|| !value.reframeDraft) {
		throw new Error('The Guided Reframe review is not open.');
	}
	return value.reframeDraft;
}

function highlightResult(
	review: LocalAssistanceGuidedReviewedResult,
): AssistanceOwnedHighlightProposalsV1 | null {
	if (review.workflowId !== 'make-highlights') return null;
	return createLocalAssistanceGuidedHighlightDraftV1(highlightOriginal(review));
}

function highlightOriginal(review: LocalAssistanceGuidedReviewedResult): unknown {
	const matches = review.outputs.filter(({ slotId }) => slotId === 'highlight-proposals');
	if (matches.length !== 1) {
		throw new TypeError('The Guided highlight review lost its exact proposal terminal.');
	}
	return matches[0]!.semantic;
}

function openHighlightDraft(
	value: LocalAssistanceGuidedSnapshot,
): AssistanceOwnedHighlightProposalsV1 {
	if (value.phase !== 'review-ready' || value.review?.workflowId !== 'make-highlights'
		|| !value.highlightDraft) {
		throw new Error('The Guided highlight review is not open.');
	}
	return value.highlightDraft;
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
	value: Omit<LocalAssistanceGuidedSnapshot, 'canRun' | 'canCancel' | 'canReview' | 'canAccept'>,
): LocalAssistanceGuidedSnapshot {
	const unavailableReason = value.selectedWorkflowId ? value.unavailableReason : null;
	return Object.freeze({ ...value, unavailableReason,
		canRun: value.phase === 'ready' && value.selectedWorkflowId !== null
			&& value.settings !== null && unavailableReason === null,
		canCancel: value.phase === 'preparing' || value.phase === 'running',
		canReview: value.phase === 'completed' && value.result?.outcome === 'completed',
		canAccept: value.phase === 'review-ready' && value.selectedChoiceIds.length > 0,
	});
}

function isUnsupportedAcceptance(value: unknown): value is Readonly<{ reason: string }> {
	return Boolean(value && typeof value === 'object'
		&& (value as Readonly<Record<string, unknown>>).outcome === 'unsupported'
		&& typeof (value as Readonly<Record<string, unknown>>).reason === 'string');
}

function isAccepted(value: unknown, selectedIds: readonly string[]): boolean {
	if (!value || typeof value !== 'object') return false;
	const row = value as Readonly<Record<string, unknown>>;
	return row.outcome === 'accepted' && Array.isArray(row.selectedIds)
		&& JSON.stringify(row.selectedIds) === JSON.stringify(selectedIds);
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
