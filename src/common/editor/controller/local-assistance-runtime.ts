/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveLocalAssistanceSelectedMediaAuthority,
} from './local-assistance-selected-media.ts';
import {
	resolveLocalAssistanceSelectedVideoAuthority,
} from './local-assistance-selected-video.ts';
import {
	createLocalAssistanceSelectedPreparation,
	type LocalAssistanceSelectedVideoStore,
} from './local-assistance-selected-preparation.ts';
import {
	createLocalAssistanceGuidedWorkflowPreparation,
} from './local-assistance-guided-preparation.ts';
import {
	createLocalAssistanceResultAcceptance,
	type LocalAssistanceResultAcceptanceStore,
} from './local-assistance-result-acceptance.ts';
import {
	createLocalAssistanceGuidedResultAcceptance,
	type LocalAssistanceGuidedHighlightAcceptanceRequest,
	type LocalAssistanceGuidedReframeAcceptanceRequest,
} from './local-assistance-guided-result-acceptance.ts';
import {
	publishLocalAssistanceGuidedIndex,
} from './local-assistance-guided-index-publication.ts';
import {
	retainLocalAssistanceGuidedReactionScores,
} from './local-assistance-guided-reaction-derivative.ts';
import { validateAssistanceWorkflow } from '../assistance/workflow.ts';
import type { LocalAssistanceGuidedWorkflowAcceptanceRequest } from
	'../ui/local-assistance-preparation.ts';
import type { DeferredLocalAssistanceRuntimeDependencies } from './deferred-local-assistance-runtime.ts';

