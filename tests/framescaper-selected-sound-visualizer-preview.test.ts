/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { UnifiedExactRenderVisualFrameEntryV13 } from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';
import {
	createSelectedFinishingSoundVisualizerPreview,
} from '../src/framescaper/selected-finishing-sound-visualizer-preview.ts';

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

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => { resolve = settle; });
	return { promise, resolve };
}

test('live visualizer preview paints idle immediately and discards an old seek result', async (t) => {
	const root = globalThis as unknown as Record<string, unknown>;
	const previousImageData = root.ImageData;
	root.ImageData = class {
		constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
	};
	t.after(() => {
		if (previousImageData === undefined) delete root.ImageData;
		else root.ImageData = previousImageData;
	});
	const painted: Uint8Array[] = [];
	const canvas = {
		getContext: () => ({
			putImageData: (image: Readonly<{ data: Uint8ClampedArray }>) => {
				painted.push(new Uint8Array(image.data));
			},
		}),
	} as unknown as HTMLCanvasElement;
	const reads = [deferred<{ channels: readonly Float32Array[] | null; sampleRate: number;
		windowStartFrame: number; timelineFrame: number }>(), deferred<{ channels: readonly Float32Array[] | null;
		sampleRate: number; windowStartFrame: number; timelineFrame: number }>()];
	let readCount = 0;
	const reader = {
		window: () => reads[readCount++]!.promise,
		dispose() {},
	};
	const preview = createSelectedFinishingSoundVisualizerPreview({
		reader,
		drawables: new Map([[entry.modelId, { drawable: canvas, videoWidth: 32, videoHeight: 24 }]]),
		sampleRate: 1_024,
		signal: new AbortController().signal,
	});
	preview.update(entry, 0, 0);
	assert.equal(painted.length, 1, 'the first preview does not wait for storage');
	preview.update(entry, 1_024, 1);
	assert.equal(readCount, 1, 'playback coalesces overlapping PCM reads');
	const idleAfterSeek = painted.at(-1)!;
	reads[0]!.resolve({ channels: [new Float32Array(1_024)], sampleRate: 1_024,
		windowStartFrame: 0, timelineFrame: 0 });
	await Promise.resolve();
	assert.deepEqual(painted.at(-1), idleAfterSeek, 'a result from before the seek cannot repaint the new frame');
	assert.equal(readCount, 2, 'the latest sample is requested after the stale read settles');
	reads[1]!.resolve({
		channels: [Float32Array.from({ length: 1_024 }, (_, frame) => frame % 2 ? 0.8 : -0.8)],
		sampleRate: 1_024, windowStartFrame: 1_024, timelineFrame: 1,
	});
	await Promise.resolve();
	const active = painted.at(-1)!;
	const waveformPixel = (12 * 32 + 10) * 4;
	assert.deepEqual([...idleAfterSeek.subarray(waveformPixel, waveformPixel + 4)],
		[0, 0, 0, 255], 'the idle frame has no waveform at the sampled column');
	assert.deepEqual([...active.subarray(waveformPixel, waveformPixel + 4)],
		[102, 211, 197, 255], 'matching PCM paints the authored teal waveform');
	preview.dispose();
});
