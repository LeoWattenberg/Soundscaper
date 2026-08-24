/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	evaluateAudioWarpMap,
	normalizeAudioWarpMap,
	type AudioWarpMap,
} from './audio-warp-domain.ts';
import {
	addRationals,
	beatToSampleFrame,
	roundRational,
	subtractRationals,
	type HoldTempoMap,
	type Rational,
	type RationalInput,
} from './timeline-time.ts';
import {
	audioWarpOuterAtTimelineFrame,
	isMusicalAudioWarpClip,
	normalizeAudioWarpRuntimeInputs,
} from './audio-warp-runtime-authority.ts';

export interface AudioWarpRuntimeProject {
	readonly sampleRate: number;
	readonly tempoMap: HoldTempoMap;
}

export interface AudioWarpRuntimeClip {
	readonly id?: unknown;
	readonly kind?: unknown;
	readonly anchor?: unknown;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly musicalStartBeat?: RationalInput | null;
	readonly musicalExtent?: unknown;
	readonly musicalDurationBeats?: RationalInput | null;
	readonly reversed?: boolean;
	readonly warpMap?: unknown;
}

export interface AudioWarpRuntimeSegment {
	readonly timelineStartFrame: number;
	readonly timelineEndFrame: number;
	readonly sourceStartFrame: Rational;
	readonly sourceEndFrame: Rational;
	readonly playbackRate: number;
}

export interface AudioWarpRuntimeRange {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sourceSampleRate: number;
}

export interface AudioWarpSourceWindowOptions {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sourceFrameCount: number;
	readonly paddingFrames?: number;
}

export interface AudioWarpRenderPathOptions {
	readonly realtimeAcceleration: boolean;
	readonly exactOfflineAvailable?: boolean;
}

export interface AudioWarpRenderPathStatus {
	readonly path: 'realtime' | 'exact-offline';
	readonly realtimeAcceleration: boolean;
	readonly exactOfflineAvailable: boolean;
	readonly fallback: boolean;
}

export interface AudioWarpRenderParityEvidence {
	readonly breakpointCount: number;
	readonly comparedFrameCount: number;
	readonly maximumErrorFrames: number;
	readonly errorBudgetFrames: number;
}

export interface AudioWarpRuntimeEvaluator {
	readonly map: Readonly<AudioWarpMap>;
	readonly fingerprint: string;
	sourceAtTimelineFrame(timelineFrame: number): Rational;
}

const TEXT_ENCODER = new TextEncoder();
export const AUDIO_WARP_RENDER_PARITY_ERROR_FRAMES = 0.000_001;

/** Fingerprint the canonical map used by playback, waveform, stretch, and render caches. */
export function audioWarpMapFingerprint(value: unknown): string {
	const map = normalizeAudioWarpMap(value);
	const descriptor = [
		'soundscaper-audio-warp-map',
		1,
		map.points.map((point) => [
			[point.outer.num, point.outer.den],
			[point.source.num, point.source.den],
			point.mode,
		]),
	];
	return bytesToHex(sha256(TEXT_ENCODER.encode(JSON.stringify(descriptor))));
}

/** Evaluate one absolute timeline sample through the clip-anchor contract. */
export function evaluateAudioWarpSourceFrame(
	projectValue: AudioWarpRuntimeProject,
	clipValue: AudioWarpRuntimeClip,
	timelineFrameValue: number,
): Rational {
	return createAudioWarpRuntimeEvaluator(projectValue, clipValue)
		.sourceAtTimelineFrame(timelineFrameValue);
}

/** Validate once and reuse the authoritative evaluator across bounded visual projections. */
export function createAudioWarpRuntimeEvaluator(
	projectValue: AudioWarpRuntimeProject,
	clipValue: AudioWarpRuntimeClip,
): Readonly<AudioWarpRuntimeEvaluator> {
	const { project, clip, map } = normalizeAudioWarpRuntimeInputs(projectValue, clipValue);
	return Object.freeze({
		map,
		fingerprint: audioWarpMapFingerprint(map),
		sourceAtTimelineFrame(timelineFrameValue: number): Rational {
			const timelineFrame = safeInteger(timelineFrameValue, 'audio warp timeline frame');
			if (timelineFrame < clip.timelineStartFrame
				|| timelineFrame > clip.timelineStartFrame + clip.durationFrames) {
				throw new RangeError('Audio warp timeline frame must remain within the clip extent.');
			}
			return evaluateAudioWarpMap(map, audioWarpOuterAtTimelineFrame(project, clip, timelineFrame));
		},
	});
}

/**
 * Partition one requested clip range at every warp and held-tempo boundary.
 * Each boundary is rounded once on the shared timeline, while source positions
 * remain exact rationals until the Web Audio rate/offset boundary.
 */
