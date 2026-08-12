/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_STORAGE_CHUNK_FRAMES } from '../chunk-stream.js';
import { buildAudioWarpRuntimeSegments } from '../audio-warp-runtime.ts';
import {
	clipDuration,
	clipStart,
	getProjectClips,
	nonNegativeInteger,
	positiveInteger,
} from './buffer-math.ts';
import type {
	EngineChunkReadContext,
	EngineChunkReadValue,
	EngineChunkSource,
	EngineClip,
	EngineProject,
	EngineSourceResolver,
	EngineTrack,
	ResolvedClipSource,
	UnknownRecord,
} from './types.ts';

export type FrameRange = readonly [startFrame: number, endFrame: number];

export interface ClipCrossfadeRanges {
	readonly crossfadeInRanges: readonly FrameRange[];
	readonly crossfadeOutRanges: readonly FrameRange[];
}

export interface ClipSchedulePlan extends ClipCrossfadeRanges {
	readonly clip: EngineClip;
	readonly trackInput: AudioNode;
	readonly originalBuffer: AudioBuffer | null;
	readonly chunkSource: EngineChunkSource | null;
	readonly reversed: boolean;
	readonly offsetFrame: number;
	readonly sourceSampleRate: number;
	readonly playbackRate: number;
	readonly segmentDuration: number;
	readonly segmentStart: number;
	readonly segmentEnd: number;
	readonly relativeStart: number;
	readonly duration: number;
}

export function normalizeSourceResolver(value: unknown): EngineSourceResolver | null {
	if (value == null) return null;
	if (typeof value !== 'function') throw new TypeError('sourceResolver must be a function or null.');
	return value as EngineSourceResolver;
}

export function normalizeChunkSource(value: unknown): EngineChunkSource {
	const source = asRecord(value, 'A long-source chunk provider is required.');
	const descriptor = source.descriptor && typeof source.descriptor === 'object'
		? source.descriptor as UnknownRecord
		: source;
	const channelCount = positiveInteger(descriptor.channelCount, 0);
	const frameCount = positiveInteger(descriptor.frameCount ?? descriptor.frameLength, 0);
	const chunkFrames = positiveInteger(descriptor.chunkFrames, 0);
	const sampleRate = positiveInteger(descriptor.sampleRate, 0);
	if (!channelCount || channelCount > 64 || !frameCount || !sampleRate) {
		throw new TypeError('Long-source metadata is invalid.');
	}
	if (chunkFrames > AUDIO_EDITOR_STORAGE_CHUNK_FRAMES) {
		throw new RangeError(`Long-source chunks cannot exceed ${AUDIO_EDITOR_STORAGE_CHUNK_FRAMES} frames.`);
	}
	const readStorageChunk = source.readStorageChunk || source.readChunk;
	if (typeof readStorageChunk !== 'function') throw new TypeError('A long source must provide readStorageChunk().');
	const read = readStorageChunk as (
		this: UnknownRecord,
		chunkIndex: number,
		context?: EngineChunkReadContext,
	) => Promise<EngineChunkReadValue> | EngineChunkReadValue;
	return Object.freeze({
		channelCount,
		frameCount,
		chunkFrames,
		sampleRate,
		readStorageChunk: (chunkIndex: number, context?: EngineChunkReadContext) => (
			read.call(source, chunkIndex, context)
		),
	});
}

export function resolveClipSource(
	clip: EngineClip,
	project: EngineProject,
	sources: ReadonlyMap<unknown, AudioBuffer>,
	sourceResolver: EngineSourceResolver | null,
	chunkSources: ReadonlyMap<unknown, EngineChunkSource> = new Map(),
): ResolvedClipSource {
	const fallback: ResolvedClipSource = {
		buffer: sources.get(clip.sourceId) || null,
		chunkSource: chunkSources.get(String(clip.sourceId)) || chunkSources.get(clip.sourceId) || null,
		sourceStartFrame: nonNegativeInteger(clip.sourceStartFrame, 0),
		sourceDurationFrames: null,
		reversed: Boolean(clip.reversed),
	};
	if (!sourceResolver) return fallback;
	const value = sourceResolver(clip, {
		project,
		sources,
		defaultBuffer: fallback.buffer,
	});
	if (value == null) return fallback;
	const resolved = isAudioBuffer(value) ? { buffer: value } : asRecord(
		value,
		'sourceResolver must return an AudioBuffer, a source descriptor, or null.',
	);
	const buffer = resolved.buffer ?? fallback.buffer;
	if (buffer != null && !isAudioBuffer(buffer)) {
		throw new TypeError('sourceResolver returned an invalid AudioBuffer.');
	}
	const chunkSource = resolved.chunkSource ?? fallback.chunkSource;
	return {
		buffer,
		chunkSource: chunkSource == null ? null : chunkSource as EngineChunkSource,
		sourceStartFrame: resolved.sourceStartFrame == null
			? fallback.sourceStartFrame
			: nonNegativeInteger(resolved.sourceStartFrame, fallback.sourceStartFrame),
		sourceDurationFrames: resolved.sourceDurationFrames == null
			? null
			: Math.max(1, nonNegativeInteger(resolved.sourceDurationFrames, 1)),
		reversed: resolved.reversed == null ? fallback.reversed : Boolean(resolved.reversed),
	};
}

