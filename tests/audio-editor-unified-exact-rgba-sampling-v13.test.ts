/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sampleUnifiedExactRgbaChannelV13 } from '../src/common/editor/unified-exact-rgba-sampling-v13.ts';

const frame = Object.freeze({
	width: 2,
	height: 2,
	pixels: new Uint8Array([
		0, 1, 2, 3, 100, 4, 5, 6,
		200, 7, 8, 9, 255, 10, 11, 12,
	]),
});

test('V13 RGBA sampling bilinearly interpolates and clamps every canvas edge', () => {
	assert.equal(sampleUnifiedExactRgbaChannelV13(frame, -1, -1, 0), 0);
	assert.equal(sampleUnifiedExactRgbaChannelV13(frame, 8, 8, 0), 255);
	assert.equal(sampleUnifiedExactRgbaChannelV13(frame, 0.5, 0.5, 0), 138.75);
	assert.equal(sampleUnifiedExactRgbaChannelV13(frame, 0.5, -8, 0), 50);
	assert.equal(sampleUnifiedExactRgbaChannelV13(frame, -8, 0.5, 0), 100);
});
