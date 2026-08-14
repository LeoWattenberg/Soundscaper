/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	compileInterpolationCurve,
	evaluateInterpolationCurveAtExactPosition,
	type InterpolationShape,
} from './interpolation-curve.ts';
import {
	AUTOMATION_LANE_MAXIMUM_POINTS_V21,
	normalizeAutomationLaneCaptureV21,
	normalizeAutomationLaneV21,
	type AutomationLaneNormalizationOptionsV21,
	type AutomationLanePointV21,
	type AutomationLanePositionV21,
	type AutomationLaneTimebaseV21,
	type AutomationLaneV21,
} from './automation-lane-v21.ts';
import type { Rational } from './timeline-time.ts';

export interface AutomationLaneThinningOptionsV21 extends AutomationLaneNormalizationOptionsV21 {
	readonly maximumPoints?: number;
	/** Native-value tolerance used only when no contextual descriptor is supplied. */
	readonly automationTolerance?: number;
}

interface IntervalCandidate {
	readonly left: number;
	readonly right: number;
	readonly index: number;
	readonly error: number;
}

interface ErrorMetric {
	readonly normalize: (value: number) => number;
	readonly tolerance: number;
}

/**
 * Reduce transient gesture capture to a persistable V21 lane. Endpoints,
 * discontinuities, and interpolation-mode boundaries are irreducible; every
 * remaining slot is assigned to the globally highest current approximation error.
 */
export function thinAutomationLaneCaptureV21(
	value: unknown,
	options: AutomationLaneThinningOptionsV21 = {},
): AutomationLaneV21 {
	const maximumPoints = boundedMaximum(options.maximumPoints);
	const capture = normalizeAutomationLaneCaptureV21(value, { descriptor: options.descriptor });
	const metric = errorMetric(options);
	const kept = protectedPointIndexes(capture);
	if (kept.size > maximumPoints) {
		throw new RangeError(
			`Automation capture has ${String(kept.size)} irreducible discontinuity or shape points above its cap.`,
		);
	}
	const candidates = intervalCandidates(capture, [...kept].sort(numberOrder), metric);
	while (candidates.length) {
		const selectedOffset = bestCandidateOffset(candidates);
		const selected = candidates[selectedOffset]!;
		if (selected.error <= metric.tolerance) break;
		if (kept.size >= maximumPoints) {
			throw new RangeError(
				'Automation capture cannot meet its automation tolerance within the persisted point cap.',
			);
		}
		candidates.splice(selectedOffset, 1);
		kept.add(selected.index);
		const left = intervalCandidate(capture, selected.left, selected.index, metric);
		const right = intervalCandidate(capture, selected.index, selected.right, metric);
		if (left) candidates.push(left);
		if (right) candidates.push(right);
	}

	const indexes = [...kept].sort(numberOrder);
	const result = {
		id: capture.id,
		address: capture.address,
		timebase: capture.timebase,
		points: indexes.map((index) => capture.points[index]!),
		segments: indexes.slice(0, -1).map((left, offset) => coalescedSegment(
			capture.segments,
			left,
			indexes[offset + 1]!,
		)),
	};
	return normalizeAutomationLaneV21(result, { descriptor: options.descriptor });
}

function protectedPointIndexes(lane: AutomationLaneV21): Set<number> {
	const last = lane.points.length - 1;
	const result = new Set<number>([0, last]);
	for (const [index, segment] of lane.segments.entries()) {
		const next = index + 1;
		if (segment.kind === 'hold' && lane.points[index]!.value !== lane.points[next]!.value) {
			result.add(index);
			result.add(next);
		}
		if (index > 0 && lane.segments[index - 1]!.kind !== segment.kind) result.add(index);
	}
	return result;
}

function intervalCandidates(
	lane: AutomationLaneV21,
	indexes: readonly number[],
	metric: ErrorMetric,
): IntervalCandidate[] {
	return indexes.slice(0, -1).flatMap((left, offset) => {
		const candidate = intervalCandidate(lane, left, indexes[offset + 1]!, metric);
		return candidate ? [candidate] : [];
	});
}

