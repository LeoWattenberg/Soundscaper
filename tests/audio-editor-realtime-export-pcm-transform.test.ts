/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyMediaChannelMapping } from '../src/common/editor/media-export.js';
import { createRealtimeExportPcmTransform } from '../src/common/editor/controller/realtime-export-pcm-transform.ts';

test('direct WAV resamples selection-only upmixes before duplicating channels', () => {
	const mapping = {
		inputChannelCount: 2,
		outputChannelCount: 16,
		mode: 'custom',
		channels: Array.from({ length: 16 }, () => ({ inputs: [{ channel: 0, gain: 1 }] })),
	};
	const resamplerChannels: number[] = [];
	const transform = createRealtimeExportPcmTransform({
		inputChannelCount: 2,
		inputSampleRate: 48_000,
		outputChannelCount: 16,
		outputSampleRate: 384_000,
		channelMapping: mapping,
		optimizeSelectionUpmix: true,
		applyChannelMapping: applyMediaChannelMapping,
		createResampler: (_inputRate, _outputRate, channelCount) => {
			resamplerChannels.push(channelCount);
			return {
				push: (channels) => channels.map((channel) => Float32Array.from(channel, (sample) => sample + 1)),
				finish: () => [Float32Array.of(3), Float32Array.of(4)],
			};
		},
	});

	const output = transform.push([Float32Array.of(0, 1), Float32Array.of(10, 11)]);
	assert.deepEqual(resamplerChannels, [2]);
	assert.equal(output.length, 16);
	assert.deepEqual(output.map((channel) => [...channel]), Array.from({ length: 16 }, () => [1, 2]));
	assert.deepEqual(transform.finish(2).map((channel) => [...channel]), Array.from({ length: 16 }, () => [3]));
});

test('direct WAV preserves map-before-resample order for matrix mixes and downmixes', () => {
	for (const mapping of [
		{
			inputChannelCount: 2, outputChannelCount: 16, mode: 'custom',
			channels: Array.from({ length: 16 }, () => ({
				inputs: [{ channel: 0, gain: 0.5 }, { channel: 1, gain: 0.5 }],
			})),
		},
		{
			inputChannelCount: 2, outputChannelCount: 1, mode: 'mono',
			channels: [{ inputs: [{ channel: 0, gain: 0.5 }, { channel: 1, gain: 0.5 }] }],
		},
	]) {
		const resamplerChannels: number[] = [];
		const transform = createRealtimeExportPcmTransform({
			inputChannelCount: 2,
			inputSampleRate: 48_000,
			outputChannelCount: mapping.outputChannelCount,
			outputSampleRate: 96_000,
			channelMapping: mapping,
			optimizeSelectionUpmix: true,
			applyChannelMapping: applyMediaChannelMapping,
			createResampler: (_inputRate, _outputRate, channelCount) => {
				resamplerChannels.push(channelCount);
				return { push: (channels) => channels, finish: () => [] };
			},
		});
		const output = transform.push([Float32Array.of(1), Float32Array.of(3)]);
		assert.deepEqual(resamplerChannels, [mapping.outputChannelCount]);
		assert.equal(output.length, mapping.outputChannelCount);
		assert.equal(output[0][0], 2);
	}
});
