/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAudioEditorSignal } from '../src/common/editor/generators.js';
import { calculateAudioSpectrum } from '../src/common/editor/audio-spectrum.ts';

function octaveRatio(channels: readonly Float32Array[], sampleRate: number): number {
	const { bins } = calculateAudioSpectrum(channels, sampleRate, { size: 65_536, average: true });
	const energy = (low: number) => bins.reduce((sum, bin) => bin.frequency >= low && bin.frequency < low * 2
		? sum + bin.amplitude ** 2 : sum, 0);
	return energy(20) / energy(80);
}

for (const sampleRate of [8_000, 48_000, 96_000]) {
	test(`Brown noise retains its low audible octave slope at ${sampleRate} Hz`, () => {
		const generated = generateAudioEditorSignal('noise', { sampleRate, color: 'brown',
			durationSeconds: 16, amplitude: .8, seed: 42 });
		const ratio = octaveRatio(generated.channels, sampleRate);
		assert.ok(ratio > 2.5 && ratio < 6, `Brown low-octave energy ratio ${ratio}`);
		assert.ok(generated.channels[0].every((sample: number) => Number.isFinite(sample) && Math.abs(sample) <= .800001));
	});
}

test('white-noise octave bandwidth and zero-amplitude controls remain unchanged', () => {
	const white = generateAudioEditorSignal('noise', { sampleRate: 48_000, color: 'white',
		durationSeconds: 16, amplitude: .8, seed: 42 });
	const ratio = octaveRatio(white.channels, white.sampleRate);
	assert.ok(ratio > .15 && ratio < .4, `White low-octave bandwidth ratio ${ratio}`);
	const silent = generateAudioEditorSignal('noise', { sampleRate: 48_000, color: 'brown',
		durationSeconds: .1, amplitude: 0, seed: 42 });
	assert.ok(silent.channels[0].every((sample: number) => sample === 0));
});
