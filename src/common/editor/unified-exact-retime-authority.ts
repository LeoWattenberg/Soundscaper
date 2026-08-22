/* SPDX-License-Identifier: AGPL-3.0-only */

import { sequenceFrameBoundarySample } from './sequence-frame-navigation.ts';
import { canonicalizeNativeMediaSummaryValue } from './native-media-plan-canonical-form.ts';
import {
	evaluateVideoRetimeCurve,
	type CompiledVideoRetimeCurve,
	type ExactVideoRetimeRational,
	type VideoRetimeCurveSegment,
} from './video-retime-curve.ts';
import {
	videoRetimeExportDecimalTokenBytes,
	videoRetimeExportOutputBoundary,
	videoRetimeInterpolateSourceTime,
} from './video-retime-export-domain.ts';
import type {
	DecimalExactRationalV6,
	VideoRetimeExportIntentV6,
	VideoRetimeExportIntersectionV6,
} from './video-retime-export-plan.ts';
import { createVideoRetimeOutputCadence } from './video-retime-output-cadence.ts';
import {
	compileVideoRetimeCurveV16,
	type VideoRetimeCurveV16,
} from './video-retime-v16.ts';
import {
	videoSourceFrameTime,
	type BoundVideoSourceTimingView,
} from './video-source-timing-view.ts';

interface UnifiedRetimePlanContext {
	readonly sampleStart: number;
	readonly sampleDuration: number;
	readonly sampleRate: number;
	readonly sequenceId: string;
	readonly sequenceRate: Readonly<{ readonly num: number; readonly den: number }>;
	readonly outputRate: Readonly<{ readonly num: number; readonly den: number }>;
	readonly outputFrameCount: number;
}

interface UnifiedRetimeClipAuthority {
	readonly clipId: string;
	readonly sourceId: string;
	readonly sequenceStartFrame: number;
	readonly sequenceFrameCount: number;
	readonly sourceInFrame: number;
	readonly sourceFrameCount: number;
	readonly sourceRate: Readonly<{ readonly num: number; readonly den: number }>;
	readonly retimeMap: VideoRetimeCurveV16 | null;
	readonly sourceTiming: Readonly<{
		readonly kind: 'cfr' | 'vfr';
	}>;
	readonly sourceTimingView: BoundVideoSourceTimingView | null;
}

interface ExpectedBaseRow {
	readonly topologyIntervalIndex: number;
	readonly layerIndex: 0;
	readonly clipIndex: 0;
	readonly startSample: number;
	readonly endSample: number;
	readonly startOutputFrame: number;
	readonly endOutputFrame: number;
}

/**
 * Reconstruct the single-clip V6 topology owned by unified plans and bind every
 * field that can select an output ordinal or source picture. VFR boundaries
 * come only from a token authenticated against the digest-bound SCTI bytes.
 */
