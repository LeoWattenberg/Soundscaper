/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact selected-video boundary mapping and clip-bound forward-retime slicing for Highlights. */

import {
	mapLocalAssistanceSelectedVideoSourceBoundary,
	type LocalAssistanceSelectedVideoAuthority,
} from '../common/editor/controller/local-assistance-selected-video.ts';
import type { VideoRetimeCurveRational, VideoRetimeCurveSegment } from
	'../common/editor/video-retime-curve.ts';
import { createVideoRetimeRuntimeMapper } from
	'../common/editor/video-retime-runtime-mapping.ts';
import {
	normalizeVideoRetimeCurveV16,
	type VideoRetimeCurveV16,
} from '../common/editor/video-retime-v16.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export interface FramescaperAssistanceHighlightVideoTiming {
	readonly sequenceFrameCount: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly retimeMap: VideoRetimeCurveV16 | null;
	readonly cropLocalFrames: readonly number[];
}

interface Fraction { readonly numerator: bigint; readonly denominator: bigint }

/**
 * Revalidate proposal edges against the live authenticated timing mapper. A retimed subclip is
 * emitted only when both cut boundaries are exactly representable in the persisted source domain.
 */
export function bindFramescaperAssistanceHighlightVideoTiming(options: Readonly<{
	readonly selection: LocalAssistanceSelectedVideoAuthority;
	readonly sequenceStartFrame: number;
	readonly sequenceEndFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly cropSourceFrames: readonly number[];
}>): FramescaperAssistanceHighlightVideoTiming {
	const sequenceStartFrame = integer(options?.sequenceStartFrame, 0, 'highlight sequence start');
	const sequenceEndFrame = integer(options?.sequenceEndFrame, 1, 'highlight sequence end');
	const sourceStartFrame = integer(options?.sourceStartFrame, 0, 'highlight source start');
	const sourceEndFrame = integer(options?.sourceEndFrame, 1, 'highlight source end');
	if (sequenceEndFrame <= sequenceStartFrame || sourceEndFrame <= sourceStartFrame) {
		throw new RangeError('Highlight timing must have positive source and sequence geometry.');
	}
	const selection = options.selection;
	if (!selection || typeof selection !== 'object') {
		throw new TypeError('Highlight timing requires authenticated selected-video authority.');
	}
	const clip = selection.clip;
	const mappedStart = mapLocalAssistanceSelectedVideoSourceBoundary(selection, sourceStartFrame);
	const mappedEnd = mapLocalAssistanceSelectedVideoSourceBoundary(selection, sourceEndFrame);
	if (mappedStart !== sequenceStartFrame || mappedEnd !== sequenceEndFrame) {
		throw new RangeError('Highlight proposal edges disagree with current source-time authority.');
	}
	const cropSourceFrames = array(options.cropSourceFrames, 'highlight crop source frames');
	let prior = -1;
	const cropLocalFrames = cropSourceFrames.map((value) => {
		const sourceFrame = integer(value, sourceStartFrame, 'highlight crop source frame');
		if (sourceFrame >= sourceEndFrame) {
			throw new RangeError('Highlight crop timing escaped its selected source range.');
		}
		const mapped = mapLocalAssistanceSelectedVideoSourceBoundary(selection, sourceFrame);
		if (mapped === null) throw new RangeError('Highlight crop timing is not exactly mappable.');
		const local = mapped - sequenceStartFrame;
		if (!Number.isSafeInteger(local) || local < 0 || local >= sequenceEndFrame - sequenceStartFrame
			|| local <= prior) {
			throw new RangeError('Highlight crop timing cannot preserve distinct forward keyframes.');
		}
		prior = local;
		return local;
	});
	if (cropLocalFrames.length < 2) throw new RangeError('Highlight crop timing needs two anchors.');
	const retimeMap = clip.retimeMap === null ? null : sliceForwardRetime(
		clip, sequenceStartFrame, sequenceEndFrame, sourceStartFrame, sourceEndFrame,
	);
	return Object.freeze({ sequenceFrameCount: sequenceEndFrame - sequenceStartFrame,
		sourceStartFrame, sourceEndFrame, retimeMap,
		cropLocalFrames: Object.freeze(cropLocalFrames) });
}

