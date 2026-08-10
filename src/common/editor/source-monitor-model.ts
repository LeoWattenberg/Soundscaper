/* SPDX-License-Identifier: AGPL-3.0-only */

import { sequenceFrameAtSample } from './sequence-frame-navigation.ts';
import { sourceFrameTimecodeLabel } from './source-properties-model.ts';
import { normalizeVideoSourceCharacteristics } from './video-source-characteristics.ts';
import { videoFrameToSampleFrame, type RationalRate } from './timeline-time.ts';

/**
 * The source monitor: one video source addressed on its own frame grid.
 *
 * Everything here is stated in source frames. A media element's `currentTime`
 * is a rendering of a position, never the authority behind one — a decoder that
 * lands between frames, or a browser that rounds a seek, must not be able to
 * move a mark the user set.
 *
 * The same module answers what the program playhead is pointing at, because
 * match-frame and replace both need that answer and a second implementation
 * would be a second opinion.
 */

export interface SourceMonitorMarks {
	readonly markIn: number | null;
	readonly markOut: number | null;
}

export interface SourceMonitorPoints {
	readonly sourceIn: number | null;
	readonly sourceOut: number | null;
}

export interface ProgramFrameRequest {
	/** The program playhead, in project samples. */
	readonly sample: number;
	readonly sequenceId?: string | null;
	/** The targeted video lane, preferred over document order when it holds a clip. */
	readonly videoTrackId?: string | null;
}

export interface ProgramFrame {
	readonly clipId: string;
	readonly trackId: string;
	readonly sourceId: string;
	readonly sequenceId: string;
	/** The frame of the source under the playhead. */
	readonly sourceFrame: number;
	/** The clip's own source range. */
	readonly sourceIn: number;
	readonly sourceFrameCount: number;
	readonly sequenceStartFrame: number;
	readonly sequenceFrameCount: number;
	/** The clip's sequence range in project samples, derived from its frames. */
	readonly startFrame: number;
	readonly endFrame: number;
}

export const SOURCE_MONITOR_NO_MARKS: SourceMonitorMarks = Object.freeze({ markIn: null, markOut: null });

type DataRecord = Readonly<Record<string, unknown>>;

/** Keep a position on a frame the source actually has. */
export function clampSourceFrame(frame: number, sourceFrameCount: number): number {
	const bound = positiveSafeInteger(sourceFrameCount, 'sourceFrameCount');
	if (!Number.isFinite(frame)) throw new RangeError('A source position must be a finite number.');
	return Math.max(0, Math.min(bound - 1, Math.trunc(frame)));
}

/** Step the playhead by whole frames, stopping at the ends of the media. */
export function stepSourceFrame(frame: number, delta: number, sourceFrameCount: number): number {
	if (!Number.isSafeInteger(delta)) throw new RangeError('A frame step must be a safe integer.');
	return clampSourceFrame(clampSourceFrame(frame, sourceFrameCount) + delta, sourceFrameCount);
}

/**
 * Set the in mark. An in at or after the current out clears the out rather than
 * swapping the pair: swapping would invent a range the user never marked, and
 * refusing would make their newest mark the one that loses.
 */
export function markSourceIn(
	marks: SourceMonitorMarks,
	frame: number,
	sourceFrameCount: number,
): SourceMonitorMarks {
	const markIn = clampSourceFrame(frame, sourceFrameCount);
	const markOut = normalizeSourceMonitorMarks(marks, sourceFrameCount).markOut;
	return Object.freeze({ markIn, markOut: markOut != null && markOut > markIn ? markOut : null });
}

/**
 * Set the out mark. The out is exclusive, so marking the frame under the
 * playhead keeps that frame: an out of N means N frames.
 */
export function markSourceOut(
	marks: SourceMonitorMarks,
	frame: number,
	sourceFrameCount: number,
): SourceMonitorMarks {
	const markOut = clampSourceFrame(frame, sourceFrameCount) + 1;
	const markIn = normalizeSourceMonitorMarks(marks, sourceFrameCount).markIn;
	return Object.freeze({ markIn: markIn != null && markIn < markOut ? markIn : null, markOut });
}

/**
 * The source points an edit reads from the monitor.
 *
 * A three-point edit needs three points in total. Whatever the marks state is
 * used as given; when the marks and the sequence selection together state fewer
 * than three, the missing source points are filled from the source's own
 * boundaries — the in point first — so an unmarked monitor still edits the
 * whole source, exactly as it did before marking existed.
 */
export function resolveSourceMonitorPoints(
	marks: SourceMonitorMarks,
	sourceFrameCount: number,
	sequencePointCount: number,
): SourceMonitorPoints {
	const bound = positiveSafeInteger(sourceFrameCount, 'sourceFrameCount');
	const stated = safeInteger(sequencePointCount, 'sequencePointCount');
	if (stated < 1 || stated > 2) throw new RangeError('A sequence states one or two points.');
	const { markIn, markOut } = normalizeSourceMonitorMarks(marks, bound);
	let sourceIn = markIn;
	let sourceOut = markOut;
	const needed = 3 - stated;
	if (count(sourceIn, sourceOut) < needed && sourceIn == null) sourceIn = 0;
	if (count(sourceIn, sourceOut) < needed && sourceOut == null) sourceOut = bound;
	return Object.freeze({ sourceIn, sourceOut });
}

/**
 * Where to put a media element's clock to show one source frame: the middle of
 * that frame's presentation interval, so a decoder rounding either way still
 * lands inside the frame that was asked for.
 */
export function sourceFrameToMediaSeconds(frame: number, rate: RationalRate): number {
	const { num, den } = frameRate(rate);
	const position = Math.max(0, Math.trunc(frame));
	return (position * 2 + 1) * den / (num * 2);
}

