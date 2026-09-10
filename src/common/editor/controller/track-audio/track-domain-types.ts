/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EngineEnvelopePoint } from '../../engine/types.ts';
import type { AudioBufferLike } from '../source/source-audio.ts';

export interface ControllerEffect extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type?: string;
	readonly enabled?: boolean;
	readonly bypassed?: boolean;
	readonly context?: Readonly<Record<string, unknown>> | null;
}

export interface ControllerClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly sourceId: string;
	readonly title?: string;
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

/** Media inventory includes visual sources; PCM consumers narrow through findControllerSource. */
export interface ControllerSourceInventory extends Partial<ControllerSource> {
	readonly id: string;
	readonly kind?: unknown;
}

export interface ControllerTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly name: string;
	readonly type: 'audio' | 'video' | 'label';
	readonly clipIds?: readonly string[];
	readonly locked?: boolean;
	readonly laneGroupId?: string | null;
	readonly effects?: readonly ControllerEffect[];
	readonly effectsActive?: boolean;
	readonly gain?: number;
	readonly pan?: number;
	readonly mute?: boolean;
	readonly solo?: boolean;
	readonly armed?: boolean;
	readonly envelope?: readonly EngineEnvelopePoint[];
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
	readonly routes?: Readonly<Record<string, ControllerMixerRoute>>;
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
	readonly sources: readonly ControllerSourceInventory[];
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
	sources: ControllerSourceInventory[];
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
	project: Readonly<{ sources: readonly ControllerSourceInventory[] }>,
	sourceId: string | null | undefined,
): ControllerSource | null {
	const source = project.sources.find((candidate) => candidate.id === sourceId);
	return source && isControllerPcmSource(source) ? source : null;
}

function isControllerPcmSource(source: ControllerSourceInventory): source is ControllerSource {
	return (source.kind === undefined || source.kind === 'audio')
		&& typeof source.storageKey === 'string' && typeof source.name === 'string'
		&& typeof source.mimeType === 'string'
		&& typeof source.frameCount === 'number' && Number.isSafeInteger(source.frameCount) && source.frameCount >= 0
		&& typeof source.channelCount === 'number' && Number.isSafeInteger(source.channelCount) && source.channelCount > 0
		&& typeof source.sampleRate === 'number' && Number.isFinite(source.sampleRate) && source.sampleRate > 0
		&& typeof source.originalSampleRate === 'number' && Number.isFinite(source.originalSampleRate) && source.originalSampleRate >= 0;
}

export function findControllerClipTrack<Track extends Readonly<{ id: string; clipIds?: readonly string[] }>>(
	project: Readonly<{ tracks: readonly Track[] }>,
	clipId: string | null | undefined,
): Track | null {
	return project.tracks.find((track) => track.clipIds?.includes(clipId ?? '')) ?? null;
}
