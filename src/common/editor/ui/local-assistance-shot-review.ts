/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict semantic review for authenticated fast-FFmpeg shot results. */

import { MAX_SHOTS } from '../assistance/shots.ts';
import {
	VIDEO_TIMING_ASSET_MAXIMUM_FRAMES,
	VIDEO_TIMING_ASSET_MAXIMUM_TIMESCALE,
} from '../video-timing-asset-reference.ts';

export interface LocalAssistanceShotBoundaryReview {
	readonly sourceFrame: number;
	readonly presentationTick: string;
	readonly score: number;
}

export interface LocalAssistanceShotBoundariesReview {
	readonly kind: 'shot-boundaries';
	readonly schemaVersion: 1;
	readonly detector: 'ffmpeg-scdet';
	readonly timescale: number;
	readonly sourceFrameCount: number;
	readonly boundaries: readonly LocalAssistanceShotBoundaryReview[];
}

const RESULT_FIELDS = Object.freeze([
	'schemaVersion', 'detector', 'timescale', 'sourceFrameCount', 'boundaries',
]);
const BOUNDARY_FIELDS = Object.freeze([
	'sourceFrame', 'presentationTick', 'score',
]);
const CANONICAL_TICK = /^(?:0|[1-9]\d*)$/u;
const MAXIMUM_TICK = 0x7fff_ffff_ffff_ffffn;

export function reviewLocalAssistanceShotBoundaries(
	value: unknown,
): LocalAssistanceShotBoundariesReview {
	const record = exactRecord(value, RESULT_FIELDS, 'shot-boundaries result');
	if (record.schemaVersion !== 1 || record.detector !== 'ffmpeg-scdet') {
		throw new RangeError('The shot-boundaries result has an unsupported schema or detector.');
	}
	const timescale = positiveInteger(record.timescale,
		VIDEO_TIMING_ASSET_MAXIMUM_TIMESCALE, 'shot timescale');
	const sourceFrameCount = positiveInteger(record.sourceFrameCount,
		VIDEO_TIMING_ASSET_MAXIMUM_FRAMES, 'shot source-frame count');
	if (!Array.isArray(record.boundaries)
		|| record.boundaries.length > Math.min(MAX_SHOTS, sourceFrameCount)) {
		throw new RangeError('The shot-boundaries result exceeds its exact boundary bound.');
	}
	let priorFrame = -1;
	let priorTick = -1n;
	const boundaries = record.boundaries.map((candidate, index) => {
		const boundary = exactRecord(candidate, BOUNDARY_FIELDS, `shot boundary ${String(index)}`);
		const sourceFrame = nonNegativeInteger(boundary.sourceFrame, `shot boundary ${String(index)} frame`);
		if (sourceFrame >= sourceFrameCount) {
			throw new RangeError(`Shot boundary ${String(index)} exceeds its source-frame authority.`);
		}
		if (sourceFrame <= priorFrame) {
			throw new RangeError('Shot boundary frames must be strictly ordered.');
		}
		const presentationTick = canonicalTick(boundary.presentationTick, index);
		const tick = BigInt(presentationTick);
		if (tick <= priorTick) {
			throw new RangeError('Shot boundary presentation ticks must be strictly increasing.');
		}
		if (typeof boundary.score !== 'number' || !Number.isFinite(boundary.score)
			|| boundary.score < 0 || boundary.score > 1) {
			throw new RangeError(`Shot boundary ${String(index)} score is invalid.`);
		}
		priorFrame = sourceFrame;
		priorTick = tick;
		return Object.freeze({ sourceFrame, presentationTick, score: boundary.score });
	});
	return Object.freeze({
		kind: 'shot-boundaries', schemaVersion: 1, detector: 'ffmpeg-scdet',
		timescale, sourceFrameCount, boundaries: Object.freeze(boundaries),
	});
}

function canonicalTick(value: unknown, index: number): string {
	if (typeof value !== 'string' || !CANONICAL_TICK.test(value)
		|| BigInt(value) > MAXIMUM_TICK) {
		throw new RangeError(`Shot boundary ${String(index)} presentation tick is invalid.`);
	}
	return value;
}

function positiveInteger(value: unknown, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function exactRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const record = value as Readonly<Record<string, unknown>>;
	const keys = Reflect.ownKeys(record);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return record;
}
