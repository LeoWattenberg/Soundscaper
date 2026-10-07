/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	roundRational,
	videoFrameToSampleFrame,
	type RationalRate,
} from './timeline-time.ts';
import {
	compareSourceTimes,
	shiftSourceTime,
	sourceTimeDifference,
	sourceTimeToVideoBoundary,
	videoBoundaryTime,
	type VideoSourceTimingView,
} from './video-source-timing-view.ts';

/**
 * Three-point editing: which frames of a source land where in a sequence.
 *
 * An edit is described by four points — source in, source out, sequence in,
 * sequence out — of which the user supplies three and the fourth follows. All
 * four combinations resolve through one rule here, so a backtimed edit is not a
 * second code path with its own rounding.
 *
 * A uniform source duration converts once as a frame count, in exact integer
 * arithmetic under a named policy. A variable-rate source instead measures
 * the marked presentation boundaries: equal ordinal counts need not occupy
 * equal durations. Both resolve to the sequence grid under the same policy.
 */

export type ThreePointEditPoint = 'sourceIn' | 'sourceOut' | 'sequenceIn' | 'sequenceOut';

export type ThreePointEditRefusal =
	/** Fewer than three points: nothing determines the edit. */
	| 'under-specified'
	/** Four points that disagree; no three of them are preferred over the rest. */
	| 'over-specified'
	/** A resolved range keeps no frames. */
	| 'empty-range'
	/** A resolved source range asks for media the source does not contain. */
	| 'source-out-of-bounds'
	/** Nothing was chosen to edit from. */
	| 'no-source'
	/** No lane was targeted to receive the edit. */
	| 'no-target'
	/** Nothing under the program playhead to match or replace. */
	| 'no-program-clip';

export class ThreePointEditError extends Error {
	readonly reason: ThreePointEditRefusal;

	constructor(reason: ThreePointEditRefusal, message: string) {
		super(message);
		this.name = 'ThreePointEditError';
		this.reason = reason;
	}
}

export interface ThreePointEditRequest {
	readonly sourceIn?: number | null;
	readonly sourceOut?: number | null;
	readonly sequenceIn?: number | null;
	readonly sequenceOut?: number | null;
}

export interface ThreePointEditContext {
	readonly sourceRate: RationalRate;
	readonly sequenceRate: RationalRate;
	readonly sampleRate: number;
	/** The source's own frame count: the edit may not ask for more than exists. */
	readonly sourceFrameCount: number;
	/** Verified presentation boundaries for a source that does not have a uniform grid. */
	readonly sourceTiming?: VideoSourceTimingView;
}

export interface ThreePointEdit {
	readonly sourceIn: number;
	readonly sourceOut: number;
	readonly sourceFrameCount: number;
	readonly sequenceIn: number;
	readonly sequenceOut: number;
	readonly sequenceFrameCount: number;
	/** Which point the other three determined. */
	readonly resolved: ThreePointEditPoint;
	/** The same sequence range in project samples, for the sample-domain runtime. */
	readonly startFrame: number;
	readonly endFrame: number;
}

const POINTS: readonly ThreePointEditPoint[] = Object.freeze([
	'sourceIn', 'sourceOut', 'sequenceIn', 'sequenceOut',
]);

