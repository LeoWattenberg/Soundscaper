/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	sampleFrameToVideoFrame,
	videoFrameToSampleFrame,
	type RationalRate,
} from '../timeline-time.ts';
import { hasSequenceGeometryProjectAuthority } from '../project-schema-version.ts';
import { nonNegativeSafeInteger, positiveSafeInteger } from './scalar-guards.ts';

type DataRecord = Record<string, unknown>;

export interface RangeSampleSpan {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly durationFrames: number;
}

export interface SequenceRangeGeometry {
	readonly sequenceId: string;
	readonly mediaTrackIds: readonly string[];
	readonly targetedMediaTrackIds: readonly string[];
	readonly sampleRange: RangeSampleSpan | null;
}

export interface RangeSequenceGeometry {
	readonly sequences: readonly SequenceRangeGeometry[];
	readonly trackRanges: ReadonlyMap<string, RangeSampleSpan | null>;
}

/** Resolve the one sample span shared by every targeted media lane in a sequence. */
export function resolveRangeSequenceGeometry(
	projectValue: unknown,
	targetTrackIdsValue: readonly string[],
	rangeValue: Readonly<{ readonly startFrame: number; readonly endFrame: number }>,
): RangeSequenceGeometry {
	const project = dataRecord(projectValue, 'project');
	const targetTrackIds = canonicalStringArray(targetTrackIdsValue, 'targetTrackIds');
	const range = sampleSpan(rangeValue, 'range');
	const trackRanges = new Map<string, RangeSampleSpan | null>();
	if (!hasSequenceGeometryProjectAuthority(project)) {
		return Object.freeze({ sequences: Object.freeze([]), trackRanges });
	}
	const sampleRate = positiveSafeInteger(project.sampleRate, 'project.sampleRate');
	const tracks = recordArray(project.tracks, 'project.tracks');
	const trackById = new Map(tracks.map((track, index) => [
		stableId(track.id, `project.tracks[${String(index)}].id`),
		track,
	]));
	const targetSet = new Set(targetTrackIds);
	const sequences = recordArray(project.sequences, 'project.sequences').flatMap((sequence, index) => {
		const sequenceId = stableId(sequence.id, `project.sequences[${String(index)}].id`);
		const sequenceTrackIds = canonicalStringArray(
			sequence.trackIds,
			`project.sequences[${String(index)}].trackIds`,
		);
		const mediaTrackIds = sequenceTrackIds.filter((trackId) => {
			const track = trackById.get(trackId);
			return track !== undefined && Array.isArray(track.clipIds);
		});
		const targetedMediaTrackIds = mediaTrackIds.filter((trackId) => targetSet.has(trackId));
		if (!targetedMediaTrackIds.length) return [];
		const hasTargetedVideo = targetedMediaTrackIds.some((trackId) => trackById.get(trackId)?.type === 'video');
		const operationRange = hasTargetedVideo
			? conformRangeToSequenceVideoGrid(range, sequence.rate, sampleRate)
			: range;
		for (const trackId of targetedMediaTrackIds) trackRanges.set(trackId, operationRange);
		return [Object.freeze({
			sequenceId,
			mediaTrackIds: Object.freeze(mediaTrackIds),
			targetedMediaTrackIds: Object.freeze(targetedMediaTrackIds),
			sampleRange: operationRange,
		})];
	});
	return Object.freeze({ sequences: Object.freeze(sequences), trackRanges });
}

function conformRangeToSequenceVideoGrid(
	range: RangeSampleSpan,
	rateValue: unknown,
	sampleRate: number,
): RangeSampleSpan | null {
	const rate = rationalRate(rateValue, 'sequence.rate');
	const startVideoFrame = sampleFrameToVideoFrame(range.startFrame, rate, sampleRate, 'point');
	const endVideoFrame = sampleFrameToVideoFrame(range.endFrame, rate, sampleRate, 'point');
	const startFrame = videoFrameToSampleFrame(startVideoFrame, rate, sampleRate, 'point');
	const endFrame = videoFrameToSampleFrame(endVideoFrame, rate, sampleRate, 'point');
	return endFrame > startFrame ? Object.freeze({
		startFrame,
		endFrame,
		durationFrames: endFrame - startFrame,
	}) : null;
}

function sampleSpan(value: unknown, name: string): RangeSampleSpan {
	const candidate = dataRecord(value, name);
	const startFrame = nonNegativeSafeInteger(candidate.startFrame, `${name}.startFrame`);
	const endFrame = nonNegativeSafeInteger(candidate.endFrame, `${name}.endFrame`);
	if (endFrame <= startFrame) throw new RangeError(`${name} must have a positive duration.`);
	return Object.freeze({ startFrame, endFrame, durationFrames: endFrame - startFrame });
}

function rationalRate(value: unknown, name: string): RationalRate {
	const candidate = dataRecord(value, name);
	const num = positiveSafeInteger(candidate.num, `${name}.num`);
	const den = positiveSafeInteger(candidate.den, `${name}.den`);
	return Object.freeze({ num, den });
}

function recordArray(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => dataRecord(candidate, `${name}[${String(index)}]`));
}

function canonicalStringArray(value: unknown, name: string): string[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	const seen = new Set<string>();
	return value.map((candidate, index) => {
		const result = stableId(candidate, `${name}[${String(index)}]`);
		if (seen.has(result)) throw new RangeError(`${name} cannot contain duplicate IDs.`);
		seen.add(result);
		return result;
	});
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as DataRecord;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()) {
		throw new TypeError(`${name} must be a canonical non-empty string.`);
	}
	return value;
}