export function assertUnifiedExactRetimeAuthority(
	intent: VideoRetimeExportIntentV6,
	context: UnifiedRetimePlanContext,
	clip: UnifiedRetimeClipAuthority,
): void {
	assertIntentEnvelope(intent, context, clip);
	if ((clip.sourceTiming.kind === 'vfr') !== (clip.sourceTimingView !== null)) {
		throw new RangeError('Unified VFR retime authority requires exactly one verified timing asset sidecar.');
	}
	const cadence = createVideoRetimeOutputCadence({
		sampleStart: context.sampleStart,
		sampleDuration: context.sampleDuration,
		sampleRate: context.sampleRate,
		sequenceRate: context.sequenceRate,
		outputRate: context.outputRate,
	});
	const clipStartSample = sequenceFrameBoundarySample(
		clip.sequenceStartFrame, context.sequenceRate, context.sampleRate,
	);
	const clipEndSample = sequenceFrameBoundarySample(
		safeAdd(clip.sequenceStartFrame, clip.sequenceFrameCount),
		context.sequenceRate,
		context.sampleRate,
	);
	const planEndSample = safeAdd(context.sampleStart, context.sampleDuration);
	const activeStart = Math.max(context.sampleStart, clipStartSample);
	const activeEnd = Math.min(planEndSample, clipEndSample);
	if (activeEnd <= activeStart) {
		throw new RangeError('Unified retime clip has no active interval in its exact plan range.');
	}
	const topologyIntervalIndex = activeStart === context.sampleStart ? 0 : 1;
	const topologyRecordCount = (activeStart === context.sampleStart ? 0 : 1)
		+ 1
		+ (activeEnd === planEndSample ? 0 : 1)
		+ 2;
	const expected = clip.retimeMap === null
		? uniformRows(clip, {
			topologyIntervalIndex, layerIndex: 0, clipIndex: 0,
			startSample: activeStart, endSample: activeEnd,
			startOutputFrame: videoRetimeExportOutputBoundary(activeStart, cadence),
			endOutputFrame: videoRetimeExportOutputBoundary(activeEnd, cadence),
		}, clipStartSample, clipEndSample)
		: curveRows(clip, cadence, activeStart, activeEnd, topologyIntervalIndex, context);
	if (expected.rows.length < 1 || expected.rows.length !== intent.intersections.length) {
		throw new RangeError('Unified retime intersections do not exactly cover their active ordinal authority.');
	}
	for (let index = 0; index < expected.rows.length; index += 1) {
		assertExactRow(intent.intersections[index]!, expected.rows[index]!, clip, index);
	}
	const decimalByteCount = intent.intersections.reduce(
		(sum, row) => sum + videoRetimeExportDecimalTokenBytes(row),
		0,
	);
	const compiledSegmentCount = clip.retimeMap?.segments.length ?? 0;
	const limits = intent.limits;
	if (limits.topologyRecordCount !== topologyRecordCount
		|| limits.compiledSegmentCount !== compiledSegmentCount
		|| limits.geometricCandidateCount !== expected.geometricCandidateCount
		|| limits.serializedIntersectionCount !== expected.rows.length
		|| limits.decimalByteCount !== decimalByteCount) {
		throw new RangeError('Unified retime intent limit accounting is not its exact owning authority.');
	}
}

function assertIntentEnvelope(
	intent: VideoRetimeExportIntentV6,
	context: UnifiedRetimePlanContext,
	clip: UnifiedRetimeClipAuthority,
): void {
	if (intent.sampleStart !== context.sampleStart || intent.sampleDuration !== context.sampleDuration
		|| intent.sampleRate !== context.sampleRate || intent.sequenceBinding.id !== context.sequenceId
		|| !sameRate(intent.sequenceBinding.rate, context.sequenceRate)
		|| !sameRate(intent.outputRate, context.outputRate)
		|| intent.outputFrameCount !== context.outputFrameCount) {
		throw new RangeError('Unified clip exact intent disagrees with the plan time authority.');
	}
	for (const row of intent.intersections) {
		if (row.clipId !== clip.clipId || row.sourceId !== clip.sourceId
			|| row.sequenceStartFrame !== clip.sequenceStartFrame
			|| row.outerFrameCount !== clip.sequenceFrameCount
			|| row.sourceInFrame !== clip.sourceInFrame
			|| row.sourceOutFrame !== safeAdd(clip.sourceInFrame, clip.sourceFrameCount)
			|| (clip.retimeMap === null ? row.mapping !== 'uniform-wall-clock' : row.mapping !== 'curve')) {
			throw new RangeError('Unified clip exact intent row escapes its clip/source authority.');
		}
	}
}

function uniformRows(
	clip: UnifiedRetimeClipAuthority,
	base: ExpectedBaseRow,
	clipStartSample: number,
	clipEndSample: number,
): Readonly<{ readonly rows: readonly VideoRetimeExportIntersectionV6[]; readonly geometricCandidateCount: 1 }> {
	if (base.startOutputFrame === base.endOutputFrame) return { rows: [], geometricCandidateCount: 1 };
	const sourceStartTime = sourceBoundaryTime(clip.sourceInFrame, clip);
	const sourceEndTime = sourceBoundaryTime(safeAdd(clip.sourceInFrame, clip.sourceFrameCount), clip);
	return {
		rows: [{
			index: 0, ...identityBase(clip), ...base,
			mapping: 'uniform-wall-clock', clipStartSample, clipEndSample,
			sourceStartTime: decimal(sourceStartTime), sourceEndTime: decimal(sourceEndTime),
			clippedSourceStartTime: decimal(videoRetimeInterpolateSourceTime(
				sourceStartTime, sourceEndTime, base.startSample, clipStartSample, clipEndSample,
			)),
			clippedSourceEndTime: decimal(videoRetimeInterpolateSourceTime(
				sourceStartTime, sourceEndTime, base.endSample, clipStartSample, clipEndSample,
			)),
		}],
		geometricCandidateCount: 1,
	};
}

