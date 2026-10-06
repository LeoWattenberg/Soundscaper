import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { generateAudioEditorSignal } from '../src/common/editor/generators.js';
import { multiplyChannel } from '../src/common/editor/audacity-effects/basic-channel-math.js';
import { applyLinkedDynamics } from '../src/common/editor/audacity-effects/basic-dynamics.js';
import { applyAudacityInvert } from '../src/common/editor/audacity-effects/basic.js';

function digest(channels: readonly Float32Array[]): string {
	const hash = createHash('sha256');
	for (const channel of channels) hash.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
	return hash.digest('hex');
}

test('pink running sum retains the channel-major seeded output through counter wrap boundaries', (t) => {
	const reduce = t.mock.method(Float64Array.prototype, 'reduce');
	const fixtures = [
		[1, 'd4ddff81203fd43fd22874cee7e7c1a172eec399b2844782ab55db050657eecf'],
		[42, '7c05e5f023e4053f9fafb4887166f76d43d4de3ce955d674cade1e5b66eba2b4'],
		[0xffff_ffff, '8636d068661e5f0df015bd20135e6fb193eed76f3144e04dd5a24737b40677d8'],
	] as const;
	for (const [seed, expected] of fixtures) {
		const result = generateAudioEditorSignal('noise', {
			sampleRate: 8_000, durationSeconds: 0.513, channelCount: 3, color: 'pink', seed,
		});
		assert.equal(digest(result.channels), expected);
	}
	assert.equal(reduce.mock.callCount(), 0, 'pink noise must not sum all seven bins for every sample');
});

test('mono generators keep their first output allocation and give other channels independent storage', () => {
	const original = globalThis.Float32Array;
	let allocations = 0;
	globalThis.Float32Array = new Proxy(original, {
		construct(target, argumentsList, newTarget) {
			allocations += 1;
			return Reflect.construct(target, argumentsList, newTarget);
		},
	});
	try {
		for (const type of ['tone', 'chirp', 'morse']) {
			allocations = 0;
			const result = generateAudioEditorSignal(type, {
				sampleRate: 8_000, durationSeconds: 0.04, text: 'SOS', wordsPerMinute: 120, channelCount: 3,
			});
			assert.equal(allocations, 3, `${type} must allocate one buffer per output channel`);
			assert.deepEqual(result.channels[0], result.channels[1]);
			const unchanged = result.channels[1][1];
			result.channels[0][1] = 0.123;
			assert.equal(result.channels[1][1], unchanged);
		}
	} finally {
		globalThis.Float32Array = original;
	}
});

test('DTMF computes each distinct symbol once without changing fades, spacing, or phase', (t) => {
	const sine = t.mock.method(Math, 'sin');
	const result = generateAudioEditorSignal('dtmf', {
		sampleRate: 8_000, sequence: '1122#11', toneSeconds: 0.03125, silenceSeconds: 0.005, channelCount: 3,
	});
	assert.equal(digest(result.channels), '3b6e4a0cc026d617a1bc0ce873fa557df0ec84715cd24b678a78e8121ea9c44a');
	assert.equal(sine.mock.callCount(), 3 * 250 * 2);
});

test('scalar gain and invert preserve IEEE samples without typed-array mapping callbacks', (t) => {
	const input = Float32Array.of(0, -0, 0.1234567, -0.7, Number.MIN_VALUE, Infinity, -Infinity, NaN);
	const expected = Float32Array.from(input, (sample) => sample * 1.3);
	const inverted = Float32Array.from(input, (sample) => -sample);
	const from = t.mock.method(Float32Array, 'from');
	assert.deepEqual(multiplyChannel(input, 1.3), expected);
	assert.deepEqual(applyAudacityInvert([input], 8_000)[0], inverted);
	assert.equal(from.mock.callCount(), 0);
});

test('destructive linked dynamics evaluates the shared linear gain once per frame', () => {
	const input = Array.from({ length: 4 }, (_, channel) => Float32Array.from({ length: 3_007 }, (_, frame) => (
		frame % 97 < 10 ? 0 : Math.sin(frame * 0.17 + channel) * (0.2 + channel * 0.18)
	)));
	let gainReads = 0;
	const output = applyLinkedDynamics(input, 8_000, {
		thresholdDb: -18, kneeWidthDb: 6, ratio: 3, lookaheadMs: 3.5, attackMs: 4, releaseMs: 50,
		get makeupGainDb() { gainReads += 1; return 2; },
	});
	assert.equal(digest(output), '9c2544cd0bfaa53b4bcf77716f49eb62de7240a7c96eb0f6b01355802a6a2e07');
	assert.equal(gainReads, input[0].length);
});
