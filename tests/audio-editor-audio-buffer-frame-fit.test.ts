/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { fitAudioBufferToFrames } from '../src/common/editor/controller/audio-buffer-frame-fit.ts';

test('audio-buffer fitting preserves an exact buffer and truncates or zero-pads channel data', () => {
	const original = testAudioBuffer([[1, 2, 3], [4, 5, 6]], 48_000);
	const context = { createBuffer: (channels: number, frames: number, sampleRate: number) => (
		testAudioBuffer(Array.from({ length: channels }, () => Array(frames).fill(0)), sampleRate)
	) };
	assert.equal(fitAudioBufferToFrames(original, 3, context), original);
	const truncated = fitAudioBufferToFrames(original, 2, context);
	assert.deepEqual([...truncated.getChannelData(0)], [1, 2]);
	assert.deepEqual([...truncated.getChannelData(1)], [4, 5]);
	const padded = fitAudioBufferToFrames(original, 5, context);
	assert.deepEqual([...padded.getChannelData(0)], [1, 2, 3, 0, 0]);
});

interface TestAudioBuffer {
	readonly length: number;
	readonly numberOfChannels: number;
	readonly sampleRate: number;
	getChannelData(channel: number): Float32Array;
}

function testAudioBuffer(channels: readonly (readonly number[])[], sampleRate: number): TestAudioBuffer {
	const data = channels.map((channel) => Float32Array.from(channel));
	return {
		length: data[0]?.length ?? 0,
		numberOfChannels: data.length,
		sampleRate,
		getChannelData: (channel) => data[channel] ?? new Float32Array(),
	};
}
