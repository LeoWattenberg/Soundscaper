/* SPDX-License-Identifier: AGPL-3.0-only */
import { motionMaximumIndexPixel } from './motionscaper-native-maximum-index-oracle.ts';
import { motionMaximumScenePixel } from './motionscaper-native-maximum-scene-oracle.ts';
import { motionMaximumNativeProfile, type MotionMaximumNativeKind } from './motionscaper-native-maximum-profile.ts';

const encode = (value: number, space: 'srgb' | '709') => space === 'srgb'
	? value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055
	: value < .018 ? 4.5 * value : 1.099 * value ** .45 - .099;
const pixel = (kind: MotionMaximumNativeKind, frame: number, x: number, y: number) => kind === 'index'
	? motionMaximumIndexPixel(frame, x, y) : motionMaximumScenePixel(kind, frame, x, y);

/** Independent linear-to-sRGB and linear-to-709 equations, using the existing numerical bounds. */
export function inspectMotionMaximumPreview(kind: MotionMaximumNativeKind, frame: number, bytes: ArrayLike<number>) {
	const profile = motionMaximumNativeProfile(kind); let maximumPremultipliedCodeError = 0;
	if (bytes.length !== profile.width * profile.height * 4) throw new Error('Maximum preview picture geometry differs.');
	for (let y = 0; y < profile.height; y++) for (let x = 0; x < profile.width; x++) {
		const expected = pixel(kind, frame, x, y), offset = (y * profile.width + x) * 4, alpha = expected[3]!;
		if (bytes[offset + 3] !== Math.round(alpha * 255)) throw new Error(`Maximum preview alpha differs at ${x},${y}.`);
		for (let c = 0; c < 3; c++) {
			const actual = bytes[offset + c]!;
			if (!Number.isInteger(actual) || actual < 0 || actual > 255) throw new Error('Maximum preview contains invalid color codes.');
			const expectedCode = Math.round(255 * encode(alpha ? expected[c]! / alpha : 0, 'srgb'));
			maximumPremultipliedCodeError = Math.max(maximumPremultipliedCodeError, Math.abs(actual - expectedCode) * Math.round(alpha * 255) / 255);
		}
	}
	if (maximumPremultipliedCodeError > 1) throw new Error(`Maximum preview exceeds one premultiplied code: ${maximumPremultipliedCodeError}`);
	return { maximumPremultipliedCodeError };
}
export function inspectMotionMaximumNativePictures(kind: MotionMaximumNativeKind, rgba: Float32Array) {
	const profile = motionMaximumNativeProfile(kind); let maximumColorError = 0, maximumAlphaError = 0;
	if (rgba.length !== profile.width * profile.height * 4 * profile.selectedFrames.length) throw new Error('Maximum native selected picture geometry differs.');
	for (const [selected, index] of profile.selectedFrames.entries()) for (let y = 0; y < profile.height; y++) for (let x = 0; x < profile.width; x++) {
		const expected = pixel(kind, profile.firstFrame + index, x, y), alpha = expected[3]!;
		const offset = (selected * profile.width * profile.height + y * profile.width + x) * 4, actualAlpha = rgba[offset + 3]!;
		if (![rgba[offset], rgba[offset + 1], rgba[offset + 2], actualAlpha].every(value => Number.isFinite(value) && value! >= 0 && value! <= 1)) throw new Error('Maximum native picture contains invalid SDR values.');
		if ((alpha === 0 || alpha === 1) && actualAlpha !== alpha) throw new Error('Maximum native alpha endpoint differs.');
		maximumAlphaError = Math.max(maximumAlphaError, Math.abs(actualAlpha - alpha));
		if (alpha) for (let c = 0; c < 3; c++) maximumColorError = Math.max(maximumColorError, Math.abs(rgba[offset + c]! - encode(expected[c]! / alpha, '709')));
	}
	if (maximumColorError > 8 / 1023 || maximumAlphaError > 2 / 1023) throw new Error(`Maximum native picture exceeds color/alpha bounds: ${maximumColorError},${maximumAlphaError}`);
	return { maximumColorError, maximumAlphaError };
}
