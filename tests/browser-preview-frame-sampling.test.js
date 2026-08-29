/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { waitForPreviewFrameSample } from './browser/helpers/preview-frame-sampling.js';

function harness() {
	const scope = {
		__soundscaperPreviewFrameTimes: [],
		__soundscaperMeasurePreviewFrames: true,
	};
	const transportButton = {
		playing: true,
		getAttribute: () => transportButton.playing ? 'true' : 'false',
	};
	return {
		scope,
		transportButton,
		canvas: { ownerDocument: { defaultView: scope } },
	};
}

test('frame sampling returns an exact bounded sample and disables instrumentation', async () => {
	const { scope, transportButton, canvas } = harness();
	const reading = waitForPreviewFrameSample(canvas, {
		transportButton,
		frameCount: 3,
		pollIntervalMs: 1,
		stallTimeoutMs: 100,
	});
	scope.__soundscaperPreviewFrameTimes.push(10, 20, 30, 40);

	assert.deepEqual(await reading, [10, 20, 30]);
	assert.equal(scope.__soundscaperMeasurePreviewFrames, false);
	assert.deepEqual(scope.__soundscaperPreviewFrameTimes, []);
});

test('frame sampling reports retained undersampling as soon as transport ends', async () => {
	const { scope, transportButton, canvas } = harness();
	const reading = waitForPreviewFrameSample(canvas, {
		transportButton,
		frameCount: 3,
		pollIntervalMs: 1,
		stallTimeoutMs: 100,
	});
	scope.__soundscaperPreviewFrameTimes.push(10, 20);
	transportButton.playing = false;

	await assert.rejects(reading, /stopped with 2 of 3 required final-frame draws/iu);
	assert.equal(scope.__soundscaperMeasurePreviewFrames, false);
});

test('frame sampling reports retained undersampling when compositor progress stalls', async () => {
	const { scope, transportButton, canvas } = harness();
	scope.__soundscaperPreviewFrameTimes.push(10, 20);
	const reading = waitForPreviewFrameSample(canvas, {
		transportButton,
		frameCount: 3,
		pollIntervalMs: 1,
		stallTimeoutMs: 5,
	});

	await assert.rejects(reading, /stalled with 2 of 3 required final-frame draws/iu);
	assert.equal(scope.__soundscaperMeasurePreviewFrames, false);
});