function curveRows(
	clip: UnifiedRetimeClipAuthority,
	cadence: ReturnType<typeof createVideoRetimeOutputCadence>,
	activeStart: number,
	activeEnd: number,
	topologyIntervalIndex: number,
	context: UnifiedRetimePlanContext,
): Readonly<{ readonly rows: readonly VideoRetimeExportIntersectionV6[]; readonly geometricCandidateCount: number }> {
	const map = clip.retimeMap!;
	const compiled = compileVideoRetimeCurveV16(map, {
		sequenceFrameCount: clip.sequenceFrameCount,
		sourceInFrame: clip.sourceInFrame,
		sourceFrameCount: clip.sourceFrameCount,
	})!;
	const rows: VideoRetimeExportIntersectionV6[] = [];
	let geometricCandidateCount = 0;
	for (let segmentIndex = 0; segmentIndex < map.segments.length; segmentIndex += 1) {
		const point = map.points[segmentIndex]!;
		const next = map.points[segmentIndex + 1]!;
		const segmentStartSample = sequenceFrameBoundarySample(
			safeAdd(clip.sequenceStartFrame, point.outerFrame), context.sequenceRate, context.sampleRate,
		);
		const segmentEndSample = sequenceFrameBoundarySample(
			safeAdd(clip.sequenceStartFrame, next.outerFrame), context.sequenceRate, context.sampleRate,
		);
		const startSample = Math.max(activeStart, segmentStartSample);
		const endSample = Math.min(activeEnd, segmentEndSample);
		if (endSample <= startSample) continue;
		geometricCandidateCount += 1;
		const startOutputFrame = videoRetimeExportOutputBoundary(startSample, cadence);
		const endOutputFrame = videoRetimeExportOutputBoundary(endSample, cadence);
		if (startOutputFrame === endOutputFrame) continue;
		const startOuterCell = required(cadence.localCellAt(
			startOutputFrame, clip.sequenceStartFrame, clip.sequenceFrameCount,
		));
		const endOuterCell = required(cadence.localCellAt(
			endOutputFrame - 1, clip.sequenceStartFrame, clip.sequenceFrameCount,
		)) + 1;
		const segment = map.segments[segmentIndex]!;
		const firstFrame = drawableFrame(compiled, startOuterCell, segment.mode, clip);
		const lastFrame = drawableFrame(compiled, endOuterCell - 1, segment.mode, clip);
		const lowerFrame = Math.min(firstFrame, lastFrame);
		const upperFrame = Math.max(firstFrame, lastFrame);
		rows.push({
			index: rows.length, ...identityBase(clip),
			topologyIntervalIndex, layerIndex: 0, clipIndex: 0,
			startSample, endSample, startOutputFrame, endOutputFrame,
			mapping: 'curve', segmentIndex, mode: segment.mode,
			segmentStartOuterCell: point.outerFrame, segmentEndOuterCell: next.outerFrame,
			sourceStart: rationalDecimal(point.sourceFrame), sourceEnd: rationalDecimal(next.sourceFrame),
			...('startVelocity' in segment ? {
				startVelocity: rationalDecimal(segment.startVelocity),
				endVelocity: rationalDecimal(segment.endVelocity),
			} : {}),
			startOuterCell, endOuterCell,
			clippedSourceStart: exactDecimal(evaluateVideoRetimeCurve(compiled, startOuterCell)),
			clippedSourceEnd: exactDecimal(evaluateVideoRetimeCurve(compiled, endOuterCell)),
			drawableStartTime: decimal(sourceBoundaryTime(lowerFrame, clip)),
			drawableEndTime: decimal(sourceBoundaryTime(upperFrame + 1, clip)),
		});
	}
	return { rows, geometricCandidateCount };
}

