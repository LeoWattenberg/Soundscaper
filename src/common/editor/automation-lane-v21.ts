/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import { createIndexedBeatFrameProjector } from './indexed-tempo-projector.ts';
import {
	compileInterpolationCurve,
	evaluateInterpolationCurveAtExactPosition,
	type CompiledInterpolationCurve,
	type InterpolationShape,
} from './interpolation-curve.ts';
import {
	canonicalParameterAddressKey,
	normalizeParameterAddress,
	type ParameterAddress,
	type ParameterDescriptor,
} from './parameter-address.ts';
import { sampleFrameToBeat } from './timeline-tempo-inverse.ts';
import {
	compareRationals,
	normalizeRational,
	type HoldTempoMap,
	type Rational,
} from './timeline-time.ts';

export const AUTOMATION_LANE_MAXIMUM_POINTS_V21 = 4_096;
export const AUTOMATION_LANE_MAXIMUM_LANES_V21 = 4_096;
export const AUTOMATION_LANE_MAXIMUM_CAPTURE_POINTS_V21 = 100_000;

export type AutomationLaneTimebaseV21 = 'absolute-samples' | 'musical-beats';
export type AutomationLanePositionV21 = number | Rational;

export interface AutomationLanePointV21 {
	readonly id: string;
	readonly position: AutomationLanePositionV21;
	readonly value: number;
}

export interface AutomationLaneV21 {
	readonly id: string;
	readonly address: ParameterAddress;
	readonly timebase: AutomationLaneTimebaseV21;
	readonly points: readonly Readonly<AutomationLanePointV21>[];
	readonly segments: readonly InterpolationShape[];
}

export interface AutomationLaneNormalizationOptionsV21 {
	readonly descriptor?: ParameterDescriptor;
}

export interface AutomationLaneFrameOptionsV21 {
	readonly sampleRate: number;
	readonly tempoMap?: HoldTempoMap;
}

export interface ResolvedAutomationLanePointV21 {
	readonly id: string;
	readonly frame: number;
	readonly value: number;
}

const NORMALIZED_CURVES = new WeakMap<object, CompiledInterpolationCurve | null>();

/** Validate one exact V21 persisted lane into detached, deeply frozen state. */
export function normalizeAutomationLaneV21(
	value: unknown,
	options: AutomationLaneNormalizationOptionsV21 = {},
): AutomationLaneV21 {
	return normalizeLane(value, options, AUTOMATION_LANE_MAXIMUM_POINTS_V21, 'automation lane');
}

/** Validate transient gesture capture before deterministic thinning; never persist this result directly. */
export function normalizeAutomationLaneCaptureV21(
	value: unknown,
	options: AutomationLaneNormalizationOptionsV21 = {},
): AutomationLaneV21 {
	return normalizeLane(
		value,
		options,
		AUTOMATION_LANE_MAXIMUM_CAPTURE_POINTS_V21,
		'automation lane capture',
	);
}

/** Enforce collection identities without owning the enclosing V21 document shape. */
export function assertAutomationLaneIdentitiesUniqueV21(value: readonly unknown[]): true {
	const candidates = readClosedDomainArray(
		value, 'automation lanes', 0, AUTOMATION_LANE_MAXIMUM_LANES_V21,
	);
	const laneIds = new Set<string>();
	const addresses = new Set<string>();
	for (const candidate of candidates) {
		const lane = normalizeAutomationLaneV21(candidate);
		if (laneIds.has(lane.id)) throw new RangeError(`Automation lanes contain a duplicate lane ID: ${lane.id}.`);
		laneIds.add(lane.id);
		const address = canonicalParameterAddressKey(lane.address);
		if (addresses.has(address)) {
			throw new RangeError(`Automation lanes contain a duplicate parameter address: ${address}.`);
		}
		addresses.add(address);
	}
	return true;
}

/** Resolve persisted point coordinates once through the project's authoritative tempo map. */
export function resolveAutomationLanePointFramesV21(
	value: AutomationLaneV21,
	options: AutomationLaneFrameOptionsV21,
): readonly ResolvedAutomationLanePointV21[] {
	const lane = normalizedLane(value);
	const sampleRate = positiveSafeInteger(options.sampleRate, 'sampleRate');
	const project = lane.timebase === 'musical-beats'
		? createIndexedBeatFrameProjector(requiredTempoMap(options.tempoMap), sampleRate)
		: null;
	return Object.freeze(lane.points.map((point) => Object.freeze({
		id: point.id,
		frame: project ? project(point.position as Rational) : point.position as number,
		value: point.value,
	})));
}

