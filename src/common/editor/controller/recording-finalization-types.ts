/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	RecordingControllerLike,
	RecordingFinalizationSnapshot,
} from './recording-session-service.ts';
import type {
	RecordingPreview,
} from './recording-model.ts';
import type {
	RecordingPreviewResampler,
	RecordingProject,
	RecordingSelection,
	RecordingSourceMetadata,
	RecordingSourceWriter,
	RoutedRecordingEntry,
} from './recording-transaction-types.ts';

export interface RecordingProjectTransactionScope {
	readonly project: RecordingProject;
	readonly projectId: string;
	assertCurrent(): void;
}

export interface RecordedAudioSource extends Readonly<Record<string, unknown>> {
	readonly sampleRate: number;
	readonly originalSampleRate: number;
	readonly sampleFormat: 'float32';
	readonly chunkFrames: number;
	readonly id: string;
	readonly storageKey: string;
	readonly name: string;
	readonly mimeType: 'audio/wav';
	readonly frameCount: number;
	readonly channelCount: number;
}

export interface RecordingPunchOptions {
	readonly trackId: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sourceId: string;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly clipId: string;
}

export interface RecordingFinalizationCommonRuntime {
	readonly sourceChunkFrames: number;
	readonly captureProjectScope: () => RecordingProjectTransactionScope;
	readonly projectSampleRate: (project: RecordingProject) => number;
	readonly pauseTransport: () => void;
	readonly disposeRecorder: (recorder: RecordingControllerLike) => Promise<void>;
	readonly appendPreview: (
		preview: RecordingPreview | null,
		channels: readonly Float32Array[] | undefined,
	) => void;
	readonly scaleFrames: (frames: number, inputRate: number, outputRate: number) => number;
	readonly createStableId: (prefix: string) => string;
	readonly createAddSourceCommand: (source: RecordedAudioSource) => unknown;
	readonly preparePunchCommand: (
		project: RecordingProject,
		options: RecordingPunchOptions,
	) => unknown;
	readonly activateStoredSource: (
		source: RecordedAudioSource,
		metadata: RecordingSourceMetadata,
	) => Promise<void>;
	readonly commitBatch: (
		project: RecordingProject,
		commands: readonly unknown[],
		selection: Readonly<{ readonly selectTrackId?: string; readonly selectClipId?: string }>,
	) => void;
	readonly setStatusDone: () => void;
	readonly deactivateSource: (sourceId: string) => PromiseLike<void> | void;
	readonly deleteStoredSource: (sourceId: string) => Promise<unknown>;
}

export interface RoutedRecordingFinalizationRuntime extends RecordingFinalizationCommonRuntime {
	readonly setRouteHealth: (trackId: string, health: 'skipped') => void;
	readonly deleteSourceAnalysis: (sourceId: string) => Promise<unknown>;
}

export interface LegacyRecordingFinalizationTransaction {
	readonly recorder: RecordingControllerLike;
	readonly writer: RecordingSourceWriter;
	readonly sourceId: string;
	readonly trackId: string;
	readonly startFrame: number;
	readonly sourceOffsetFrames: number;
	readonly selection: RecordingSelection | null;
	readonly resampler: RecordingPreviewResampler | null;
	readonly sampleRate: number | null;
	readonly preview: RecordingPreview | null;
	readonly discardRequested: boolean;
	readonly fatalError: unknown;
}

export interface RoutedRecordingFinalizationTransaction {
	readonly recorder: RecordingControllerLike;
	readonly entries: readonly RoutedRecordingEntry[];
	readonly discardRequested: boolean;
	readonly fatalError: unknown;
}

export type RecordingFinalizationInput = RecordingFinalizationSnapshot;
