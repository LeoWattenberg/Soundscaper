/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { clipSourceSelection } from '../src/common/editor/ui/inspector/clip-source-selection.ts';
const project = { sampleRate: 1000, tempoMap: { mode: 'hold' as const, events: [{ beat: { num: 0, den: 1 }, bpm: 120 }] } };
const clip = { sourceStartFrame: 200, sourceDurationFrames: 200, timelineStartFrame: 800, durationFrames: 200, reversed: true };
const source = { sampleRate: 1000, frameCount: 1000 };

test('reversed source selections on either unused side exclude the clip at the seam', () => {
	assert.deepEqual(clipSourceSelection(project, clip, source, { startFrame: 100, endFrame: 200 }).source, { startFrame: 100, endFrame: 200 });
	assert.deepEqual(clipSourceSelection(project, clip, source, { startFrame: 400, endFrame: 500 }).source, { startFrame: 400, endFrame: 500 });
});
test('a selection inside reversed audio maps exactly to its selected source samples', () => {
	assert.deepEqual(clipSourceSelection(project, clip, source, { startFrame: 250, endFrame: 300 }).source, { startFrame: 300, endFrame: 350 });
});
test('crossing a reversed seam expands the visible selection to the contiguous source range before applying effects', () => {
	assert.deepEqual(clipSourceSelection(project, clip, source, { startFrame: 100, endFrame: 300 }), {
		display: { startFrame: 100, endFrame: 400 }, source: { startFrame: 100, endFrame: 400 },
	});
	assert.deepEqual(clipSourceSelection(project, clip, source, { startFrame: 300, endFrame: 500 }), {
		display: { startFrame: 200, endFrame: 500 }, source: { startFrame: 200, endFrame: 500 },
	});
});
