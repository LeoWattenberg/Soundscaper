/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionSurface } from '../src/common/editor/motion-surface.ts';
import { motionVideoI420Pixels } from '../src/common/editor/motion-video-planar.ts';

test('Motion video uses explicit limited-range BT709 luma and chroma code points', () => {
	for (const [color, expected] of [
		[[0, 0, 0, 1], [16, 128, 128]], [[1, 1, 1, 1], [235, 128, 128]],
		[[1, 0, 0, 1], [63, 102, 240]], [[0, 1, 0, 1], [173, 42, 26]], [[0, 0, 1, 1], [32, 240, 118]],
	] as const) assert.deepEqual([...motionVideoI420Pixels(createMotionSurface(1, 1, color), [0, 0, 0])], expected);
	assert.deepEqual([...motionVideoI420Pixels(createMotionSurface(1, 1, [1, 0, 0, 0.5]), [0, 0, 1])], [60, 189, 200]);
});

test('Motion I420 averages chroma in encoded coordinates and retains odd canvas edges', () => {
	const surface = createMotionSurface(2, 2);
	surface.pixels.set([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1]);
	assert.deepEqual([...motionVideoI420Pixels(surface, [0, 0, 0])], [63, 173, 32, 235, 128, 128]);
	const odd = createMotionSurface(3, 1); odd.pixels.set(surface.pixels.subarray(0, 12));
	assert.deepEqual([...motionVideoI420Pixels(odd, [0, 0, 0])], [63, 173, 32, 72, 240, 133, 118]);
	assert.throws(() => motionVideoI420Pixels(surface, [0, Number.NaN, 0]), /background/u);
});
