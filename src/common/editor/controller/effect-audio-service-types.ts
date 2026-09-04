/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PersistEffectResultOptions, SelectionEffectResult } from './effect-result-service.ts';
import type {
	EffectSelection,
	EffectSelectionFrequencyRange,
	EffectTarget,
} from './effect-selection-service.ts';
import type { EditorProjectToken, EditorTaskScope } from './lifecycle.ts';

/**
 * The shapes the effect audio service reads and writes.
 *
 * The service is a port of legacy JavaScript, so it describes its runtime rather than
 * owning it: these declarations say what the editor must supply for a selection effect to
 * render, and the test harness builds against exactly them.
 */

export interface EffectAudioEffect extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: string;
	readonly params: Readonly<Record<string, unknown>>;
	readonly enabled?: boolean;
	readonly context?: Readonly<Record<string, unknown>> | null;
}

export interface EffectAudioTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly name: string;
	readonly type: 'audio' | 'video' | 'label';
	readonly clipIds: readonly string[];
	readonly effects?: readonly EffectAudioEffect[];
	readonly gain?: number;
	readonly pan?: number;
	readonly mute?: boolean;
	readonly solo?: boolean;
	readonly envelope?: readonly unknown[];
	readonly spectrogram?: Readonly<{ readonly windowSize?: number }>;
}

export interface EffectAudioClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind?: 'audio' | 'video';
	readonly sourceId: string;
	readonly title: string;
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
}

export interface EffectAudioProject extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly schemaVersion: number;
	readonly sampleRate: number;
	readonly masterChannels: number;
	readonly tracks: readonly EffectAudioTrack[];
	readonly clips: readonly EffectAudioClip[];
	readonly selection?: EffectSelection | null;
	readonly master: Readonly<{ readonly gain?: number; readonly effects: readonly EffectAudioEffect[] }>;
	readonly mixer: Readonly<Record<string, unknown>>;
}

export interface MutableEffectAudioTrack extends Record<string, unknown> {
	id: string;
	name: string;
	type: 'audio' | 'video' | 'label';
	clipIds: string[];
	effects: EffectAudioEffect[];
	gain: number;
	pan: number;
	mute: boolean;
	solo: boolean;
	envelope?: unknown[];
}

export interface MutableEffectAudioProject extends Record<string, unknown> {
	id: string;
	schemaVersion: number;
	sampleRate: number;
	masterChannels: number;
	tracks: MutableEffectAudioTrack[];
	clips: EffectAudioClip[];
	selection: EffectSelection | null;
	master: { gain?: number; effects: EffectAudioEffect[] };
	mixer: Record<string, unknown>;
}

export interface EffectAudioState {
	selectedTrackId: string | null;
	selectedClipId: string | null;
	audacityEffectProcessing: boolean;
	audacityNoiseProfile: unknown;
}

interface EffectAudioBuffer {
	readonly channels?: readonly Float32Array[];
	readonly [property: string]: unknown;
}

interface EffectAudioRenderEngine {
	loadProject(project: EffectAudioProject, sourceBuffers: unknown): void;
	renderTrack(trackId: string, options: Readonly<Record<string, unknown>>): Promise<EffectAudioBuffer>;
	renderMix(options: Readonly<Record<string, unknown>>): Promise<EffectAudioBuffer>;
	dispose(): Promise<void> | void;
}

interface EffectAudioCopy {
	readonly audacityApplied: string;
	readonly audacityProcessing: string;
	readonly audacityProfileProcessing: string;
	readonly audacitySelectionHint: string;
	readonly audioTrackNotFound: string;
	readonly effectProcessingFailed: string;
	readonly noiseProfileMinimumSamples: string;
	readonly noiseProfileReady: string;
	readonly rackEffectNotFound: string;
	readonly spectralAmplify: string;
	readonly spectralApplied: string;
	readonly spectralDelete: string;
	readonly spectralGainInvalid: string;
	readonly spectralProcessing: string;
	readonly spectralSelectionRequired: string;
	readonly v2Required: string;
}

