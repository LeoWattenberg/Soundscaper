/* SPDX-License-Identifier: AGPL-3.0-only */

/** Controller-owned selected-media custody port; it deliberately has no model knowledge. */

import {
	ASSISTANCE_OPERATIONS,
	normalizeAssistanceOperation,
	type AssistanceOperation,
} from './operation.ts';
import type {
	AssistanceAdvancedWorkflowId,
	AssistanceGuidedWorkflowId,
} from './workflow-recipes.ts';
import type {
	AssistanceWorkflowOutputClaimV1,
	AssistanceWorkflowV1,
} from './workflow.ts';
import type { AssistanceWorkflowSettingsV1 } from './workflow-settings-v1.ts';
import type { AssistanceSelectionFence } from './proposal-session.ts';
import type { LocalAssistanceShotDetectionMode } from './shot-detection-mode.ts';
import type {
	LocalAssistanceInputRole,
	LocalAssistanceModel,
	LocalAssistanceOutputClaim,
	LocalAssistanceOutputRole,
} from './local-assistance-bridge.ts';
import type {
	LocalAssistanceWorkflowCustodyBridge,
} from './local-assistance-workflow-bridge.ts';
import type { LocalAssistanceOutputReview } from './local-assistance-result-review.ts';
// Prepared-media normalization is controller-owned validation, not presentation, so it and
// these record primitives live beside the controllers that also need them.
import {
	enumValue,
	exactRecord,
	id,
	normalizeLocalAssistancePreparedMedia,
	text,
} from '../controller/local-assistance-prepared-media.ts';

export { normalizeLocalAssistancePreparedMedia };

// Model selection is controller-owned policy for the same reason; re-exported so the
// session stores and the dialog keep importing it from where they always have.
export {
	localAssistanceModelCompatible,
	localAssistanceModelTaskSlots,
	localAssistanceOperationModelsAvailable,
	localAssistanceSelectedModels,
} from '../controller/local-assistance-model-selection.ts';
import type {
	LocalAssistanceTranscriptCleanupPreparationRequest,
} from './local-assistance-cleanup.ts';
import type { LocalAssistanceGuidedReviewedResult } from './local-assistance-guided-result-review.ts';

export type LocalAssistanceMediaKind =
	| 'audio' | 'video' | 'frame-pack' | 'transcript' | 'text' | 'editorial-context';

export const LOCAL_ASSISTANCE_GUIDED_PREPARATION_UNAVAILABLE_REASONS = Object.freeze([
	'selected-media-unavailable', 'aggregate-custody-unavailable', 'model-binding-unavailable',
	'source-custody-unavailable', 'transcript-custody-unavailable',
	'derived-custody-unavailable', 'editorial-context-custody-unavailable',
	'timing-authority-unavailable', 'workflow-disabled',
] as const);

export type LocalAssistanceGuidedPreparationUnavailableReason =
	(typeof LOCAL_ASSISTANCE_GUIDED_PREPARATION_UNAVAILABLE_REASONS)[number];

export interface LocalAssistanceSelectedMediaSource {
	readonly sourceId: string;
	readonly label: string;
	readonly mediaKind: LocalAssistanceMediaKind;
	readonly operations: readonly AssistanceOperation[];
}

export interface LocalAssistanceSelectedMediaInventory {
	readonly sources: readonly LocalAssistanceSelectedMediaSource[];
}

export interface LocalAssistancePreparedInput {
	readonly role: LocalAssistanceInputRole;
	readonly mediaType: string;
	readonly bytes: Blob;
}

export interface LocalAssistancePreparedOutput {
	readonly slotId?: 'enhanced-audio' | 'dereverberated-audio' | 'dialogue' | 'music' | 'effects';
	readonly role: LocalAssistanceOutputRole;
	readonly mediaType: string;
	readonly maximumByteLength: number;
}

export interface LocalAssistancePreparedMedia {
	readonly sourceId: string;
	readonly operation: AssistanceOperation;
	readonly shotDetectionMode?: LocalAssistanceShotDetectionMode;
	readonly selectionFence: AssistanceSelectionFence;
	readonly inputs: readonly LocalAssistancePreparedInput[];
	readonly outputs: readonly LocalAssistancePreparedOutput[];
}

export interface LocalAssistanceSelectedMediaPreparationPort {
	listSelectedMedia(): Promise<unknown>;
	prepareSelectedMedia(request: Readonly<{
		sourceId: string;
		operation: AssistanceOperation;
		shotDetectionMode?: LocalAssistanceShotDetectionMode;
		signal?: AbortSignal;
	}>): Promise<unknown>;
	prepareGuidedWorkflow?(request: LocalAssistanceGuidedWorkflowPreparationRequest): Promise<unknown>;
	prepareAdvancedWorkflow?(request: LocalAssistanceAdvancedWorkflowPreparationRequest): Promise<unknown>;
	assertCurrentWorkflowFence?(workflow: AssistanceWorkflowV1, signal: AbortSignal): Promise<void>;
	acceptGuidedWorkflowResult?(request: LocalAssistanceGuidedWorkflowAcceptanceRequest): Promise<unknown>;
	acceptValidatedResult?(request: LocalAssistanceValidatedResultAcceptanceRequest): Promise<void>;
	prepareTranscriptCleanup?(
		request: LocalAssistanceTranscriptCleanupPreparationRequest,
	): Promise<unknown>;
	acceptTranscriptCleanup?(proposalIds: readonly string[]): Promise<void>;
	rejectTranscriptCleanup?(): Promise<void>;
	cancelTranscriptCleanup?(): Promise<void>;
}

