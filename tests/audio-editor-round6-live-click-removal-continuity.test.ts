/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';

const RATE = 48_000;
const WARM_FRAMES = 13_333;
const TYPE = 'audacity-click-removal';

function recording(frames: number, offset = 0): Float32Array {
	return Float32Array.from({ length: frames }, (_, frame) => .6 * Math.sin(2 * Math.PI * 1000 * (offset + frame) / RATE));
}

test('a live Click Removal threshold edit retains its audible analysis clock', () => {
	const processor = createAudacityLiveProcessor(TYPE, RATE);
	const warm = new Float32Array(WARM_FRAMES);
	processor.process([recording(WARM_FRAMES)], [warm]);
	assert.ok(warm.subarray(-128).some(sample => Math.abs(sample) > .5));
	processor.updateParams({ threshold: 201 });
	const output = new Float32Array(1024);
	processor.process([recording(output.length, WARM_FRAMES)], [output]);
	assert.deepEqual(output, recording(output.length, WARM_FRAMES - 8191));
});

for (const warmFrames of [8192, WARM_FRAMES]) {
	test(`Click Removal retains processed overlap and exact queued PCM after ${warmFrames} input frames`, () => {
		const changed = createAudacityLiveProcessor(TYPE, RATE);
		const control = createAudacityLiveProcessor(TYPE, RATE);
		const input = recording(warmFrames).map(sample => sample * .05); input[5000] = 1;
		for (const processor of [changed, control]) processor.process([input], [new Float32Array(warmFrames)]);
		changed.updateParams({});
		const actual = new Float32Array(8192); const expected = new Float32Array(8192);
		const following = recording(actual.length, warmFrames);
		changed.process([following], [actual]); control.process([following], [expected]);
		assert.ok(expected.some(sample => Math.abs(sample) > .01));
		if (warmFrames === 8192) assert.ok(Math.abs(expected[4999]!) < .1, 'The overlap already repaired the original full-scale click.');
		assert.deepEqual(actual, expected, 'Previously repaired overlap and each pending Float32 word must survive.');
	});
}

for (const zero of [{ threshold: 0 }, { maximumWidth: 0 }]) {
	test(`Click Removal retains immediate bypass and fresh geometry when ${JSON.stringify(zero)}`, () => {
		const processor = createAudacityLiveProcessor(TYPE, RATE);
		processor.process([recording(WARM_FRAMES)], [new Float32Array(WARM_FRAMES)]);
		processor.updateParams(zero);
		assert.equal(processor.latencyFrames, 0);
		const input = recording(128); const output = new Float32Array(128);
		processor.process([input], [output]);
		assert.deepEqual(output, input);
		processor.updateParams({ threshold: 200, maximumWidth: 20 });
		assert.equal(processor.latencyFrames, 8191);
		processor.process([input], [output]);
		assert.ok(output.every(sample => sample === 0));
	});
}

test('explicit Click Removal reset still discards the analysis window', () => {
	const processor = createAudacityLiveProcessor(TYPE, RATE);
	processor.process([recording(WARM_FRAMES)], [new Float32Array(WARM_FRAMES)]);
	processor.reset();
	const output = new Float32Array(128);
	processor.process([recording(128)], [output]);
	assert.ok(output.every(sample => sample === 0));
});
