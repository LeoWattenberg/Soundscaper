/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoColorGradeV1, type RgbTripletV1 } from './video-color-management-v27.ts';

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

/** Closed grade admission happens once, before preparing any table or frame. */
export function prepareScalarColorWheelsGradeV1(value: unknown): Readonly<ScalarColorWheelsGradeV1> {
	const grade = normalizeVideoColorGradeV1(value);
	if (grade.exposureStops !== 0 || grade.contrast !== 1 || grade.pivot !== 0.18 || grade.saturation !== 1 || grade.lut !== null) {
		throw new RangeError('Scalar color wheels require the numeric LGG-only grade profile.');
	}
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
