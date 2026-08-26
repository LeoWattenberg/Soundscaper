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
} from './local-assistance-guided-result-acceptance.ts';
import {
	publishLocalAssistanceGuidedIndex,
} from './local-assistance-guided-index-publication.ts';
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
	const currentSelectionFence = () => {
		try { return resolveLocalAssistanceSelectedMediaAuthority(selectedMediaDependencies).fence; }
		catch (audioError) {
			if (!assistanceVideoStore) throw audioError;
			return resolveLocalAssistanceSelectedVideoAuthority(selectedMediaDependencies).fence;
		}
	};
	const resultAcceptance = assistanceStore ? createLocalAssistanceResultAcceptance({
		currentAuthority: () => resolveLocalAssistanceSelectedMediaAuthority(selectedMediaDependencies),
		...(assistanceVideoStore ? {
			currentVideoAuthority: () => resolveLocalAssistanceSelectedVideoAuthority(
				selectedMediaDependencies,
			),
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
		createBeatReviewSession: (request) => resultAcceptance.createBeatReviewSession(request),
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
	return Object.freeze({
		...selectedPreparation,
		prepareGuidedWorkflow: guidedPreparation.prepareGuidedWorkflow,
		async acceptGuidedWorkflowResult(request: LocalAssistanceGuidedWorkflowAcceptanceRequest) {
			const workflow = validateAssistanceWorkflow(request.workflow);
			if (workflow.workflowId === 'index-transcript' || workflow.workflowId === 'index-video') {
				if (!dependencies.assistanceDerivativeRepository) return Object.freeze({
					outcome: 'unsupported' as const, workflowId: workflow.workflowId,
					reason: 'workflow-publication-unavailable' as const,
				});
				const outcome = await publishLocalAssistanceGuidedIndex({ workflow,
					review: request.reviewedResult, selectedChoiceIds: request.selectedChoiceIds,
					readOutput: request.readOutput, repository: dependencies.assistanceDerivativeRepository,
					currentProject: () => {
						const project = dependencies.getProject() as Readonly<Record<string, unknown>>;
						return { projectId: project.id, projectRevision: project.revision };
					},
				});
				return outcome.outcome === 'published'
					? Object.freeze({ outcome: 'accepted' as const,
						selectedIds: Object.freeze([...request.selectedChoiceIds]) })
					: Object.freeze({ outcome: 'accepted' as const, selectedIds: Object.freeze([]) });
			}
			if (!guidedAcceptance) return Object.freeze({ outcome: 'unsupported' as const,
				workflowId: workflow.workflowId, reason: 'workflow-publication-unavailable' as const });
			const availability = guidedAcceptance.createAcceptanceSession({ workflow,
				reviewedResult: request.reviewedResult });
			return availability.outcome === 'ready'
				? await availability.session.accept(request.selectedChoiceIds) : availability;
		},
		...(resultAcceptance ? {
			prepareTranscriptCleanup: resultAcceptance.prepareTranscriptCleanup,
			acceptTranscriptCleanup: resultAcceptance.acceptTranscriptCleanup,
			rejectTranscriptCleanup: resultAcceptance.rejectTranscriptCleanup,
			cancelTranscriptCleanup: resultAcceptance.cancelTranscriptCleanup,
		} : {}),
	});
}
