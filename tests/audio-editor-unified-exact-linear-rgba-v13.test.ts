/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { videoPreviewRenderGeometry } from '../src/common/editor/video-preview-render-description.ts';
import { sampleUnifiedExactRgbaChannelV13 } from '../src/common/editor/unified-exact-rgba-sampling-v13.ts';

import {
	addUnifiedExactLinearDissolveV13,
	compositeUnifiedExactLinearFrameV13,
	createUnifiedExactLinearPremultipliedFrameV13,
	encodeUnifiedExactLinearFrameV13,
	placeUnifiedExactLinearRgbaFrameV13,
} from '../src/common/editor/unified-exact-linear-rgba-v13.ts';

test('straight 50-percent alpha is premultiplied once and composited in linear light', () => {
	const backdrop = createUnifiedExactLinearPremultipliedFrameV13(1, 1, [0, 0, 1, 1]);
	const source = placeUnifiedExactLinearRgbaFrameV13({
		frame: { width: 1, height: 1, pixels: Uint8Array.of(255, 0, 0, 128) },
		displayWidth: 1, displayHeight: 1, outputWidth: 1, outputHeight: 1,
		renderDescription: description(1),
	});
	assert.ok(Math.abs(source.pixels[0]! - 128 / 255) < 1e-12);
	compositeUnifiedExactLinearFrameV13(backdrop, source, 'normal');
	const encoded = encodeUnifiedExactLinearFrameV13(backdrop, 'srgb');
	assert.ok(encoded[0]! >= 187 && encoded[0]! <= 188);
	assert.ok(encoded[2]! >= 187 && encoded[2]! <= 188);
	assert.equal(encoded[3], 255);
});

test('a canonical half dissolve adds graded premultiplied layers before one output encode', () => {
	const target = createUnifiedExactLinearPremultipliedFrameV13(1, 1);
	for (const pixels of [Uint8Array.of(255, 0, 0, 255), Uint8Array.of(0, 255, 0, 255)]) {
		addUnifiedExactLinearDissolveV13(target, placeUnifiedExactLinearRgbaFrameV13({
			frame: { width: 1, height: 1, pixels },
			displayWidth: 1, displayHeight: 1, outputWidth: 1, outputHeight: 1,
			renderDescription: description(0.5),
		}));
	}
	const encoded = encodeUnifiedExactLinearFrameV13(target, 'srgb');
	assert.ok(encoded[0]! >= 187 && encoded[0]! <= 188);
	assert.ok(encoded[1]! >= 187 && encoded[1]! <= 188);
	assert.equal(encoded[2], 0);
	assert.equal(encoded[3], 255);
});

test('placement applies masks to alpha without changing straight color', () => {
	const placed = placeUnifiedExactLinearRgbaFrameV13({
		frame: { width: 2, height: 1, pixels: Uint8Array.of(
			255, 255, 255, 255, 255, 255, 255, 255,
		) },
		displayWidth: 2, displayHeight: 1, outputWidth: 2, outputHeight: 1,
		renderDescription: description(1, 2, 1), mask: Uint8Array.of(255, 0),
	});
	assert.deepEqual([...placed.pixels], [1, 1, 1, 1, 0, 0, 0, 0]);
});

test('exact placement agrees byte-for-byte with the canonical bilinear oracle across affine crops and alpha masks', () => {
	const frame = { width: 7, height: 5, pixels: Uint8Array.from(
		{ length: 7 * 5 * 4 }, (_unused, index) => (index * 37 + 11) % 256,
	) };
	for (const transform of [
		[1, 0, 0, 1, 0, 0], [1.3, 0, 0, 0.8, 0.3, -0.2],
		[0.8, 0.4, -0.4, 0.8, 2, -1], [-1, 0, 0, 1, 7, 0],
	]) {
		const renderDescription = { ...description(0.7, 7, 5), sourceDisplayToCanvas: transform,
			crop: { normalized: { left: 0.1, top: 0, right: 0.1, bottom: 0 },
				sourcePixels: { x: 0.7, y: 0, width: 5.6, height: 5 } } };
		const mask = Uint8Array.from({ length: 9 * 6 }, (_unused, index) => (index * 29) % 256);
		const actual = placeUnifiedExactLinearRgbaFrameV13({
			frame, displayWidth: 7, displayHeight: 5, outputWidth: 9, outputHeight: 6,
			renderDescription, opacity: 0.8, mask,
		});
		const geometry = videoPreviewRenderGeometry(renderDescription, {
			canvasWidth: 9, canvasHeight: 6, sourceDisplayWidth: 7, sourceDisplayHeight: 5,
			intervalProgress: 0,
		});
		const expected = new Float64Array(9 * 6 * 4);
		const [a, b, c, d, e, f] = geometry.sourceDisplayToCanvas;
		const determinant = a * d - b * c;
		const crop = geometry.sourcePixels;
		for (let y = 0; y < 6; y += 1) for (let x = 0; x < 9; x += 1) {
			const dx = x + 0.5 - e;
			const dy = y + 0.5 - f;
			const sx = (d * dx - c * dy) / determinant;
			const sy = (-b * dx + a * dy) / determinant;
			if (sx < crop.x || sy < crop.y || sx >= crop.x + crop.width || sy >= crop.y + crop.height) continue;
			const rgba = [0, 1, 2, 3].map((channel) => sampleUnifiedExactRgbaChannelV13(
				frame, sx * frame.width / 7 - 0.5, sy * frame.height / 5 - 0.5, channel,
			) / 255);
			const pixel = y * 9 + x;
			const alpha = rgba[3]! * (geometry.opacity * 0.8) * (mask[pixel]! / 255);
			for (let channel = 0; channel < 3; channel += 1) expected[pixel * 4 + channel] = rgba[channel]! * alpha;
			expected[pixel * 4 + 3] = alpha;
		}
		assert.deepEqual(actual.pixels, expected);
	}
});

function description(opacity: number, width = 1, height = 1) {
	return {
		crop: {
			normalized: { left: 0, top: 0, right: 0, bottom: 0 },
			sourcePixels: { x: 0, y: 0, width, height },
		},
		sourceDisplayToCanvas: [1, 0, 0, 1, 0, 0],
		opacityStart: opacity, opacityEnd: opacity,
		blendMode: 'normal', compositingOrder: 0,
	};
}