export function getTrackClips(
	track: EngineTrack,
	clipsById: ReadonlyMap<string, EngineClip>,
): EngineClip[] {
	if (Array.isArray(track.clipIds)) {
		return track.clipIds
			.map((id) => clipsById.get(String(id)))
			.filter((clip): clip is EngineClip => Boolean(clip));
	}
	if (Array.isArray(track.clips)) {
		return track.clips
			.map((clip) => clip && typeof clip === 'object'
				? clip as EngineClip
				: clipsById.get(String(clip)))
			.filter((clip): clip is EngineClip => Boolean(clip));
	}
	return [];
}

/** Derive complementary, clip-local crossfade ranges for overlapping clips. */
export function automaticCrossfadeRanges(clips: readonly EngineClip[]): Map<string, ClipCrossfadeRanges> {
	if (!Array.isArray(clips)) throw new TypeError('clips must be an array.');
	const ranges = new Map<string, {
		crossfadeInRanges: FrameRange[];
		crossfadeOutRanges: FrameRange[];
	}>(clips.map((clip) => [String(clip.id), { crossfadeInRanges: [], crossfadeOutRanges: [] }]));
	const ordered = clips
		.filter((clip) => clip && clip.id != null && clipDuration(clip) > 0)
		.slice()
		.sort((left, right) => clipStart(left) - clipStart(right) || String(left.id).localeCompare(String(right.id)));
	for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
		const left = ordered[leftIndex];
		const leftStart = clipStart(left);
		const leftEnd = leftStart + clipDuration(left);
		for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
			const right = ordered[rightIndex];
			const rightStart = clipStart(right);
			if (rightStart >= leftEnd) break;
			const overlapStart = Math.max(leftStart, rightStart);
			const overlapEnd = Math.min(leftEnd, rightStart + clipDuration(right));
			if (overlapEnd <= overlapStart) continue;
			ranges.get(String(left.id))?.crossfadeOutRanges.push([
				overlapStart - leftStart,
				overlapEnd - leftStart,
			]);
			ranges.get(String(right.id))?.crossfadeInRanges.push([
				overlapStart - rightStart,
				overlapEnd - rightStart,
			]);
		}
	}
	for (const value of ranges.values()) {
		value.crossfadeInRanges = mergeFrameRanges(value.crossfadeInRanges);
		value.crossfadeOutRanges = mergeFrameRanges(value.crossfadeOutRanges);
	}
	return ranges;
}

export function mergeFrameRanges(ranges: readonly FrameRange[]): FrameRange[] {
	const ordered = ranges
		.filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
		.slice()
		.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
	const merged: [number, number][] = [];
	for (const [start, end] of ordered) {
		const previous = merged.at(-1);
		if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
		else merged.push([start, end]);
	}
	return merged;
}

export interface BuildClipSchedulePlansOptions {
	readonly project: EngineProject;
	readonly sources: ReadonlyMap<unknown, AudioBuffer>;
	readonly chunkSources?: ReadonlyMap<unknown, EngineChunkSource>;
	readonly trackInputs: ReadonlyMap<string, AudioNode>;
	readonly fromFrame: number;
	readonly toFrame: number;
	readonly sampleRate: number;
	readonly sourceResolver?: EngineSourceResolver | null;
}

