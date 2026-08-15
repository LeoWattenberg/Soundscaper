/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVisibleVideoTrackPredicate } from './video-timeline.js';

import {
	sequenceFrameAtSample,
	sequenceFrameBoundarySample,
	snapSampleToSequenceFrame,
} from './sequence-frame-navigation.ts';
import type { RationalRate } from './timeline-time.ts';
import type { VideoEditTargets } from './video-edit-targeting.ts';

/** The professional J/K/L rate ladder, ordered from reverse to forward. */
export const VIDEO_SHUTTLE_RATES = Object.freeze([
	-8, -4, -2, -1, 0, 1, 2, 4, 8,
] as const);

export type VideoShuttleRate = typeof VIDEO_SHUTTLE_RATES[number];
export type VideoShuttleDirection = -1 | 1;
export type VideoEditPointDirection = 'previous' | 'next';

export interface VideoProgramGeometry {
	readonly sequenceId: string;
	readonly sequenceRate: RationalRate;
	readonly sampleRate: number;
	/** The exclusive end on the sequence's canonical video-frame grid. */
	readonly programEndSequenceFrame: number;
	/** The same exclusive end converted once to project samples. */
	readonly programEndSample: number;
}

/** One fixed origin for a stretch of constant-rate shuttle playback. */
export interface VideoShuttleAnchor extends VideoProgramGeometry {
	readonly rate: Exclude<VideoShuttleRate, 0>;
	readonly anchorSequenceFrame: number;
	readonly anchorSample: number;
	readonly anchorMilliseconds: number;
}

export interface VideoShuttlePosition {
	readonly sequenceFrame: number;
	readonly sample: number;
	readonly ended: boolean;
}

type DataRecord = Readonly<Record<string, unknown>>;

interface SequenceContext {
	readonly project: DataRecord;
	readonly sequence: DataRecord;
	readonly sequenceId: string;
	readonly sequenceRate: RationalRate;
	readonly sampleRate: number;
	readonly memberTrackIds: ReadonlySet<string>;
}

/** Move J or L by exactly one rung, holding at either extreme. */
export function stepVideoShuttleRate(
	current: VideoShuttleRate,
	direction: VideoShuttleDirection,
): VideoShuttleRate {
	const index = VIDEO_SHUTTLE_RATES.indexOf(current);
	if (index < 0) throw new RangeError(`Unsupported video shuttle rate: ${String(current)}.`);
	if (direction !== -1 && direction !== 1) {
		throw new RangeError('A video shuttle direction must be -1 or 1.');
	}
	return VIDEO_SHUTTLE_RATES[Math.max(0, Math.min(VIDEO_SHUTTLE_RATES.length - 1, index + direction))]!;
}

/** Resolve the visible program's primary-sequence extent. */
export function resolveVideoProgramGeometry(projectValue: unknown): VideoProgramGeometry {
	const context = resolveSequenceContext(projectValue);
	let programEndSequenceFrame = 0;
	for (const clip of videoClipsOnTracks(context, visibleVideoTracks(context))) {
		const { end } = videoClipRange(clip, context.sequenceId);
		programEndSequenceFrame = Math.max(programEndSequenceFrame, end);
	}
	return Object.freeze({
		sequenceId: context.sequenceId,
		sequenceRate: context.sequenceRate,
		sampleRate: context.sampleRate,
		programEndSequenceFrame,
		programEndSample: sequenceFrameBoundarySample(
			programEndSequenceFrame,
			context.sequenceRate,
			context.sampleRate,
		),
	});
}

/**
 * Start a constant-rate shuttle run from a directionally aligned boundary.
 * Forward aligns to the next boundary and reverse to the previous one, so the
 * first movement never crosses a partly elapsed frame.
 */