function sliceForwardRetime(
	clip: DataRecord,
	sequenceStartFrame: number,
	sequenceEndFrame: number,
	sourceStartFrame: number,
	sourceEndFrame: number,
): VideoRetimeCurveV16 {
	const clipSequenceStart = integer(clip.sequenceStartFrame, 0, 'video clip sequence start');
	const clipSequenceCount = integer(clip.sequenceFrameCount, 1, 'video clip sequence count');
	const clipSourceStart = integer(clip.sourceInFrame, 0, 'video clip source start');
	const clipSourceCount = integer(clip.sourceFrameCount, 1, 'video clip source count');
	const outerStart = sequenceStartFrame - clipSequenceStart;
	const outerEnd = sequenceEndFrame - clipSequenceStart;
	if (outerStart < 0 || outerEnd > clipSequenceCount || outerEnd <= outerStart) {
		throw new RangeError('Highlight retime slice escaped its selected video occurrence.');
	}
	const normalized = normalizeVideoRetimeCurveV16(clip.retimeMap, {
		sequenceFrameCount: clipSequenceCount,
		sourceInFrame: clipSourceStart,
		sourceFrameCount: clipSourceCount,
	});
	if (normalized === null) throw new TypeError('Highlight forward-retime authority disappeared.');
	const mapper = createVideoRetimeRuntimeMapper(clip);
	const endpointStart = mapper.mapOuterFrame(outerStart);
	const endpointEnd = mapper.mapOuterFrame(outerEnd);
	if (!equalsInteger(endpointStart, sourceStartFrame) || !equalsInteger(endpointEnd, sourceEndFrame)) {
		throw new RangeError('Highlight retime cut is not exactly representable at its source boundaries.');
	}
	const outerPoints = [outerStart, ...normalized.points
		.map(({ outerFrame }) => outerFrame)
		.filter((outerFrame) => outerFrame > outerStart && outerFrame < outerEnd), outerEnd];
	const points = outerPoints.map((outerFrame) => Object.freeze({
		outerFrame: outerFrame - outerStart,
		sourceFrame: publicRational(mapper.mapOuterFrame(outerFrame)),
	}));
	const segments = outerPoints.slice(0, -1).map((left, index) => {
		const right = outerPoints[index + 1]!;
		const sourceIndex = normalized.points.findIndex((point, pointIndex) => (
			pointIndex < normalized.segments.length && point.outerFrame <= left
				&& normalized.points[pointIndex + 1]!.outerFrame >= right
		));
		if (sourceIndex < 0) throw new RangeError('Highlight retime slice lost a source segment.');
		return sliceSegment(normalized.segments[sourceIndex]!, normalized.points[sourceIndex]!.outerFrame,
			normalized.points[sourceIndex + 1]!.outerFrame, left, right);
	});
	const result = normalizeVideoRetimeCurveV16({ feature: 'video-retime', version: 2,
		points, segments }, { sequenceFrameCount: outerEnd - outerStart,
		sourceInFrame: sourceStartFrame, sourceFrameCount: sourceEndFrame - sourceStartFrame });
	if (result === null) throw new TypeError('Highlight retime slice could not be authenticated.');
	return result;
}

function sliceSegment(
	segment: VideoRetimeCurveSegment,
	segmentStart: number,
	segmentEnd: number,
	cutStart: number,
	cutEnd: number,
): VideoRetimeCurveSegment {
	if (segment.mode === 'constant-forward') return Object.freeze({ mode: 'constant-forward' });
	if (segment.mode !== 'ramp-forward') {
		throw new RangeError(`Highlight publication refuses ${segment.mode} timing.`);
	}
	return Object.freeze({ mode: 'ramp-forward',
		startVelocity: interpolateVelocity(segment.startVelocity, segment.endVelocity,
			cutStart - segmentStart, segmentEnd - segmentStart),
		endVelocity: interpolateVelocity(segment.startVelocity, segment.endVelocity,
			cutEnd - segmentStart, segmentEnd - segmentStart) });
}

function interpolateVelocity(
	start: VideoRetimeCurveRational,
	end: VideoRetimeCurveRational,
	offset: number,
	duration: number,
): VideoRetimeCurveRational {
	const first = fraction(start);
	const last = fraction(end);
	const delta = subtract(last, first);
	return publicRational(add(first, multiply(delta, {
		numerator: BigInt(offset), denominator: BigInt(duration),
	})));
}

function fraction(value: VideoRetimeCurveRational): Fraction {
	return reduce({ numerator: BigInt(value.num), denominator: BigInt(value.den) });
}

function add(left: Fraction, right: Fraction): Fraction {
	return reduce({ numerator: left.numerator * right.denominator
		+ right.numerator * left.denominator,
	denominator: left.denominator * right.denominator });
}

function subtract(left: Fraction, right: Fraction): Fraction {
	return reduce({ numerator: left.numerator * right.denominator
		- right.numerator * left.denominator,
	denominator: left.denominator * right.denominator });
}

function multiply(left: Fraction, right: Fraction): Fraction {
	return reduce({ numerator: left.numerator * right.numerator,
		denominator: left.denominator * right.denominator });
}

function publicRational(value: Fraction): VideoRetimeCurveRational {
	const normalized = reduce(value);
	const num = Number(normalized.numerator);
	const den = Number(normalized.denominator);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den < 1) {
		throw new RangeError('Highlight retime slice exceeds the exact rational domain.');
	}
	return Object.freeze({ num, den });
}

function reduce(value: Fraction): Fraction {
	if (value.denominator === 0n) throw new RangeError('Highlight retime rational cannot divide by zero.');
	const sign = value.denominator < 0n ? -1n : 1n;
	const divisor = greatestCommonDivisor(value.numerator, value.denominator);
	return Object.freeze({ numerator: sign * value.numerator / divisor,
		denominator: sign * value.denominator / divisor });
}

function greatestCommonDivisor(leftValue: bigint, rightValue: bigint): bigint {
	let left = leftValue < 0n ? -leftValue : leftValue;
	let right = rightValue < 0n ? -rightValue : rightValue;
	while (right !== 0n) [left, right] = [right, left % right];
	return left || 1n;
}

function equalsInteger(value: Fraction, expected: number): boolean {
	return value.numerator === BigInt(expected) * value.denominator;
}

function array(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`The ${name} must be an array.`);
	return value;
}

function integer(value: unknown, minimum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The ${name} is invalid.`);
	}
	return Number(value);
}
