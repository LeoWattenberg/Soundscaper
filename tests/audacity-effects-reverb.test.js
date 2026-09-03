import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyAudacityBrowserReverb,
	normalizeReverbParams,
} from '../src/common/editor/audacity-effects/reverb.js';

const SAMPLE_RATE = 48_000;

function impulse(length = 4_096) {
	const channel = new Float32Array(length);
	channel[0] = 1;
	return [channel];
}

function energyAbove(channel, sampleRate, cutoffHz) {
	// A single-pole difference is enough to weigh the top of the spectrum: it
	// answers "is this preset bright or dark" without an FFT in the test.
	const coefficient = Math.exp(-2 * Math.PI * cutoffHz / sampleRate);
	let previous = 0;
	let total = 0;
	for (const sample of channel) {
		const highpassed = sample - previous * coefficient;
		previous = sample;
		total += highpassed * highpassed;
	}
	return total;
}

function energyBelow(channel, sampleRate, cutoffHz) {
	const coefficient = Math.exp(-2 * Math.PI * cutoffHz / sampleRate);
	let previous = 0;
	let total = 0;
	for (const sample of channel) {
		previous = sample * (1 - coefficient) + previous * coefficient;
		total += previous * previous;
	}
	return total;
}

test('reverb settings carry the upstream pre-delay and tone controls', () => {
	assert.deepEqual(normalizeReverbParams(), {
		roomSize: 75,
		preDelay: 10,
		reverberance: 50,
		damping: 50,
		toneLow: 100,
		toneHigh: 100,
		wetGainDb: -6,
		dryGainDb: 0,
		stereoWidth: 100,
		wetOnly: false,
	});
	assert.throws(() => normalizeReverbParams({ preDelay: 240 }), /preDelay must be between 0 and 200/);
	assert.throws(() => normalizeReverbParams({ toneLow: -1 }), /toneLow must be between 0 and 100/);
	assert.throws(() => normalizeReverbParams({ toneHigh: 101 }), /toneHigh must be between 0 and 100/);
});

test('pre-delay holds the wet signal back without moving the dry signal', () => {
	const [wet] = applyAudacityBrowserReverb(impulse(), SAMPLE_RATE, {
		preDelay: 50, wetOnly: true, wetGainDb: 0,
	});
	const holdFrames = Math.round(50 / 1_000 * SAMPLE_RATE);
	for (let frame = 0; frame < holdFrames; frame += 1) {
		assert.equal(wet[frame], 0, `frame ${frame} should still be silent`);
	}
	assert.ok(wet.slice(holdFrames).some((sample) => sample !== 0));

	const [dry] = applyAudacityBrowserReverb(impulse(), SAMPLE_RATE, {
		preDelay: 50, dryGainDb: 0, wetGainDb: -60,
	});
	assert.ok(dry[0] > 0.9, 'the dry impulse stays at the head of the selection');
});

test('tone controls trade the bright and dark halves of the wet tail', () => {
	const settings = { preDelay: 0, wetOnly: true, wetGainDb: 0, damping: 0 };
	const [bright] = applyAudacityBrowserReverb(impulse(), SAMPLE_RATE, { ...settings, toneHigh: 100 });
	const [dark] = applyAudacityBrowserReverb(impulse(), SAMPLE_RATE, { ...settings, toneHigh: 0 });
	assert.ok(
		energyAbove(dark, SAMPLE_RATE, 4_000) < energyAbove(bright, SAMPLE_RATE, 4_000) * 0.5,
		'a closed tone high should drop most of the high-frequency wet energy',
	);

	const [full] = applyAudacityBrowserReverb(impulse(), SAMPLE_RATE, { ...settings, toneLow: 100 });
	const [thin] = applyAudacityBrowserReverb(impulse(), SAMPLE_RATE, { ...settings, toneLow: 0 });
	assert.ok(
		energyBelow(thin, SAMPLE_RATE, 200) < energyBelow(full, SAMPLE_RATE, 200) * 0.5,
		'a closed tone low should high-pass the wet tail well above the reverberator floor',
	);
});
