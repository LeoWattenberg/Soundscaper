/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { motionNativePreviewMattePixel } from '../desktop/motionscaper-preview-reference.ts';

test('native Rec.709 reference is composited in linear light and converted to sRGB display bytes', () => {
	// Quantized straight native source values retain their declared Rec.709 transfer.
	assert.deepEqual(motionNativePreviewMattePixel([111 / 255, 47 / 255, 197 / 255, 128 / 255], 'rec709'), new Uint8Array([90, 44, 149, 255]));
	assert.deepEqual(motionNativePreviewMattePixel([111 / 255, 47 / 255, 197 / 255, 0], 'rec709'), new Uint8Array([0, 0, 0, 255]));
	assert.deepEqual(motionNativePreviewMattePixel([0.5, 0.5, 0.5, 1], 'srgb'), new Uint8Array([128, 128, 128, 255]));
	assert.throws(() => motionNativePreviewMattePixel([0, 0, Number.NaN, 1], 'rec709'), /pixel/u);
});
