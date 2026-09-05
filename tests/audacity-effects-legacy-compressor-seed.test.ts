/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyLegacyCompressorChannel } from '../src/common/editor/audacity-effects/basic-dynamics.js';

const SAMPLE_RATE = 48_000;
// Audacity seeds its follower from the first processing buffer only, and
// TwoPassSimpleMono sizes that buffer at most GetMaxBlockSize() frames, which
// is Sequence::sMaxDiskBlockSize / 4 = 262144 frames for float32 storage.
const SEED_SCAN_FRAMES = 262_144;
const FRAME_COUNT = 400_000;
const BURST_FRAMES = 4_800;
const SETTINGS = Object.freeze({
	thresholdDb: -12,
	noiseFloorDb: -40,
	ratio: 2,
	attackSeconds: 0.1,
	releaseSeconds: 1,
	usePeak: true,
});

function tone(): Float32Array {
	const channel = new Float32Array(FRAME_COUNT);
	for (let index = 0; index < FRAME_COUNT; index += 1) {
		channel[index] = 0.1 * Math.sin(2 * Math.PI * 440 * index / SAMPLE_RATE);
	}
	return channel;
}

function withBurstAt(start: number): Float32Array {
	const channel = tone();
	for (let index = start; index < start + BURST_FRAMES; index += 1) {
		channel[index] = index % 2 === 0 ? 1 : -1;
	}
	return channel;
}

function render(channel: Float32Array): Float32Array {
	return applyLegacyCompressorChannel(channel, SAMPLE_RATE, SETTINGS) as Float32Array;
}

test('a peak past the first Audacity block never reaches the head of the selection', () => {
	const burstStart = 336_000;
	assert.ok(burstStart > SEED_SCAN_FRAMES, 'the burst must sit beyond the seed window');
	const clean = render(tone());
	const late = render(withBurstAt(burstStart));

	let worstIndex = 0;
	let worstDifference = 0;
	for (let index = 0; index < SAMPLE_RATE; index += 1) {
		const difference = Math.abs(clean[index]! - late[index]!);
		if (difference > worstDifference) {
			worstDifference = difference;
			worstIndex = index;
		}
	}
	assert.ok(
		worstDifference < 1e-6,
		`material ${burstStart} frames in changed the opening second by ${worstDifference} at sample ${worstIndex}`,
	);
});

test('a peak inside the first Audacity block still seeds the follower', () => {
	const clean = render(tone());
	const near = render(withBurstAt(24_000));
	const ratio = near[50]! / clean[50]!;
	assert.ok(
		ratio < 0.9,
		`a burst inside the seed window must duck the head, but the gain ratio was ${ratio}`,
	);
});
