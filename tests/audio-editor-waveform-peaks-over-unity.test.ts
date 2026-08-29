/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Waveform peaks summarize each block as its minimum and maximum sample. Float
 * sources are not clamped to unity — a hot master, a recorded take or a render
 * can sit wholly above +1 or below -1 — so seeding the running extremes at ±1
 * reports a block that never leaves +1.5 as reaching down to +1, and the drawn
 * envelope no longer bounds the audio it summarizes.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	generateStoredWaveformPeaksFallback,
	generateWaveformPeaksFallback,
} from '../src/common/editor/controller/waveform-analysis.ts';

const BLOCK = 64;

/** One channel that is entirely above +1, then entirely below -1. */
function overUnityChannel(): Float32Array {
	const data = new Float32Array(BLOCK * 2);
	data.fill(Math.fround(1.5), 0, BLOCK);
	data.fill(Math.fround(-1.4), BLOCK);
	return data;
}

function levelAt(peaks: { levels: readonly { blockSize: number; channels: readonly {
	minimums: Float32Array; maximums: Float32Array; rms: Float32Array }[] }[] }) {
	const level = peaks.levels.find((entry) => entry.blockSize === BLOCK);
	assert.ok(level, `the peak pyramid carries a ${String(BLOCK)}-sample level`);
	return level.channels[0]!;
}

test('in-memory peaks bound a block that never comes back inside unity', () => {
	const channel = levelAt(generateWaveformPeaksFallback([overUnityChannel()]));

	assert.equal(channel.minimums[0], Math.fround(1.5), 'a block of +1.5 never dips to +1');
	assert.equal(channel.maximums[0], Math.fround(1.5));
	assert.equal(channel.maximums[1], Math.fround(-1.4), 'a block of -1.4 never rises to -1');
	assert.equal(channel.minimums[1], Math.fround(-1.4));
});

test('stored streaming peaks agree with the in-memory pyramid', async () => {
	const data = overUnityChannel();
	const store = {
		async *readSourceChunks() {
			// Two chunks, so the running extremes have to survive a chunk boundary.
			yield { frames: BLOCK, channels: [data.slice(0, BLOCK)] };
			yield { frames: BLOCK, channels: [data.slice(BLOCK)] };
		},
	};
	const stored = levelAt(await generateStoredWaveformPeaksFallback(
		store as never,
		{ id: 'hot-source', storageKey: 'hot-source', channelCount: 1, frameCount: data.length } as never,
	));
	const memory = levelAt(generateWaveformPeaksFallback([data]));

	assert.deepEqual([...stored.minimums], [...memory.minimums]);
	assert.deepEqual([...stored.maximums], [...memory.maximums]);
});