export function buildAudioWarpRuntimeSegments(
	projectValue: AudioWarpRuntimeProject,
	clipValue: AudioWarpRuntimeClip,
	rangeValue: AudioWarpRuntimeRange,
): readonly Readonly<AudioWarpRuntimeSegment>[] {
	const { project, clip, map } = normalizeAudioWarpRuntimeInputs(projectValue, clipValue);
	const startFrame = safeInteger(rangeValue?.startFrame, 'audio warp range startFrame');
	const endFrame = safeInteger(rangeValue?.endFrame, 'audio warp range endFrame');
	const sourceSampleRate = positiveSafeInteger(
		rangeValue?.sourceSampleRate,
		'audio warp source sample rate',
	);
	const clipEndFrame = safeAdd(clip.timelineStartFrame, clip.durationFrames, 'audio warp clip extent');
	if (endFrame <= startFrame || startFrame < clip.timelineStartFrame || endFrame > clipEndFrame) {
		throw new RangeError('Audio warp runtime range must be positive and remain within the clip extent.');
	}
	const boundaries = new Set<number>([startFrame, endFrame]);
	for (const point of map.points.slice(1, -1)) {
		for (const frame of timelineFramesAtOuter(project, clip, point.outer)) {
			if (frame > startFrame && frame < endFrame) boundaries.add(frame);
		}
	}
	if (isMusicalAudioWarpClip(clip)) {
		for (const event of project.tempoMap.events.slice(1)) {
			for (const frame of [
				beatToSampleFrame(event.beat, project.tempoMap, project.sampleRate, 'enclosingStart'),
				beatToSampleFrame(event.beat, project.tempoMap, project.sampleRate, 'enclosingEnd'),
			]) {
				if (frame > startFrame && frame < endFrame) boundaries.add(frame);
			}
		}
	}
	const ordered = [...boundaries].sort((left, right) => left - right);
	const segments: AudioWarpRuntimeSegment[] = [];
	for (let index = 0; index < ordered.length - 1; index += 1) {
		const timelineStartFrame = ordered[index]!;
		const timelineEndFrame = ordered[index + 1]!;
		const sourceStartFrame = evaluateAudioWarpMap(
			map,
			audioWarpOuterAtTimelineFrame(project, clip, timelineStartFrame),
		);
		const sourceEndFrame = evaluateAudioWarpMap(
			map,
			audioWarpOuterAtTimelineFrame(project, clip, timelineEndFrame),
		);
		const sourceSpan = rationalNumber(subtractRationals(sourceEndFrame, sourceStartFrame));
		const timelineSpan = timelineEndFrame - timelineStartFrame;
		const playbackRate = sourceSpan * project.sampleRate / (timelineSpan * sourceSampleRate);
		if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
			throw new RangeError('Audio warp runtime segments cannot freeze or reverse.');
		}
		segments.push(Object.freeze({
			timelineStartFrame,
			timelineEndFrame,
			sourceStartFrame,
			sourceEndFrame,
			playbackRate,
		}));
	}
	return Object.freeze(segments);
}

/** Resolve one visible clip window to the bounded PCM source window it needs. */
export function audioWarpSourceWindowRange(
	projectValue: AudioWarpRuntimeProject,
	clipValue: AudioWarpRuntimeClip,
	options: Readonly<AudioWarpSourceWindowOptions>,
): Readonly<{ startFrame: number; endFrame: number }> {
	const evaluator = createAudioWarpRuntimeEvaluator(projectValue, clipValue);
	const clipDuration = positiveSafeInteger(clipValue.durationFrames, 'audio warp clip duration');
	const startFrame = nonNegativeSafeInteger(options?.startFrame, 'audio warp window start');
	const endFrame = nonNegativeSafeInteger(options?.endFrame, 'audio warp window end');
	if (endFrame <= startFrame || endFrame > clipDuration) {
		throw new RangeError('Audio warp source windows must be positive and remain within the clip extent.');
	}
	const sourceFrameCount = nonNegativeSafeInteger(
		options.sourceFrameCount,
		'audio warp source frame count',
	);
	const paddingFrames = nonNegativeSafeInteger(
		options.paddingFrames ?? 2,
		'audio warp source window padding',
	);
	const timelineStart = safeAdd(
		nonNegativeSafeInteger(clipValue.timelineStartFrame, 'audio warp clip start'),
		startFrame,
		'audio warp visible start',
	);
	const timelineEnd = safeAdd(
		nonNegativeSafeInteger(clipValue.timelineStartFrame, 'audio warp clip start'),
		endFrame,
		'audio warp visible end',
	);
	const mappedStart = rationalNumber(evaluator.sourceAtTimelineFrame(timelineStart));
	const mappedEnd = rationalNumber(evaluator.sourceAtTimelineFrame(timelineEnd));
	return Object.freeze({
		startFrame: Math.max(0, Math.floor(Math.min(mappedStart, mappedEnd)) - paddingFrames),
		endFrame: Math.min(sourceFrameCount, Math.ceil(Math.max(mappedStart, mappedEnd)) + paddingFrames),
	});
}

