/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ReverbLiveProcessor } from '../src/common/editor/audacity-effects/reverb-live-processor.ts';

for (const [sampleRate, nextPreDelay] of [[8000, 10.05], [44100, 10.01], [48000, 10.01], [96000, 10.001]]) {
	const settings = { preDelay: 10, wetOnly: true, wetGainDb: 6, roomSize: 100, reverberance: 100 };
	const frames = Math.round(sampleRate! * .3);
	const input = Float32Array.from({ length: frames }, (_, frame) => .6 * Math.sin(2 * Math.PI * 1000 * frame / sampleRate!));
	test(`Reverb at ${sampleRate} Hz retains exact audible tail when milliseconds resolve to the same delay frame`, () => {
		assert.equal(Math.round(10 * sampleRate! / 1000), Math.round(nextPreDelay! * sampleRate! / 1000));
		const changed = new ReverbLiveProcessor(sampleRate!, settings);
		const reference = new ReverbLiveProcessor(sampleRate!, settings);
		for (const processor of [changed, reference]) processor.process([input], [new Float32Array(frames)]);
		changed.updateParams({ preDelay: nextPreDelay! });
		const actual = new Float32Array(1024); const expected = new Float32Array(1024);
		changed.process([], [actual]); reference.process([], [expected]);
		assert.ok(expected.some(sample => Math.abs(sample) > .01), 'The reference tail must remain physically audible.');
		assert.deepEqual(actual, expected, 'An unchanged delay geometry must not erase a single queued PCM word.');
	});

	test(`Reverb at ${sampleRate} Hz still clears state for a different delay frame and explicit reset`, () => {
		const processor = new ReverbLiveProcessor(sampleRate!, settings);
		processor.process([input], [new Float32Array(frames)]);
		processor.updateParams({ preDelay: 11 });
		const output = new Float32Array(128);
		processor.process([], [output]);
		assert.ok(output.every(sample => sample === 0));
		processor.process([input], [new Float32Array(frames)]);
		processor.reset(); processor.process([], [output]);
		assert.ok(output.every(sample => sample === 0));
	});
}
