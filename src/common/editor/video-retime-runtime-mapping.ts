/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	evaluateVideoRetimeCurve,
	invertVideoRetimeCurve,
	type CompiledVideoRetimeCurve,
	type ExactVideoRetimeRational,
	type VideoRetimeCurveRational,
	type VideoRetimeCurveSegment,
	type VideoRetimeInverseOccurrence,
} from './video-retime-curve.ts';
import { compileVideoRetimeCurveV16 } from './video-retime-v16.ts';

export type VideoRetimeRuntimeQuery =
	| number
	| VideoRetimeCurveRational
	| ExactVideoRetimeRational;

export interface VideoRetimeRuntimePartition {
	readonly segmentIndex: number;
	readonly mode: VideoRetimeCurveSegment['mode'];
	readonly startOuterFrame: number;
	readonly endOuterFrame: number;
	readonly startSourceFrame: ExactVideoRetimeRational;
	readonly endSourceFrame: ExactVideoRetimeRational;
}

export interface VideoRetimeRuntimeInverseOptions {
	readonly policy: 'all' | 'earliest' | 'latest' | 'nearest-cell';
	readonly outerHint?: number;
}

export interface VideoRetimeRuntimeMapper {
	readonly sequenceStartFrame: number;
	readonly sequenceEndFrame: number;
	readonly outerFrameCount: number;
	readonly sourceInFrame: number;
	readonly sourceOutFrame: number;
	readonly partitions: readonly VideoRetimeRuntimePartition[];
	readonly mapOuterFrame: (outerFrame: VideoRetimeRuntimeQuery) => ExactVideoRetimeRational;
	readonly invertSourceFrame: (
		sourceFrame: VideoRetimeRuntimeQuery,
		options: Readonly<VideoRetimeRuntimeInverseOptions>,
	) => readonly VideoRetimeInverseOccurrence[];
}

const RUNTIME_PROJECTION_ALIASES = Object.freeze([
	'timelineStartFrame',
	'durationFrames',
	'sourceStartFrame',
	'sourceDurationFrames',
] as const);

/** Compile one persisted V16 video clip into a stable exact runtime mapper. */
export function createVideoRetimeRuntimeMapper(clipValue: unknown): VideoRetimeRuntimeMapper {
	const clip = record(clipValue, 'video retime clip');
	for (const alias of RUNTIME_PROJECTION_ALIASES) {
		if (Object.hasOwn(clip, alias)) {
			throw new TypeError('A resolved runtime projection cannot be used as a persisted video retime clip.');
		}
	}
	const kind = dataProperty(clip, 'kind', 'video retime clip');
	if (kind !== 'video') throw new TypeError('A video retime runtime mapper requires a video clip.');
	const sequenceStartFrame = nonNegativeSafeInteger(
		dataProperty(clip, 'sequenceStartFrame', 'video retime clip'),
		'video retime clip.sequenceStartFrame',
	);
	const outerFrameCount = positiveSafeInteger(
		dataProperty(clip, 'sequenceFrameCount', 'video retime clip'),
		'video retime clip.sequenceFrameCount',
	);
	const sourceInFrame = nonNegativeSafeInteger(
		dataProperty(clip, 'sourceInFrame', 'video retime clip'),
		'video retime clip.sourceInFrame',
	);
	const sourceFrameCount = positiveSafeInteger(
		dataProperty(clip, 'sourceFrameCount', 'video retime clip'),
		'video retime clip.sourceFrameCount',
	);
	const retimeMap = dataProperty(clip, 'retimeMap', 'video retime clip');

	const sequenceEndFrame = safeAdd(sequenceStartFrame, outerFrameCount, 'video retime clip sequence end');
	const sourceOutFrame = safeAdd(sourceInFrame, sourceFrameCount, 'video retime clip source end');
	const compiled = compileVideoRetimeCurveV16(retimeMap, Object.freeze({
		sequenceFrameCount: outerFrameCount,
		sourceInFrame,
		sourceFrameCount,
	}));
	if (compiled === null) throw new TypeError('A video retime runtime mapper requires a non-null retime map.');
	const partitions = createPartitions(compiled);

	return Object.freeze({
		sequenceStartFrame,
		sequenceEndFrame,
		outerFrameCount,
		sourceInFrame,
		sourceOutFrame,
		partitions,
		mapOuterFrame: (outerFrame: VideoRetimeRuntimeQuery): ExactVideoRetimeRational =>
			evaluateVideoRetimeCurve(compiled, outerFrame),
		invertSourceFrame: (
			sourceFrame: VideoRetimeRuntimeQuery,
			options: Readonly<VideoRetimeRuntimeInverseOptions>,
		): readonly VideoRetimeInverseOccurrence[] => invertVideoRetimeCurve(compiled, sourceFrame, options),
	});
}

function createPartitions(
	compiled: CompiledVideoRetimeCurve,
): readonly VideoRetimeRuntimePartition[] {
	const endpoints = compiled.points.map(({ sourceFrame }) => Object.freeze({
		numerator: BigInt(sourceFrame.num),
		denominator: BigInt(sourceFrame.den),
	}));
	return Object.freeze(compiled.segments.map((segment, index) => {
		const start = required(compiled.points[index]);
		const end = required(compiled.points[index + 1]);
		return Object.freeze({
			segmentIndex: index,
			mode: segment.mode,
			startOuterFrame: start.outerFrame,
			endOuterFrame: end.outerFrame,
			startSourceFrame: required(endpoints[index]),
			endSourceFrame: required(endpoints[index + 1]),
		});
	}));
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function dataProperty(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property, not an accessor.`);
	}
	return descriptor.value;
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

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}

function required<Value>(value: Value | null | undefined): Value {
	if (value == null) throw new RangeError('Expected a compiled video retime partition endpoint.');
	return value;
}
