/* SPDX-License-Identifier: AGPL-3.0-only */

/* SPDX-License-Identifier: AGPL-3.0-only */

/** Explicit renderer session for one local-assistance job and its staged custody. */

import type { AssistanceOperation } from '../assistance/operation.ts';
import type { LocalAssistanceShotDetectionMode } from '../assistance/shot-detection-mode.ts';
import {
	type LocalAssistanceBridge,
	type LocalAssistanceModel,
	type LocalAssistanceOutputClaim,
	type LocalAssistanceProgress,
	type LocalAssistanceUnavailableReason,
} from '../assistance/local-assistance-bridge.ts';
import {
	type LocalAssistanceSelectedMediaPreparationPort,
	type LocalAssistanceSelectedMediaSource,
} from '../assistance/local-assistance-preparation.ts';
import {
	type LocalAssistanceOutputReview,
} from '../assistance/local-assistance-result-review.ts';
import {
	type LocalAssistanceTranscriptCleanupState,
	type LocalAssistanceTranscriptCleanupPreset,
} from '../assistance/local-assistance-cleanup.ts';

/**
 * The shape of a local assistance session as the surfaces see it.
 *
 * The store publishes one frozen snapshot per change and the UI renders from nothing else,
 * so this declaration is the whole contract between them: every phase a session can be in,
 * every reason it can be unavailable, and what a validated result carries once one exists.
 */

export type LocalAssistancePhase =
	| 'idle' | 'loading' | 'selection-required' | 'ready' | 'preparing' | 'running'
	| 'cancelling' | 'completed' | 'accepting' | 'accepted'
	| 'cancelled' | 'unavailable' | 'error';

export type LocalAssistanceUiUnavailableReason =
	| LocalAssistanceUnavailableReason
	| 'bridge-unavailable'
	| 'selection-required'
	| 'no-compatible-model';

export interface LocalAssistanceOutputBody {
	readonly slotId?: 'enhanced-audio' | 'dereverberated-audio' | 'dialogue' | 'music' | 'effects';
	readonly claim: LocalAssistanceOutputClaim;
	readonly bytes: Blob;
	readonly review: LocalAssistanceOutputReview;
}

export interface LocalAssistanceValidatedResult {
	readonly operation: AssistanceOperation;
	readonly outputs: readonly LocalAssistanceOutputBody[];
}

export interface LocalAssistanceSnapshot {
	readonly phase: LocalAssistancePhase;
	readonly sources: readonly LocalAssistanceSelectedMediaSource[];
	readonly models: readonly LocalAssistanceModel[];
	readonly selectedSourceId: string | null;
	readonly selectedOperation: AssistanceOperation | null;
	readonly shotDetectionMode: LocalAssistanceShotDetectionMode;
	readonly selectedModelIds: readonly string[];
	readonly consent: boolean;
	readonly progress: LocalAssistanceProgress | null;
	readonly result: LocalAssistanceValidatedResult | null;
	readonly unavailableReason: LocalAssistanceUiUnavailableReason | null;
	readonly error: string | null;
	readonly cleanup?: LocalAssistanceTranscriptCleanupState | null;
	readonly canRun: boolean;
	readonly canCancel: boolean;
	readonly canReview: boolean;
	readonly canAccept: boolean;
	readonly canPrepareTranscriptCleanup?: boolean;
}

export interface LocalAssistanceSessionStore {
	getSnapshot(): LocalAssistanceSnapshot;
	subscribe(listener: () => void): () => void;
	connect(): () => void;
	load(): Promise<void>;
	selectSource(sourceId: string): void;
	selectOperation(operation: AssistanceOperation): void;
	selectShotDetectionMode(mode: LocalAssistanceShotDetectionMode): void;
	selectModel(modelId: string): void;
	setConsent(consent: boolean): void;
	run(): Promise<void>;
	cancel(): Promise<void>;
	accept(): Promise<void>;
	prepareTranscriptCleanup(preset?: LocalAssistanceTranscriptCleanupPreset): Promise<void>;
	setTranscriptCleanupProposalSelected(proposalId: string, selected: boolean): void;
	acceptTranscriptCleanup(): Promise<void>;
	rejectTranscriptCleanup(): Promise<void>;
	dispose(): Promise<void>;
}

export interface StoreOptions {
	readonly bridge: LocalAssistanceBridge | null;
	readonly preparation: LocalAssistanceSelectedMediaPreparationPort | null;
}
