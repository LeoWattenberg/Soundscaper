/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioBufferLike } from './source-audio.ts';

export interface ControllerEffect extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: string;
	readonly enabled?: boolean;
	readonly bypassed?: boolean;
	readonly context?: Readonly<Record<string, unknown>> | null;
}

export interface ControllerClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly sourceId: string;
	readonly title: string;
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
	readonly trimStartFrames?: number;
	readonly trimEndFrames?: number;
}

export interface ControllerSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly storageKey: string;
	readonly name: string;
	readonly mimeType: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly originalSampleRate: number;
	readonly sampleFormat?: string;
	readonly chunkFrames?: number;
}

export interface ControllerTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly name: string;
	readonly type: 'audio' | 'video' | 'label';
	readonly clipIds: readonly string[];
	readonly locked?: boolean;
	readonly laneGroupId?: string | null;
	readonly effects?: readonly ControllerEffect[];
	readonly effectsActive?: boolean;
	readonly gain?: number;
	readonly pan?: number;
	readonly mute?: boolean;
	readonly solo?: boolean;
	readonly armed?: boolean;
	readonly envelope?: readonly Readonly<Record<string, unknown>>[];
}

export interface ControllerMixerBus extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly pan?: number;
	readonly effects?: readonly ControllerEffect[];
	readonly effectsActive?: boolean;
}

export interface ControllerMixerRoute extends Readonly<Record<string, unknown>> {
	readonly groupId?: string | null;
	readonly sends?: Readonly<Record<string, number>>;
}

export interface ControllerMixer {
	readonly groups: readonly ControllerMixerBus[];
	readonly sends: readonly ControllerMixerBus[];
	readonly routes: Readonly<Record<string, ControllerMixerRoute>>;
}

export interface ControllerSelection extends Readonly<Record<string, unknown>> {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds?: readonly string[];
	readonly clipIds?: readonly string[];
	readonly frequencyRange?: Readonly<Record<string, number>> | null;
}

export interface ControllerProject extends Readonly<Record<string, unknown>> {
	readonly schemaVersion: number;
	readonly id: string;
	readonly title: string;
	readonly sampleRate: number;
	readonly tracks: readonly ControllerTrack[];
	readonly clips: readonly ControllerClip[];
	readonly sources: readonly ControllerSource[];
	readonly selection?: ControllerSelection | null;
	readonly mixer: ControllerMixer;
}

export interface MutableControllerProject extends Record<string, unknown> {
	schemaVersion: number;
	id: string;
	title: string;
	sampleRate: number;
	tracks: ControllerTrack[];
	clips: ControllerClip[];
	sources: ControllerSource[];
	selection: ControllerSelection | null;
	mixer: {
		groups: ControllerMixerBus[];
		sends: ControllerMixerBus[];
		routes: Record<string, ControllerMixerRoute>;
	};
}

export interface DerivedSourceRecord {
	readonly source: ControllerSource;
	readonly buffer: AudioBufferLike | null;
	readonly channels: readonly Float32Array[] | null;
}

export interface SourceWriter {
	readonly framesWritten?: number;
	write(channels: Float32Array[]): Promise<unknown> | unknown;
	commit(metadata?: Readonly<Record<string, unknown>>): Promise<unknown> | unknown;
	abort(reason?: unknown): Promise<unknown> | unknown;
}

export interface SourceStoragePort {
	beginSourceWrite(sourceId: string, metadata: Readonly<Record<string, unknown>>): Promise<SourceWriter>;
	saveAnalysis(key: string, value: unknown): Promise<unknown>;
	deleteAnalysis?(key: string): Promise<unknown>;
	deleteSource(sourceId: string): Promise<unknown>;
}

export function findControllerTrack(
	project: ControllerProject,
	trackId: string | null | undefined,
): ControllerTrack | null {
	return project.tracks.find((track) => track.id === trackId) ?? null;
}

export function findControllerClip(
	project: ControllerProject,
	clipId: string | null | undefined,
): ControllerClip | null {
	return project.clips.find((clip) => clip.id === clipId) ?? null;
}

export function findControllerSource(
	project: ControllerProject,
	sourceId: string | null | undefined,
): ControllerSource | null {
	return project.sources.find((source) => source.id === sourceId) ?? null;
}

export function findControllerClipTrack(
	project: ControllerProject,
	clipId: string | null | undefined,
): ControllerTrack | null {
	return project.tracks.find((track) => track.clipIds.includes(clipId ?? '')) ?? null;
}
