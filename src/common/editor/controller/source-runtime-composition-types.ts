/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EnginePublicApi } from '../engine/public-api.ts';
import type { createSourceBufferCache } from '../source-buffer-cache.js';
import type {
	ClipTimePitchCacheServiceDependencies,
	ClipTimePitchPlaybackState,
	ClipTimePitchRenderEngine,
} from './clip-time-pitch-service.ts';
import type { EditorControllerLifetime, EditorProjectGeneration } from './lifecycle.ts';
import type { PlaybackProjectService } from './playback-project-service.ts';
import type { ProjectVisualProject, ProjectVisualServiceDependencies } from './project-visual-types.ts';
import type { bufferFromChannels, createStoredChunkProvider, readStoredAudioBuffer } from './source-audio.ts';
import type { SourceChunkProviderRegistry } from './source-chunk-provider-registry.ts';
import type { generateStoredWaveformPeaks, generateWaveformPeaks } from './waveform-analysis.ts';

/** The document shape the visual, time-pitch and playback services read. */
export type SourceRuntimeProject = ProjectVisualProject;

export type SourceRuntimeCompositionState = ClipTimePitchPlaybackState & {
	missingSourceIds: Set<string>;
};

export type SourceRuntimeCompositionCopy =
	& Parameters<typeof bufferFromChannels>[3]
	& Parameters<typeof generateWaveformPeaks>[1]
	& Parameters<typeof generateStoredWaveformPeaks>[2]
	& Readonly<{ readonly ready: string }>;

/**
 * What the visual service, the stored-source readers and the source lifecycle
 * read from the store. The lifecycle's runtime is still untyped, so the four
 * members it calls directly are declared here.
 */
export type SourceRuntimeCompositionStore =
	& ProjectVisualServiceDependencies['store']
	& Parameters<typeof readStoredAudioBuffer>[0]
	& Parameters<typeof createStoredChunkProvider>[0]
	& Parameters<typeof generateStoredWaveformPeaks>[0]
	& Readonly<{
		getSourceMetadata(sourceId: string): Promise<unknown>;
		loadAnalysis(key: string): Promise<unknown>;
		saveAnalysis(key: string, value: unknown): Promise<unknown>;
		deleteAnalysis?(key: string): Promise<unknown>;
	}>;

export type SourceRuntimeCompositionEngine = Pick<EnginePublicApi,
	| 'applyProject' | 'getAudioContext' | 'getState' | 'stop'
>;

export interface SourceRuntimeCompositionDependencies<
	RenderEngine extends ClipTimePitchRenderEngine = ClipTimePitchRenderEngine,
> {
	readonly state: SourceRuntimeCompositionState;
	readonly copy: SourceRuntimeCompositionCopy;
	readonly lifetime: EditorControllerLifetime;
	readonly projectGeneration: Pick<EditorProjectGeneration, 'capture' | 'assertCurrent'>;
	readonly store: SourceRuntimeCompositionStore;
	readonly engine: SourceRuntimeCompositionEngine;
	readonly sourceBuffers: ReturnType<typeof createSourceBufferCache>;
	readonly sourceChunkProviders: SourceChunkProviderRegistry<string, ReturnType<typeof createStoredChunkProvider>>;
	readonly sourcePeaks: Map<string, unknown>;
	/** The render-cache coordinator the kernel owns, and the resolver it hands the engines. */
	readonly timePitchCache: ClipTimePitchCacheServiceDependencies['cache'];
	readonly sourceResolver: unknown;
	readonly createRenderEngine: ClipTimePitchCacheServiceDependencies<RenderEngine>['createRenderEngine'];
	readonly playbackProjects: Pick<PlaybackProjectService, 'projectForPlayback'>;
	readonly resolveProductVideoPreviewMedia?: ProjectVisualServiceDependencies['resolveProductVideoPreviewMedia'];
	readonly projectDurationFrames: ProjectVisualServiceDependencies['projectDurationFrames'];
	readonly getProject: () => SourceRuntimeProject | null;
	readonly publishDocumentSnapshot: () => void;
	readonly setStatus: (message: string, state?: string) => void;
	readonly handleError: (error: unknown) => void;
}
