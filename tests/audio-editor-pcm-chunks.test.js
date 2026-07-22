import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createImmutablePcmChunks,
	editImmutablePcmSamples,
	readImmutablePcmRange,
	smoothImmutablePcmRange,
} from '../src/common/editor/pcm-chunks.js';

test('sample pencil edits clone only touched 65,536-frame chunks', () => {
	const input = Float32Array.from({ length: 140_000 }, (_, frame) => frame / 140_000);
	const pcm = createImmutablePcmChunks([input]);
	assert.equal(pcm.chunkFrames, 65_536);
	assert.equal(pcm.chunks.length, 3);
	const result = editImmutablePcmSamples(pcm, [
		{ channel: 0, frame: 5, value: -0.75 },
		{ channel: 0, frame: 65_540, value: 0.25 },
	]);
	assert.deepEqual(result.changedChunkIndices, [0, 1]);
	assert.notStrictEqual(result.pcm.chunks[0], pcm.chunks[0]);
	assert.notStrictEqual(result.pcm.chunks[1], pcm.chunks[1]);
	assert.strictEqual(result.pcm.chunks[2], pcm.chunks[2]);
	assert.equal(readImmutablePcmRange(result.pcm, 5, 6)[0][0], -0.75);
	assert.equal(readImmutablePcmRange(pcm, 5, 6)[0][0], input[5]);
});

test('sample smoothing spans chunk boundaries without mutating source history', () => {
	const input = new Float32Array(65_540);
	input[65_535] = 1;
	const pcm = createImmutablePcmChunks([input]);
	const result = smoothImmutablePcmRange(pcm, { startFrame: 65_533, endFrame: 65_538, radius: 2 });
	const smoothed = readImmutablePcmRange(result.pcm, 65_533, 65_538)[0];
	assert.ok(smoothed[2] < 1 && smoothed[2] > 0);
	assert.ok(smoothed[1] > 0);
	assert.ok(smoothed[3] > 0);
	assert.equal(readImmutablePcmRange(pcm, 65_535, 65_536)[0][0], 1);
	assert.deepEqual(result.changedChunkIndices, [0, 1]);
});
