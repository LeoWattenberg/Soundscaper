/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { selectVideoPreviewPosition } from '../src/common/editor/ui/workspace/use-video-preview-transport-state.js';

function selectionState() {
	return {
		gpuPlaying: false,
		interval: null,
		observedFrame: 0,
		published: { frame: 0 },
	};
}

const intervals = [
	{ timelineStartFrame: 0, timelineEndFrame: 1_000 },
	{ timelineStartFrame: 1_000, timelineEndFrame: 2_000 },
];

function select(selection, positionFrame, overrides = {}) {
	return selectVideoPreviewPosition({
		telemetry: {
			positionFrame,
			transportState: 'playing',
			playbackRate: 1,
			...overrides,
		},
		selection,
		intervals,
		compositorState: 'ready',
		sampleRate: 48_000,
	});
}

test('GPU preview transport publishes entry, interval changes, and explicit seeks only', () => {
	const state = selectionState();
	assert.deepEqual(select(state, 10), { frame: 10 });
	const stable = state.published;
	assert.strictEqual(select(state, 20), stable);
	assert.equal(state.observedFrame, 20);

	assert.deepEqual(select(state, 1_010), { frame: 1_010 });
	const afterIntervalChange = state.published;
	assert.strictEqual(select(state, 1_020), afterIntervalChange);
	assert.deepEqual(select(state, 20_000), { frame: 20_000 });
});

test('fallback and stopped preview transport publish every observed position', () => {
	const state = selectionState();
	const fallback = selectVideoPreviewPosition({
		telemetry: { positionFrame: 20, transportState: 'playing', playbackRate: 1 },
		selection: state,
		intervals,
		compositorState: 'fallback',
		sampleRate: 48_000,
	});
	assert.deepEqual(fallback, { frame: 20 });
	assert.deepEqual(select(state, 30, { transportState: 'stopped' }), { frame: 30 });
});
