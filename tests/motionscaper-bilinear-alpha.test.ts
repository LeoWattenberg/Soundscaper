/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionSurface, transformMotionSurface, validateMotionSurface } from '../src/common/editor/motion-surface.ts';

test('small stabilization similarity transforms retain bounded opaque alpha after bilinear resampling', () => {
	const source = createMotionSurface(64, 64, [1, 0.5, 0.25, 1]); const retained = source.pixels.slice();
	const output = transformMotionSurface(source, 64, 64, [1.0000099949999501, 0.00010000099983333168, 0, 0,
		-0.00010000099983333168, 1.0000099949999501, 0, 0, 0, 0, 1, 0, -0.02702702702702703, -0.024390243902439025, 0, 1]);
	validateMotionSurface(output); assert.deepEqual(source.pixels, retained);
	assert.equal(output.pixels[(32 * 64 + 32) * 4 + 3], 1);
	for (let i = 0; i < output.pixels.length; i += 4) { assert.equal(output.pixels[i], output.pixels[i + 3]); assert.equal(output.pixels[i + 1], output.pixels[i]! / 2); }
});
