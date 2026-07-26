import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorAnalysisVisuals } from '../src/common/editor/controller/analysis-visuals.ts';

test('analysis visuals mix a centered spectrum and bounded mono overview', () => {
	const left = Float32Array.from({ length: 200_000 }, (_, index) => index % 11 / 10);
	const right = Float32Array.from({ length: 200_000 }, (_, index) => -(index % 7) / 10);
	const visuals = createEditorAnalysisVisuals([left, right], 48_000);

	assert.equal(visuals.spectrum.samples.length, 16_384);
	assert.equal(visuals.spectrum.startFrame, Math.floor((200_000 - 16_384) / 2));
	assert.equal(visuals.overview.samples.length <= 131_072, true);
	assert.equal(visuals.overview.sampleRate, 24_000);
	assert.equal(visuals.overview.step, 2);
	assert.equal(visuals.overview.samples[0], 0);
});

test('analysis visuals safely represent empty channel input', () => {
	const visuals = createEditorAnalysisVisuals([], 44_100);
	assert.equal(visuals.spectrum.samples.length, 0);
	assert.equal(visuals.overview.samples.length, 0);
	assert.equal(visuals.spectrum.sampleRate, 44_100);
});
