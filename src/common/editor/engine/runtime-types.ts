/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ChunkStreamClientLike, ChunkAudioNodeFactory } from './clip-scheduler.ts';
import type { NormalizedLoop, PlanarPcm, PreparedSpeedPlayback } from './buffer-math.ts';
import type {
	EngineAudioContext,
	EngineMeterSnapshot,
	EnginePublicApi,
} from './public-api.ts';
import type { ProjectGraph } from './project-graph.ts';
import type { EngineChunkSource, EngineProject, EngineSourceResolver } from './types.ts';
import {
	ENGINE_ASSERT_ACTIVE,
	ENGINE_CANCEL_SCRUB,
	ENGINE_DISPOSE_RESOURCES,
	ENGINE_EMIT_METERS,
	ENGINE_EMIT_PARAMETRIC_EQ_ERROR,
	ENGINE_EMIT_POSITION,
	ENGINE_ENSURE_MASTER_LOUDNESS_METER,
	ENGINE_GET_CHUNK_STREAM_CLIENT,
	ENGINE_GET_CONTEXT,
	ENGINE_HANDLE_SCHEDULING_ERROR,
	ENGINE_HALT_GRAPH,
	ENGINE_SCHEDULE_CURRENT_PLAYBACK,
	ENGINE_SCHEDULE_LOOP_AHEAD,
	ENGINE_SCHEDULE_PLAYBACK,
	ENGINE_SCHEDULE_PREPARED_SPEED_PLAYBACK,
	ENGINE_SET_STATE,
	ENGINE_START_TICKER,
	ENGINE_STOP_TICKER,
} from './runtime-symbols.ts';

export type EngineRuntimeMethodMap<Keys extends keyof EngineRuntimeHost> =
	Pick<EngineRuntimeHost, Keys> & ThisType<EngineRuntimeHost>;

export type EngineRealtimeContextFactory =
	| ((options?: AudioContextOptions) => EngineAudioContext)
	| (new(options?: AudioContextOptions) => EngineAudioContext);

export interface EngineOfflineContextOptions {
	readonly numberOfChannels: number;
	readonly length: number;
	readonly sampleRate: number;
}

export type EngineOfflineContextFactory =
	| ((options: EngineOfflineContextOptions) => OfflineAudioContext)
	| (new(options: EngineOfflineContextOptions) => OfflineAudioContext)
	| (new(numberOfChannels: number, length: number, sampleRate: number) => OfflineAudioContext);

export type EngineSoftwareRenderer = (
	options: Readonly<Record<string, unknown>>,
) => AudioBuffer | PlanarPcm | Promise<AudioBuffer | PlanarPcm>;

export interface MutablePreparedSpeedPlayback extends Omit<PreparedSpeedPlayback, 'audioBuffer'> {
	audioBuffer: AudioBuffer | null;
}

export interface PreparedAudioWarpPlayback {
	readonly project: EngineProject;
	readonly authorityFingerprint: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly channels: readonly Float32Array[];
	readonly frameCount: number;
	readonly sampleRate: number;
	audioBuffer: AudioBuffer | null;
}

export interface AudioWarpPlaybackPreparation {
	readonly project: EngineProject;
	readonly authorityFingerprint: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly promise: Promise<Readonly<PreparedAudioWarpPlayback>>;
}

export interface EngineLoudnessMeter {
	readonly node: AudioNode;
	setRunning(running: boolean): void;
	reset(): void;
	requestSnapshot(): void;
	dispose(): void;
}

