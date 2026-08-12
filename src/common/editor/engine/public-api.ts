/* SPDX-License-Identifier: AGPL-3.0-only */

import type { NormalizedLoop, PlanarPcm } from './buffer-math.ts';
import type { EffectSpectrumMetadata } from './effect-rack.ts';
import type { AudioWarpRenderPathStatus } from '../audio-warp-runtime.ts';
import type {
	EngineChunkSource,
	EngineLoop,
	EngineProject,
	EngineSourceResolver,
	UnknownRecord,
} from './types.ts';

export interface EngineAudioContext extends AudioContext {
	setSinkId?(deviceId: string): Promise<void>;
}

export type EngineSourceBufferInput =
	| ReadonlyMap<unknown, AudioBuffer>
	| Readonly<Record<string, AudioBuffer>>;

export type EngineChunkSourceInput =
	| ReadonlyMap<unknown, EngineChunkSource | unknown>
	| Readonly<Record<string, EngineChunkSource | unknown>>;

export interface EngineLoadProjectOptions {
	readonly chunkSources?: EngineChunkSourceInput;
}

export interface EngineOutputDeviceState {
	readonly preferredDeviceId: string;
	readonly activeDeviceId: string;
	readonly supported: boolean;
	readonly error: unknown;
}

export interface EngineStateSnapshot {
	readonly state: string;
	readonly positionFrame: number;
	readonly durationFrames: number;
	readonly loop: NormalizedLoop;
	readonly playbackRate: number;
	readonly playbackMode: 'normal' | 'naive' | 'staffpad' | 'audio-warp-exact';
}

export interface EngineLoudnessMeasurementState {
	readonly manuallyPaused: boolean;
	readonly running: boolean;
	readonly error: unknown;
}

export interface EngineMeterReading {
	readonly peak: number;
	readonly rms: number;
	readonly dbfs: number;
	readonly loudness?: unknown;
}

export interface EngineMeterSnapshot {
	readonly master: EngineMeterReading;
	readonly tracks: Readonly<Record<string, EngineMeterReading>>;
	readonly groups: Readonly<Record<string, EngineMeterReading>>;
	readonly sends: Readonly<Record<string, EngineMeterReading>>;
}

export interface EngineProgress {
	readonly frames?: number;
	readonly totalFrames?: number;
	readonly progress: number;
}

export type EnginePitchPreserver = (
	channels: readonly Float32Array[],
	sampleRate: number,
	playbackRate: number,
	options: Readonly<{
		signal: AbortSignal | null;
		onProgress: ((progress: EngineProgress) => void) | null;
	}>,
) => Promise<readonly (Float32Array | ArrayLike<number>)[]>;

export interface EnginePlayAtSpeedOptions {
	readonly preservePitch?: boolean;
	readonly pitchPreserver?: EnginePitchPreserver | null;
	readonly signal?: AbortSignal | null;
	readonly onProgress?: ((progress: EngineProgress) => void) | null;
}

export interface EngineScrubOptions {
	readonly durationMs?: number;
}

export type EngineEffectScope = 'track' | 'group' | 'send' | 'master';

export interface EngineEffectMessageOptions {
	readonly revision?: number;
	readonly transitionFrames?: number;
}

export interface EngineParametricEqPreview {
	readonly source: AudioBufferSourceNode;
	onended: ((event: Event) => void) | null;
	onerror: ((error: unknown) => void) | null;
	start(when?: number, offset?: number, duration?: number): void;
	stop(when?: number): void;
	configure(params: UnknownRecord): number | false;
	audition(bandId: string | null): number | false;
	readSpectrum(which: 'input' | 'output', target: Float32Array): EffectSpectrumMetadata | null;
	disconnect(): void;
}

export interface EngineRenderMixOptions {
	readonly startFrame?: number;
	readonly endFrame?: number;
	readonly includeTail?: boolean | number;
	readonly trackId?: unknown;
	readonly includeMaster?: boolean;
	readonly includeTrackPan?: boolean;
	readonly respectMuteSolo?: boolean;
	readonly outputFrames?: number | null;
	readonly preRollFrames?: number;
	readonly signal?: AbortSignal | null;
	readonly onProgress?: ((progress: EngineProgress) => void) | null;
}

export interface EnginePcmChunkMetadata {
	readonly frameOffset?: number;
	readonly sampleRate: number;
	readonly frames?: number;
}

export type EnginePcmChunkSink = (
	channels: readonly Float32Array[],
	metadata: EnginePcmChunkMetadata,
) => void | Promise<void>;