export interface LocalAssistanceGuidedWorkflowAcceptanceRequest {
	readonly workflow: unknown;
	readonly reviewedResult: LocalAssistanceGuidedReviewedResult;
	readonly selectedChoiceIds: readonly string[];
	readonly reframeDraft?: unknown;
	readonly highlightDraft?: unknown;
	readonly highlightSourceTimeAuthority?: unknown;
	readonly readOutput: (request: Readonly<{
		readonly jobId: string;
		readonly workflowId: AssistanceGuidedWorkflowId;
		readonly claim: AssistanceWorkflowOutputClaimV1;
	}>) => Promise<Blob>;
}

export interface LocalAssistanceGuidedWorkflowPreparationRequest {
	readonly jobId: string;
	readonly workflowId: AssistanceGuidedWorkflowId;
	readonly settings: AssistanceWorkflowSettingsV1;
	readonly models: readonly LocalAssistanceModel[];
	readonly custody: LocalAssistanceWorkflowCustodyBridge;
	readonly signal: AbortSignal;
}

export interface LocalAssistanceAdvancedWorkflowPreparationRequest {
	readonly jobId: string;
	readonly workflowId: AssistanceAdvancedWorkflowId;
	readonly sourceId: string;
	readonly operation: AssistanceOperation;
	readonly shotDetectionMode?: LocalAssistanceShotDetectionMode;
	readonly settings: AssistanceWorkflowSettingsV1;
	readonly models: readonly LocalAssistanceModel[];
	readonly custody: LocalAssistanceWorkflowCustodyBridge;
	readonly signal: AbortSignal;
}

export interface LocalAssistanceValidatedResultAcceptanceRequest {
	readonly sourceId: string;
	readonly operation: AssistanceOperation;
	readonly selectionFence: AssistanceSelectionFence;
	readonly models: readonly LocalAssistanceModel[];
	readonly outputs: readonly Readonly<{
		readonly slotId?: 'enhanced-audio' | 'dereverberated-audio' | 'dialogue' | 'music' | 'effects';
		readonly claim: LocalAssistanceOutputClaim;
		readonly review: LocalAssistanceOutputReview;
		readonly bytes?: Blob;
	}>[];
}

export type LocalAssistanceModelTaskSlot = readonly string[];

const MEDIA_KINDS = Object.freeze([
	'audio', 'video', 'frame-pack', 'transcript', 'text', 'editorial-context',
] as const);

export function normalizeLocalAssistanceSelectedMediaInventory(
	value: unknown,
): LocalAssistanceSelectedMediaInventory {
	const record = exactRecord(value, ['sources'], 'selected-media inventory');
	if (!Array.isArray(record.sources) || record.sources.length > 128) {
		throw new TypeError('The selected-media source inventory is invalid.');
	}
	const seen = new Set<string>();
	const sources = record.sources.map((candidate) => {
		const source = exactRecord(candidate, ['sourceId', 'label', 'mediaKind', 'operations'], 'selected-media source');
		const sourceId = id(source.sourceId);
		if (seen.has(sourceId)) throw new TypeError('A selected-media source identity is repeated.');
		seen.add(sourceId);
		if (!Array.isArray(source.operations) || source.operations.length < 1
			|| source.operations.length > ASSISTANCE_OPERATIONS.length) {
			throw new TypeError('A selected-media source operation inventory is invalid.');
		}
		const operations = Object.freeze(source.operations.map(normalizeAssistanceOperation));
		if (new Set(operations).size !== operations.length) {
			throw new TypeError('A selected-media source repeats an operation.');
		}
		return Object.freeze({ sourceId, label: text(source.label, 160, 'source label'),
			mediaKind: enumValue(source.mediaKind, MEDIA_KINDS, 'media kind'), operations });
	});
	return Object.freeze({ sources: Object.freeze(sources) });
}

export function assertLocalAssistanceShotDetectionReviewMode(
	mode: LocalAssistanceShotDetectionMode,
	review: LocalAssistanceOutputReview,
): void {
	const detector = mode === 'accurate' ? 'transnetv2' : 'ffmpeg-scdet';
	if (review.kind !== 'shot-boundaries' || review.detector !== detector) {
		throw new TypeError('Mark Cuts returned an output from the opposite detection mode.');
	}
}
