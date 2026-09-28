/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { UnifiedExactRenderVisualFrameEntryV13 } from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';
import { renderVideoNoiseRgba } from '../src/common/editor/video-test-image-noise-rgba.ts';
import { createSelectedFinishingNoisePreview } from '../src/framescaper/selected-finishing-noise-preview.ts';

const entry: UnifiedExactRenderVisualFrameEntryV13 = {
	nodeId: 'visual:noise', modelId: 'noise-clip', modelKind: 'noise',
	trackId: 'video-track', opacity: 1, blendMode: 'normal', masks: [],
	authoredState: {
		source: {
			schemaVersion: 1, kind: 'generator', id: 'noise-source', name: 'Noise',
			width: 8, height: 8, frameRate: { num: 30, den: 1 }, frameCount: 10,
			generator: { kind: 'noise', mode: 'color', grainSize: 1, seed: 123 },
		},
		clip: {
			schemaVersion: 1, kind: 'generator', id: 'noise-clip', sourceId: 'noise-source',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10,
		},
	},
};

test('live noise preview paints each output frame once and matches exact seeded pixels', (t) => {
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
	const canvas = { getContext: () => ({
		putImageData(image: Readonly<{ data: Uint8ClampedArray }>) {
			painted.push(Uint8Array.from(image.data));
		},
	}) } as unknown as HTMLCanvasElement;
	const preview = createSelectedFinishingNoisePreview({
		drawables: new Map([[entry.modelId, { drawable: canvas, videoWidth: 8, videoHeight: 8 }]]),
		signal: new AbortController().signal,
	});
	preview.update(entry, 0);
	preview.update(entry, 0);
	preview.update(entry, 1);
	assert.equal(painted.length, 2);
	assert.notDeepEqual(painted[0], painted[1]);
	for (const outputOrdinal of [0, 1]) assert.deepEqual(painted[outputOrdinal],
		renderVideoNoiseRgba({
			mode: 'color', grainSize: 1, seed: 123, width: 8, height: 8, outputOrdinal,
		}).pixels);
	preview.dispose();
});
