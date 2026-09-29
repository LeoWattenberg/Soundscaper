/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { materializeUnifiedExactRenderVisualEntryV13 } from '../src/common/editor/unified-exact-render-visual-materializer-v13.ts';
import type { UnifiedExactRenderVisualFrameEntryV13 } from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';

const entry: UnifiedExactRenderVisualFrameEntryV13 = {
	nodeId: 'visual:visualizer', modelId: 'visualizer-clip', modelKind: 'sound-visualizer',
	trackId: 'video-track', opacity: 1, blendMode: 'normal', masks: [],
	authoredState: {
		source: {
			schemaVersion: 1, kind: 'generator', id: 'visualizer-source', name: 'Visualizer',
			width: 32, height: 24, frameRate: { num: 25, den: 1 }, frameCount: 10,
			generator: {
				kind: 'sound-visualizer', mode: 'waveform', sourceIds: [],
				windowSeconds: 1, foregroundColor: '#66d3c5ff', backgroundColor: '#000000ff',
			},
		},
		clip: {
			schemaVersion: 1, kind: 'generator', id: 'visualizer-clip', sourceId: 'visualizer-source',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10,
		},
	},
};

function pixel(pixels: Uint8Array, x: number, y: number): number[] {
	const offset = (y * 32 + x) * 4;
	return Array.from(pixels.subarray(offset, offset + 4));
}

test('sound visualizer materialization consumes the supplied audio window and exact output ordinal', async () => {
	const channels = [Float32Array.from({ length: 1_024 }, (_, frame) => frame % 2 ? 0.8 : -0.8)];
	const first = await materializeUnifiedExactRenderVisualEntryV13(entry, {
		targetWidth: 32, targetHeight: 24,
		soundVisualizer: { channels, sampleRate: 1_024, windowStartFrame: 0, timelineFrame: 0 },
	});
	const second = await materializeUnifiedExactRenderVisualEntryV13(entry, {
		targetWidth: 32, targetHeight: 24,
		soundVisualizer: { channels, sampleRate: 1_024, windowStartFrame: 1, timelineFrame: 1 },
	});
	assert.equal(first.pixels.length, 32 * 24 * 4);
	assert.deepEqual(pixel(first.pixels, 10, 12), [102, 211, 197, 255],
		'the waveform uses the authored teal foreground');
	assert.deepEqual(pixel(first.pixels, 10, 0), [0, 0, 0, 255],
		'the unpainted area uses the authored black background');
	assert.deepEqual(pixel(first.pixels, 0, 0), [255, 255, 255, 255]);
	assert.deepEqual(pixel(second.pixels, 1, 0), [255, 255, 255, 255]);
	assert.notDeepEqual(first.pixels, second.pixels);
});

test('a Project Bin sound visualizer thumbnail has an animated idle first frame', async () => {
	const thumbnail = await materializeUnifiedExactRenderVisualEntryV13(entry, {
		targetWidth: 32, targetHeight: 24,
	});
	assert.equal(thumbnail.pixels.length, 32 * 24 * 4);
	assert.deepEqual(pixel(thumbnail.pixels, 8, 0), [0, 0, 0, 255]);
	assert.deepEqual(pixel(thumbnail.pixels, 0, 0), [255, 255, 255, 255],
		'the idle marker remains visible on the first frame');
});
