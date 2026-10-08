/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioSourceLeaf } from './project-media-types.ts';
import type { SourcePcmChunk } from './storage/source-read-repository.ts';
import type { AudioWarpRuntimeClip, AudioWarpRuntimeProject } from './audio-warp-runtime.ts';

export interface SampleEditClip extends AudioWarpRuntimeClip {
	readonly id: string;
	readonly sourceId: string;
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
	readonly reversed?: boolean;
	readonly opaqueExtensions?: unknown;
}

export type SampleEditSource = AudioSourceLeaf & Readonly<Record<string, unknown>>;

export interface SamplePencilPoint {
	readonly timelineFrame: number;
	readonly value: number;
}

export interface SamplePencilEdit {
	readonly channel: number;
	readonly frame: number;
	readonly value: number;
}

export interface CreatePencilSampleEditsRequest {
	readonly clip: SampleEditClip;
	readonly source: SampleEditSource;
	readonly project?: AudioWarpRuntimeProject;
	readonly channel?: number;
	readonly points?: readonly SamplePencilPoint[];
	readonly maximumFrames?: number;
}

export interface SampleSmoothingSegment {
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface SmoothSampleRange extends SampleSmoothingSegment {
	readonly channel: number | null;
	readonly segments?: readonly SampleSmoothingSegment[];
}

export interface CreateSmoothSampleRangeRequest {
	readonly clip: SampleEditClip;
	readonly source: SampleEditSource;
	readonly project?: AudioWarpRuntimeProject;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly channel?: number | null;
	readonly maximumFrames?: number;
}

export type SampleEditStoredChunk = SourcePcmChunk;

export interface SampleEditSourceWriter {
	write(channels: Float32Array[]): PromiseLike<unknown> | unknown;
	commit(
		metadata?: Readonly<Record<string, unknown>>,
	): PromiseLike<Readonly<Record<string, unknown>>> | Readonly<Record<string, unknown>>;
	abort(reason?: unknown): PromiseLike<unknown> | unknown;
}

export interface SampleEditStore {
	readSourceChunks(sourceId: string): AsyncIterable<SampleEditStoredChunk>;
	beginSourceWrite(
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
	): PromiseLike<SampleEditSourceWriter> | SampleEditSourceWriter;
	writeDerivedSource?(
		sourceId: string,
		baseSourceId: string,
		replacementChunks: readonly Readonly<{
			readonly index: number;
			readonly channels: readonly Float32Array[];
		}>[],
		metadata: Readonly<Record<string, unknown>>,
	): PromiseLike<Readonly<Record<string, unknown>>> | Readonly<Record<string, unknown>>;
	deleteAnalysis?(key: string): PromiseLike<unknown> | unknown;
	deleteSource(sourceId: string): PromiseLike<unknown> | unknown;
}

export interface PersistedSampleEdit {
	readonly source: SampleEditSource;
	readonly metadata: Readonly<Record<string, unknown>>;
	readonly changedChunkIndices: readonly number[];
	rollback(): PromiseLike<void> | void;
}

export interface PersistImmutableSampleEditRequest {
	readonly store: SampleEditStore;
	readonly source: SampleEditSource;
	readonly edits?: readonly SamplePencilEdit[] | null;
	readonly smooth?: SmoothSampleRange | null;
	readonly sourceId?: string;
	readonly radius?: number;
	readonly signal?: AbortSignal | null;
}
