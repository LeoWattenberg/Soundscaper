import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAudacityAudioInput } from '../src/common/editor/audacity-effects/basic-channel-math.js';
import { applyAudacityAmplify } from '../src/common/editor/audacity-effects/basic.js';
import { applyAudacityEcho } from '../src/common/editor/audacity-effects/realtime.js';

const invalidInputs = [
	{ channels: [], sampleRate: 48_000, message: /non-empty array/u },
	{ channels: [new Float64Array(1)], sampleRate: 48_000, message: /Float32Array/u },
	{
		channels: [new Float32Array(1), new Float32Array(2)],
		sampleRate: 48_000,
		message: /same length/u,
	},
	{ channels: [new Float32Array(1)], sampleRate: 0, message: /sampleRate/u },
	{ channels: [new Float32Array(1)], sampleRate: Number.NaN, message: /sampleRate/u },
];

test('one Audacity input authority preserves the basic and realtime rejection matrix', () => {
	for (const { channels, sampleRate, message } of invalidInputs) {
		assert.throws(() => validateAudacityAudioInput(channels, sampleRate), message);
		assert.throws(() => applyAudacityAmplify(channels, sampleRate), message);
		assert.throws(() => applyAudacityEcho(channels, sampleRate), message);
	}
	assert.equal(validateAudacityAudioInput([
		new Float32Array(0),
		new Float32Array(0),
	], 48_000), undefined);
});