export function createVideoShuttleAnchor(
	geometry: VideoProgramGeometry,
	positionSample: number,
	rate: Exclude<VideoShuttleRate, 0>,
	anchorMilliseconds: number,
): VideoShuttleAnchor {
	assertShuttleRate(rate, false);
	const now = finiteNumber(anchorMilliseconds, 'shuttle anchor time');
	const position = Math.max(
		0,
		Math.min(geometry.programEndSample, nonNegativeSafeInteger(positionSample, 'program position')),
	);
	const anchorSample = Math.min(
		geometry.programEndSample,
		snapSampleToSequenceFrame(
			position,
			geometry.sequenceRate,
			geometry.sampleRate,
			rate > 0 ? 'next' : 'previous',
		),
	);
	return Object.freeze({
		...geometry,
		rate,
		anchorSequenceFrame: sequenceFrameAtSample(
			anchorSample,
			geometry.sequenceRate,
			geometry.sampleRate,
		),
		anchorSample,
		anchorMilliseconds: now,
	});
}

/**
 * Resolve from the fixed anchor and absolute monotonic elapsed time. Timer
 * cadence is deliberately absent from the arithmetic, so skipped or bunched
 * callbacks cannot accumulate a fractional-frame remainder.
 */
export function resolveVideoShuttlePosition(
	anchor: VideoShuttleAnchor,
	nowMilliseconds: number,
): VideoShuttlePosition {
	const now = finiteNumber(nowMilliseconds, 'shuttle time');
	const elapsed = Math.max(0, now - anchor.anchorMilliseconds);
	const available = anchor.rate > 0
		? anchor.programEndSequenceFrame - anchor.anchorSequenceFrame
		: anchor.anchorSequenceFrame;
	const quotient = elapsed * Math.abs(anchor.rate) * anchor.sequenceRate.num
		/ (1_000 * anchor.sequenceRate.den);
	const elapsedFrames = Math.min(available, Math.max(0, Math.floor(quotient)));
	const sequenceFrame = anchor.anchorSequenceFrame + Math.sign(anchor.rate) * elapsedFrames;
	const ended = anchor.rate > 0
		? sequenceFrame >= anchor.programEndSequenceFrame
		: sequenceFrame <= 0;
	return Object.freeze({
		sequenceFrame,
		sample: sequenceFrameBoundarySample(sequenceFrame, anchor.sequenceRate, anchor.sampleRate),
		ended,
	});
}

/**
 * Find the strict adjacent edit boundary without changing selection or the
 * document. A resolved target names one exact visible video lane; when there
 * is no inherited or explicit video lane, every visible lane is searched.
 */
export function resolveAdjacentVideoEditPoint(
	projectValue: unknown,
	playheadSample: number,
	targets: Pick<VideoEditTargets, 'sequenceId' | 'videoTrackId' | 'explicit'>,
	direction: VideoEditPointDirection,
): number | null {
	if (direction !== 'previous' && direction !== 'next') {
		throw new RangeError(`Unsupported video edit-point direction: ${String(direction)}.`);
	}
	const pivot = nonNegativeSafeInteger(playheadSample, 'program position');
	const context = resolveSequenceContext(projectValue, targets.sequenceId);
	const tracks = editPointTracks(context, targets);
	const boundaries = new Set<number>();
	for (const clip of videoClipsOnTracks(context, tracks)) {
		const { start, end } = videoClipRange(clip, context.sequenceId);
		boundaries.add(start);
		boundaries.add(end);
	}
	let adjacent: number | null = null;
	for (const frame of boundaries) {
		const sample = sequenceFrameBoundarySample(frame, context.sequenceRate, context.sampleRate);
		if (direction === 'previous') {
			if (sample < pivot && (adjacent === null || sample > adjacent)) adjacent = sample;
		} else if (sample > pivot && (adjacent === null || sample < adjacent)) adjacent = sample;
	}
	return adjacent;
}

function editPointTracks(
	context: SequenceContext,
	targets: Pick<VideoEditTargets, 'videoTrackId' | 'explicit'>,
): DataRecord[] {
	const visible = editableVideoTracks(context);
	if (targets.videoTrackId !== null) {
		return visible.filter((track) => String(track.id) === targets.videoTrackId);
	}
	return targets.explicit ? [] : visible;
}

function editableVideoTracks(context: SequenceContext): DataRecord[] {
	return visibleVideoTracks(context).filter((track) => track.locked !== true);
}

function visibleVideoTracks(context: SequenceContext): DataRecord[] {
	const visible = createVisibleVideoTrackPredicate(arrayOf(context.project.tracks));
	return arrayOf(context.project.tracks).filter((track) => (
		visible(track) && context.memberTrackIds.has(String(track.id))
	));
}

