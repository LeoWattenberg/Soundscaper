/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EnginePublicApi } from '../engine/public-api.ts';
import type { AudioWarpControllerCompositionDependencies } from './audio-warp-composition.ts';
import type { DerivedAudioCompositionDependencies } from './derived-audio-composition.ts';
import type { ExportSnapshotRendererRuntime } from './export-snapshot-renderer.ts';
import type { EditorControllerLifetime, EditorProjectGeneration } from './lifecycle.ts';
import type { MicrophoneMeterService } from './microphone-meter-service.ts';
import type { MixRenderServiceDependencies } from './mix-render-service.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { ControllerRecordingState } from './recording-state.ts';
import type { TakeCompCompositionDependencies } from './take-comp-composition.ts';
import type { EditorTaskProgressCoordinator } from './task-progress.ts';
import type { bufferFromChannels } from './source-audio.ts';
import type { EditorTrackServiceDependencies, TrackRecordingRoutingPort } from './track-service.ts';
import type { generateWaveformPeaks } from './waveform-analysis.ts';

/** The document shape every track and audio-production service reads. */
export type TrackAudioCompositionProject =
	& ReturnType<DerivedAudioCompositionDependencies['getProject']>
	& ReturnType<EditorTrackServiceDependencies['getProject']>
	& ReturnType<TakeCompCompositionDependencies['getProject']>
	& ReturnType<AudioWarpControllerCompositionDependencies['getProject']>
	& ReturnType<MixRenderServiceDependencies['getProject']>;

export type TrackAudioCompositionState = Pick<ControllerRecordingState,
	| 'preferredInputChannelCount' | 'preferredInputDeviceId' | 'recordingDevices' | 'recordingPoolSources'
	| 'recordingRouteHealth' | 'recordingRouting'
> & {
	selectedTrackId: string | null;
	selectedClipId: string | null;
	audacityEffectProcessing: boolean;
	analysisProcessing: boolean;
	timelineView: Parameters<EditorTrackServiceDependencies['setTimelineView']>[0];
};

export type TrackAudioCompositionCopy =
	& DerivedAudioCompositionDependencies['copy']
	& EditorTrackServiceDependencies['copy']
	& MixRenderServiceDependencies['copy']
	& Parameters<typeof bufferFromChannels>[3]
	& Parameters<typeof generateWaveformPeaks>[1]
	& Readonly<{
		readonly audacityProcessing: string;
		readonly rendering: string;
		readonly resamplingTrack?: string;
		readonly resamplingClip?: string;
		readonly rewritingChannels?: string;
	}>;

export type TrackAudioCompositionStore =
	& DerivedAudioCompositionDependencies['store']
	& AudioWarpControllerCompositionDependencies['store']
	& MixRenderServiceDependencies['store'];

export type TrackAudioCompositionEngine = Pick<EnginePublicApi,
	| 'getAudioContext' | 'getAudioWarpRenderStatus' | 'getPositionFrames' | 'seek' | 'stop'
>;

/** What the deferred export service takes beyond the pure helpers the composition imports itself. */
export type TrackAudioExportPorts = Readonly<{
	readonly ffmpeg: unknown;
	readonly fileService: unknown;
	readonly playbackProjects: unknown;
	readonly productName: string;
	readonly prepareProjectForExport: unknown;
	readonly normalizeExportSettings: (value?: unknown) => unknown;
	readonly toggleExport: (active: boolean) => void;
	readonly updateExportProgress: ExportSnapshotRendererRuntime['updateExportProgress'];
	readonly setPersistentExportProgressObserver: (observer: ((value: number) => void) | null) => void;
}>;

