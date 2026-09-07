/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EnginePublicApi } from '../engine/public-api.ts';
import type { LinkedOriginalStoreService } from '../storage/linked-original-store-service.ts';
import type { createFfmpegVideoTimingProbe } from '../video-timing-probe.ts';
import type { ClipTimePitchRenderStore } from './clip-time-pitch-render-service.ts';
import type { ConsolidateMediaStore } from './consolidate-media-service.ts';
import type { DerivedAudioCompositionDependencies } from './derived-audio-composition.ts';
import type { createIncrementalPcmImporter } from './incremental-wav-import-service.ts';
import type { EditorControllerLifetime, EditorProjectGeneration } from './lifecycle.ts';
import type { createLinkedPcmImporter } from './linked-wav-import-service.ts';
import type { ProjectBinServiceDependencies } from './project-bin-service.ts';
import type { ProjectChangedOptions } from './project-mutation-service.ts';
import type { ProjectSwitchOptions } from './project-switch-service-types.ts';
import type { ProjectVisualService } from './project-visual-types.ts';
import type { bufferFromChannels } from './source-audio.ts';
import type { publishImportedVideo } from './source-import-video-publication.ts';
import type { EditorTaskProgressCoordinator } from './task-progress.ts';
import type { ChangedContentVideoCandidateRuntime } from './video-relink-probe.ts';
import type { VideoSourceReprobeDependencies } from './video-source-reprobe-service.ts';
import type { generateWaveformPeaks } from './waveform-analysis.ts';

export type ImportCompositionProject = ReturnType<ProjectBinServiceDependencies['getProject']>;

export type ImportCompositionState = {
	selectedTrackId: string | null;
	selectedClipId: string | null;
	importing: boolean;
	missingSourceIds: ProjectBinServiceDependencies['missingSourceIds'];
	projectBinPreview: ReturnType<ProjectBinServiceDependencies['getPreview']>;
};

/**
 * The project and video import services still take untyped runtimes, so the
 * copy they and their helpers read is named here rather than derived.
 */
export type ImportCompositionCopy =
	& ProjectBinServiceDependencies['copy']
	& Parameters<typeof bufferFromChannels>[3]
	& Parameters<typeof generateWaveformPeaks>[1]
	& Parameters<typeof createLinkedPcmImporter>[0]['copy']
	& Readonly<{
		readonly audioTrackNotFound: string;
		readonly aupImported: string;
		readonly aupImporting: string;
		readonly bextMetadataImportWarning: string;
		readonly done: string;
		readonly importSummary: string;
		readonly importedSourceDescriptorMissing: string;
		readonly importedSourcePcmInvalid: string;
		readonly importing: string;
		readonly structuredProjectRequired: string;
		readonly timelineFramesFinite: string;
		readonly track: string;
		readonly videoAudioDecodeFailed: string;
	}>;

/** Everything the bin and the import paths write to or read from the store. */
export type ImportCompositionStore =
	& ProjectBinServiceDependencies['store']
	& ClipTimePitchRenderStore
	& Parameters<typeof createIncrementalPcmImporter>[0]['store']
	& Parameters<typeof createLinkedPcmImporter>[0]['store']
	& Parameters<typeof publishImportedVideo>[0]
	& Pick<ConsolidateMediaStore, 'unlinkLinkedVideoOriginal'>
	& Pick<LinkedOriginalStoreService, 'saveLinkedVideoDerivative'>
	& Readonly<{
		bindLinkedVideoOriginal(
			...args: Parameters<LinkedOriginalStoreService['bindVideo']>
		): ReturnType<LinkedOriginalStoreService['bindVideo']>;
		saveVideoDerivative(sourceId: string, derivative: Readonly<Record<string, unknown>>): Promise<unknown>;
		deleteVideoDerivative(sourceId: string, selector?: Readonly<Record<string, unknown>>): Promise<unknown>;
	}>;