function videoClipsOnTracks(
	context: SequenceContext,
	tracks: readonly DataRecord[],
): DataRecord[] {
	const clipsById = new Map<string, DataRecord>();
	for (const clip of arrayOf(context.project.clips)) {
		const id = nonEmptyId(clip.id, 'clip.id');
		if (clipsById.has(id)) throw new RangeError(`Duplicate clip ID ${id}.`);
		clipsById.set(id, clip);
	}
	const result: DataRecord[] = [];
	const included = new Set<string>();
	for (const track of tracks) {
		const trackId = nonEmptyId(track.id, 'track.id');
		for (const clipIdValue of arrayValues(track.clipIds, `track ${trackId}.clipIds`)) {
			const clipId = nonEmptyId(clipIdValue, `track ${trackId} clip ID`);
			const clip = clipsById.get(clipId);
			if (!clip) throw new ReferenceError(`Track ${trackId} references missing clip ${clipId}.`);
			if (clip.kind !== 'video' || included.has(clipId)) continue;
			if (String(clip.sequenceId ?? context.sequenceId) !== context.sequenceId) continue;
			included.add(clipId);
			result.push(clip);
		}
	}
	return result;
}

function videoClipRange(clip: DataRecord, sequenceId: string): Readonly<{ start: number; end: number }> {
	const id = nonEmptyId(clip.id, 'clip.id');
	if (String(clip.sequenceId ?? sequenceId) !== sequenceId) {
		throw new RangeError(`Video clip ${id} does not belong to sequence ${sequenceId}.`);
	}
	const start = nonNegativeSafeInteger(clip.sequenceStartFrame, `video clip ${id}.sequenceStartFrame`);
	const count = positiveSafeInteger(clip.sequenceFrameCount, `video clip ${id}.sequenceFrameCount`);
	const end = start + count;
	if (!Number.isSafeInteger(end)) throw new RangeError(`Video clip ${id} exceeds the safe frame range.`);
	return Object.freeze({ start, end });
}

function resolveSequenceContext(projectValue: unknown, requestedSequenceId?: string): SequenceContext {
	const project = record(projectValue, 'project');
	const sampleRate = positiveSafeInteger(project.sampleRate, 'project.sampleRate');
	const sequenceId = nonEmptyId(
		requestedSequenceId ?? project.primarySequenceId,
		'sequence ID',
	);
	const sequence = arrayOf(project.sequences).find((candidate) => String(candidate.id) === sequenceId);
	if (!sequence) throw new ReferenceError(`Unknown sequence: ${sequenceId}.`);
	const sequenceRate = rationalRate(sequence.rate, 'sequence.rate');
	const memberTrackIds = new Set(
		arrayValues(sequence.trackIds, `sequence ${sequenceId}.trackIds`)
			.map((trackId) => nonEmptyId(trackId, `sequence ${sequenceId} track ID`)),
	);
	return Object.freeze({ project, sequence, sequenceId, sequenceRate, sampleRate, memberTrackIds });
}

function assertShuttleRate(value: number, allowStop: boolean): asserts value is VideoShuttleRate {
	if (!VIDEO_SHUTTLE_RATES.includes(value as VideoShuttleRate) || (!allowStop && value === 0)) {
		throw new RangeError(`Unsupported video shuttle rate: ${String(value)}.`);
	}
}

function rationalRate(value: unknown, name: string): RationalRate {
	const candidate = record(value, name);
	return Object.freeze({
		num: positiveSafeInteger(candidate.num, `${name}.num`),
		den: positiveSafeInteger(candidate.den, `${name}.den`),
	});
}

function arrayOf(value: unknown): DataRecord[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function arrayValues(value: unknown, name: string): unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value;
}

function record(value: unknown, name: string): DataRecord {
	if (!isRecord(value)) throw new TypeError(`${name} must be an object.`);
	return value;
}

function isRecord(value: unknown): value is DataRecord {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyId(value: unknown, name: string): string {
	const result = typeof value === 'string' ? value.trim() : '';
	if (!result) throw new TypeError(`${name} must be a non-empty string.`);
	return result;
}

function finiteNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}
