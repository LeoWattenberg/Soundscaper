/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';

for (const type of ['audacity-compressor', 'audacity-limiter']) {
	test(`${type} evaluates the linked gain once per frame for surround audio`, (context) => {
		const processor = createAudacityLiveProcessor(type, 48_000, { lookaheadMs: 0 });
		const input = Array.from({ length: 8 }, (_, channel) => Float32Array.from(
			{ length: 128 }, (_, frame) => Math.sin(frame * 0.13 + channel) * 0.8,
		));
		const output = input.map(() => new Float32Array(128));
		let evaluations = 0;
		const original = Math.exp;
		context.mock.method(Math, 'exp', (value: number) => { evaluations++; return original(value); });
		processor.process(input, output);
		assert.equal(evaluations, 128);
		assert.ok(output.every((channel) => channel.some((sample) => sample !== 0)));
	});
}