/** Evaluate one lane at an authoritative integer project sample. */
export function evaluateAutomationLaneAtFrameV21(
	value: AutomationLaneV21,
	frameValue: number,
	options: AutomationLaneFrameOptionsV21,
): number {
	const lane = normalizedLane(value);
	const frame = nonNegativeSafeInteger(frameValue, 'frame');
	const sampleRate = positiveSafeInteger(options.sampleRate, 'sampleRate');
	const curve = NORMALIZED_CURVES.get(lane);
	if (!curve) return lane.points[0]!.value;
	const position = lane.timebase === 'absolute-samples'
		? Object.freeze({ num: frame, den: 1 })
		: sampleFrameToBeat(frame, requiredTempoMap(options.tempoMap), sampleRate);
	return canonicalValue(evaluateInterpolationCurveAtExactPosition(curve, position));
}

function normalizeLane(
	value: unknown,
	options: AutomationLaneNormalizationOptionsV21,
	maximumPoints: number,
	name: string,
): AutomationLaneV21 {
	const input = readClosedDomainRecord(value, name, ['id', 'address', 'timebase', 'points', 'segments']);
	const id = stableId(field(input, 'id', name), `${name} ID`);
	const address = normalizeParameterAddress(field(input, 'address', name));
	const timebase = normalizeTimebase(field(input, 'timebase', name), `${name}.timebase`);
	const pointValues = readClosedDomainArray(
		field(input, 'points', name), `${name}.points`, 1, maximumPoints,
	);
	const segmentValues = readClosedDomainArray(
		field(input, 'segments', name), `${name}.segments`, 0, Math.max(0, maximumPoints - 1),
	);
	if (segmentValues.length !== pointValues.length - 1) {
		throw new RangeError(`${name}.segments must contain exactly one fewer entry than points.`);
	}
	const points = pointValues.map((candidate, index) => normalizePoint(
		candidate, timebase, `${name}.points[${String(index)}]`,
	));
	assertOrderedUniquePoints(points, timebase, name);
	for (const [index, candidate] of segmentValues.entries()) {
		inspectSegment(candidate, `${name}.segments[${String(index)}]`);
	}

	const curve = points.length === 1 ? null : compileInterpolationCurve({
		anchors: points.map(({ position, value }) => ({
			position: authoredRational(position, timebase),
			value,
		})),
		segments: segmentValues,
	});
	const segments = curve?.segments ?? Object.freeze([]);
	const descriptor = options.descriptor;
	if (descriptor) validateDescriptor(descriptor, address, points, segments, name);
	const lane = Object.freeze({
		id,
		address,
		timebase,
		points: Object.freeze(points),
		segments,
	});
	NORMALIZED_CURVES.set(lane, curve);
	return lane;
}

function normalizePoint(
	value: unknown,
	timebase: AutomationLaneTimebaseV21,
	name: string,
): Readonly<AutomationLanePointV21> {
	const point = readClosedDomainRecord(value, name, ['id', 'position', 'value']);
	const positionValue = field(point, 'position', name);
	const position = timebase === 'absolute-samples'
		? nonNegativeSafeInteger(positionValue, `${name}.position`)
		: persistedRational(positionValue, `${name}.position`);
	return Object.freeze({
		id: stableId(field(point, 'id', name), `${name}.id`),
		position,
		value: finiteCanonicalNumber(field(point, 'value', name), `${name}.value`),
	});
}

function inspectSegment(value: unknown, name: string): void {
	const base = readClosedDomainRecord(value, name, ['kind', 'control1', 'control2'], ['kind']);
	const kind = field(base, 'kind', name);
	if (kind === 'hold' || kind === 'linear' || kind === 'eased') {
		readClosedDomainRecord(value, name, ['kind']);
		return;
	}
	if (kind !== 'bezier') throw new RangeError(`${name}.kind is unsupported.`);
	const bezier = readClosedDomainRecord(value, name, ['kind', 'control1', 'control2']);
	inspectControl(field(bezier, 'control1', name), `${name}.control1`);
	inspectControl(field(bezier, 'control2', name), `${name}.control2`);
}

function inspectControl(value: unknown, name: string): void {
	const control = readClosedDomainRecord(value, name, ['position', 'value']);
	persistedRational(field(control, 'position', name), `${name}.position`);
	finiteCanonicalNumber(field(control, 'value', name), `${name}.value`);
}

function assertOrderedUniquePoints(
	points: readonly Readonly<AutomationLanePointV21>[],
	timebase: AutomationLaneTimebaseV21,
	name: string,
): void {
	const ids = new Set<string>();
	for (const [index, point] of points.entries()) {
		if (ids.has(point.id)) throw new RangeError(`${name} contains a duplicate point ID: ${point.id}.`);
		ids.add(point.id);
		if (index === 0) continue;
		const previous = points[index - 1]!;
		const ordered = timebase === 'absolute-samples'
			? Number(previous.position) < Number(point.position)
			: compareRationals(previous.position as Rational, point.position as Rational) < 0;
		if (!ordered) throw new RangeError(`${name} point positions must be strictly increasing.`);
	}
}