export type ImportCompositionEngine = Pick<EnginePublicApi,
	| 'decodeAudioData' | 'getAudioContext' | 'getPositionFrames' | 'getState' | 'stop'
>;

/** The codec runtime as the import paths use it; CFR conforming is a desktop-only optional. */
export type ImportCompositionFfmpeg =
	& ChangedContentVideoCandidateRuntime['ffmpeg']
	& Parameters<typeof createFfmpegVideoTimingProbe>[0]
	& Readonly<{
		decode(file: Blob, options: Readonly<Record<string, unknown>>): PromiseLike<unknown>;
		conformVideoToCfr?(file: Blob, options: Readonly<Record<string, unknown>>): PromiseLike<Blob>;
	}>;

export interface ImportCompositionDependencies {
	readonly state: ImportCompositionState;
	readonly copy: ImportCompositionCopy;
	readonly lifetime: EditorControllerLifetime;
	readonly projectGeneration: Pick<EditorProjectGeneration, 'capture' | 'assertCurrent'>;
	readonly store: ImportCompositionStore;
	readonly engine: ImportCompositionEngine;
	readonly ffmpeg: ImportCompositionFfmpeg;
	readonly helperTimingProbe: VideoSourceReprobeDependencies['helperTimingProbe'];
	readonly sourceBuffers: ProjectBinServiceDependencies['sourceBuffers'];
	readonly sourceChunkProviders: ProjectBinServiceDependencies['sourceChunkProviders'];
	readonly sourcePeaks: ProjectBinServiceDependencies['sourcePeaks'];
	readonly sourceResolver: ProjectBinServiceDependencies['sourceResolver'];
	readonly sourceChunkFrames: number;
	/** Shared with project retention so staged bin imports stay live until they settle. */
	readonly protectedSourceIds: ProjectBinServiceDependencies['protectedSourceIds'];
	readonly trackColors: readonly string[];
	readonly taskProgress: Pick<EditorTaskProgressCoordinator, 'run' | 'updateActive'>;
	readonly projectVisual: Pick<ProjectVisualService, 'getProjectBinClipVisualData' | 'activateVideoSource' | 'revokeVideoVisual'>;
	readonly createPreviewEngine: ProjectBinServiceDependencies['createPreviewEngine'];
	readonly getProject: () => ImportCompositionProject | null;
	readonly editingBlocked: () => boolean;
	readonly commit: ProjectBinServiceDependencies['commit'];
	readonly updateSelection: ProjectBinServiceDependencies['updateSelection'];
	readonly setStatus: (message: string, state?: string) => void;
	readonly publishDocumentSnapshot: () => void;
	readonly handleError: (error: unknown) => void;
	readonly preflightStorage: (bytes: number, category: 'import') => Promise<unknown>;
	readonly projectSampleRate: () => number;
	readonly activateStoredSource: ProjectBinServiceDependencies['activateStoredSource'];
	readonly invalidateSourceRuntime: ProjectBinServiceDependencies['invalidateSourceRuntime'];
	readonly retireSourceChunkProvider: ProjectBinServiceDependencies['retireSourceChunkProvider'];
	readonly retireTimelinePlayback: ProjectBinServiceDependencies['retireTimelinePlayback'];
	readonly cacheSourceBuffer: DerivedAudioCompositionDependencies['cacheSourceBuffer'];
	readonly captureActiveDocument: ProjectBinServiceDependencies['captureActiveDocument'];
	readonly restoreActiveDocument: ProjectBinServiceDependencies['restoreActiveDocument'];
	readonly switchProject: (
		project: ImportCompositionProject,
		options?: ProjectSwitchOptions<ReturnType<ProjectBinServiceDependencies['captureActiveDocument']>['history']>,
	) => Promise<void>;
	readonly projectChanged: (options?: ProjectChangedOptions) => void;
	readonly warnEnvelope: () => void;
}
