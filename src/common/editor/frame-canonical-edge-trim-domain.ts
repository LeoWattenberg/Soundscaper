/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RationalRate } from './timeline-time.ts';

export type FrameCanonicalTrimEdge = 'left' | 'right';
export type FrameCanonicalTrackLockPredicate = (trackId: string) => boolean;

export interface FrameCanonicalEdgeTrimRequest {
	readonly activeClipId: string;
	readonly edge: FrameCanonicalTrimEdge;
	readonly requestedBoundarySample: number;
	readonly isTrackLocked?: FrameCanonicalTrackLockPredicate;
}

export interface FrameCanonicalEdgeTrimTransform {
	readonly clipId: string;
	readonly trackId: string;
	readonly changes: Readonly<Record<string, unknown>>;
	readonly sequencePlacement?: Readonly<{
		readonly sequenceStartFrame: number;
		readonly sequenceFrameCount: number;
	}>;
	readonly sequenceTrimRange?: Readonly<{ readonly startFrame: number; readonly endFrame: number }>;
}

export interface FrameCanonicalEdgeTrimPreview {
	readonly clipId: string;
	readonly trackId: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly trimStartFrames: number;
	readonly trimEndFrames: number;
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
}

interface FrameCanonicalEdgeTrimDiagnostics extends Readonly<Record<string, unknown>> {
	readonly activeClipId: string;
	readonly edge: FrameCanonicalTrimEdge;
	readonly sequenceId: string;
	readonly requestedBoundarySample: number;
	readonly requestedSequenceFrame: number;
	readonly appliedSequenceFrame: number;
	readonly sequenceFrameDelta: number;
	readonly resolvedSampleDelta: number;
	readonly boundarySample: number;
	readonly clamped: boolean;
	readonly participantClipIds: readonly string[];
}

export interface FrameCanonicalEdgeTrimNoop extends FrameCanonicalEdgeTrimDiagnostics {
	readonly kind: 'noop';
	readonly transforms: readonly [];
	readonly previews: readonly [];
}

export interface FrameCanonicalEdgeTrimTransformPlan extends FrameCanonicalEdgeTrimDiagnostics {
	readonly kind: 'transform';
	readonly transforms: readonly FrameCanonicalEdgeTrimTransform[];
	readonly previews: readonly FrameCanonicalEdgeTrimPreview[];
}

export type FrameCanonicalEdgeTrimPlan =
	| FrameCanonicalEdgeTrimNoop
	| FrameCanonicalEdgeTrimTransformPlan;

export type FrameTrimDataRecord = Readonly<Record<string, unknown>>;

export interface FrameTrimProjectIndex {
	readonly project: FrameTrimDataRecord;
	readonly sampleRate: number;
	readonly clips: readonly FrameTrimDataRecord[];
	readonly clipById: ReadonlyMap<string, FrameTrimDataRecord>;
	readonly trackById: ReadonlyMap<string, FrameTrimDataRecord>;
	readonly trackByClipId: ReadonlyMap<string, FrameTrimDataRecord>;
	readonly sourceById: ReadonlyMap<string, FrameTrimDataRecord>;
	readonly sequenceById: ReadonlyMap<string, FrameTrimDataRecord>;
	readonly sequenceIdByTrackId: ReadonlyMap<string, string>;
}

export function indexFrameTrimProject(project: FrameTrimDataRecord): FrameTrimProjectIndex {
	const sampleRate = positiveSafeInteger(project.sampleRate, 'project.sampleRate');
	const clips = recordArray(project.clips, 'project.clips');
	const tracks = recordArray(project.tracks, 'project.tracks');
	const sources = recordArray(project.sources, 'project.sources');
	const sequences = recordArray(project.sequences, 'project.sequences');
	const clipById = uniqueRecords(clips, 'clip');
	const trackById = uniqueRecords(tracks, 'track');
	const sourceById = uniqueRecords(sources, 'source');
	const sequenceById = uniqueRecords(sequences, 'sequence');
	const trackByClipId = new Map<string, FrameTrimDataRecord>();
	for (const track of tracks) {
		if (!Array.isArray(track.clipIds)) continue;
		const trackId = nonEmptyString(track.id, 'track.id');
		for (const clipIdValue of track.clipIds) {
			const clipId = nonEmptyString(clipIdValue, `track ${trackId} clip ID`);
			if (!clipById.has(clipId)) throw new ReferenceError(`Track ${trackId} references missing clip ${clipId}.`);
			if (trackByClipId.has(clipId)) throw new RangeError(`Clip ${clipId} has duplicate track ownership.`);
			trackByClipId.set(clipId, track);
		}
	}
	const sequenceIdByTrackId = new Map<string, string>();
	for (const sequence of sequences) {
		const sequenceId = nonEmptyString(sequence.id, 'sequence.id');
		if (!Array.isArray(sequence.trackIds)) throw new TypeError(`Sequence ${sequenceId}.trackIds must be an array.`);
		for (const trackIdValue of sequence.trackIds) {
			const trackId = nonEmptyString(trackIdValue, `sequence ${sequenceId} track ID`);
			if (!trackById.has(trackId)) throw new ReferenceError(`Sequence ${sequenceId} references missing track ${trackId}.`);
			if (sequenceIdByTrackId.has(trackId)) throw new RangeError(`Track ${trackId} belongs to multiple sequences.`);
			sequenceIdByTrackId.set(trackId, sequenceId);
		}
	}
	return {
		project, sampleRate, clips, clipById, trackById, trackByClipId,
		sourceById, sequenceById, sequenceIdByTrackId,
	};
}

export function requireFrameTrimTrack(
	index: FrameTrimProjectIndex,
	trackId: string,
): FrameTrimDataRecord {
	const track = index.trackById.get(trackId);
	if (!track) throw new ReferenceError(`Unknown video track ${trackId}.`);
	return track;
}

export function frameTrimRecord(value: unknown, name: string): FrameTrimDataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as FrameTrimDataRecord;
}

export function frameTrimRationalRate(value: unknown, name: string): RationalRate {
	const rate = frameTrimRecord(value, name);
	return Object.freeze({
		num: positiveSafeInteger(rate.num, `${name}.num`),
		den: positiveSafeInteger(rate.den, `${name}.den`),
	});
}

export function sameFrameTrimRate(left: RationalRate, right: RationalRate): boolean {
	return BigInt(left.num) * BigInt(right.den) === BigInt(right.num) * BigInt(left.den);
}

export function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

export function safeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`);
	return Number(value);
}

export function nonNegativeSafeInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result < 0) throw new RangeError(`${name} must be non-negative.`);
	return result;
}

export function positiveSafeInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result <= 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

export function safeAdd(left: number, right: number, name: string): number {
	const value = left + right;
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return value;
}

export function safeDifference(left: number, right: number, name: string): number {
	return safeAdd(left, -right, name);
}

export function deepFreeze<Value>(value: Value): Value {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}

function uniqueRecords(
	values: readonly FrameTrimDataRecord[],
	name: string,
): ReadonlyMap<string, FrameTrimDataRecord> {
	const result = new Map<string, FrameTrimDataRecord>();
	for (const value of values) {
		const id = nonEmptyString(value.id, `${name}.id`);
		if (result.has(id)) throw new RangeError(`Duplicate ${name} ID ${id}.`);
		result.set(id, value);
	}
	return result;
}

function recordArray(value: unknown, name: string): FrameTrimDataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => frameTrimRecord(item, `${name}[${String(index)}]`));
}
