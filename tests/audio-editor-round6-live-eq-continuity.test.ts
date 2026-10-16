/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';
import { initializePffft } from '../src/common/editor/pffft.js';

await initializePffft();

const RATE = 48_000;
const WARM_FRAMES = 12_288;
const TYPES = ['audacity-graphic-eq', 'audacity-filter-curve-eq'] as const;

function tone(frames: number, offset = 0): Float32Array {
	return Float32Array.from({ length: frames }, (_, frame) => .6 * Math.sin(2 * Math.PI * 1000 * (offset + frame) / RATE));
}

function rms(samples: Float32Array): number {
	return Math.sqrt(samples.reduce((power, sample) => power + sample ** 2, 0) / samples.length);
}

for (const type of TYPES) {
	test(`${type} keeps its healthy convolution output across a same-geometry gain edit`, () => {
		const processor = createAudacityLiveProcessor(type, RATE);
		const warm = new Float32Array(WARM_FRAMES);
		processor.process([tone(WARM_FRAMES)], [warm]);
		assert.ok(rms(warm.subarray(-128)) > .4);
		processor.updateParams(type === 'audacity-graphic-eq'
			? { gains: Array<number>(31).fill(1) }
			: { points: [{ frequency: 20, gain: 1 }, { frequency: 20_000, gain: 1 }] });
		const output = new Float32Array(1024);
		processor.process([tone(output.length, WARM_FRAMES)], [output]);
		for (let frame = 0; frame < output.length; frame += 128) {
			assert.ok(rms(output.subarray(frame, frame + 128)) > .4, 'Every audible block must survive the band edit.');
		}
	});

	test(`${type} preserves exact queued PCM when publishing unchanged parameters`, () => {
		const changed = createAudacityLiveProcessor(type, RATE);
		const control = createAudacityLiveProcessor(type, RATE);
		for (const processor of [changed, control]) {
			const warm = new Float32Array(WARM_FRAMES);
			processor.process([tone(WARM_FRAMES)], [warm]);
			assert.ok(rms(warm.subarray(-128)) > .4);
		}
		changed.updateParams({});
		const actual = new Float32Array(1024); const expected = new Float32Array(1024);
		changed.process([tone(actual.length, WARM_FRAMES)], [actual]);
		control.process([tone(expected.length, WARM_FRAMES)], [expected]);
		assert.ok(rms(expected) > .4);
		assert.ok(actual.every((sample, frame) => Object.is(sample, expected[frame])), 'Every queued Float32 word must survive.');
	});

	test(`${type} resets queued geometry when the FIR length changes or reset is explicit`, () => {
		const processor = createAudacityLiveProcessor(type, RATE);
		processor.process([tone(WARM_FRAMES)], [new Float32Array(WARM_FRAMES)]);
		processor.updateParams({ filterLength: 4095 });
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