/** Compose the stateful selected-media and proposal-acceptance ports after invocation. */
export function createLocalAssistancePreparationRuntime(
	dependencies: DeferredLocalAssistanceRuntimeDependencies,
) {
	const selectedMediaDependencies = {
		getProject: dependencies.getProject,
		getSelectedClipId: dependencies.getSelectedClipId,
		captureProject: dependencies.captureProject,
		assertProject: dependencies.assertProject,
		renderDryTrackRange: dependencies.renderDryTrackRange,
	};
	const assistanceStore = dependencies.assistanceStore as
		LocalAssistanceResultAcceptanceStore | undefined;
	const assistanceVideoStore = dependencies.assistanceVideoStore as
		LocalAssistanceSelectedVideoStore | undefined;
	const currentVideoAuthority = () => resolveLocalAssistanceSelectedVideoAuthority(
		selectedMediaDependencies,
	);
	const currentSelectionFence = () => {
		try { return resolveLocalAssistanceSelectedMediaAuthority(selectedMediaDependencies).fence; }
		catch (audioError) {
			if (!assistanceVideoStore) throw audioError;
			return currentVideoAuthority().fence;
		}
	};
	const resultAcceptance = assistanceStore ? createLocalAssistanceResultAcceptance({
		currentAuthority: () => resolveLocalAssistanceSelectedMediaAuthority(selectedMediaDependencies),
		...(assistanceVideoStore ? {
			currentVideoAuthority,
		} : {}),
		captureProject: dependencies.captureProject,
		store: assistanceStore,
		audioStore: assistanceStore,
		createId: dependencies.createId,
		preflightStorage: dependencies.preflightStorage,
		assertProject: dependencies.assertProject,
		commit: dependencies.commit,
	}) : null;
	const guidedAcceptance = resultAcceptance ? createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence,
		acceptValidatedResult: (request) => resultAcceptance.acceptValidatedResult(request),
		acceptAudioResult: (request, choice) => resultAcceptance.acceptAudioResult(request, choice),
		acceptCleanupResult: (request) => resultAcceptance.acceptCleanupResult(request),
		createBeatReviewSession: (request) => resultAcceptance.createBeatReviewSession(request),
		createReactionReviewSession: (request) =>
			resultAcceptance.createReactionReviewSession(request),
		...(assistanceVideoStore ? {
			acceptReframeResult: (request: LocalAssistanceGuidedReframeAcceptanceRequest) =>
				acceptFramescaperReframe(request),
			acceptHighlightResult: (request: LocalAssistanceGuidedHighlightAcceptanceRequest) =>
				acceptFramescaperHighlights(request),
		} : {}),
	}) : null;
	const selectedPreparation = createLocalAssistanceSelectedPreparation({
		...selectedMediaDependencies,
		...(assistanceVideoStore ? { videoStore: assistanceVideoStore } : {}),
		...(resultAcceptance ? { acceptValidatedResult: resultAcceptance.acceptValidatedResult } : {}),
	});
	const guidedPreparation = createLocalAssistanceGuidedWorkflowPreparation({
		getProject: dependencies.getProject,
		getSelectedClipId: dependencies.getSelectedClipId,
		captureProject: dependencies.captureProject,
		assertProject: dependencies.assertProject,
		preflightStorage: (bytes) => dependencies.preflightStorage(bytes, 'effect'),
		currentSelectionFence,
		...(assistanceStore ? {
			loadTranscriptBody: (storageKey: string) => assistanceStore.loadMediaAsset(storageKey),
		} : {}),
		selected: selectedPreparation,
	});

	async function acceptFramescaperReframe(
		request: LocalAssistanceGuidedReframeAcceptanceRequest,
	): Promise<void> {
		const { createFramescaperAssistanceReframePublication } = await import(
			'../../../framescaper/editor-local-assistance-reframe-publication.ts'
		);
		const publication = createFramescaperAssistanceReframePublication({
			currentAuthority: () => ({ selection: currentVideoAuthority(), fence: request.fence }),
			captureProject: dependencies.captureProject,
			assertProject: dependencies.assertProject,
			commit: (command) => dependencies.commit(command as Readonly<Record<string, unknown>>),
		});
		await publication.acceptReviewed(request);
	}

	async function acceptFramescaperHighlights(
		request: LocalAssistanceGuidedHighlightAcceptanceRequest,
	): Promise<void> {
		const { createFramescaperAssistanceHighlightPublication } = await import(
			'../../../framescaper/editor-local-assistance-highlight-publication.ts'
		);
		const publication = createFramescaperAssistanceHighlightPublication({
			currentAuthority: () => ({
				project: currentVideoAuthority().project as never,
				fence: request.fence,
			}),
			captureProject: dependencies.captureProject,
			assertProject: dependencies.assertProject,
			createId: dependencies.createId,
			commit: (command) => dependencies.commit(command as Readonly<Record<string, unknown>>),
		});
		await publication.acceptReviewed({
			kind: 'highlight-proposals', schemaVersion: 1, workflowId: 'make-highlights',
			fence: request.fence, proposals: request.result.proposals,
		}, request.selectedProposalIds);
	}
	return Object.freeze({
		...selectedPreparation,
		prepareGuidedWorkflow: guidedPreparation.prepareGuidedWorkflow,
		async acceptGuidedWorkflowResult(request: LocalAssistanceGuidedWorkflowAcceptanceRequest) {
			const workflow = validateAssistanceWorkflow(request.workflow);
			const currentProject = () => {
				const project = dependencies.getProject() as Readonly<Record<string, unknown>>;
				return { projectId: project.id, projectRevision: project.revision };
			};
			if (workflow.workflowId === 'index-transcript' || workflow.workflowId === 'index-video') {
				if (!dependencies.assistanceDerivativeRepository) return Object.freeze({
					outcome: 'unsupported' as const, workflowId: workflow.workflowId,
					reason: 'workflow-publication-unavailable' as const,
				});
				const outcome = await publishLocalAssistanceGuidedIndex({ workflow,
					review: request.reviewedResult, selectedChoiceIds: request.selectedChoiceIds,
					readOutput: request.readOutput, repository: dependencies.assistanceDerivativeRepository,
					currentProject,
				});
				return outcome.outcome === 'published'
					? Object.freeze({ outcome: 'accepted' as const,
						selectedIds: Object.freeze([...request.selectedChoiceIds]) })
					: Object.freeze({ outcome: 'accepted' as const, selectedIds: Object.freeze([]) });
			}
			if (!guidedAcceptance) return Object.freeze({ outcome: 'unsupported' as const,
				workflowId: workflow.workflowId, reason: 'workflow-publication-unavailable' as const });
			if (workflow.workflowId === 'mark-reactions'
				&& !dependencies.assistanceDerivativeRepository) return Object.freeze({
				outcome: 'unsupported' as const, workflowId: workflow.workflowId,
				reason: 'workflow-publication-unavailable' as const,
			});
			const availability = guidedAcceptance.createAcceptanceSession({ workflow,
				reviewedResult: request.reviewedResult });
			if (availability.outcome !== 'ready') return availability;
			if (workflow.workflowId === 'mark-reactions' && request.selectedChoiceIds.length > 0) {
				await retainLocalAssistanceGuidedReactionScores({ workflow,
					readOutput: request.readOutput,
					repository: dependencies.assistanceDerivativeRepository!, currentProject,
				});
			}
			return await availability.session.accept(request.selectedChoiceIds);
		},
		...(resultAcceptance ? {
			prepareTranscriptCleanup: resultAcceptance.prepareTranscriptCleanup,
			acceptTranscriptCleanup: resultAcceptance.acceptTranscriptCleanup,
			rejectTranscriptCleanup: resultAcceptance.rejectTranscriptCleanup,
			cancelTranscriptCleanup: resultAcceptance.cancelTranscriptCleanup,
		} : {}),
	});
}
