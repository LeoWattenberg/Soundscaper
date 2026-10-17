/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import type { VideoColorGradeV1, RgbTripletV1 } from './video-color-management-v27.ts';

/** A new encoded-sRGB byte process over the existing numeric grade model.
 * Each channel decodes to linear Rec.709, applies lift→gain→gamma, clamps,
 * encodes sRGB and quantizes half up independently. Neutral exposure/contrast
 * and saturation are omitted, not evaluated through legacy Float64 algebra.
 * Legacy GradeV1's luminance recombination can change rounding at half-byte
 * boundaries; its evaluator and all existing bytes remain unchanged. */
export const COLOR_WHEELS_SCALAR_PROCESS_V1 = 'srgb-scalar-lgg-wheels-v1';
export interface ScalarColorWheelsGradeV1 {
	readonly lift: RgbTripletV1;
	readonly gamma: RgbTripletV1;
	readonly gain: RgbTripletV1;
}
const PREPARED = new WeakSet<object>();
const FIELDS = ['schemaVersion', 'exposureStops', 'contrast', 'pivot', 'lift', 'gamma', 'gain', 'saturation', 'lut'];

/** This exact LGG-only profile shares GradeV1's closed numeric bounds without
 * importing the legacy multichannel renderer or its LUT body authority. */
export function normalizeScalarColorWheelsGradeV1(value: unknown): VideoColorGradeV1 {
	const input = record(value, 'scalar color wheel grade', FIELDS);
	for (const [key, expected] of [['schemaVersion', 1], ['exposureStops', 0], ['contrast', 1], ['pivot', 0.18], ['saturation', 1], ['lut', null]] as const) {
		const actual = field(input, key, 'scalar color wheel grade');
		if (actual !== expected || Object.is(actual, -0)) throw new RangeError('Scalar color wheels require the numeric LGG-only grade profile.');
	}
	return Object.freeze({ schemaVersion: 1, exposureStops: 0, contrast: 1, pivot: 0.18, saturation: 1, lut: null,
		lift: triplet(field(input, 'lift', 'scalar color wheel grade'), -2, 2),
		gamma: triplet(field(input, 'gamma', 'scalar color wheel grade'), 0.01, 10),
		gain: triplet(field(input, 'gain', 'scalar color wheel grade'), 0, 16) });
}

function triplet(value: unknown, minimum: number, maximum: number): RgbTripletV1 {
	const values = readClosedDomainArray(value, 'scalar color wheel channels', 3, 3);
	return Object.freeze(values.map(value => {
		if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0) || value < minimum || value > maximum) {
			throw new RangeError('Scalar color wheel channel is outside its GradeV1 bound.');
		}
		return value;
	}) as unknown as [number, number, number]);
}

/** Closed grade admission happens once, before preparing any table or frame. */
export function prepareScalarColorWheelsGradeV1(value: unknown): Readonly<ScalarColorWheelsGradeV1> {
	const grade = normalizeScalarColorWheelsGradeV1(value);
	const prepared = Object.freeze({ lift: grade.lift, gamma: grade.gamma, gain: grade.gain });
	PREPARED.add(prepared); return prepared;
}

/** The exact owning scalar is shared by CPU pixels and transient GPU/GEQ tables. */
export function scalarColorWheelsByteV1(prepared: ScalarColorWheelsGradeV1, byte: number, channel: 0 | 1 | 2): number {
	if (!PREPARED.has(prepared)) throw new TypeError('Scalar color wheels require their owning admitted grade.');
	if (!Number.isInteger(byte) || byte < 0 || byte > 255 || (channel !== 0 && channel !== 1 && channel !== 2)) {
		throw new RangeError('Invalid scalar color wheel byte channel.');
	}
	const encoded = byte / 255, linear = encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
	const lgg = Math.min(1, Math.max(0, Math.pow(Math.max(0, linear + prepared.lift[channel]) * prepared.gain[channel], 1 / prepared.gamma[channel])));
	const srgb = lgg <= 0.0031308 ? 12.92 * lgg : 1.055 * lgg ** (1 / 2.4) - 0.055;
	return Math.floor(srgb * 255 + 0.5);
}
