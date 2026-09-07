/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { EnginePublicApi } from '../engine/public-api.ts';
import type { AssistanceDerivativeRepositoryPort } from '../storage/deferred-assistance-derivative-repository.ts';
import type { AbsentSubsystemContext } from './absent-audio-subsystems.ts';
import type { EffectAudioProject, EffectAudioServiceRuntime } from './effect-audio-service.ts';
import type { EffectControlsServiceRuntime } from './effect-controls-service.ts';
import type { EffectMacroServiceRuntime } from './effect-macro-service.ts';
import type { EffectResultProject, SelectionEffectResultRuntime } from './effect-result-service.ts';
import type {
	EffectSelection,
	EffectSelectionProject,
	EffectSelectionServiceRuntime,
} from './effect-selection-service.ts';
import type { EditorControllerLifetime, EditorProjectGeneration } from './lifecycle.ts';
import type {
	NyquistGeneratedAudioProject,
	NyquistGeneratedAudioServiceRuntime,
} from './nyquist-generated-audio-service.ts';
import type { NyquistHostProject, NyquistHostServiceRuntime } from './nyquist-host-service.ts';
import type {
	RackEffectCommitOptions,
	RackEffectCopy,
	RackEffectProject,
	RackEffectServiceRuntime,
} from './rack-effect-service.ts';
import type { SelectionEffectWorkerServiceRuntime } from './selection-effect-worker-service.ts';
import type { EditorTaskProgressCoordinator } from './task-progress.ts';
import type { AudioBufferLike } from './source-audio.ts';
import type { generateWaveformPeaks } from './waveform-analysis.ts';

/** The document shape every effect service reads; the controller supplies its current project. */
export type EffectsCompositionProject =
	& EffectSelectionProject
	& EffectAudioProject
	& NyquistHostProject
	& NyquistGeneratedAudioProject
	& RackEffectProject
	& EffectResultProject
	& ReturnType<EffectControlsServiceRuntime['getProject']>
	& ReturnType<EffectMacroServiceRuntime['getProject']>;

/** The union of what the effect services read and write on the controller state. */
export type EffectsCompositionState =
	& EffectSelectionServiceRuntime['state']
	& EffectControlsServiceRuntime['state']
	& EffectAudioServiceRuntime['state']
	& NyquistHostServiceRuntime['state']
	& NyquistGeneratedAudioServiceRuntime['state']
	& SelectionEffectWorkerServiceRuntime['state']
	& RackEffectServiceRuntime['state']
	& SelectionEffectResultRuntime['state']
	& {
		audacityEffectProcessing: boolean;
		audacityPreviewGeneration: number;
	};

export type EffectsCompositionCopy =
	& EffectSelectionServiceRuntime['copy']
	& EffectControlsServiceRuntime['copy']
	& EffectAudioServiceRuntime['copy']
	& NyquistHostServiceRuntime['copy']
	& NyquistGeneratedAudioServiceRuntime['copy']
	& EffectMacroServiceRuntime['copy']
	& SelectionEffectResultRuntime['copy']
	& SelectionEffectWorkerServiceRuntime['copy']
	& RackEffectCopy
	& Parameters<typeof generateWaveformPeaks>[1]
	& Readonly<{
		readonly effectMemoryTooLarge: string;
		readonly audacityProcessing: string;
		readonly macroProcessing?: string;
		readonly spectralProcessing?: string;
		readonly nyquistProcessing?: string;
	}>;

export type EffectsCompositionStore =
	& SelectionEffectResultRuntime['store']
	& NyquistGeneratedAudioServiceRuntime['store']
	& Readonly<{ readonly assistanceDerivativeRepository?: AssistanceDerivativeRepositoryPort }>;

export type EffectsCompositionEngine = Pick<EnginePublicApi,
	| 'configureParametricEq' | 'configureRackEffect' | 'getAudioContext' | 'getPositionFrames' | 'pause'
>;

export interface EffectsCompositionDependencies {
	readonly state: EffectsCompositionState;
	readonly copy: EffectsCompositionCopy;
	readonly locale: string;
	/** Which optional audio domains this product composes; the rest get refusing stand-ins. */
	readonly composition: Readonly<{
		readonly effects: boolean;
		readonly macros: boolean;
		readonly selectionEffectWorkers: boolean;
	}>;
	readonly absentSubsystem: AbsentSubsystemContext;
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask' | 'cancelTask'>;
	readonly projectGeneration: Pick<EditorProjectGeneration, 'capture' | 'assertCurrent'>;
	readonly projectRuntime: Readonly<{
		readonly assistanceAssetCommands: boolean;
		/** Validate and normalise a document; the result keeps the document's shape. */
		readonly cloneProject: <Project>(project: Project) => Project;
	}>;
	readonly store: EffectsCompositionStore;
	readonly engine: EffectsCompositionEngine;
	readonly sourceBuffers: NyquistGeneratedAudioServiceRuntime['sourceBuffers'];
	readonly sourcePeaks: NyquistGeneratedAudioServiceRuntime['sourcePeaks'];
	readonly taskProgress: Pick<EditorTaskProgressCoordinator, 'run' | 'updateActive'>;
	readonly nyquistEvaluator: (request: unknown, options?: unknown) => Promise<unknown>;
	readonly getProject: () => EffectsCompositionProject | null;
	readonly activeSelection: () => EffectSelection | null;
	readonly selectedTracksTimeRange: EffectSelectionServiceRuntime['selectedTracksTimeRange'];
	readonly editingBlocked: () => boolean;
	readonly setSelection: EffectSelectionServiceRuntime['setSelection'];
	readonly persistSetting: EffectControlsServiceRuntime['persistSetting'];
	readonly publishDocumentSnapshot: () => void;
	readonly setStatus: (message: string, status?: string) => void;
	readonly preflightStorage: (bytes: number, kind: 'effect') => Promise<unknown>;
	readonly renderSnapshot: (
		project: unknown,
		options: Readonly<Record<string, unknown>>,
		sourceMap?: unknown,
		signal?: AbortSignal | null,
	) => Promise<AudioBufferLike>;
	readonly prepareCommittedTimePitchCaches: EffectAudioServiceRuntime['prepareCommittedTimePitchCaches'];
	readonly createRenderEngine: EffectAudioServiceRuntime<AudioBufferLike>['createRenderEngine'];
	readonly commit: (
		command: AudioEditorCommand | Readonly<Record<string, unknown>>,
		selection?: Readonly<{ readonly selectTrackId?: string | null; readonly selectClipId?: string | null }>,
		options?: RackEffectCommitOptions,
	) => EffectsCompositionProject;
	readonly cacheSourceBuffer: (sourceId: string, buffer: unknown) => unknown;
	readonly snapTimelineFrame: (frame: unknown) => number;
	readonly projectDurationFrames: (project: EffectsCompositionProject | null) => number;
	readonly projectSampleRate: () => number;
	readonly handleError: (error: unknown) => null;
}
