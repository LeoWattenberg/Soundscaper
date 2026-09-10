/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EnginePublicApi } from '../../engine/public-api.ts';
import type { ClipPropertyServiceDependencies } from './internal/clip/clip-property-service.ts';
import type { ClipTimePitchRenderServiceDependencies } from './clip-time-pitch-render-service.ts';
import type { ClipTransformServiceDependencies } from './internal/clip/clip-transform-service.ts';
import type { EditorControllerLifetime, EditorProjectGeneration } from '../shared/lifecycle.ts';
import type { ControllerRuntimeProject } from '../document/project-runtime.ts';
import type {
	SampleEditServiceCopy,
	SampleEditServiceRuntime,
	SampleEditServiceState,
	SampleEditStore,
} from './internal/sample-edit-service.ts';
import type { SequenceTimingServiceDependencies } from './internal/sequence-timing-service.ts';
import type { SourceMonitorServiceDependencies } from './internal/source-monitor-service.ts';
import type { EditorTaskProgressCoordinator } from '../shared/task-progress.ts';
import type { VideoEditServiceDependencies } from './internal/video/video-edit-service.ts';
import type { VideoEffectServiceRuntime } from './video-effect-service.ts';
import type { VideoNavigationServiceDependencies } from './internal/video/video-navigation-service.ts';
import type { VideoRetimeProgramStateResolverDependencies } from './internal/video/video-retime-program-state.ts';
import type { VideoSourceReprobeDependencies } from './video-source-reprobe-service.ts';
import type { VideoTrimCompositionDependencies } from './internal/trim/video-trim-composition.ts';
import type { generateWaveformPeaks } from '../source/waveform-analysis.ts';

/** The document identity the clip services read; the command projection is supplied separately. */
export type ClipVideoCompositionProject =
	& ReturnType<VideoSourceReprobeDependencies['getProject']>
	& NonNullable<ReturnType<VideoEffectServiceRuntime['getProject']>>
	& ControllerRuntimeProject;

/** The resolved-sample projection every edit and navigation service reads. */
export type ClipVideoCommandProject =
	& ReturnType<SourceMonitorServiceDependencies['getProject']>
	& ReturnType<VideoEditServiceDependencies['getProject']>
	& ReturnType<VideoNavigationServiceDependencies['getProject']>
	& ReturnType<ClipPropertyServiceDependencies['getProject']>
	& ReturnType<ClipTimePitchRenderServiceDependencies['getProject']>
	& ReturnType<ClipTransformServiceDependencies['getProject']>;

export type ClipVideoCompositionState = VideoEffectServiceRuntime['state'] & SampleEditServiceState & {
	selectedTrackId: string | null;
	selectedClipId: string | null;
	readonly audacityEffectProcessing: boolean;
};

export type ClipVideoCompositionCopy =
	& ClipTransformServiceDependencies['copy']
	& ClipPropertyServiceDependencies['copy']
	& ClipTimePitchRenderServiceDependencies['copy']
	& VideoTrimCompositionDependencies['copy']
	& VideoEffectServiceRuntime['copy']
	& SampleEditServiceCopy
	& Parameters<typeof generateWaveformPeaks>[1]
	& Readonly<{ readonly rendering: string }>;

export type ClipVideoCompositionStore =
	& VideoSourceReprobeDependencies['store']
	& ClipTimePitchRenderServiceDependencies['store']
	& SampleEditStore;

export type ClipVideoCompositionEngine = Pick<EnginePublicApi,
	| 'endScrub' | 'getPositionFrames' | 'pause' | 'scrub' | 'seek'
>;

export interface ClipVideoCompositionDependencies {
	readonly state: ClipVideoCompositionState;
	readonly copy: ClipVideoCompositionCopy;
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive' | 'signal' | 'startTask'>;
	readonly projectGeneration: Pick<EditorProjectGeneration, 'capture' | 'assertCurrent'>;
	readonly projectRuntime: VideoRetimeProgramStateResolverDependencies['projectRuntime'];
	readonly store: ClipVideoCompositionStore;
	readonly engine: ClipVideoCompositionEngine;
	readonly ffmpeg: VideoSourceReprobeDependencies['ffmpeg'];
	readonly helperTimingProbe: VideoSourceReprobeDependencies['helperTimingProbe'];
	readonly sourceBuffers: ClipPropertyServiceDependencies['sourceBuffers'] & ClipTimePitchRenderServiceDependencies['sourceBuffers'];
	readonly sourcePeaks: ClipTimePitchRenderServiceDependencies['sourcePeaks'];
	readonly sourceChunkFrames: number;
	readonly taskProgress: Pick<EditorTaskProgressCoordinator, 'run' | 'updateActive'>;
	readonly currentTimeMs: () => number;
	readonly monotonicNow?: () => number;
	readonly setInterval: VideoNavigationServiceDependencies['setInterval'];
	readonly clearInterval: VideoNavigationServiceDependencies['clearInterval'];
	readonly createVideoRetimeProgramOrdinalBridge?: VideoRetimeProgramStateResolverDependencies['createBridge'];
	/** Prepare a clip's committed time-pitch output through the render cache, reporting progress. */
	readonly prepareCommittedOutput: (
		clip: Parameters<ClipTimePitchRenderServiceDependencies['prepareCommittedOutput']>[0],
		source: Parameters<ClipTimePitchRenderServiceDependencies['prepareCommittedOutput']>[1],
		options: Readonly<{ readonly signal: AbortSignal; readonly onProgress: (value: number) => void }>,
	) => ReturnType<ClipTimePitchRenderServiceDependencies['prepareCommittedOutput']>;
	readonly materializeTimePitchCacheEntry: ClipTimePitchRenderServiceDependencies['materializeEntry'];
	readonly retireSourceChunkProvider: SampleEditServiceRuntime['retireSourceChunkProvider'];
	readonly getProject: () => ClipVideoCompositionProject | null;
	readonly getCommandProject: () => ClipVideoCommandProject;
	readonly editingBlocked: () => boolean;
	readonly commit:
		& SequenceTimingServiceDependencies['commit']
		& VideoEditServiceDependencies['commit']
		& VideoTrimCompositionDependencies['commit']
		& VideoSourceReprobeDependencies['commit']
		& ClipTransformServiceDependencies['commit']
		& ClipPropertyServiceDependencies['commit']
		& ClipTimePitchRenderServiceDependencies['commit']
		& VideoEffectServiceRuntime['commit'];
	readonly publishProjectState: () => void;
	readonly publishDocumentSnapshot: () => void;
	readonly setStatus: (message: string, state?: 'info' | 'success' | 'error') => void;
	readonly handleError: (error: unknown) => void;
	readonly normalizePlaybackFrame: (frame: unknown) => number;
	readonly cancelPlaybackCachePreparation: () => unknown;
	readonly cancelPlayAtSpeedPreparation: () => unknown;
	readonly stopProjectBinPreview: () => PromiseLike<unknown> | unknown;
	readonly hasMissingTimelineSources: () => boolean;
	readonly activateVideoSource: VideoSourceReprobeDependencies['activateVideoSource'];
	readonly activateStoredSource: SampleEditServiceRuntime['activateStoredSource'];
	readonly activeSelection: ClipTransformServiceDependencies['activeSelection'];
	readonly snapTimelineFrame: (frame: unknown) => number;
	readonly preflightStorage: (bytes: number, purpose: 'effect') => Promise<unknown>;
	readonly projectSampleRate: () => number;
	readonly cacheSourceBuffer: ClipTimePitchRenderServiceDependencies['cacheSourceBuffer'];
	readonly setEffectProcessing: (processing: boolean) => void;
}
