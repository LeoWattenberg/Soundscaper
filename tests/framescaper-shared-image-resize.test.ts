/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { scaleFramescaperImageRgbaTimelineImage } from '../src/framescaper/editor-selected-timeline-image-image-frame-source.ts';

test('Frame preview extraction preserves its independent sample golden and detached output', () => {
	const input = Uint8Array.from([1, 11, 21, 255, 2, 12, 22, 128, 3, 13, 23, 64, 4, 14, 24, 0]);
	assert.deepEqual(Array.from(scaleFramescaperImageRgbaTimelineImage(input, 2, 2, 1, 2)), [1, 11, 21, 255, 3, 13, 23, 64]);
	const output = scaleFramescaperImageRgbaTimelineImage(input, 2, 2, 2, 2); output.fill(0);
	assert.equal(input[0], 1);
});

test('Frame keeps its exact legacy dimension, output ceiling, RGBA geometry and abort refusals', () => {
	assert.throws(() => scaleFramescaperImageRgbaTimelineImage(new Uint8Array(4), 0, 1, 1, 1), /timelineImage image source width must be a positive bounded dimension/u);
	assert.throws(() => scaleFramescaperImageRgbaTimelineImage(new Uint8Array(4), 1, 1, 8192, 8192), /at most 33554432 pixels/u);
	assert.throws(() => scaleFramescaperImageRgbaTimelineImage(new Uint8Array(4), 2, 1, 1, 1), /RGBA bytes do not match/u);
	const controller = new AbortController(), reason = new Error('stop Frame picture'); controller.abort(reason);
	assert.throws(() => scaleFramescaperImageRgbaTimelineImage(new Uint8Array(4), 1, 1, 1, 1, controller.signal), error => error === reason);
});
