/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { samplePointAtPointer } from '../src/common/editor/ui/timeline/track-row-helpers.jsx';
import { createPencilSampleEdits } from '../src/common/editor/sample-edit.js';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createImmutablePcmChunks, editImmutablePcmSamples, readImmutablePcmRange }
	from '../src/common/editor/pcm-chunks.js';

for (const count of [3, 6, 8]) test(`Pencil on the displayed right lane edits only native channel 1 of ${String(count)}`, () => {
	const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Recording',
		frameCount: 96, channelCount: count, sampleRate: 48_000, originalSampleRate: 48_000 });
	const clip = { id: 'clip', sourceId: source.id, timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: 96, durationFrames: 96 };
	const lane = { dataset: { channelBodyTop: '20', channelHeightRatio: '0.5' },
		getBoundingClientRect: () => ({ top: 10, height: 180 }) };
	const point = samplePointAtPointer({ clientX: 32, clientY: 130 }, lane, clip, source, () => 32);
	const original = Array.from({ length: count }, () => new Float32Array(96));
	const edits = createPencilSampleEdits({ clip, source, channel: point.channel, points: [point] });
	const output = readImmutablePcmRange(editImmutablePcmSamples(createImmutablePcmChunks(original), edits).pcm);
	assert.equal(point.channel, 1);
	assert.equal(output[1]![32], 0.5);
	for (let channel = 0; channel < count; channel += 1) {
		for (let frame = 0; frame < 96; frame += 1) {
			assert.equal(output[channel]![frame], channel === 1 && frame === 32 ? 0.5 : 0);
		}
	}
	assert.ok(original.every(channel => channel.every(sample => sample === 0)), 'immutable source stays intact');
});

test('a multichannel pencil stroke retains the visible asymmetric stereo split and locked channel', () => {
	const lane = { dataset: { channelBodyTop: '20', channelHeightRatio: '0.25' },
		getBoundingClientRect: () => ({ top: 0, height: 120 }) };
	const clip = { timelineStartFrame: 0, durationFrames: 96 };
	const source = { channelCount: 6 };
	const left = samplePointAtPointer({ clientX: 10, clientY: 30 }, lane, clip, source, () => 32);
	assert.equal(left.channel, 0); assert.ok(Math.abs(left.value - 0.2) < 1e-12);
	const right = samplePointAtPointer({ clientX: 10, clientY: 63.75 }, lane, clip, source, () => 32);
	assert.equal(right.channel, 1); assert.equal(right.value, 0.5);
	const dragged = samplePointAtPointer({ clientX: 10, clientY: 30 }, lane, clip, source, () => 33, right.channel);
	assert.equal(dragged.channel, 1); assert.equal(dragged.value, 1);
});
