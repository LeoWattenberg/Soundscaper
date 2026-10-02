/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FrequencyWaveformAnalyzer,
	FrequencyWaveformBandSplitter,
} from '../src/common/editor/frequency-waveform-analysis.ts';
import { DEFAULT_FREQUENCY_WAVEFORM_CROSSOVERS } from '../src/common/editor/frequency-waveform-contract.ts';

const FRAME_COUNT = 4_321;
const channels = Array.from({ length: 2 }, (_, channel) => Float32Array.from(
	{ length: FRAME_COUNT }, (_, frame) => Math.sin(frame * 0.13 + channel) * 0.8,
));

test('frequency band extrema scan PCM once instead of at every pyramid level', (context) => {
	let minimumCalls = 0;
	const original = Math.min;
	context.mock.method(Math, 'min', (...values: number[]) => { minimumCalls++; return original(...values); });
	const analyzer = new FrequencyWaveformAnalyzer({ sampleRate: 48_000, frameCount: FRAME_COUNT, channelCount: 2 }, () => undefined);
	for (let offset = 0; offset < FRAME_COUNT; offset += 131) {
		analyzer.push(channels.map((channel) => channel.subarray(offset, offset + 131)));
	}
	analyzer.finish();
	assert.ok(minimumCalls < FRAME_COUNT * 3 * channels.length * 2,
		`expected a single extrema scan plus bucket aggregation, received ${String(minimumCalls)} minimum operations`);
});

test('frequency pyramid extrema match direct band scans through partial chunks and buckets', () => {
	const bands = new FrequencyWaveformBandSplitter(48_000, channels.length, DEFAULT_FREQUENCY_WAVEFORM_CROSSOVERS)
		.process(channels);
	const analyzer = new FrequencyWaveformAnalyzer({ sampleRate: 48_000, frameCount: FRAME_COUNT, channelCount: 2 }, () => undefined);
	for (let offset = 0; offset < FRAME_COUNT; offset += 131) {
		analyzer.push(channels.map((channel) => channel.subarray(offset, offset + 131)));
	}
	for (const level of analyzer.finish().levels) {
		for (const band of ['low', 'mid', 'high'] as const) {
			for (let channel = 0; channel < channels.length; channel++) {
				const values = bands[band][channel]!;
				const peaks = level.bands[band][channel]!;
				for (let bucket = 0; bucket < peaks.minimums.length; bucket++) {
					const source = values.subarray(bucket * level.blockSize, (bucket + 1) * level.blockSize);
					assert.equal(peaks.minimums[bucket], Math.min(...source));
					assert.equal(peaks.maximums[bucket], Math.max(...source));
				}
			}
		}
	}
});
