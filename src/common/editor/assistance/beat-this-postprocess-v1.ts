/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	ASSISTANCE_BEAT_SAMPLE_RATE,
	reviewAssistanceBeatGridV1,
	type AssistanceBeatGridV1,
	type AssistanceBeatPointV1,
} from './m7-semantic-results.ts';

/** Geometry used by the pinned Beat This v1.1.0 checkpoints. */
export const ASSISTANCE_BEAT_THIS_FRAMES_PER_SECOND = 50;

const REQUEST_FIELDS = Object.freeze([
	'schemaVersion', 'sampleRate', 'framesPerSecond', 'beatLogits', 'downbeatLogits',
] as const);
const MAXIMUM_LOGIT_FRAMES = 10_000_000;
const MAXIMUM_TEMPO_BPM = 400;
const MINIMUM_TEMPO_BPM = 20;
const MAX_POOL_RADIUS = 3;

export interface AssistanceBeatThisPostprocessRequestV1 {
	readonly schemaVersion: 1;
	readonly sampleRate: typeof ASSISTANCE_BEAT_SAMPLE_RATE;
	readonly framesPerSecond: typeof ASSISTANCE_BEAT_THIS_FRAMES_PER_SECOND;
	readonly beatLogits: Float32Array;
	readonly downbeatLogits: Float32Array;
}

/**
 * Apply Beat This' minimal postprocessor without importing model-owned Python:
 * positive logits survive seven-frame max pooling, adjacent detections collapse
 * to their mean frame, and downbeats snap to the closest detected beat.
 */
export function createAssistanceBeatThisGridV1(value: unknown): AssistanceBeatGridV1 {
	const row = exactRecord(value, REQUEST_FIELDS, 'Beat This postprocess request');
	if (row.schemaVersion !== 1) {
		throw new TypeError('The Beat This postprocess schema version is unsupported.');
	}
	if (row.sampleRate !== ASSISTANCE_BEAT_SAMPLE_RATE) {
		throw new RangeError(`Beat This audio must be exactly ${String(ASSISTANCE_BEAT_SAMPLE_RATE)} Hz.`);
	}
	if (row.framesPerSecond !== ASSISTANCE_BEAT_THIS_FRAMES_PER_SECOND) {
		throw new RangeError('Beat This logits must use exactly 50 frames per second.');
	}
	const beats = logits(row.beatLogits, null, 'beat');
	const downbeats = logits(row.downbeatLogits, beats.length, 'downbeat');
	const beatFrames = collapseAdjacentPeaks(localMaxima(beats));
	const downbeatFrames = collapseAdjacentPeaks(localMaxima(downbeats));
	const kinds = new Map<number, AssistanceBeatPointV1['kind']>();
	for (const frame of beatFrames) kinds.set(frame, 'beat');
	for (const frame of downbeatFrames) {
		const snapped = nearestFrame(frame, beatFrames);
		kinds.set(snapped ?? frame, 'downbeat');
	}
	const samples = [...kinds.entries()]
		.map(([frame, kind]) => ({
			sample: frameToSample(frame),
			kind,
			confidence: null,
		}))
		.sort((left, right) => left.sample - right.sample);
	const points = mergeRoundedSamples(samples);
	return reviewAssistanceBeatGridV1({
		schemaVersion: 1,
		sampleRate: ASSISTANCE_BEAT_SAMPLE_RATE,
		points,
		tempoProposal: constantTempo(points),
	});
}

function logits(value: unknown, expectedLength: number | null, label: string): Float32Array {
	if (!(value instanceof Float32Array) || value.length < 1
		|| value.length > MAXIMUM_LOGIT_FRAMES
		|| (expectedLength !== null && value.length !== expectedLength)) {
		throw new RangeError(`The Beat This ${label} logit geometry or length is invalid.`);
	}
	for (const candidate of value) {
		if (!Number.isFinite(candidate)) {
			throw new RangeError(`Every Beat This ${label} logit must be finite.`);
		}
	}
	return value;
}

function localMaxima(values: Float32Array): readonly number[] {
	const result: number[] = [];
	for (let frame = 0; frame < values.length; frame += 1) {
		const candidate = values[frame]!;
		if (candidate <= 0) continue;
		const start = Math.max(0, frame - MAX_POOL_RADIUS);
		const end = Math.min(values.length - 1, frame + MAX_POOL_RADIUS);
		let maximum = Number.NEGATIVE_INFINITY;
		for (let neighbor = start; neighbor <= end; neighbor += 1) {
			maximum = Math.max(maximum, values[neighbor]!);
		}
		if (candidate === maximum) result.push(frame);
	}
	return result;
}

function collapseAdjacentPeaks(peaks: readonly number[]): readonly number[] {
	if (peaks.length === 0) return Object.freeze([]);
	const result: number[] = [];
	let total = peaks[0]!;
	let count = 1;
	for (let index = 1; index < peaks.length; index += 1) {
		const frame = peaks[index]!;
		if (frame - peaks[index - 1]! <= 1) {
			total += frame;
			count += 1;
			continue;
		}
		result.push(total / count);
		total = frame;
		count = 1;
	}
	result.push(total / count);
	return Object.freeze(result);
}

function nearestFrame(target: number, candidates: readonly number[]): number | null {
	let nearest: number | null = null;
	let distance = Number.POSITIVE_INFINITY;
	for (const candidate of candidates) {
		const candidateDistance = Math.abs(candidate - target);
		if (candidateDistance < distance) {
			nearest = candidate;
			distance = candidateDistance;
		}
	}
	return nearest;
}

function frameToSample(frame: number): number {
	return Math.round(frame * ASSISTANCE_BEAT_SAMPLE_RATE
		/ ASSISTANCE_BEAT_THIS_FRAMES_PER_SECOND);
}

function mergeRoundedSamples(
	values: readonly Readonly<{ sample: number; kind: AssistanceBeatPointV1['kind']; confidence: null }>[],
): readonly AssistanceBeatPointV1[] {
	const result: AssistanceBeatPointV1[] = [];
	for (const value of values) {
		const prior = result[result.length - 1];
		if (prior?.sample === value.sample) {
			if (value.kind === 'downbeat' && prior.kind !== 'downbeat') {
				result[result.length - 1] = Object.freeze({ ...prior, kind: 'downbeat' });
			}
			continue;
		}
		result.push(Object.freeze(value));
	}
	return Object.freeze(result);
}

function constantTempo(points: readonly AssistanceBeatPointV1[]) {
	if (points.length < 2) return null;
	const intervals: number[] = [];
	for (let index = 1; index < points.length; index += 1) {
		const interval = points[index]!.sample - points[index - 1]!.sample;
		if (interval > 0) intervals.push(interval);
	}
	if (intervals.length === 0) return null;
	intervals.sort((left, right) => left - right);
	const middle = Math.floor(intervals.length / 2);
	const median = intervals.length % 2 === 1
		? intervals[middle]!
		: (intervals[middle - 1]! + intervals[middle]!) / 2;
	const bpm = 60 * ASSISTANCE_BEAT_SAMPLE_RATE / median;
	if (!Number.isFinite(bpm) || bpm < MINIMUM_TEMPO_BPM || bpm > MAXIMUM_TEMPO_BPM) {
		return null;
	}
	return Object.freeze({ kind: 'constant' as const, bpm });
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const row = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(row);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return row as Record<Field, unknown>;
}
