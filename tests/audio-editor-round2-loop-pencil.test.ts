/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPencilSampleEdits } from '../src/common/editor/sample-edit.js';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';

const source = createAudioSource({ id: 'cycle', frameCount: 192, channelCount: 1, sampleRate: 48_000 });
const clip = { id: 'loop', sourceId: source.id, timelineStartFrame: 100, sourceStartFrame: 32,
	sourceDurationFrames: 96, durationFrames: 288,
	opaqueExtensions: { 'org.soundscaper.clip-loop/v1': { periodFrames: 96, offsetFrames: 0 } } };

test('pencil points address loop phase rather than stretching the source across all repeats', () => {
	for (const reversed of [false, true]) {
		const edits = createPencilSampleEdits({ clip: { ...clip, reversed }, source,
			points: [{ timelineFrame: 100 + 96 + 32, value: 0.5 }] });
		assert.deepEqual(edits, [{ channel: 0, frame: reversed ? 95 : 64, value: 0.5 }]);
	}
});

test('a pencil stroke crossing a loop boundary only interpolates its continuous short path', () => {
	const edits = createPencilSampleEdits({ clip, source, points: [
		{ timelineFrame: 100 + 95, value: -1 }, { timelineFrame: 100 + 97, value: 1 },
	] });
	assert.deepEqual(edits, [
		{ channel: 0, frame: 32, value: 0 }, { channel: 0, frame: 33, value: 1 },
		{ channel: 0, frame: 127, value: -1 },
	]);
});

test('a split loop pencil honors its nonzero loop phase and stretched period', () => {
	const shifted = { ...clip, opaqueExtensions: { 'org.soundscaper.clip-loop/v1': { periodFrames: 192, offsetFrames: 64 } } };
	assert.deepEqual(createPencilSampleEdits({ clip: shifted, source,
		points: [{ timelineFrame: 100 + 192 + 16, value: 0.25 }] }), [{ channel: 0, frame: 72, value: 0.25 }]);
});
