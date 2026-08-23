/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

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