export interface EngineRealtimeRenderOptions extends EngineRenderMixOptions {
	readonly sampleRate?: number;
	readonly chunkFrames?: number;
	readonly maximumPendingChunks?: number;
	readonly backpressureHighWaterChunks?: number;
	readonly onChunk?: EnginePcmChunkSink;
}

export interface EngineRenderResult {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly chunkCount: number;
}

export type EnginePcmSink = EnginePcmChunkSink | Readonly<{ write: EnginePcmChunkSink }>;

export interface EngineRenderToSinkOptions extends Omit<EngineRealtimeRenderOptions, 'onChunk'> {
	readonly sink?: EnginePcmSink;
}

/** Public contract shared by the runtime host, constructor, and API registry. */
export interface EnginePublicApi {
	readonly sampleRate: number;
	loadProject(project: EngineProject | null, sourceBuffers?: EngineSourceBufferInput, options?: EngineLoadProjectOptions): this;
	applyProject(project: EngineProject | null, sourceBuffers?: EngineSourceBufferInput, options?: EngineLoadProjectOptions): Promise<void>;
	setSourceResolver(sourceResolver?: EngineSourceResolver | null): this;
	setChunkSources(chunkSources?: EngineChunkSourceInput): this;
	decodeAudioData(data: ArrayBuffer | Blob): Promise<AudioBuffer>;
	getAudioContext(options?: Readonly<{ resume?: boolean }>): Promise<EngineAudioContext>;
	setOutputDevice(deviceId?: string): Promise<EngineOutputDeviceState>;
	getOutputDeviceState(): EngineOutputDeviceState;
	getAudioWarpRenderStatus(): Readonly<AudioWarpRenderPathStatus>;
	play(): Promise<void>;
	playAtSpeed(rate: number, options?: EnginePlayAtSpeedOptions): Promise<void>;
	/** Resolves to the actual context start after asynchronous playback priming. */
	playAt(contextTime: number, fromFrame?: number): Promise<number>;
	pause(): void;
	stop(): void;
	seek(frame: number): number;
	pauseLoudnessMeasurement(): EngineLoudnessMeasurementState;
	continueLoudnessMeasurement(): EngineLoudnessMeasurementState;
	resetLoudnessMeasurement(): EngineLoudnessMeasurementState;
	getLoudnessMeasurementState(): EngineLoudnessMeasurementState;
	scrub(frame: number, options?: EngineScrubOptions): Promise<number>;
	endScrub(): number;
	setLoop(loopOrEnabled: EngineLoop | boolean, startFrame?: number, endFrame?: number): NormalizedLoop;
	getPositionFrames(): number;
	getState(): EngineStateSnapshot;
	subscribePosition(listener: (frame: number, durationFrames: number) => void): () => boolean | void;
	subscribeMeters(listener: (meter: EngineMeterSnapshot) => void): () => boolean | void;
	subscribeState(listener: (state: string) => void): () => boolean | void;
	subscribeParametricEqErrors(listener: (error: unknown) => void): () => boolean | void;
	configureRackEffect(scope: EngineEffectScope, targetId: unknown, effectId: string, params: UnknownRecord, options?: EngineEffectMessageOptions): number | false;
	configureParametricEq(scope: EngineEffectScope, targetId: unknown, effectId: string, params: UnknownRecord, options?: EngineEffectMessageOptions): number | false;
	auditionParametricEq(scope: EngineEffectScope, targetId: unknown, effectId: string, bandId?: string | null): number | false;
	resetParametricEq(scope: EngineEffectScope, targetId: unknown, effectId: string): number | false;
	readParametricEqSpectrum(scope: EngineEffectScope, targetId: unknown, effectId: string, which: 'input' | 'output', target: Float32Array): EffectSpectrumMetadata | null;
	createParametricEqPreview(buffer: AudioBuffer, params: UnknownRecord, options?: Readonly<{ effectId?: string }>): Promise<EngineParametricEqPreview>;
	renderMix(options?: EngineRenderMixOptions): Promise<AudioBuffer | PlanarPcm>;
	renderMixRealtime(options?: EngineRealtimeRenderOptions): Promise<EngineRenderResult>;
	renderMixToSink(options?: EngineRenderToSinkOptions): Promise<EngineRenderResult>;
	renderTrack(trackId: unknown, options?: EngineRenderMixOptions): Promise<AudioBuffer | PlanarPcm>;
	renderTrackToSink(trackId: unknown, options?: EngineRenderToSinkOptions): Promise<EngineRenderResult>;
	dispose(): Promise<void>;
}
