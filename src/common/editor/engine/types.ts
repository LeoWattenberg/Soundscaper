/* SPDX-License-Identifier: AGPL-3.0-only */

export type UnknownRecord = Record<string, unknown>;

export interface EngineEnvelopePoint {
	readonly frame: number;
	readonly value: number;
}

export interface EngineEffect {
	readonly id?: string;
	readonly type?: string;
	readonly kind?: string;
	readonly enabled?: boolean;
	readonly bypassed?: boolean;
	readonly params?: UnknownRecord;
	readonly context?: UnknownRecord | null;
}

export interface EngineGainOwner {
	readonly id?: unknown;
	readonly type?: string;
	readonly gain?: number;
	readonly pan?: number;
	readonly mute?: boolean;
	readonly solo?: boolean;
	readonly effectsActive?: boolean;
	readonly effects?: readonly EngineEffect[];
	readonly envelope?: readonly EngineEnvelopePoint[];
}

export interface EngineClip extends Readonly<Record<string, unknown>> {
	readonly id?: unknown;
	readonly sourceId?: unknown;
	readonly timelineStartFrame?: number;
	readonly timelineStartFrames?: number;
	readonly durationFrames?: number;
	readonly frameLength?: number;
	readonly sourceStartFrame?: number;
	readonly sourceDurationFrames?: number;
	readonly reversed?: boolean;
	readonly gain?: number;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
	readonly envelope?: readonly EngineEnvelopePoint[];
	readonly warpMap?: unknown;
}

export interface EngineTrack extends EngineGainOwner {
	readonly clipIds?: readonly unknown[];
	readonly clips?: readonly (EngineClip | unknown)[];
}

export type EngineMixerBus = EngineGainOwner;

export interface EngineMixerRoute {
	readonly groupId?: unknown;
	readonly sends?: Readonly<Record<string, unknown>>;
}

export interface EngineLoop {
	readonly enabled?: boolean;
	readonly startFrame?: number;
	readonly endFrame?: number;
}

export interface EngineProject extends Readonly<Record<string, unknown>> {
	readonly schemaVersion?: number;
	readonly sampleRate?: number;
	readonly masterChannels?: number;
	readonly tempoMap?: import('../timeline-time.ts').HoldTempoMap;
	readonly metadata?: Readonly<{ adm?: unknown }>;
	readonly loop?: EngineLoop;
	readonly clips?: readonly EngineClip[];
	readonly tracks?: readonly EngineTrack[];
	readonly sources?: readonly Readonly<{
		id?: unknown;
		channelCount?: number;
	}>[];
	readonly mixer?: Readonly<{
		groups?: readonly EngineMixerBus[];
		sends?: readonly EngineMixerBus[];
		routes?: Readonly<Record<string, EngineMixerRoute>>;
	}>;
	readonly master?: EngineGainOwner;
}

export interface EngineEffectRackLocation {
	readonly scope: 'track' | 'group' | 'send' | 'master';
	readonly targetId: string | null;
	readonly effectsActive: boolean;
	readonly effects: readonly EngineEffect[];
}

export interface EngineChunkReadContext {
	readonly signal?: AbortSignal | null;
}

export type EngineChunkReadValue =
	| readonly Float32Array[]
	| Readonly<{ channels: readonly Float32Array[] }>;

export interface EngineChunkSource {
	readonly channelCount: number;
	readonly frameCount: number;
	readonly chunkFrames: number;
	readonly sampleRate: number;
	readStorageChunk(chunkIndex: number, context?: EngineChunkReadContext): Promise<EngineChunkReadValue> | EngineChunkReadValue;
}

export interface ResolvedClipSource {
	readonly buffer: AudioBuffer | null;
	readonly chunkSource: EngineChunkSource | null;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number | null;
	readonly reversed: boolean;
}

export type EngineSourceResolver = (
	clip: EngineClip,
	context: Readonly<{
		project: EngineProject;
		sources: ReadonlyMap<unknown, AudioBuffer>;
		defaultBuffer: AudioBuffer | null;
	}>,
) => unknown;