function validateDescriptor(
	descriptor: ParameterDescriptor,
	address: ParameterAddress,
	points: readonly Readonly<AutomationLanePointV21>[],
	segments: readonly InterpolationShape[],
	name: string,
): void {
	const input = readClosedDomainRecord(descriptor, 'automation descriptor', [
		'id', 'address', 'unit', 'minimum', 'maximum', 'defaultValue', 'step', 'taper',
		'automationTolerance', 'automatable', 'automationBlockReason', 'latencyFrames', 'tailFrames',
	], [
		'id', 'address', 'unit', 'minimum', 'maximum', 'defaultValue', 'step', 'taper',
		'automationTolerance', 'automatable', 'latencyFrames', 'tailFrames',
	]);
	const descriptorAddress = canonicalParameterAddressKey(field(input, 'address', 'automation descriptor'));
	if (field(input, 'id', 'automation descriptor') !== descriptorAddress) {
		throw new RangeError('An automation descriptor ID must match its canonical address.');
	}
	if (descriptorAddress !== canonicalParameterAddressKey(address)) {
		throw new RangeError(`${name} does not match its supplied descriptor address.`);
	}
	if (field(input, 'automatable', 'automation descriptor') !== true) {
		throw new RangeError(`${name} targets a nonautomatable parameter.`);
	}
	const minimum = finiteNumber(field(input, 'minimum', 'automation descriptor'), 'descriptor minimum');
	const maximum = finiteNumber(field(input, 'maximum', 'automation descriptor'), 'descriptor maximum');
	if (minimum > maximum) throw new RangeError('An automation descriptor range must be ordered.');
	if (field(input, 'taper', 'automation descriptor') === 'discrete'
		&& segments.some(({ kind }) => kind !== 'hold')) {
		throw new RangeError('A discrete automation lane must use only hold segments.');
	}
	for (const [index, point] of points.entries()) {
		assertValueInRange(point.value, minimum, maximum, `${name}.points[${String(index)}].value`);
	}
	for (const [index, segment] of segments.entries()) {
		if (segment.kind !== 'bezier') continue;
		assertValueInRange(segment.control1.value, minimum, maximum, `${name}.segments[${String(index)}].control1.value`);
		assertValueInRange(segment.control2.value, minimum, maximum, `${name}.segments[${String(index)}].control2.value`);
	}
}

function assertValueInRange(value: number, minimum: number, maximum: number, name: string): void {
	if (value < minimum || value > maximum) throw new RangeError(`${name} is outside its target range.`);
}

function normalizedLane(value: AutomationLaneV21): AutomationLaneV21 {
	if (value && typeof value === 'object' && NORMALIZED_CURVES.has(value)) return value;
	return normalizeAutomationLaneV21(value);
}

function authoredRational(
	position: AutomationLanePositionV21,
	timebase: AutomationLaneTimebaseV21,
): Rational {
	return timebase === 'absolute-samples'
		? Object.freeze({ num: position as number, den: 1 })
		: position as Rational;
}

function persistedRational(value: unknown, name: string): Rational {
	const record = readClosedDomainRecord(value, name, ['num', 'den']);
	const num = field(record, 'num', name);
	const den = field(record, 'den', name);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || Object.is(num, -0) || Object.is(den, -0)) {
		throw new RangeError(`${name} must be a canonical safe-integer rational object.`);
	}
	const normalized = normalizeRational({ num: Number(num), den: Number(den) });
	if (normalized.num !== num || normalized.den !== den) {
		throw new RangeError(`${name} must be a canonical reduced rational object.`);
	}
	if (compareRationals(normalized, 0) < 0) throw new RangeError(`${name} must be non-negative.`);
	return normalized;
}

function requiredTempoMap(value: HoldTempoMap | undefined): HoldTempoMap {
	if (!value) throw new TypeError('A musical automation lane requires the project tempo map.');
	return value;
}

function normalizeTimebase(value: unknown, name: string): AutomationLaneTimebaseV21 {
	if (value !== 'absolute-samples' && value !== 'musical-beats') {
		throw new RangeError(`${name} must be absolute-samples or musical-beats.`);
	}
	return value;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${name} must be a non-empty string.`);
	if (value.length > 256 || /[\p{Cc}\p{Cf}]/u.test(value)) {
		throw new RangeError(`${name} must contain at most 256 code units and no control or formatting characters.`);
	}
	return value;
}

function finiteCanonicalNumber(value: unknown, name: string): number {
	const result = finiteNumber(value, name);
	if (Object.is(result, -0)) throw new RangeError(`${name} must not be negative zero.`);
	return result;
}

function finiteNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Object.is(value, -0)) {
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

function canonicalValue(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}