export interface EngineRuntimeHost extends EnginePublicApi {
	audioContextFactory: EngineRealtimeContextFactory | null;
	offlineAudioContextFactory: EngineOfflineContextFactory | null;
	softwareRenderer: EngineSoftwareRenderer | null;
	audioWarpRealtimeAcceleration: boolean;
	sourceResolver: EngineSourceResolver | null;
	chunkStreamClient: (ChunkStreamClientLike & { dispose?(): void }) | null;
	chunkStreamClientFactory: () => ChunkStreamClientLike & { dispose?(): void };
	chunkAudioNodeFactory: ChunkAudioNodeFactory;
	project: EngineProject | null;
	sources: Map<unknown, AudioBuffer>;
	chunkSources: Map<string, EngineChunkSource>;
	context: EngineAudioContext | null;
	preferredOutputDeviceId: string;
	activeOutputDeviceId: string;
	outputDeviceError: unknown;
	outputDeviceGeneration: number;
	playbackGain: number;
	playbackOutputNode: GainNode | null;
	playbackOutputDestination: AudioNode | null;
	positionFrame: number;
	playbackStartFrame: number;
	playbackStartTime: number;
	durationFrames: number;
	playbackDurationFrames: number;
	playEndFrame: number;
	loopScheduleTime: number;
	playbackRate: number;
	playbackMode: 'normal' | 'naive' | 'staffpad' | 'audio-warp-exact';
	preparedSpeedPlayback: MutablePreparedSpeedPlayback | null;
	preparedAudioWarpPlayback: PreparedAudioWarpPlayback | null;
	audioWarpPlaybackPreparation: AudioWarpPlaybackPreparation | null;
	state: string;
	loop: NormalizedLoop;
	graph: ProjectGraph | null;
	ticker: ReturnType<typeof globalThis.setInterval> | null;
	scrubTimer: ReturnType<typeof globalThis.setTimeout> | null;
	scrubNextAt: number;
	scrubGeneration: number;
	scrubbing: boolean;
	meterInterval: number;
	monotonicNow: (() => number) | null;
	reversedBuffers: WeakMap<AudioBuffer, AudioBuffer>;
	positionListeners: Set<(frame: number, durationFrames: number) => void>;
	meterListeners: Set<(meter: EngineMeterSnapshot) => void>;
	stateListeners: Set<(state: string) => void>;
	parametricEqErrorListeners: Set<(error: unknown) => void>;
	masterLoudnessMeter: EngineLoudnessMeter | null;
	masterLoudnessMeterChannelCount: number | null;
	masterLoudnessMeterChannelWeights: readonly number[] | null;
	masterLoudnessMeterPromise: Promise<EngineLoudnessMeter | null> | null;
	masterLoudnessMeterError: unknown;
	latestMasterLoudnessMeter: Readonly<{ loudness?: unknown }> | null;
	loudnessMeasurementManuallyPaused: boolean;
	disposed: boolean;
	disposePromise: Promise<void> | null;
	lifecycleGeneration: number;
	readonly sampleRate: number;

	[ENGINE_ASSERT_ACTIVE](): void;
	[ENGINE_CANCEL_SCRUB](): void;
	[ENGINE_DISPOSE_RESOURCES](): Promise<void>;
	[ENGINE_EMIT_METERS](): void;
	[ENGINE_EMIT_PARAMETRIC_EQ_ERROR](error: unknown): void;
	[ENGINE_EMIT_POSITION](frame?: number): void;
	[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context: EngineAudioContext): Promise<EngineLoudnessMeter | null>;
	[ENGINE_GET_CHUNK_STREAM_CLIENT](): ChunkStreamClientLike | null;
	[ENGINE_GET_CONTEXT](): Promise<EngineAudioContext>;
	[ENGINE_HANDLE_SCHEDULING_ERROR](error: unknown): void;
	[ENGINE_HALT_GRAPH](): void;
	[ENGINE_SCHEDULE_CURRENT_PLAYBACK](fromFrame: number, scheduledTime?: number): Promise<number>;
	[ENGINE_SCHEDULE_LOOP_AHEAD](): void;
	[ENGINE_SCHEDULE_PLAYBACK](fromFrame: number, scheduledTime?: number): Promise<number>;
	[ENGINE_SCHEDULE_PREPARED_SPEED_PLAYBACK](fromFrame: number, scheduledTime?: number): Promise<number>;
	[ENGINE_SET_STATE](value: string): void;
	[ENGINE_START_TICKER](): void;
	[ENGINE_STOP_TICKER](): void;
}
