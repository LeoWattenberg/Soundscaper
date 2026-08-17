/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createMasteringSequenceV23 } from '../src/common/editor/mastering-sequence.ts';
import { createMasteringSequenceDeliveryPlan } from '../src/common/editor/mastering-sequence-delivery.ts';
import { renderMasteringSequenceDelivery } from '../src/common/editor/mastering-sequence-render.ts';

const REGIONS = [
	{ id: 'a', sequenceId: 'main', name: 'One', startFrame: 0, endFrame: 8 },
	{ id: 'b', sequenceId: 'main', name: 'Two', startFrame: 100, endFrame: 104 },
];

const plan = (entries: readonly unknown[]) => createMasteringSequenceDeliveryPlan(
	createMasteringSequenceV23({ id: 'album', sequenceId: 'main', name: 'Album', entries }),
	REGIONS,
);

const filled = (length: number, value = 1) => Float32Array.from({ length }, () => value);

test('regions land at their planned positions with silence in the gaps', () => {
	const delivery = plan([
		{ id: 'e1', annotationId: 'a' },
		{ id: 'e2', annotationId: 'b', gapBeforeFrames: 3 },
	]);
	const [channel] = renderMasteringSequenceDelivery({
		plan: delivery,
		channelCount: 1,
		segments: [
			{ entryId: 'e1', channels: [filled(8, 0.5)] },
			{ entryId: 'e2', channels: [filled(4, 0.25)] },
		],
	});
	assert.equal(channel.length, 15, '8 + 3 gap + 4');
	assert.deepEqual([...channel], [
		0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
		0, 0, 0,
		0.25, 0.25, 0.25, 0.25,
	]);
});

test('a lead-in gap is real silence at the head of the delivery', () => {
	const [channel] = renderMasteringSequenceDelivery({
		plan: plan([{ id: 'e1', annotationId: 'a', gapBeforeFrames: 2 }]),
		channelCount: 1,
		segments: [{ entryId: 'e1', channels: [filled(8)] }],
	});
	assert.deepEqual([...channel.subarray(0, 2)], [0, 0]);
	assert.equal(channel.length, 10);
});

test('fades are applied to the delivery, and the shortest one still reaches silence', () => {
	const [channel] = renderMasteringSequenceDelivery({
		plan: plan([{ id: 'e1', annotationId: 'a', fadeInFrames: 4, fadeOutFrames: 4 }]),
		channelCount: 1,
		segments: [{ entryId: 'e1', channels: [filled(8)] }],
	});
	assert.equal(channel[0], 0, 'a fade-in starts at silence');
	assert.equal(channel[7], 0, 'a fade-out ends at silence');
	assert.ok(channel[1] > 0 && channel[1] < 1);
	// Monotonic in, monotonic out.
	for (let frame = 1; frame < 4; frame += 1) assert.ok(channel[frame] > channel[frame - 1]);
	for (let frame = 5; frame < 8; frame += 1) assert.ok(channel[frame] < channel[frame - 1]);

	const [oneFrame] = renderMasteringSequenceDelivery({
		plan: plan([{ id: 'e1', annotationId: 'a', fadeInFrames: 1 }]),
		channelCount: 1,
		segments: [{ entryId: 'e1', channels: [filled(8)] }],
	});
	assert.equal(oneFrame[0], 0, 'a one-frame fade is audible rather than a no-op');
	assert.equal(oneFrame[1], 1);
});

test('a region delivered twice can carry different fades, and the source is untouched', () => {
	// Fades belong to the delivery, not the project, which is what makes a reprise
	// with a different treatment expressible at all.
	const delivery = plan([
		{ id: 'e1', annotationId: 'a' },
		{ id: 'e2', annotationId: 'a', fadeOutFrames: 8 },
	]);
	const source = filled(8);
	const [channel] = renderMasteringSequenceDelivery({
		plan: delivery,
		channelCount: 1,
		segments: [
			{ entryId: 'e1', channels: [source] },
			{ entryId: 'e2', channels: [source] },
		],
	});
	assert.deepEqual([...channel.subarray(0, 8)], Array.from({ length: 8 }, () => 1));
	assert.ok(channel[15] < channel[8], 'the second copy fades and the first does not');
	assert.deepEqual([...source], Array.from({ length: 8 }, () => 1), 'the rendered region is not mutated');
});

test('every channel is delivered, and a missing one is refused', () => {
	const [left, right] = renderMasteringSequenceDelivery({
		plan: plan([{ id: 'e1', annotationId: 'a' }]),
		channelCount: 2,
		segments: [{ entryId: 'e1', channels: [filled(8, 0.5), filled(8, -0.5)] }],
	});
	assert.equal(left[0], 0.5);
	assert.equal(right[0], -0.5);

	assert.throws(() => renderMasteringSequenceDelivery({
		plan: plan([{ id: 'e1', annotationId: 'a' }]),
		channelCount: 2,
		segments: [{ entryId: 'e1', channels: [filled(8)] }],
	}), /missing a channel/u);
});

test('a segment of the wrong length is refused rather than padded', () => {
	// Padding would slide every later entry, turning a render bug into a delivery
	// whose cues no longer point at its own audio.
	assert.throws(() => renderMasteringSequenceDelivery({
		plan: plan([{ id: 'e1', annotationId: 'a' }]),
		channelCount: 1,
		segments: [{ entryId: 'e1', channels: [filled(7)] }],
	}), /rendered 7 frames, not 8/u);
});

test('an unrendered entry is a reference error, not silence', () => {
	assert.throws(() => renderMasteringSequenceDelivery({
		plan: plan([{ id: 'e1', annotationId: 'a' }, { id: 'e2', annotationId: 'b' }]),
		channelCount: 1,
		segments: [{ entryId: 'e1', channels: [filled(8)] }],
	}), /e2 was not rendered/u);
});

test('an empty sequence delivers an empty buffer of the right width', () => {
	const channels = renderMasteringSequenceDelivery({
		plan: plan([]), channelCount: 2, segments: [],
	});
	assert.equal(channels.length, 2);
	assert.equal(channels[0].length, 0);
});