/** Resolve the fourth point of a three-point edit and admit the result. */
export function resolveThreePointEdit(
	request: ThreePointEditRequest,
	context: ThreePointEditContext,
): ThreePointEdit {
	const given = new Map<ThreePointEditPoint, number>();
	for (const point of POINTS) {
		const value = request?.[point];
		if (value == null) continue;
		given.set(point, nonNegativeSafeInteger(value, `edit.${point}`));
	}
	if (given.size < 3) {
		throw new ThreePointEditError(
			'under-specified',
			'A three-point edit needs three of its four points.',
		);
	}
	const sourceRate = rationalRate(context?.sourceRate, 'context.sourceRate');
	const sequenceRate = rationalRate(context?.sequenceRate, 'context.sequenceRate');
	const sampleRate = positiveSafeInteger(context?.sampleRate, 'context.sampleRate');
	const sourceBound = positiveSafeInteger(context?.sourceFrameCount, 'context.sourceFrameCount');
	if (Number(given.get('sourceIn') ?? 0) > sourceBound || Number(given.get('sourceOut') ?? 0) > sourceBound) {
		throw new ThreePointEditError('source-out-of-bounds', 'The edit asks for source frames beyond the end of the media.');
	}
	const resolved = given.size === 4
		? admitFullySpecified(given, sourceRate, sequenceRate, context.sourceTiming)
		: deriveFourthPoint(given, sourceRate, sequenceRate, context.sourceTiming);
	const { sourceIn, sourceOut, sequenceIn, sequenceOut, point } = resolved;
	if (sourceOut <= sourceIn || sequenceOut <= sequenceIn) {
		throw new ThreePointEditError('empty-range', 'A three-point edit keeps at least one frame.');
	}
	if (sourceOut > sourceBound) {
		throw new ThreePointEditError(
			'source-out-of-bounds',
			'The edit asks for source frames beyond the end of the media.',
		);
	}
	return Object.freeze({
		sourceIn,
		sourceOut,
		sourceFrameCount: sourceOut - sourceIn,
		sequenceIn,
		sequenceOut,
		sequenceFrameCount: sequenceOut - sequenceIn,
		resolved: point,
		startFrame: videoFrameToSampleFrame(sequenceIn, sequenceRate, sampleRate, 'point'),
		endFrame: videoFrameToSampleFrame(sequenceOut, sequenceRate, sampleRate, 'point'),
	});
}

/**
 * Convert a frame count between two grids as one exact change of basis. The
 * result depends only on the count, never on where the range sits, so the same
 * source range always produces the same extent.
 */
export function convertFrameCount(count: number, from: RationalRate, to: RationalRate): number {
	const frames = positiveSafeInteger(count, 'frame count');
	return Math.max(1, roundRational(
		BigInt(frames) * BigInt(to.num) * BigInt(from.den),
		BigInt(to.den) * BigInt(from.num),
		'point',
	));
}

interface ResolvedPoints {
	readonly sourceIn: number;
	readonly sourceOut: number;
	readonly sequenceIn: number;
	readonly sequenceOut: number;
	readonly point: ThreePointEditPoint;
}

function deriveFourthPoint(
	given: ReadonlyMap<ThreePointEditPoint, number>,
	sourceRate: RationalRate,
	sequenceRate: RationalRate,
	sourceTiming?: VideoSourceTimingView,
): ResolvedPoints {
	const sourceIn = given.get('sourceIn');
	const sourceOut = given.get('sourceOut');
	const sequenceIn = given.get('sequenceIn');
	const sequenceOut = given.get('sequenceOut');
	if (sourceIn != null && sourceOut != null) {
		// The source pair owns the duration; the sequence side receives it.
		if (sourceOut <= sourceIn) {
			throw new ThreePointEditError('empty-range', 'A source range keeps at least one frame.');
		}
		const extent = sequenceExtent(sourceIn, sourceOut, sourceRate, sequenceRate, sourceTiming);
		return sequenceIn != null
			? { sourceIn, sourceOut, sequenceIn, sequenceOut: sequenceIn + extent, point: 'sequenceOut' }
			: {
				sourceIn,
				sourceOut,
				sequenceIn: safeNonNegative(Number(sequenceOut) - extent, 'sequenceIn'),
				sequenceOut: Number(sequenceOut),
				point: 'sequenceIn',
			};
	}
	// Three of four distinct points always complete one pair, so the sequence
	// pair is complete here and owns the duration: fill exactly this much
	// programme from the source.
	if (Number(sequenceOut) <= Number(sequenceIn)) {
		throw new ThreePointEditError('empty-range', 'A sequence range keeps at least one frame.');
	}
	const sequenceCount = Number(sequenceOut) - Number(sequenceIn);
	const extent = convertFrameCount(sequenceCount, sequenceRate, sourceRate);
	return sourceIn != null
		? {
			sourceIn,
			sourceOut: sourceTiming
				? sourceEndpoint(sourceTiming, sourceIn, sequenceCount, sequenceRate, 1)
				: sourceIn + extent,
			sequenceIn: Number(sequenceIn),
			sequenceOut: Number(sequenceOut),
			point: 'sourceOut',
		}
		: {
			sourceIn: safeNonNegative(sourceTiming
				? sourceEndpoint(sourceTiming, Number(sourceOut), sequenceCount, sequenceRate, -1)
				: Number(sourceOut) - extent, 'sourceIn'),
			sourceOut: Number(sourceOut),
			sequenceIn: Number(sequenceIn),
			sequenceOut: Number(sequenceOut),
			point: 'sourceIn',
		};
}

