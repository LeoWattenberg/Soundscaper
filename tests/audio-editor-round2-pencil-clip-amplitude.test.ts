/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { samplePointAtPointer } from '../src/common/editor/ui/timeline/track-row-helpers.jsx';

interface PencilClip {
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly gain?: number;
	readonly inverted?: boolean;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
	readonly envelope?: readonly Readonly<{ frame: number; value: number }>[];
}

function pencil(clip: PencilClip, amplitude = 0.25, frame = 150): number {
	const lane = { dataset: {}, getBoundingClientRect: () => ({ top: 0, height: 100 }) };
	return samplePointAtPointer({ clientX: 10, clientY: (1 - amplitude) * 50 }, lane,
		clip, { channelCount: 1 }, () => frame).value;
}

test('Pencil stores the source polarity that draws at the requested visible amplitude', () => {
	assert.equal(pencil({ timelineStartFrame: 100, durationFrames: 100, inverted: true }), -0.25);
	assert.equal(pencil({ timelineStartFrame: 100, durationFrames: 100, gain: 2, inverted: true }), -0.125);
});

test('Pencil removes the rendered clip gain, fades and envelope before writing source PCM', () => {
	const clip = { timelineStartFrame: 100, durationFrames: 100, gain: 2, fadeInFrames: 100,
		fadeOutFrames: 100, envelope: [{ frame: 0, value: 0.5 }, { frame: 100, value: 0.5 }] };
	assert.equal(pencil(clip, 0.125), 0.5);
	assert.equal(pencil({ ...clip, inverted: true }, -0.125), 0.5);
});

test('Pencil writes the nearest attainable source amplitude for quiet or silent clip regions', () => {
	assert.equal(pencil({ timelineStartFrame: 100, durationFrames: 100, gain: 0.125 }), 1);
	assert.equal(pencil({ timelineStartFrame: 100, durationFrames: 100, gain: 0 }), 0);
	assert.equal(pencil({ timelineStartFrame: 100, durationFrames: 100, fadeInFrames: 50 }, 0.25, 100), 0);
});