export function buildClipSchedulePlans({
	project,
	sources,
	chunkSources = new Map(),
	trackInputs,
	fromFrame,
	toFrame,
	sampleRate,
	sourceResolver = null,
}: BuildClipSchedulePlansOptions): ClipSchedulePlan[] {
	const clipsById = new Map(getProjectClips(project).map((clip) => [String(clip.id), clip]));
	const plans: ClipSchedulePlan[] = [];
	for (const [trackIndex, track] of (project.tracks || []).entries()) {
		if (track.type === 'label' || track.type === 'video') continue;
		const trackInput = trackInputs.get(String(track.id ?? trackIndex));
		if (!trackInput) continue;
		const trackClips = getTrackClips(track, clipsById);
		const crossfades = automaticCrossfadeRanges(trackClips);
		for (const clip of trackClips) {
			const start = clipStart(clip);
			const duration = clipDuration(clip);
			const end = start + duration;
			const segmentStart = Math.max(start, fromFrame);
			const segmentEnd = Math.min(end, toFrame);
			if (segmentEnd <= segmentStart) continue;
			// A scalar pitch/speed cache cannot stand in for an authored piecewise
			// map. Warped clips resolve only their canonical source media here.
			const resolvedSource = resolveClipSource(
				clip,
				project,
				sources,
				clip.warpMap == null ? sourceResolver : null,
				chunkSources,
			);
			const originalBuffer = resolvedSource.buffer;
			const chunkSource = resolvedSource.chunkSource;
			if (!originalBuffer && !chunkSource) continue;
			const sourceSampleRate = originalBuffer?.sampleRate ?? chunkSource?.sampleRate ?? sampleRate;
			const clipCrossfades = crossfades.get(String(clip.id)) || {
				crossfadeInRanges: [],
				crossfadeOutRanges: [],
			};
			if (clip.warpMap != null) {
				const warpSegments = buildAudioWarpRuntimeSegments(
					project as Parameters<typeof buildAudioWarpRuntimeSegments>[0],
					clip as Parameters<typeof buildAudioWarpRuntimeSegments>[1],
					{ startFrame: segmentStart, endFrame: segmentEnd, sourceSampleRate },
				);
				const sourceFrameCount = originalBuffer?.length ?? chunkSource?.frameCount ?? 0;
				for (const segment of warpSegments) {
					const sourceStartFrame = segment.sourceStartFrame.num / segment.sourceStartFrame.den;
					const sourceEndFrame = segment.sourceEndFrame.num / segment.sourceEndFrame.den;
					const offsetFrame = resolvedSource.reversed
						? Math.max(0, sourceFrameCount - sourceEndFrame)
						: sourceStartFrame;
					plans.push({
						clip,
						...clipCrossfades,
						trackInput,
						originalBuffer,
						chunkSource,
						reversed: resolvedSource.reversed,
						offsetFrame,
						sourceSampleRate,
						playbackRate: segment.playbackRate,
						segmentDuration: (segment.timelineEndFrame - segment.timelineStartFrame) / sampleRate,
						segmentStart: segment.timelineStartFrame,
						segmentEnd: segment.timelineEndFrame,
						relativeStart: segment.timelineStartFrame - start,
						duration,
					});
				}
				continue;
			}
			const relativeStart = segmentStart - start;
			const sourceStart = resolvedSource.sourceStartFrame;
			const sourceDuration = resolvedSource.sourceDurationFrames
				?? Math.max(1, nonNegativeInteger(clip.sourceDurationFrames, duration));
			const sourceFramesPerTimelineFrame = sourceDuration / Math.max(1, duration);
			const relativeSourceStart = relativeStart * sourceFramesPerTimelineFrame;
			const sourceFrameCount = originalBuffer?.length ?? chunkSource?.frameCount ?? 0;
			const reversed = resolvedSource.reversed;
			const offsetFrame = reversed
				? Math.max(0, sourceFrameCount - (sourceStart + sourceDuration) + relativeSourceStart)
				: sourceStart + relativeSourceStart;
			const segmentDuration = (segmentEnd - segmentStart) / sampleRate;
			const playbackRate = sourceDuration * sampleRate / Math.max(1, duration * sourceSampleRate);
			plans.push({
				clip,
				...clipCrossfades,
				trackInput,
				originalBuffer,
				chunkSource,
				reversed,
				offsetFrame,
				sourceSampleRate,
				playbackRate,
				segmentDuration,
				segmentStart,
				segmentEnd,
				relativeStart,
				duration,
			});
		}
	}
	return plans;
}

function isAudioBuffer(value: unknown): value is AudioBuffer {
	if (!value || typeof value !== 'object') return false;
	const buffer = value as Partial<AudioBuffer>;
	return typeof buffer.getChannelData === 'function'
		&& typeof buffer.sampleRate === 'number'
		&& Number.isFinite(buffer.sampleRate)
		&& typeof buffer.length === 'number'
		&& Number.isSafeInteger(buffer.length)
		&& buffer.length > 0;
}

function asRecord(value: unknown, message: string): UnknownRecord {
	if (!value || typeof value !== 'object') throw new TypeError(message);
	return value as unknown as UnknownRecord;
}
