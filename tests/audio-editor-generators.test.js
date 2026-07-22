import assert from 'node:assert/strict';
import test from 'node:test';

import { generateAudioEditorSignal } from '../src/common/editor/generators.js';

test('built-in generators honor arbitrary project rates and channel layouts', () => {
	const silence = generateAudioEditorSignal('silence', { sampleRate: 44_100, durationSeconds: 0.5, channelCount: 2 });
	assert.equal(silence.frameCount, 22_050);
	assert.equal(silence.channels.length, 2);
	assert.equal(silence.channels[0].every((sample) => sample === 0), true);

	const tone = generateAudioEditorSignal('tone', { sampleRate: 8_000, durationSeconds: 0.25, frequency: 1_000 });
	assert.equal(tone.frameCount, 2_000);
	assert.ok(Math.abs(tone.channels[0][2] - 0.8) < 1e-5);
	assert.ok(Math.max(...tone.channels[0]) <= 0.800001);

	const chirp = generateAudioEditorSignal('chirp', { sampleRate: 16_000, durationSeconds: 0.2, startFrequency: 100, endFrequency: 4_000 });
	assert.equal(chirp.frameCount, 3_200);
	assert.ok(chirp.channels[0].some((sample) => sample !== 0));
});

test('noise and DTMF generation are deterministic, bounded, and validated', () => {
	const first = generateAudioEditorSignal('noise', { sampleRate: 8_000, durationSeconds: 0.1, color: 'pink', seed: 42, channelCount: 2 });
	const second = generateAudioEditorSignal('noise', { sampleRate: 8_000, durationSeconds: 0.1, color: 'pink', seed: 42, channelCount: 2 });
	assert.deepEqual(first.channels, second.channels);
	assert.ok(first.channels.every((channel) => channel.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 0.800001)));

	const dtmf = generateAudioEditorSignal('dtmf', { sampleRate: 8_000, sequence: '12#', toneSeconds: 0.1, silenceSeconds: 0.05 });
	assert.equal(dtmf.frameCount, 3_200);
	assert.ok(dtmf.channels[0].some((sample) => sample !== 0));
	assert.throws(() => generateAudioEditorSignal('dtmf', { sequence: 'hello' }), /unsupported symbol/);
	assert.throws(() => generateAudioEditorSignal('tone', { frequency: 100_000 }), /frequency/);
});