/** Never substitute the legacy scalar renderer for an authored warp map. */
export function selectAudioWarpRenderPath(
	options: Readonly<AudioWarpRenderPathOptions>,
): 'realtime' | 'exact-offline' {
	if (options?.realtimeAcceleration === true) return 'realtime';
	if (options?.exactOfflineAvailable === false) {
		throw new Error('Audio warp requires the exact offline render path when realtime acceleration is unavailable.');
	}
	return 'exact-offline';
}

/** Snapshot the exact render facility selected by the owning runtime. */
export function createAudioWarpRenderPathStatus(
	options: Readonly<AudioWarpRenderPathOptions>,
): Readonly<AudioWarpRenderPathStatus> {
	const realtimeAcceleration = options?.realtimeAcceleration === true;
	const exactOfflineAvailable = options?.exactOfflineAvailable !== false;
	const path = selectAudioWarpRenderPath({ realtimeAcceleration, exactOfflineAvailable });
	return Object.freeze({
		path,
		realtimeAcceleration,
		exactOfflineAvailable,
		fallback: path === 'exact-offline',
	});
}

/**
 * Compare the native segment projection with the exact evaluator at every
 * breakpoint and representative interior frames. Live and offline scheduling
 * both consume these same segments; this makes their numerical budget explicit.
 */
export function evaluateAudioWarpRenderParity(
	project: AudioWarpRuntimeProject,
	clip: AudioWarpRuntimeClip,
	range: AudioWarpRuntimeRange,
): Readonly<AudioWarpRenderParityEvidence> {
	const evaluator = createAudioWarpRuntimeEvaluator(project, clip);
	const segments = buildAudioWarpRuntimeSegments(project, clip, range);
	const comparedFrames = new Set<number>();
	let maximumErrorFrames = 0;
	for (const segment of segments) {
		const frames = [
			segment.timelineStartFrame,
			Math.floor((segment.timelineStartFrame + segment.timelineEndFrame) / 2),
			segment.timelineEndFrame,
		];
		for (const frame of frames) {
			comparedFrames.add(frame);
			const progress = (frame - segment.timelineStartFrame)
				/ (segment.timelineEndFrame - segment.timelineStartFrame);
			const realtimeSource = rationalNumber(segment.sourceStartFrame)
				+ (rationalNumber(segment.sourceEndFrame) - rationalNumber(segment.sourceStartFrame))
				* progress;
			const exactSource = rationalNumber(evaluator.sourceAtTimelineFrame(frame));
			maximumErrorFrames = Math.max(maximumErrorFrames, Math.abs(realtimeSource - exactSource));
		}
	}
	if (maximumErrorFrames > AUDIO_WARP_RENDER_PARITY_ERROR_FRAMES) {
		throw new Error('Audio warp realtime and exact-offline projections exceed their shared error budget.');
	}
	return Object.freeze({
		breakpointCount: new Set(segments.flatMap((segment) => (
			[segment.timelineStartFrame, segment.timelineEndFrame]
		))).size,
		comparedFrameCount: comparedFrames.size,
		maximumErrorFrames,
		errorBudgetFrames: AUDIO_WARP_RENDER_PARITY_ERROR_FRAMES,
	});
}

function timelineFramesAtOuter(
	project: AudioWarpRuntimeProject,
	clip: AudioWarpRuntimeClip,
	outer: Rational,
): readonly [number, number] {
	if (!isMusicalAudioWarpClip(clip)) {
		return Object.freeze([
			safeAdd(clip.timelineStartFrame, roundRational(outer.num, outer.den, 'enclosingStart'),
				'audio warp timeline boundary'),
			safeAdd(clip.timelineStartFrame, roundRational(outer.num, outer.den, 'enclosingEnd'),
				'audio warp timeline boundary'),
		]);
	}
	const beat = addRationals(clip.musicalStartBeat!, outer);
	return Object.freeze([
		beatToSampleFrame(beat, project.tempoMap, project.sampleRate, 'enclosingStart'),
		beatToSampleFrame(beat, project.tempoMap, project.sampleRate, 'enclosingEnd'),
	]);
}

function rationalNumber(value: Rational): number {
	return value.num / value.den;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function safeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`);
	return Number(value);
}

function safeAdd(left: number, right: number, name: string): number {
	if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)
		|| right > Number.MAX_SAFE_INTEGER - left) {
		throw new RangeError(`${name} exceeds the supported safe integer range.`);
	}
	return left + right;
}
