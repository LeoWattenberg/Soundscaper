/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { materializeUnifiedExactRenderVisualEntryV13 } from '../src/common/editor/unified-exact-render-visual-materializer-v13.ts';
import type { UnifiedExactRenderVisualFrameEntryV13 } from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';
import {
	renderVideoNoiseRgba,
	renderVideoTestImageRgba,
} from '../src/common/editor/video-test-image-noise-rgba.ts';

function pixel(frame: Readonly<{ width: number; pixels: Uint8Array }>, x: number, y: number): number[] {
	return Array.from(frame.pixels.subarray((y * frame.width + x) * 4, (y * frame.width + x + 1) * 4));
}

test('color bars have eight exact opaque calibration colors', () => {
	const frame = renderVideoTestImageRgba({ pattern: 'color-bars', width: 8, height: 2 });
	assert.deepEqual(Array.from({ length: 8 }, (_, x) => pixel(frame, x, 0)), [
		[255, 255, 255, 255], [255, 255, 0, 255], [0, 255, 255, 255], [0, 255, 0, 255],
		[255, 0, 255, 255], [255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 0, 255],
	]);
	assert.deepEqual(pixel(frame, 3, 1), pixel(frame, 3, 0));
});

test('grayscale ramp spans black through white', () => {
	const frame = renderVideoTestImageRgba({ pattern: 'grayscale-ramp', width: 3, height: 1 });
	assert.deepEqual(pixel(frame, 0, 0), [0, 0, 0, 255]);
	assert.deepEqual(pixel(frame, 1, 0), [128, 128, 128, 255]);
	assert.deepEqual(pixel(frame, 2, 0), [255, 255, 255, 255]);
});

test('alignment grid marks the image center and preserves an opaque field', () => {
	const frame = renderVideoTestImageRgba({ pattern: 'alignment-grid', width: 24, height: 24 });
	assert.deepEqual(pixel(frame, 12, 12), [255, 64, 64, 255]);
	assert.deepEqual(pixel(frame, 0, 3), [224, 224, 224, 255]);
	assert.deepEqual(pixel(frame, 3, 3), [24, 24, 24, 255]);
});

test('placed test images use the exact visual materializer and their selected pattern', async () => {
	const entry: UnifiedExactRenderVisualFrameEntryV13 = {
		nodeId: 'visual:test-image', modelId: 'test-image-clip', modelKind: 'test-image',
		trackId: 'video-track', opacity: 1, blendMode: 'normal', masks: [],
		authoredState: {
			source: {
				schemaVersion: 1, kind: 'generator', id: 'test-image-source', name: 'Test Image',
				width: 8, height: 2, frameRate: { num: 30, den: 1 }, frameCount: 10,
				generator: { kind: 'test-image', pattern: 'grayscale-ramp' },
			},
			clip: {
				schemaVersion: 1, kind: 'generator', id: 'test-image-clip', sourceId: 'test-image-source',
				sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
				sourceInFrame: 0, sourceFrameCount: 10,
			},
		},
	};
	const frame = await materializeUnifiedExactRenderVisualEntryV13(entry, {
		targetWidth: 8, targetHeight: 2, outputOrdinal: 99,
	});
	assert.deepEqual(pixel(frame, 0, 0), [0, 0, 0, 255]);
	assert.deepEqual(pixel(frame, 7, 1), [255, 255, 255, 255]);
});

test('noise is deterministic for a seed and frame and changes at every adjacent frame', () => {
	const request = { mode: 'monochrome' as const, grainSize: 4, seed: 123, width: 16, height: 8 };
	const first = renderVideoNoiseRgba({ ...request, outputOrdinal: 255 });
	const same = renderVideoNoiseRgba({ ...request, outputOrdinal: 255 });
	const next = renderVideoNoiseRgba({ ...request, outputOrdinal: 256 });
	assert.deepEqual(first.pixels, same.pixels);
	assert.notDeepEqual(first.pixels, next.pixels);
	assert.deepEqual(pixel(first, 0, 0).slice(0, 3), [255, 255, 255]);
	assert.deepEqual(pixel(next, 0, 0).slice(0, 3), [0, 0, 0]);
	assert.deepEqual(pixel(first, 0, 0), pixel(first, 1, 1), 'the changing reference grain remains one block');
	assert.deepEqual(pixel(first, 1, 1), pixel(first, 3, 3), 'a grain block shares one value');
	assert.deepEqual([pixel(first, 4, 0), pixel(first, 8, 0)],
		[[247, 247, 247, 255], [65, 65, 65, 255]], 'seeded blocks have exact distinct values');
});

test('one-pixel color noise still animates with no source media', () => {
	const frame = (outputOrdinal: number) => renderVideoNoiseRgba({
		mode: 'color', grainSize: 1, seed: 0, width: 1, height: 1, outputOrdinal,
	});
	assert.deepEqual(pixel(frame(0), 0, 0), [0, 31, 193, 255]);
	assert.deepEqual(pixel(frame(1), 0, 0), [1, 33, 221, 255]);
	assert.deepEqual(pixel(frame(255), 0, 0), [255, 28, 102, 255]);
	assert.deepEqual(pixel(frame(256), 0, 0), [0, 139, 231, 255]);
});

test('noise rejects invalid output ordinals and generation dimensions', () => {
	assert.throws(() => renderVideoNoiseRgba({
		mode: 'color', grainSize: 1, seed: 1, width: 1, height: 1, outputOrdinal: -1,
	}), /ordinal/u);
	assert.throws(() => renderVideoTestImageRgba({
		pattern: 'color-bars', width: 0, height: 1,
	}), /width/u);
});
