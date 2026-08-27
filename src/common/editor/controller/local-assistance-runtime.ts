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
	createLocalAssistanceAdvancedWorkflowPreparation,
} from './local-assistance-advanced-workflow-preparation.ts';
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
	createLocalAssistanceGuidedPublicationFenceResolver,
} from './local-assistance-guided-publication-fence.ts';
import {
	retainLocalAssistanceGuidedReusableDerivatives,
} from './local-assistance-guided-reusable-derivatives.ts';
import {
	retainLocalAssistanceGuidedReactionScores,
} from './local-assistance-guided-reaction-derivative.ts';
import {
	retainLocalAssistanceGuidedAcceptedReframePathV1,
} from './local-assistance-guided-reframe-derivative.ts';
import {
	acknowledgeLocalAssistanceGuidedEditorialSelection,
} from './local-assistance-guided-editorial-acceptance.ts';
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
	const selectedPreparation = createLocalAssistanceSelectedPreparation({
		...selectedMediaDependencies,
		...(assistanceVideoStore ? { videoStore: assistanceVideoStore } : {}),
		...(resultAcceptance ? { acceptValidatedResult: resultAcceptance.acceptValidatedResult } : {}),
	});
	const publicationFenceResolver = createLocalAssistanceGuidedPublicationFenceResolver({
		getProject: dependencies.getProject,
		captureProject: dependencies.captureProject,
		assertProject: dependencies.assertProject,
		currentSelectionFence,
		...(assistanceVideoStore ? {
			currentVideoSelectionFence: () => currentVideoAuthority().fence,
		} : {}),
		...(assistanceStore ? {
			loadTranscriptBody: (storageKey: string, signal: AbortSignal) => {
				signal.throwIfAborted();
				return assistanceStore.loadMediaAsset(storageKey);
			},
		} : {}),
		selected: selectedPreparation,
	});
	const guidedAcceptance = resultAcceptance ? createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence,
		assertCurrentWorkflowFence: (workflow, signal) =>
			publicationFenceResolver.assertCurrentFence(workflow, signal),
		acceptValidatedResult: (request) => resultAcceptance.acceptValidatedResult(request),
		acceptAudioResult: (request, choice) => resultAcceptance.acceptAudioResult(request, choice),
		acceptCleanupResult: (request) => resultAcceptance.acceptCleanupResult(request),
		createBeatReviewSession: (request) => resultAcceptance.createBeatReviewSession(request),
		createReactionReviewSession: (request, options) =>
			resultAcceptance.createReactionReviewSession(request, options),
		...(assistanceVideoStore ? {
			acceptReframeResult: (request: LocalAssistanceGuidedReframeAcceptanceRequest) =>
				acceptFramescaperReframe(request),
			acceptHighlightResult: (request: LocalAssistanceGuidedHighlightAcceptanceRequest) =>
				acceptFramescaperHighlights(request),
			...(dependencies.assistanceDerivativeRepository ? {
				retainReframeResult: async ({ workflow, result }: Readonly<{
					workflow: unknown; result: unknown;
				}>) => {
					try {
						await retainLocalAssistanceGuidedAcceptedReframePathV1({ workflow, result,
							repository: dependencies.assistanceDerivativeRepository!,
							currentProject: () => {
								const project = dependencies.getProject() as
									Readonly<Record<string, unknown>>;
								return { projectId: project.id, projectRevision: project.revision };
							},
						});
					} catch {
						// Disposable crop evidence cannot turn an already committed edit into failure.
					}
				},
			} : {}),
		} : {}),
	}) : null;
	const advancedPreparation = createLocalAssistanceAdvancedWorkflowPreparation({
		getProject: dependencies.getProject,
		captureProject: dependencies.captureProject,
		assertProject: dependencies.assertProject,
		preflightStorage: (bytes) => dependencies.preflightStorage(bytes, 'effect'),
		selected: selectedPreparation,
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
		...(dependencies.assistanceDerivativeRepository ? {
			loadVisualIndexDerivatives: async (projectId: string, signal: AbortSignal) => {
				signal.throwIfAborted();
				const records = await dependencies.assistanceDerivativeRepository!.listProject(
					projectId, ['visual-index'],
				);
				signal.throwIfAborted();
				return records;
			},
			loadReframeDerivatives: async (projectId: string, signal: AbortSignal) => {
				signal.throwIfAborted();
				const records = await dependencies.assistanceDerivativeRepository!.listProject(
					projectId, ['reframe-path'],
				);
				signal.throwIfAborted();
				return records;
			},
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
				selection: currentVideoAuthority(),
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
		prepareAdvancedWorkflow: advancedPreparation.prepareAdvancedWorkflow,
		prepareGuidedWorkflow: guidedPreparation.prepareGuidedWorkflow,
		assertCurrentWorkflowFence: (
			workflow: Parameters<typeof publicationFenceResolver.assertCurrentFence>[0],
			signal: AbortSignal,
		) => publicationFenceResolver.assertCurrentFence(workflow, signal),
		async acceptGuidedWorkflowResult(request: LocalAssistanceGuidedWorkflowAcceptanceRequest) {
			const workflow = validateAssistanceWorkflow(request.workflow);
			if (workflow.workflowId === 'generate-editorial-text') {
				return acknowledgeLocalAssistanceGuidedEditorialSelection({ workflow,
					reviewedResult: request.reviewedResult,
					selectedChoiceIds: request.selectedChoiceIds,
				});
			}
			const publicationSignal = new AbortController().signal;
			await publicationFenceResolver.assertCurrentFence(workflow, publicationSignal);
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
					resolveCurrentFence: publicationFenceResolver.resolveCurrentFence,
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
				reviewedResult: request.reviewedResult,
				...(request.reframeDraft === undefined ? {} : { reframeDraft: request.reframeDraft }),
				...(request.highlightDraft === undefined ? {} : { highlightDraft: request.highlightDraft }) });
			if (availability.outcome !== 'ready') return availability;
			const accepted = await availability.session.accept(request.selectedChoiceIds);
			if (accepted.outcome === 'accepted' && request.selectedChoiceIds.length > 0) {
				try {
					if (workflow.workflowId === 'mark-reactions') {
						await retainLocalAssistanceGuidedReactionScores({ workflow,
							readOutput: request.readOutput,
							repository: dependencies.assistanceDerivativeRepository!, currentProject,
						});
					} else if (dependencies.assistanceDerivativeRepository
						&& (workflow.workflowId === 'mark-cuts' || workflow.workflowId === 'reframe'
							|| workflow.workflowId === 'make-highlights')) {
						await retainLocalAssistanceGuidedReusableDerivatives({ workflow,
							review: request.reviewedResult, readOutput: request.readOutput,
							repository: dependencies.assistanceDerivativeRepository,
							resolveCurrentFence: publicationFenceResolver.resolveCurrentFence,
						});
					}
				} catch {
					// Disposable evidence cannot turn an already committed edit into failure.
				}
			}
			return accepted;
		},
		...(resultAcceptance ? {
			prepareTranscriptCleanup: resultAcceptance.prepareTranscriptCleanup,
			acceptTranscriptCleanup: resultAcceptance.acceptTranscriptCleanup,
			rejectTranscriptCleanup: resultAcceptance.rejectTranscriptCleanup,
			cancelTranscriptCleanup: resultAcceptance.cancelTranscriptCleanup,
		} : {}),
	});
}