function assertExactRow(
	actual: VideoRetimeExportIntersectionV6,
	expected: VideoRetimeExportIntersectionV6,
	clip: UnifiedRetimeClipAuthority,
	index: number,
): void {
	if (canonicalizeNativeMediaSummaryValue(actual) !== canonicalizeNativeMediaSummaryValue(expected)) {
		throw new RangeError(`Unified retime intersection ${String(index)} is not its exact ordinal authority for ${clip.clipId}.`);
	}
}

function identityBase(clip: UnifiedRetimeClipAuthority) {
	return {
		clipId: clip.clipId, sourceId: clip.sourceId,
		sequenceStartFrame: clip.sequenceStartFrame, outerFrameCount: clip.sequenceFrameCount,
		sourceInFrame: clip.sourceInFrame, sourceOutFrame: safeAdd(clip.sourceInFrame, clip.sourceFrameCount),
	};
}

function drawableFrame(
	curve: CompiledVideoRetimeCurve,
	outerCell: number,
	mode: VideoRetimeCurveSegment['mode'],
	clip: UnifiedRetimeClipAuthority,
): number {
	const position = evaluateVideoRetimeCurve(curve, outerCell);
	const reverse = mode === 'constant-reverse' || mode === 'ramp-reverse';
	const owned = reverse ? ceiling(position) - 1n : floor(position);
	const lower = BigInt(clip.sourceInFrame);
	const upper = BigInt(safeAdd(clip.sourceInFrame, clip.sourceFrameCount) - 1);
	return Number(owned < lower ? lower : owned > upper ? upper : owned);
}

function sourceTime(frame: number, rate: Readonly<{ readonly num: number; readonly den: number }>) {
	return normalize(BigInt(frame) * BigInt(rate.den), BigInt(rate.num));
}

function sourceBoundaryTime(frame: number, clip: UnifiedRetimeClipAuthority) {
	if (clip.sourceTiming.kind === 'cfr') return sourceTime(frame, clip.sourceRate);
	if (clip.sourceTimingView === null) {
		throw new RangeError('Unified VFR source boundary has no authenticated timing sidecar.');
	}
	return videoSourceFrameTime(clip.sourceTimingView, {
		numerator: BigInt(frame), denominator: 1n,
	});
}

function decimal(value: Readonly<{ readonly numerator: bigint; readonly denominator: bigint }>): DecimalExactRationalV6 {
	return { numerator: value.numerator.toString(), denominator: value.denominator.toString() };
}

function exactDecimal(value: ExactVideoRetimeRational): DecimalExactRationalV6 { return decimal(value); }
function rationalDecimal(value: Readonly<{ readonly num: number; readonly den: number }>): DecimalExactRationalV6 {
	return decimal(normalize(BigInt(value.num), BigInt(value.den)));
}

function normalize(numerator: bigint, denominator: bigint) {
	const divisor = gcd(numerator < 0n ? -numerator : numerator, denominator);
	return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function floor(value: ExactVideoRetimeRational): bigint {
	const quotient = value.numerator / value.denominator;
	return value.numerator % value.denominator < 0n ? quotient - 1n : quotient;
}

function ceiling(value: ExactVideoRetimeRational): bigint {
	const quotient = value.numerator / value.denominator;
	return value.numerator % value.denominator > 0n ? quotient + 1n : quotient;
}

function sameRate(
	left: Readonly<{ readonly num: number; readonly den: number }>,
	right: Readonly<{ readonly num: number; readonly den: number }>,
): boolean { return left.num === right.num && left.den === right.den; }

function safeAdd(left: number, right: number): number {
	const result = BigInt(left) + BigInt(right);
	if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Unified retime range overflows.');
	return Number(result);
}

function required(value: number | null): number {
	if (value === null) throw new RangeError('Unified retime cadence escaped its clip authority.');
	return value;
}

function gcd(left: bigint, right: bigint): bigint {
	while (right !== 0n) [left, right] = [right, left % right];
	return left || 1n;
}