export interface TrackAudioCompositionDependencies {
	readonly state: TrackAudioCompositionState;
	readonly copy: TrackAudioCompositionCopy;
	readonly lifetime: EditorControllerLifetime;
	readonly projectGeneration: Pick<EditorProjectGeneration, 'capture' | 'assertCurrent'>;
	/** The product runtime's document operations; both keep the document's shape. */
	readonly projectRuntime: Readonly<{
		readonly cloneProject: <Project>(project: Project) => Project;
		readonly applyCommand: <Project>(project: Project, command: AudioEditorCommand) => Project;
	}>;
	/** The controller's raw options, which the export service still reads product hooks from. */
	readonly controllerOptions: ExportSnapshotRendererRuntime['options'];
	readonly store: TrackAudioCompositionStore;
	readonly engine: TrackAudioCompositionEngine;
	readonly sourceBuffers: DerivedAudioCompositionDependencies['sourceBuffers'] & TakeCompCompositionDependencies['sourceBuffers'];
	readonly sourceChunkProviders: TakeCompCompositionDependencies['sourceChunkProviders'];
	readonly sourcePeaks: DerivedAudioCompositionDependencies['sourcePeaks'];
	readonly sourceResolver: TakeCompCompositionDependencies['sourceResolver'];
	readonly sourceChunkFrames: number;
	readonly mixRenderMemoryLimitBytes: number;
	readonly defaultPixelsPerSecond: number;
	readonly maximumPixelsPerSecond: number;
	readonly trackColors: readonly string[];
	readonly taskProgress: Pick<EditorTaskProgressCoordinator, 'run' | 'updateActive'>;
	readonly microphoneMeter: Pick<MicrophoneMeterService, 'clearRoutedLoudnessMeter' | 'synchronizeTarget'>;
	readonly export: TrackAudioExportPorts;
	readonly createRenderEngine: MixRenderServiceDependencies['createRenderEngine'];
	readonly createPreviewEngine: TakeCompCompositionDependencies['createPreviewEngine'];
	readonly prepareCommittedTimePitchCaches: MixRenderServiceDependencies['prepareCommittedTimePitchCaches'] & ExportSnapshotRendererRuntime['prepareCommittedTimePitchCaches'];
	readonly getProject: () => TrackAudioCompositionProject | null;
	readonly editingBlocked: () => boolean;
	readonly commit:
		& DerivedAudioCompositionDependencies['commit']
		& EditorTrackServiceDependencies['commit']
		& TakeCompCompositionDependencies['commit']
		& AudioWarpControllerCompositionDependencies['commit']
		& MixRenderServiceDependencies['commit'];
	readonly setStatus: (message: string, state?: string) => void;
	readonly publishDocumentSnapshot: () => void;
	readonly publishProjectState: () => void;
	readonly handleError: (error: unknown) => void;
	readonly preflightStorage: (bytes: number, category: 'effect') => Promise<unknown>;
	readonly projectSampleRate: () => number;
	readonly projectDurationFrames: (project: unknown) => number;
	readonly editorTimelineDurationFrames: (project: unknown, sampleRate: number) => number;
	readonly normalizeTimelineFrame: (frame: unknown) => number;
	readonly persistSetting: (key: string, value: unknown) => Promise<unknown>;
	readonly productSettingKey: (name: string) => string;
	readonly activeSelection: () => Readonly<{ readonly startFrame: number; readonly endFrame: number }> | null;
	readonly activateStoredSource: MixRenderServiceDependencies['activateStoredSource'];
	readonly cacheSourceBuffer: DerivedAudioCompositionDependencies['cacheSourceBuffer'];
	readonly retireSourceChunkProvider: DerivedAudioCompositionDependencies['retireSourceChunkProvider'];
	readonly renderDryTrackRange: DerivedAudioCompositionDependencies['renderDryTrackRange'];
	readonly hasMissingTimelineSources: () => boolean;
	readonly updatePlayhead: (frame?: unknown, duration?: unknown) => unknown;
	readonly updateSelection: (...args: unknown[]) => unknown;
	readonly synchronizeAutomaticSampleEditMode: () => unknown;
	readonly updateRecordingDeviceRows: TrackRecordingRoutingPort['updateDeviceRows'];
	readonly persistRecordingRouting: TrackRecordingRoutingPort['persistRouting'];
}
