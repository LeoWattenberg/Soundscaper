/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ExactTakeCycleCapturePlan,
	TakeCycleCapturePass,
	TakeCycleCaptureSpan,
} from '../take-cycle-capture-domain.ts';
import type {
	CleanupTakeCyclePublishedMediaAction,
	CleanupTakeCycleStagedMediaAction,
	ReplayTakeCycleProjectCommitAction,
	TakeCycleEnvelopeRecoveryPlan,
	TakeCycleProjectPublicationEvidence,
	TakeCycleProjectPublicationFence,
	TakeCycleRecoveryEnvelope,
} from '../take-cycle-recovery-envelope.ts';
import type { TakeMediaPublicationBinding, TakeMediaRecoveryDecision } from '../take-media-recovery-journal.ts';
import type { AudioSourceStageReceipt } from '../storage/source-write-repository.ts';
import type { TakeCycleRecoveryEnvelopeRepository } from '../storage/take-cycle-recovery-envelope-repository.ts';
import type { EditorControllerLifetime, EditorProjectToken } from './lifecycle.ts';

export type MaybePromise<Value> = PromiseLike<Value> | Value;

export interface TakeCyclePublicationDescriptor {
	readonly journalId: string;
	readonly laneId: string;
	readonly takeId: string;
	readonly mediaId: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface TakeCycleLaneFinalizationRequest {
	readonly envelopeId: string;
	readonly groupId: string;
	readonly laneId: string;
	readonly loopStartSample: number;
	readonly loopEndSample: number;
	readonly captureSpans: readonly TakeCycleCaptureSpan[];
	readonly interrupted: boolean;
	readonly publications: readonly TakeCyclePublicationDescriptor[];
}

export interface TakeCycleFinalizationRequest {
	/** Durable project generation, independent of the process-local project token. */
	readonly publicationGeneration: number;
	readonly lanes: readonly TakeCycleLaneFinalizationRequest[];
}

export interface TakeCycleRecoveryRequest {
	readonly currentGeneration: number;
	readonly decision: TakeMediaRecoveryDecision;
}

export interface TakeCycleRecordingOptions {
	readonly signal?: AbortSignal;
}

export interface TakeCycleOperationOwnership {
	readonly projectToken: EditorProjectToken;
	readonly signal: AbortSignal;
	assertCurrent(): void;
}

export interface TakeCycleLaneOperation {
	readonly ownership: TakeCycleOperationOwnership;
	readonly laneIndex: number;
	readonly plan: ExactTakeCycleCapturePlan;
}

export interface TakeCycleProjectPreparationOperation extends TakeCycleLaneOperation {
	readonly publications: readonly TakeCyclePublicationDescriptor[];
}

export interface PreparedTakeCycleProjectPublication {
	readonly projectFence: TakeCycleProjectPublicationFence;
	readonly targetProjectDocument: string;
}

export interface TakeCycleStageReceiptOperation extends TakeCycleLaneOperation {
	readonly pass: TakeCycleCapturePass;
	readonly publication: TakeCyclePublicationDescriptor;
}

export interface TakeCyclePassOperation extends TakeCycleLaneOperation {
	readonly pass: TakeCycleCapturePass;
	readonly envelope: TakeCycleRecoveryEnvelope;
	readonly entryIndex: number;
}

export interface TakeCycleProjectPublicationOperation extends TakeCycleLaneOperation {
	readonly envelope: TakeCycleRecoveryEnvelope;
	readonly targetProjectDocument: string;
}

export interface TakeCycleRecoveryInspectionOperation {
	readonly ownership: TakeCycleOperationOwnership;
	readonly envelope: TakeCycleRecoveryEnvelope;
}

export interface TakeCycleRecoveryMediaInspectionOperation
	extends TakeCycleRecoveryInspectionOperation {
	readonly entryIndex: number;
	readonly binding: TakeMediaPublicationBinding;
}

export interface TakeCycleRecoveryActionOperation<
	Action extends CleanupTakeCycleStagedMediaAction | CleanupTakeCyclePublishedMediaAction =
		CleanupTakeCycleStagedMediaAction | CleanupTakeCyclePublishedMediaAction,
> {
	readonly ownership: TakeCycleOperationOwnership;
	readonly envelope: TakeCycleRecoveryEnvelope;
	readonly action: Action;
}

export interface TakeCycleRecoveryReplayOperation {
	readonly ownership: TakeCycleOperationOwnership;
	readonly envelope: TakeCycleRecoveryEnvelope;
	readonly action: ReplayTakeCycleProjectCommitAction;
}

export interface TakeCycleRecordingServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask' | 'cancelTask'>;
	readonly recoveryRepository: Pick<
		TakeCycleRecoveryEnvelopeRepository,
		'load' | 'create' | 'replace' | 'remove'
	>;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	prepareProjectPublication(
		operation: TakeCycleProjectPreparationOperation,
	): MaybePromise<PreparedTakeCycleProjectPublication>;
	/** Must only mint ownership; durable media work begins after envelope creation. */
	createMediaStageReceipt(operation: TakeCycleStageReceiptOperation): MaybePromise<AudioSourceStageReceipt>;
	stageMedia(operation: TakeCyclePassOperation): MaybePromise<void>;
	publishMedia(operation: TakeCyclePassOperation): MaybePromise<TakeMediaPublicationBinding>;
	publishProject(operation: TakeCycleProjectPublicationOperation): MaybePromise<TakeCycleProjectPublicationEvidence>;
	inspectMedia(operation: TakeCycleRecoveryMediaInspectionOperation): MaybePromise<TakeMediaPublicationBinding | null>;
	inspectProject(operation: TakeCycleRecoveryInspectionOperation): MaybePromise<TakeCycleProjectPublicationEvidence | null>;
	cleanupStagedMedia(
		operation: TakeCycleRecoveryActionOperation<CleanupTakeCycleStagedMediaAction>,
	): MaybePromise<boolean>;
	cleanupPublishedMedia(
		operation: TakeCycleRecoveryActionOperation<CleanupTakeCyclePublishedMediaAction>,
	): MaybePromise<boolean>;
	replayProjectCommit(operation: TakeCycleRecoveryReplayOperation): MaybePromise<TakeCycleProjectPublicationEvidence>;
}

export interface TakeCycleLaneFinalizationResult {
	readonly groupId: string;
	readonly laneId: string;
	readonly status: 'committed' | 'failed';
	readonly committedPasses: readonly TakeMediaPublicationBinding[];
	readonly error: unknown | null;
}

export interface TakeCycleFinalizationResult {
	readonly kind: 'take-cycle-finalization';
	readonly generation: number;
	readonly lanes: readonly TakeCycleLaneFinalizationResult[];
}

export interface TakeCycleRecordingService {
	finalize(
		request: TakeCycleFinalizationRequest,
		options?: TakeCycleRecordingOptions,
	): Promise<TakeCycleFinalizationResult>;
	recover(
		request: TakeCycleRecoveryRequest,
		options?: TakeCycleRecordingOptions,
	): Promise<TakeCycleEnvelopeRecoveryPlan>;
	cancel(reason?: unknown): void;
}
