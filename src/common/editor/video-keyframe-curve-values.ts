/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainRecord, readClosedDomainField as field } from './closed-domain-value.ts';
import { compileInterpolationCurve, type CompiledInterpolationCurve } from './interpolation-curve.ts';
import { normalizeRational, compareRationals, type Rational, type RationalInput } from './timeline-time.ts';
import { MAXIMUM_VIDEO_KEYFRAME_ANCHORS } from './video-keyframe-curves-types.ts';

interface NumericParameterDescriptor { readonly minimum: number; readonly maximum: number; readonly integer: boolean; }
/** Inert interpolation/rational admission shared by the fixed V1/V2 owners. */
export function normalizeCurve(value: unknown, name: string): CompiledInterpolationCurve {
	const record = readClosedDomainRecord(value, name, ['anchors', 'segments']);
	const anchors = readClosedDomainArray(field(record, 'anchors', name), `${name}.anchors`, 2, MAXIMUM_VIDEO_KEYFRAME_ANCHORS);
	const segments = readClosedDomainArray(field(record, 'segments', name), `${name}.segments`, 1, MAXIMUM_VIDEO_KEYFRAME_ANCHORS - 1);
	if (anchors.length !== segments.length + 1) {
		throw new RangeError(`${name}.anchors must contain exactly one more item than segments.`);
	}
	for (const [index, candidate] of anchors.entries()) inspectAnchor(candidate, `${name}.anchors[${String(index)}]`);
	for (const [index, candidate] of segments.entries()) inspectSegment(candidate, `${name}.segments[${String(index)}]`);
	return compileInterpolationCurve(record);
}

function inspectAnchor(value: unknown, name: string): void {
	const anchor = readClosedDomainRecord(value, name, ['position', 'value']);
	inspectPersistedRational(field(anchor, 'position', name), `${name}.position`);
	if (Object.is(field(anchor, 'value', name), -0)) throw new RangeError(`${name}.value must not be negative zero.`);
}

function inspectSegment(value: unknown, name: string): void {
	const base = readClosedDomainRecord(value, name, ['kind', 'control1', 'control2'], ['kind']);
	if (field(base, 'kind', name) !== 'bezier') return;
	const bezier = readClosedDomainRecord(value, name, ['kind', 'control1', 'control2']);
	inspectAnchor(field(bezier, 'control1', name), `${name}.control1`);
	inspectAnchor(field(bezier, 'control2', name), `${name}.control2`);
}

export function validateCurveDomain(curve: CompiledInterpolationCurve, duration: Rational, name: string): void {
	for (const [index, anchor] of curve.anchors.entries()) assertInAuthoredDomain(anchor.position, duration, `${name}.anchors[${String(index)}].position`);
	for (const [index, segment] of curve.segments.entries()) {
		if (segment.kind !== 'bezier') continue;
		assertInAuthoredDomain(segment.control1.position, duration, `${name}.segments[${String(index)}].control1.position`);
		assertInAuthoredDomain(segment.control2.position, duration, `${name}.segments[${String(index)}].control2.position`);
	}
}

function assertInAuthoredDomain(value: Rational, duration: Rational, name: string): void {
	if (compareRationals(value, 0) < 0 || compareRationals(value, duration) > 0) {
		throw new RangeError(`${name} is outside the authored clip domain.`);
	}
}

export function validateCurveValues(curve: CompiledInterpolationCurve, owned: NumericParameterDescriptor, name: string): void {
	if (owned.integer && curve.segments.some(({ kind }) => kind !== 'hold')) {
		throw new RangeError(`${name} must use hold segments for an integer target.`);
	}
	for (const [index, anchor] of curve.anchors.entries()) validateParameterValue(anchor.value, owned, `${name}.anchors[${String(index)}].value`);
	for (const [index, segment] of curve.segments.entries()) {
		if (segment.kind !== 'bezier') continue;
		validateParameterValue(segment.control1.value, owned, `${name}.segments[${String(index)}].control1.value`);
		validateParameterValue(segment.control2.value, owned, `${name}.segments[${String(index)}].control2.value`);
	}
}

function validateParameterValue(value: number, owned: NumericParameterDescriptor, name: string): void {
	if (value < owned.minimum || value > owned.maximum) throw new RangeError(`${name} is outside its target range.`);
	if (owned.integer && !Number.isSafeInteger(value)) throw new RangeError(`${name} must be an integer.`);
}

export function exactRational(value: unknown, name: string): Rational {
	inspectRationalNegativeZero(value, name);
	return normalizeRational(value as RationalInput);
}

function inspectPersistedRational(value: unknown, name: string): void {
	if (typeof value === 'number') throw new TypeError(`${name} must be a rational object.`);
	inspectRationalNegativeZero(value, name);
	const rational = readClosedDomainRecord(value, name, ['num', 'den']);
	const num = field(rational, 'num', name);
	const den = field(rational, 'den', name);
	const normalized = normalizeRational({ num: num as number, den: den as number });
	if (num !== normalized.num || den !== normalized.den) {
		throw new RangeError(`${name} must be a canonical reduced rational object.`);
	}
}

function inspectRationalNegativeZero(value: unknown, name: string): void {
	if (typeof value === 'number') {
		if (Object.is(value, -0)) throw new RangeError(`${name} must not be negative zero.`);
		return;
	}
	const rational = readClosedDomainRecord(value, name, ['num', 'den']);
	for (const key of ['num', 'den'] as const) {
		if (Object.is(field(rational, key, name), -0)) throw new RangeError(`${name}.${key} must not be negative zero.`);
	}
}