function intervalCandidate(
	lane: AutomationLaneV21,
	left: number,
	right: number,
	metric: ErrorMetric,
): IntervalCandidate | null {
	if (right - left < 2) return null;
	const start = lane.points[left]!;
	const end = lane.points[right]!;
	const curve = compileInterpolationCurve({
		anchors: [curveAnchor(start, lane.timebase), curveAnchor(end, lane.timebase)],
		segments: [coalescedSegment(lane.segments, left, right)],
	});
	let selected = left + 1;
	let maximumError = -1;
	for (let index = left + 1; index < right; index += 1) {
		const point = lane.points[index]!;
		const approximation = evaluateInterpolationCurveAtExactPosition(
			curve,
			authoredPosition(point.position, lane.timebase),
		);
		const error = Math.abs(metric.normalize(point.value) - metric.normalize(approximation));
		if (error > maximumError) {
			selected = index;
			maximumError = error;
		}
	}
	return Object.freeze({ left, right, index: selected, error: maximumError });
}

function coalescedSegment(
	segments: readonly InterpolationShape[],
	left: number,
	right: number,
): InterpolationShape {
	const first = segments[left]!;
	if (right === left + 1) return first;
	for (let index = left + 1; index < right; index += 1) {
		if (segments[index]!.kind !== first.kind) {
			throw new RangeError('Automation thinning cannot cross an interpolation shape-mode boundary.');
		}
	}
	if (first.kind !== 'bezier') return Object.freeze({ kind: first.kind });
	const last = segments[right - 1]!;
	if (last.kind !== 'bezier') throw new Error('A homogeneous Bézier interval was expected.');
	return Object.freeze({
		kind: 'bezier',
		control1: first.control1,
		control2: last.control2,
	});
}

function curveAnchor(point: Readonly<AutomationLanePointV21>, timebase: AutomationLaneTimebaseV21) {
	return Object.freeze({ position: authoredPosition(point.position, timebase), value: point.value });
}

function authoredPosition(position: AutomationLanePositionV21, timebase: AutomationLaneTimebaseV21): Rational {
	return timebase === 'absolute-samples'
		? Object.freeze({ num: position as number, den: 1 })
		: position as Rational;
}

function bestCandidateOffset(candidates: readonly IntervalCandidate[]): number {
	let selected = 0;
	for (let index = 1; index < candidates.length; index += 1) {
		const candidate = candidates[index]!;
		const current = candidates[selected]!;
		if (candidate.error > current.error
			|| (candidate.error === current.error && candidate.index < current.index)) selected = index;
	}
	return selected;
}

function boundedMaximum(value: unknown): number {
	const maximum = value === undefined ? AUTOMATION_LANE_MAXIMUM_POINTS_V21 : value;
	if (!Number.isSafeInteger(maximum) || Number(maximum) < 1
		|| Number(maximum) > AUTOMATION_LANE_MAXIMUM_POINTS_V21) {
		throw new RangeError(`maximumPoints must be from 1 through ${String(AUTOMATION_LANE_MAXIMUM_POINTS_V21)}.`);
	}
	return Number(maximum);
}

function errorMetric(options: AutomationLaneThinningOptionsV21): ErrorMetric {
	if (!options.descriptor) {
		const tolerance = nonNegativeFinite(options.automationTolerance ?? 0, 'automationTolerance');
		return Object.freeze({ normalize: identity, tolerance });
	}
	if (options.automationTolerance !== undefined) {
		throw new TypeError('A descriptor owns automationTolerance; a second thinning tolerance is not allowed.');
	}
	const minimum = finite(options.descriptor.minimum, 'descriptor minimum');
	const maximum = finite(options.descriptor.maximum, 'descriptor maximum');
	if (maximum < minimum) throw new RangeError('The descriptor value range must be ordered.');
	const span = maximum - minimum;
	const nativeTolerance = nonNegativeFinite(
		options.descriptor.automationTolerance,
		'descriptor automationTolerance',
	);
	if (span === 0) return Object.freeze({ normalize: () => 0, tolerance: 0 });
	return Object.freeze({
		normalize: (value: number) => (value - minimum) / span,
		tolerance: nativeTolerance / span,
	});
}

function finite(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
	return value;
}

function nonNegativeFinite(value: unknown, name: string): number {
	const result = finite(value, name);
	if (result < 0) throw new RangeError(`${name} must be non-negative.`);
	return result;
}

function identity(value: number): number {
	return value;
}

function numberOrder(left: number, right: number): number {
	return left - right;
}
