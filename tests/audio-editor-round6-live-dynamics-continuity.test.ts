/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';

const RATE = 48_000;
const WARM_FRAMES = 12_288;
const TYPES = ['audacity-compressor', 'audacity-limiter'] as const;

function tone(frames: number, offset = 0): Float32Array {
	return Float32Array.from({ length: frames }, (_, frame) => .6 * Math.sin(2 * Math.PI * 1000 * (offset + frame) / RATE));
}

function rms(samples: Float32Array): number {
	return Math.sqrt(samples.reduce((power, sample) => power + sample ** 2, 0) / samples.length);
}

for (const type of TYPES) {
	const neutral = { thresholdDb: 0, makeupGainDb: 0, makeupTargetDb: 0, kneeWidthDb: 0, ratio: 1, lookaheadMs: 40 };
	test(`${type} keeps pending audible lookahead PCM across an ordinary release edit`, () => {
		const processor = createAudacityLiveProcessor(type, RATE, neutral);
		const warm = new Float32Array(WARM_FRAMES);
		processor.process([tone(WARM_FRAMES)], [warm]);
		assert.ok(rms(warm.subarray(-128)) > .4);
		processor.updateParams({ releaseMs: 101 });
		const output = new Float32Array(1024);
		processor.process([tone(output.length, WARM_FRAMES)], [output]);
		for (let frame = 0; frame < output.length; frame += 128) {
			assert.ok(rms(output.subarray(frame, frame + 128)) > .4, 'Pending lookahead must remain audible after the release edit.');
		}
	});

	test(`${type} preserves every queued Float32 word when publishing unchanged parameters`, () => {
		const changed = createAudacityLiveProcessor(type, RATE, neutral);
		const control = createAudacityLiveProcessor(type, RATE, neutral);
		for (const processor of [changed, control]) processor.process([tone(WARM_FRAMES)], [new Float32Array(WARM_FRAMES)]);
		changed.updateParams({});
		const actual = new Float32Array(1024); const expected = new Float32Array(1024);
		changed.process([tone(actual.length, WARM_FRAMES)], [actual]);
		control.process([tone(expected.length, WARM_FRAMES)], [expected]);
		assert.ok(rms(expected) > .4);
		assert.ok(actual.every((sample, frame) => Object.is(sample, expected[frame])));
	});

	test(`${type} retains gain reduction instead of restarting release at full volume`, () => {
		const params = { thresholdDb: -12, makeupGainDb: 0, makeupTargetDb: -12, kneeWidthDb: 0, ratio: 4, lookaheadMs: 0, releaseMs: 100 };
		const changed = createAudacityLiveProcessor(type, RATE, params);
		const control = createAudacityLiveProcessor(type, RATE, params);
		for (const processor of [changed, control]) processor.process([new Float32Array(WARM_FRAMES).fill(.6)], [new Float32Array(WARM_FRAMES)]);
		changed.updateParams({ releaseMs: 101 });
		const actual = new Float32Array(128); const expected = new Float32Array(128);
		changed.process([new Float32Array(128).fill(.1)], [actual]);
		control.process([new Float32Array(128).fill(.1)], [expected]);
		assert.ok(expected[0]! > 0 && expected[0]! < .06);
		assert.ok(actual[0]! <= expected[0]! * 1.02, 'The held reduction must survive even with zero lookahead.');
	});

	test(`${type} resets delay geometry when lookahead changes or reset is explicit`, () => {
		const processor = createAudacityLiveProcessor(type, RATE, neutral);
		processor.process([tone(WARM_FRAMES)], [new Float32Array(WARM_FRAMES)]);
		processor.updateParams({ lookaheadMs: 50 });
		const output = new Float32Array(128);
		processor.process([tone(output.length, WARM_FRAMES)], [output]);
		assert.ok(output.every(sample => sample === 0));
		const warm = new Float32Array(WARM_FRAMES);
		processor.process([tone(WARM_FRAMES)], [warm]);
		assert.ok(rms(warm.subarray(-128)) > .4);
		processor.reset();
		processor.process([tone(output.length)], [output]);
		assert.ok(output.every(sample => sample === 0));
	});
}
