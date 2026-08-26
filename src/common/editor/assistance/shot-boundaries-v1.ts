/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict renderer-independent semantic review for Fast and Accurate shot results. */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from
	'../closed-domain-value.ts';
import {
	normalizeLocalAssistanceShotDetector,
	type LocalAssistanceShotDetector,
} from './shot-detection-mode.ts';
import { MAX_SHOTS } from './shots.ts';
import {
	VIDEO_TIMING_ASSET_MAXIMUM_FRAMES,
	VIDEO_TIMING_ASSET_MAXIMUM_TIMESCALE,
} from '../video-timing-asset-reference.ts';

export interface AssistanceShotBoundaryReviewV1 {
	readonly sourceFrame: number;
	readonly presentationTick: string;
	readonly score: number;
}

export interface AssistanceShotBoundariesReviewV1 {
	readonly schemaVersion: 1;
	readonly detector: LocalAssistanceShotDetector;
	readonly timescale: number;
	readonly sourceFrameCount: number;
	readonly boundaries: readonly AssistanceShotBoundaryReviewV1[];
}

const RESULT_FIELDS = Object.freeze([
	'schemaVersion', 'detector', 'timescale', 'sourceFrameCount', 'boundaries',
]);
const BOUNDARY_FIELDS = Object.freeze(['sourceFrame', 'presentationTick', 'score']);
const CANONICAL_TICK = /^(?:0|[1-9]\d*)$/u;
const MAXIMUM_TICK = 0x7fff_ffff_ffff_ffffn;

export function reviewAssistanceShotBoundariesV1(value: unknown): AssistanceShotBoundariesReviewV1 {
	const row = readClosedDomainRecord(value, 'shot-boundaries result', RESULT_FIELDS);
	if (readClosedDomainField(row, 'schemaVersion', 'shot-boundaries result') !== 1) {
		throw new TypeError('The shot-boundaries result schema version is unsupported.');
	}
	const detector = normalizeLocalAssistanceShotDetector(
		readClosedDomainField(row, 'detector', 'shot-boundaries result'),
	);
	const timescale = integer(readClosedDomainField(row, 'timescale', 'shot-boundaries result'),
		1, VIDEO_TIMING_ASSET_MAXIMUM_TIMESCALE, 'shot timescale');
	const sourceFrameCount = integer(
		readClosedDomainField(row, 'sourceFrameCount', 'shot-boundaries result'),
		1, VIDEO_TIMING_ASSET_MAXIMUM_FRAMES, 'shot source-frame count');
	const candidates = readClosedDomainArray(
		readClosedDomainField(row, 'boundaries', 'shot-boundaries result'),
		'shot-boundaries inventory', 0, Math.min(MAX_SHOTS, sourceFrameCount),
	);
	let priorFrame = -1;
	let priorTick = -1n;
	const boundaries = candidates.map((candidate, index): AssistanceShotBoundaryReviewV1 => {
		const label = `shot boundary ${String(index)}`;
		const boundary = readClosedDomainRecord(candidate, label, BOUNDARY_FIELDS);
		const sourceFrame = integer(readClosedDomainField(boundary, 'sourceFrame', label),
			0, sourceFrameCount - 1, `${label} source frame`);
		if (sourceFrame <= priorFrame) {
			throw new RangeError('Shot boundary source frames must be strictly ordered.');
		}
		const presentationTick = tick(
			readClosedDomainField(boundary, 'presentationTick', label), label,
		);
		const tickValue = BigInt(presentationTick);
		if (tickValue <= priorTick) {
			throw new RangeError('Shot boundary presentation ticks must be strictly ordered.');
		}
		const score = unit(readClosedDomainField(boundary, 'score', label), `${label} score`);
		priorFrame = sourceFrame;
		priorTick = tickValue;
		return Object.freeze({ sourceFrame, presentationTick, score });
	});
	return Object.freeze({
		schemaVersion: 1, detector, timescale, sourceFrameCount,
		boundaries: Object.freeze(boundaries),
	});
}

function tick(value: unknown, label: string): string {
	if (typeof value !== 'string' || !CANONICAL_TICK.test(value)
		|| BigInt(value) > MAXIMUM_TICK) {
		throw new RangeError(`The ${label} presentation tick is invalid.`);
	}
	return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function unit(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`The ${label} must be finite and within the unit interval.`);
	}
	return value;
}
