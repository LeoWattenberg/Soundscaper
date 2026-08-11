/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	compileVideoRetimeCurve,
	type CompiledVideoRetimeCurve,
	type VideoRetimeCurveRational,
	type VideoRetimeCurveSegment,
} from './video-retime-curve.ts';

export interface VideoRetimeCurveV16Binding {
	readonly sequenceFrameCount: number;
	readonly sourceInFrame: number;
	readonly sourceFrameCount: number;
}

export interface VideoRetimeCurvePointV16 {
	readonly outerFrame: number;
	readonly sourceFrame: VideoRetimeCurveRational;
}

export interface VideoRetimeCurveV16 {
	readonly feature: 'video-retime';
	readonly version: 2;
	readonly points: readonly Readonly<VideoRetimeCurvePointV16>[];
	readonly segments: readonly VideoRetimeCurveSegment[];
}

/** Validate one clip-bound V16 retime wire and return an immutable canonical snapshot. */
export function normalizeVideoRetimeCurveV16(
	value: unknown,
	bindingValue: unknown,
): VideoRetimeCurveV16 | null {
	const compiled = compileVideoRetimeCurveV16(value, bindingValue);
	if (compiled === null) return null;
	return Object.freeze({
		feature: 'video-retime' as const,
		version: 2 as const,
		points: compiled.points,
		segments: compiled.segments,
	});
}

/** Validate one clip-bound V16 retime wire and retain its algebra identity. */
export function compileVideoRetimeCurveV16(
	value: unknown,
	bindingValue: unknown,
): CompiledVideoRetimeCurve | null {
	if (value === null) return null;
	const map = dataRecord(value, 'video retime map', ['feature', 'version', 'points', 'segments']);
	if (map.feature !== 'video-retime') {
		throw new RangeError('video retime map.feature must be video-retime.');
	}
	if (map.version !== 2) throw new RangeError('video retime map.version must be 2.');
	const binding = dataRecord(bindingValue, 'video retime binding', [
		'sequenceFrameCount', 'sourceInFrame', 'sourceFrameCount',
	]);
	return compileVideoRetimeCurve({
		version: 2,
		outerFrameCount: binding.sequenceFrameCount,
		sourceStartFrame: binding.sourceInFrame,
		sourceFrameCount: binding.sourceFrameCount,
		points: map.points,
		segments: map.segments,
	});
}

function dataRecord(
	value: unknown,
	name: string,
	keys: readonly string[],
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must have a plain record prototype.`);
	}
	const record = value as Record<string, unknown>;
	const ownKeys = Reflect.ownKeys(record);
	const expected = new Set(keys);
	if (ownKeys.some((key) => typeof key !== 'string' || !expected.has(key))) {
		throw new TypeError(`${name} contains an unsupported field.`);
	}
	for (const key of keys) {
		if (!ownKeys.includes(key)) throw new TypeError(`${name}.${key} is required.`);
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an enumerable data property, not an accessor.`);
		}
	}
	return record;
}