/** Read a media element's clock back as the source frame it is inside. */
export function mediaSecondsToSourceFrame(
	seconds: number,
	rate: RationalRate,
	sourceFrameCount: number,
): number {
	const { num, den } = frameRate(rate);
	if (!Number.isFinite(seconds)) throw new RangeError('A media position must be a finite number.');
	return clampSourceFrame(Math.floor(Math.max(0, seconds) * num / den), sourceFrameCount);
}

/** The SMPTE label this source's own origin gives one of its frames. */
export function sourceMonitorTimecodeLabel(sourceValue: unknown, frame: number): string {
	const source = record(sourceValue, 'source');
	const rate = frameRate(source.frameRate);
	const characteristics = normalizeVideoSourceCharacteristics(source.characteristics ?? null, { rate });
	return sourceFrameTimecodeLabel(rate, characteristics.startTimecode, Math.max(0, Math.trunc(frame)));
}

/**
 * What the program playhead is pointing at: which clip, which frame of which
 * source, and the clip's own range.
 *
 * A targeted video lane wins when it holds a clip under the playhead, because
 * an edit that lifts and places has to agree with itself about the lane. With
 * nothing targeted this takes document order, which is the rule the source
 * timecode readout already applies, so both surfaces name the same frame.
 */
export function resolveProgramFrame(
	projectValue: unknown,
	request: ProgramFrameRequest,
): ProgramFrame | null {
	const project = record(projectValue, 'project');
	const sampleRate = positiveSafeInteger(project.sampleRate, 'project.sampleRate');
	const sequenceId = String(request.sequenceId ?? project.primarySequenceId ?? '');
	const sequence = arrayOf(project.sequences).find((candidate) => String(candidate.id) === sequenceId);
	if (!sequence) return null;
	const rate = frameRate(sequence.rate);
	const frame = sequenceFrameAtSample(
		Math.max(0, Math.trunc(safeInteger(request.sample, 'program sample'))),
		rate,
		sampleRate,
	);
	const trackIdByClipId = new Map<string, string>();
	for (const track of arrayOf(project.tracks)) {
		if (track.type !== 'video') continue;
		for (const clipId of Array.isArray(track.clipIds) ? track.clipIds : []) {
			trackIdByClipId.set(String(clipId), String(track.id));
		}
	}
	const targetedTrackId = request.videoTrackId == null ? null : String(request.videoTrackId);
	let matched: DataRecord | null = null;
	for (const clip of arrayOf(project.clips)) {
		if (clip.kind !== 'video' || String(clip.sequenceId ?? sequenceId) !== sequenceId) continue;
		const start = Number(clip.sequenceStartFrame);
		const count = Number(clip.sequenceFrameCount);
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count)) continue;
		if (frame < start || frame >= start + count) continue;
		const trackId = trackIdByClipId.get(String(clip.id)) ?? null;
		if (targetedTrackId !== null && trackId === targetedTrackId) {
			matched = clip;
			break;
		}
		matched ??= clip;
	}
	if (!matched) return null;
	const trackId = trackIdByClipId.get(String(matched.id));
	if (trackId === undefined) return null;
	const sequenceStartFrame = Number(matched.sequenceStartFrame);
	const sequenceFrameCount = Number(matched.sequenceFrameCount);
	const sourceIn = Number(matched.sourceInFrame ?? 0);
	return Object.freeze({
		clipId: String(matched.id),
		trackId,
		sourceId: String(matched.sourceId),
		sequenceId,
		sourceFrame: (Number.isSafeInteger(sourceIn) ? sourceIn : 0) + (frame - sequenceStartFrame),
		sourceIn: Number.isSafeInteger(sourceIn) ? sourceIn : 0,
		sourceFrameCount: Number(matched.sourceFrameCount ?? sequenceFrameCount),
		sequenceStartFrame,
		sequenceFrameCount,
		startFrame: videoFrameToSampleFrame(sequenceStartFrame, rate, sampleRate, 'point'),
		endFrame: videoFrameToSampleFrame(sequenceStartFrame + sequenceFrameCount, rate, sampleRate, 'point'),
	});
}

/**
 * Drop a mark the media can no longer hold, and an out that lost its order. A
 * re-read that shortened a source leaves marks past its end; dropping them asks
 * the user to mark again rather than quietly moving the point they set.
 */
export function normalizeSourceMonitorMarks(
	marks: SourceMonitorMarks,
	sourceFrameCount: number,
): SourceMonitorMarks {
	const inside = (value: number | null, bound: number): number | null => (
		value != null && Number.isSafeInteger(value) && value >= 0 && value <= bound ? value : null
	);
	const markIn = inside(marks?.markIn ?? null, sourceFrameCount - 1);
	const markOut = inside(marks?.markOut ?? null, sourceFrameCount);
	if (markIn != null && markOut != null && markOut <= markIn) return SOURCE_MONITOR_NO_MARKS;
	return Object.freeze({ markIn, markOut });
}

function count(...values: readonly (number | null)[]): number {
	return values.filter((value) => value != null).length;
}

function arrayOf(value: unknown): DataRecord[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function record(value: unknown, name: string): DataRecord {
	if (!isRecord(value)) throw new TypeError(`${name} must be an object.`);
	return value;
}

function isRecord(value: unknown): value is DataRecord {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function frameRate(value: unknown): RationalRate {
	if (!isRecord(value)) throw new TypeError('A frame rate must be rational.');
	return Object.freeze({
		num: positiveSafeInteger(value.num, 'rate.num'),
		den: positiveSafeInteger(value.den, 'rate.den'),
	});
}

function safeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`);
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}
