/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createNormalizingMixRenderPacketSink,
	normalizeMixRenderChannels,
} from '../src/common/editor/controller/mix-render-channel-normalizer.ts';

test('buffered and streamed Mix and Render use identical chosen multichannel layouts', async () => {
	const input = Array.from({ length: 6 }, (_, channel) => Float32Array.of(
		channel + 0.1,
		channel + 0.2,
		channel + 0.3,
		channel + 0.4,
	));
	for (const outputChannelCount of [1, 2, 6]) {
		const buffered = normalizeMixRenderChannels(input, outputChannelCount, invalidAudio);
		const packets: Float32Array[][] = [];
		const streamed = createNormalizingMixRenderPacketSink({
			write(channels) { packets.push(channels.map((channel) => channel.slice())); },
		}, outputChannelCount, invalidAudio);
		await streamed.write(input.map((channel) => channel.subarray(0, 2)));
		await streamed.write(input.map((channel) => channel.subarray(2)));

		assert.equal(buffered.length, outputChannelCount);
		assert.equal(streamed.inputChannelCount, 6);
		assert.equal(packets.length, 2);
		for (let channel = 0; channel < outputChannelCount; channel += 1) {
			assert.deepEqual(
				Float32Array.from([...packets[0]![channel]!, ...packets[1]![channel]!]),
				buffered[channel],
			);
		}
	}
});

test('a chosen stereo layout duplicates a mono render in buffered and streamed paths', async () => {
	const mono = [Float32Array.of(0.1, -0.2, 0.3)];
	const buffered = normalizeMixRenderChannels(mono, 2, invalidAudio);
	const packets: Float32Array[][] = [];
	const streamed = createNormalizingMixRenderPacketSink({
		write(channels) { packets.push(channels); },
	}, 2, invalidAudio);
	await streamed.write(mono);

	assert.deepEqual(buffered, [mono[0], mono[0]]);
	assert.deepEqual(packets, [buffered]);
});

function invalidAudio(): Error {
	return new Error('Invalid Mix and Render audio.');
}