/**
 * Four points are accepted only when they agree. Preferring three of them would
 * silently discard a mark the user set, which is exactly the kind of repair the
 * milestone forbids.
 *
 * Agreement is whether these four points are a result the three-point rule could
 * have produced, which means asking in both directions. Count conversion is
 * monotone but not invertible, so a range this module derives one way does not
 * always convert back to the count it came from; checking one direction alone
 * refused an edit the module had itself just resolved.
 */
function admitFullySpecified(
	given: ReadonlyMap<ThreePointEditPoint, number>,
	sourceRate: RationalRate,
	sequenceRate: RationalRate,
	sourceTiming?: VideoSourceTimingView,
): ResolvedPoints {
	const sourceIn = Number(given.get('sourceIn'));
	const sourceOut = Number(given.get('sourceOut'));
	const sequenceIn = Number(given.get('sequenceIn'));
	const sequenceOut = Number(given.get('sequenceOut'));
	if (sourceOut <= sourceIn || sequenceOut <= sequenceIn) {
		throw new ThreePointEditError('empty-range', 'A three-point edit keeps at least one frame.');
	}
	const sourceCount = sourceOut - sourceIn;
	const sequenceCount = sequenceOut - sequenceIn;
	const agrees = sequenceExtent(sourceIn, sourceOut, sourceRate, sequenceRate, sourceTiming) === sequenceCount
		|| (sourceTiming
			? sourceEndpoint(sourceTiming, sourceIn, sequenceCount, sequenceRate, 1) === sourceOut
				|| sourceEndpoint(sourceTiming, sourceOut, sequenceCount, sequenceRate, -1) === sourceIn
			: convertFrameCount(sequenceCount, sequenceRate, sourceRate) === sourceCount);
	if (!agrees) {
		throw new ThreePointEditError(
			'over-specified',
			'All four points were given and their durations disagree; fitting one to the other would change speed.',
		);
	}
	return { sourceIn, sourceOut, sequenceIn, sequenceOut, point: 'sequenceOut' };
}

function sequenceExtent(
	sourceIn: number,
	sourceOut: number,
	sourceRate: RationalRate,
	sequenceRate: RationalRate,
	timing?: VideoSourceTimingView,
): number {
	if (!timing) return convertFrameCount(sourceOut - sourceIn, sourceRate, sequenceRate);
	const duration = sourceTimeDifference(videoBoundaryTime(timing, sourceOut), videoBoundaryTime(timing, sourceIn));
	return Math.max(1, roundRational(duration.numerator * BigInt(sequenceRate.num),
		duration.denominator * BigInt(sequenceRate.den), 'point'));
}

function sourceEndpoint(
	timing: VideoSourceTimingView,
	sourcePoint: number,
	sequenceCount: number,
	sequenceRate: RationalRate,
	direction: 1 | -1,
): number {
	const time = shiftSourceTime(videoBoundaryTime(timing, sourcePoint), {
		numerator: BigInt(direction) * BigInt(sequenceCount) * BigInt(sequenceRate.den),
		denominator: BigInt(sequenceRate.num),
	});
	const bound = timing.kind === 'vfr' ? timing.index.frameCount : timing.frameCount;
	if (compareSourceTimes(time, videoBoundaryTime(timing, 0)) < 0) return -1;
	if (compareSourceTimes(time, videoBoundaryTime(timing, bound)) > 0) return bound + 1;
	const endpoint = sourceTimeToVideoBoundary(timing, time);
	return direction === 1 ? Math.max(sourcePoint + 1, endpoint) : Math.min(sourcePoint - 1, endpoint);
}

function safeNonNegative(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new ThreePointEditError('empty-range', `A backtimed edit resolves ${name} before the origin.`);
	}
	return value;
}

function rationalRate(value: unknown, name: string): RationalRate {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	const rate = value as Record<string, unknown>;
	return Object.freeze({
		num: positiveSafeInteger(rate.num, `${name}.num`),
		den: positiveSafeInteger(rate.den, `${name}.den`),
	});
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}
