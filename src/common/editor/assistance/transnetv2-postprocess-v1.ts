/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic TransNetV2 cut/dissolve probability postprocessing. */

export const ASSISTANCE_TRANSNET_V2_THRESHOLD = 0.5;

const REQUEST_FIELDS = Object.freeze([
	'timescale', 'presentationTicks', 'singleFrameProbabilities', 'allFrameProbabilities',
	'threshold', 'minimumBoundaryDistanceFrames',
] as const);
const MAXIMUM_SOURCE_FRAMES = 10_000_000;
const MAXIMUM_TIMESCALE = 0x7fff_ffff;
const MAXIMUM_TICK = 0x7fff_ffff_ffff_ffffn;
const TICK = /^(?:0|[1-9]\d*)$/u;

export interface AssistanceTransNetV2PostprocessRequestV1 {
	readonly timescale: number;
	readonly presentationTicks: readonly string[];
	readonly singleFrameProbabilities: Float32Array;
	readonly allFrameProbabilities: Float32Array;
	readonly threshold: number;
	readonly minimumBoundaryDistanceFrames: number;
}

export interface AssistanceTransNetV2BoundaryV1 {
	readonly sourceFrame: number;
	readonly presentationTick: string;
	readonly score: number;
}

export interface AssistanceTransNetV2BoundariesV1 {
	readonly schemaVersion: 1;
	readonly detector: 'transnetv2';
	readonly timescale: number;
	readonly sourceFrameCount: number;
	readonly boundaries: readonly AssistanceTransNetV2BoundaryV1[];
}

interface Peak {
	readonly sourceFrame: number;
	readonly score: number;
}

/**
 * Fuse TransNetV2's single-frame and all-frame heads, collapse each contiguous
 * transition run to its strongest source frame, then apply stable local
 * suppression. This gives hard cuts and dissolves the same canonical boundary
 * form without inventing a cut at source frame zero.
 */
export function createAssistanceTransNetV2BoundariesV1(
	value: unknown,
): AssistanceTransNetV2BoundariesV1 {
	const row = exactRecord(value, REQUEST_FIELDS, 'TransNetV2 postprocess request');
	const timescale = integer(row.timescale, 1, MAXIMUM_TIMESCALE, 'TransNetV2 timescale');
	const presentationTicks = timing(row.presentationTicks);
	const single = probabilities(row.singleFrameProbabilities, presentationTicks.length,
		'TransNetV2 single-frame');
	const all = probabilities(row.allFrameProbabilities, presentationTicks.length,
		'TransNetV2 all-frame');
	const threshold = unit(row.threshold, 'TransNetV2 threshold');
	const minimumBoundaryDistanceFrames = integer(row.minimumBoundaryDistanceFrames, 1,
		presentationTicks.length, 'TransNetV2 minimum boundary distance');
	const runs: Peak[] = [];
	let active: Peak | null = null;
	for (let sourceFrame = 0; sourceFrame < presentationTicks.length; sourceFrame += 1) {
		const score = Math.fround(Math.max(single[sourceFrame]!, all[sourceFrame]!));
		if (score >= threshold) {
			if (active === null || score > active.score) {
				active = Object.freeze({ sourceFrame, score });
			}
			continue;
		}
		if (active !== null) runs.push(active);
		active = null;
	}
	if (active !== null) runs.push(active);
	const selected: Peak[] = [];
	for (const candidate of runs) {
		if (candidate.sourceFrame === 0) continue;
		const prior = selected[selected.length - 1];
		if (!prior || candidate.sourceFrame - prior.sourceFrame >= minimumBoundaryDistanceFrames) {
			selected.push(candidate);
			continue;
		}
		if (candidate.score > prior.score) selected[selected.length - 1] = candidate;
	}
	return Object.freeze({
		schemaVersion: 1,
		detector: 'transnetv2',
		timescale,
		sourceFrameCount: presentationTicks.length,
		boundaries: Object.freeze(selected.map(({ sourceFrame, score }) => Object.freeze({
			sourceFrame,
			presentationTick: presentationTicks[sourceFrame]!,
			score,
		}))),
	});
}

function timing(value: unknown): readonly string[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > MAXIMUM_SOURCE_FRAMES) {
		throw new RangeError('The TransNetV2 timing authority exceeds its frame bound.');
	}
	let prior = -1n;
	return Object.freeze(value.map((candidate, index) => {
		if (typeof candidate !== 'string' || !TICK.test(candidate)) {
			throw new RangeError(`TransNetV2 presentation tick ${String(index)} is invalid.`);
		}
		const tick = BigInt(candidate);
		if (tick > MAXIMUM_TICK || tick <= prior) {
			throw new RangeError('TransNetV2 presentation ticks must be strictly increasing.');
		}
		prior = tick;
		return candidate;
	}));
}

function probabilities(value: unknown, frameCount: number, label: string): Float32Array {
	if (!(value instanceof Float32Array) || value.length !== frameCount) {
		throw new RangeError(`The ${label} probability geometry or length is invalid.`);
	}
	for (const candidate of value) {
		if (!Number.isFinite(candidate) || candidate < 0 || candidate > 1) {
			throw new RangeError(`Every ${label} probability must be finite and within [0, 1].`);
		}
	}
	return value;
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const row = value as Record<string, unknown>;
	const keys = Object.keys(row);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key as Field))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return row as Record<Field, unknown>;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function unit(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`The ${label} must be finite and within [0, 1].`);
	}
	return value;
}
