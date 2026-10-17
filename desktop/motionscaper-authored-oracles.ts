/* SPDX-License-Identifier: AGPL-3.0-only */
/** Fixed authored-title acceptance oracles, independent of the menu driver. */
import assert from 'node:assert/strict';
import { encodeMotionChannel, motionSurfaceToRgba8, validateMotionSurface, type MotionSurface } from '../src/common/editor/motion-surface.ts';
import { inspectMotionNativeReference, type MotionNativeReference } from './motionscaper-native-reference.ts';

function reference(surface: MotionSurface): void {
	validateMotionSurface(surface); assert.equal(surface.width, 160); assert.equal(surface.height, 96);
}
export function verifyMotionAuthoredPreview(surface: MotionSurface, actual: readonly number[]): number {
	reference(surface); const expected = motionSurfaceToRgba8(surface, 'srgb'); assert.equal(actual.length, expected.length);
	assert.ok(actual.every(value => Number.isInteger(value) && value >= 0 && value <= 255), 'Invalid canvas bytes.');
	let maximum = 0, whitePixels = 0;
	for (let pixel = 0; pixel < actual.length; pixel += 4) {
		assert.equal(actual[pixel + 3], expected[pixel + 3], 'Preview alpha differs from matching-quality CPU reference.');
		for (let c = 0; c < 3; c++) maximum = Math.max(maximum, Math.abs(actual[pixel + c]! - expected[pixel + c]!) * expected[pixel + 3]! / 255);
		if (actual[pixel]! > 240 && actual[pixel + 1]! > 240 && actual[pixel + 2]! > 240 && actual[pixel + 3] === 255) whitePixels++;
	}
	assert.ok(whitePixels > 50, 'Authored text must produce readable white interior pixels.');
	assert.deepEqual(actual.slice(0, 4), [0, 0, 0, 0]);
	const card = (60 * 160 + 15) * 4; assert.deepEqual(actual.slice(card, card + 4), [74, 128, 255, 255]);
	assert.ok(maximum <= 1, `Canvas premultiplied readback exceeded one 8-bit code: ${String(maximum)}`);
	return maximum;
}
export function verifyMotionAuthoredNative(references: readonly MotionSurface[], decoded: Readonly<{ metadata: MotionNativeReference; rgba: Float32Array; pcm: Float32Array }>) {
	assert.equal(references.length, 2); references.forEach(reference);
	const metadata = inspectMotionNativeReference(decoded.metadata, decoded.rgba.byteLength, decoded.pcm.byteLength);
	assert.deepEqual([metadata.width, metadata.height, metadata.audio], [160, 96, null]); assert.equal(metadata.frames.length, 2);
	for (const [index, time] of metadata.frames.entries()) assert.equal(time.num * 30, index * time.den, 'Authored native timestamps differ.');
	assert.ok(decoded.rgba.every(Number.isFinite), 'Native reference contains nonfinite channels.');
	let maximumRec709ColorError = 0, maximumAlphaError = 0;
	for (const [frame, surface] of references.entries()) for (let pixel = 0; pixel < surface.pixels.length; pixel += 4) {
		const offset = frame * surface.pixels.length + pixel, alpha = surface.pixels[pixel + 3]!, actualAlpha = decoded.rgba[offset + 3]!;
		maximumAlphaError = Math.max(maximumAlphaError, Math.abs(actualAlpha - alpha));
		if (alpha === 0 || alpha === 1) assert.equal(actualAlpha, alpha, 'Native alpha endpoints changed.');
		if (alpha !== 0) for (let c = 0; c < 3; c++) maximumRec709ColorError = Math.max(maximumRec709ColorError,
			Math.abs(decoded.rgba[offset + c]! - encodeMotionChannel(surface.pixels[pixel + c]! / alpha, 'rec709')));
	}
	assert.ok(maximumRec709ColorError <= 8 / 1023, `Native 10-bit RGB boundary exceeded eight code values: ${String(maximumRec709ColorError)}`);
	assert.ok(maximumAlphaError <= 2 / 1023, `Native alpha exceeded two 10-bit input codes: ${String(maximumAlphaError)}`);
	return { maximumRec709ColorError, maximumAlphaError, metadata };
}