interface NoiseProfileWorkerResult {
	readonly profile: unknown;
}

export interface EffectAudioServiceRuntime {
	readonly lifetime: Readonly<{ startTask(name: string): EditorTaskScope }>;
	readonly captureProject: () => EditorProjectToken;
	readonly assertProject: (token: EditorProjectToken) => void;
	readonly state: EffectAudioState;
	readonly copy: EffectAudioCopy;
	readonly memoryLimitBytes: number;
	readonly getProject: () => EffectAudioProject;
	readonly activeSelection: () => EffectSelection | null;
	readonly audacityEffectTarget: (trackId?: string | null) => EffectTarget | null;
	readonly audacityEffectTargets: (options?: Readonly<{ includeSilentTracks?: boolean }>) => EffectTarget[];
	readonly audacityEffectSelectionDetails: (
		selection: EffectSelection | null,
		targets: readonly EffectTarget[],
	) => Readonly<{
		trackIds: readonly string[];
		clipIds: readonly string[];
		frequencyRange: EffectSelectionFrequencyRange | null;
	}>;
	readonly editingBlocked: () => boolean;
	readonly projectSampleRate: () => number;
	readonly currentAudacityEffectParams: (type: string) => Readonly<Record<string, unknown>>;
	readonly estimateAudacityEffectPeakBytes: (
		type: string,
		frames: number,
		params: Readonly<Record<string, unknown>>,
		options: Readonly<{ channelCount: number; sampleRate: number }>,
	) => number;
	readonly audacityEffectMemoryError: () => Error;
	readonly preflightStorage: (bytes: number, kind: 'effect') => Promise<unknown>;
	readonly createId: (prefix: string) => string;
	readonly cloneProject: (project: EffectAudioProject) => EffectAudioProject;
	readonly audacitySelectionChannelCount: (
		project: EffectAudioProject,
		trackId: string,
		startFrame: number,
		endFrame: number,
	) => number;
	readonly renderSnapshot: (
		project: EffectAudioProject,
		options: Readonly<Record<string, unknown>>,
		sourceMap?: unknown,
		signal?: AbortSignal | null,
	) => Promise<EffectAudioBuffer>;
	readonly prepareCommittedTimePitchCaches: (project: EffectAudioProject) => Promise<unknown>;
	readonly createRenderEngine: () => EffectAudioRenderEngine;
	readonly sourceBuffers: unknown;
	readonly audioBufferChannels: (buffer: EffectAudioBuffer) => readonly Float32Array[];
	readonly matchAudacitySelectionChannels: (
		channels: readonly Float32Array[],
		channelCount: number,
	) => Float32Array[];
	readonly runSelectionEffectWorker: (request: Readonly<{
		operation: 'capture-noise-profile';
		channels: Float32Array[];
		sampleRate: number;
		params: Readonly<Record<string, unknown>>;
	}>) => Promise<NoiseProfileWorkerResult>;
	readonly runSpectralEditWorker: (
		channels: Float32Array[],
		options: Readonly<{
			sampleRate: number;
			startFrame: number;
			endFrame: number;
			minimumFrequency: number;
			maximumFrequency: number;
			windowSize: number;
			gainDb: number;
		}>,
	) => Promise<Float32Array[]>;
	readonly serializeNoiseProfile: (profile: unknown) => unknown;
	readonly assistanceStore?: unknown;
	readonly assistanceVideoStore?: unknown;
	readonly assistanceDerivativeRepository?: import(
		'../storage/deferred-assistance-derivative-repository.ts'
	).AssistanceDerivativeRepositoryPort;
	readonly commit: (command: Readonly<Record<string, unknown>>) => void;
	readonly persistAudacityEffectResults: (
		results: readonly SelectionEffectResult[],
		type: null,
		options: PersistEffectResultOptions,
	) => Promise<unknown>;
	readonly setStatus: (message: string, status?: string) => void;
	readonly publishDocumentSnapshot: () => void;
}
