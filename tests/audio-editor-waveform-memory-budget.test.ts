/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { waveformPeakBlockSizes, WAVEFORM_PEAK_MAX_SOURCE_BYTES, WAVEFORM_PEAK_BLOCK_SIZES } from '../src/common/editor/waveform-peak-contract.ts';
import { generateWaveformPeaksFallback, generateStoredWaveformPeaksFallback, waveformPeaksHaveRms } from '../src/common/editor/controller/source/waveform-analysis.ts';
import { validateWaveformPeakLevels } from '../src/common/editor/design-system-adapters/waveform-internals.ts';

test('waveform storage stays bounded for hour-long and much larger audio sources', () => {
	for (const frames of [160_083_000, 10_000_000_000, 1_000_000_000_000]) {
		for (const channels of [1, 2, 32]) {
			const sizes = waveformPeakBlockSizes(frames, channels);
			assert.ok(sizes[0]! > WAVEFORM_PEAK_BLOCK_SIZES[0]!);
			assert.equal(sizes.length, WAVEFORM_PEAK_BLOCK_SIZES.length);
			assert.ok(sizes.reduce((total, size) => total + Math.ceil(frames / size) * channels * 12, 0) <= WAVEFORM_PEAK_MAX_SOURCE_BYTES);
		}
	}
	assert.deepEqual(waveformPeakBlockSizes(4_096, 2), WAVEFORM_PEAK_BLOCK_SIZES);
});

test('bounded stored and buffered pyramids preserve extrema and RMS and remain renderable', async () => {
	const frames = 3_000_001;
	const samples = new Float32Array(frames).fill(0.25);
	samples[65_535] = -1.5;
	samples[65_536] = 1.75;
	const source = { id: 'long', frameCount: frames, channelCount: 1 };
	const store = { async *readSourceChunks() {
		for (let offset = 0; offset < frames; offset += 65_536) {
			const values = samples.subarray(offset, offset + 65_536);
			yield { frames: values.length, channels: [values] };
		}
	} };
	const stored = await generateStoredWaveformPeaksFallback(store, source);
	const buffered = generateWaveformPeaksFallback([samples]);
	assert.deepEqual(stored, buffered);
	assert.equal(waveformPeaksHaveRms(stored, source), true);
	assert.equal(waveformPeaksHaveRms(stored), true);
	assert.equal(validateWaveformPeakLevels(stored).levels.length, stored.levels.length);
	const level = stored.levels[0]!;
	assert.ok(level.blockSize > 8);
	assert.equal(level.channels[0]!.minimums[Math.floor(65_535 / level.blockSize)], -1.5);
	assert.equal(level.channels[0]!.maximums[Math.floor(65_536 / level.blockSize)], 1.75);
	assert.equal(waveformPeaksHaveRms({ ...stored, levels: stored.levels.map((item) => ({ ...item, blockSize: item.blockSize * 2 })) }, source), false);
});
