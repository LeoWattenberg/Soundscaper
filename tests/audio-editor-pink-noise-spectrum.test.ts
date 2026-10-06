/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAudioEditorSignal } from '../src/common/editor/generators.js';
import { calculateAudioSpectrum } from '../src/common/editor/audio-spectrum.ts';

test('pink noise has comparable energy per low audible octave across project rates', () => {
	for (const sampleRate of [8_000, 48_000, 96_000]) {
		const generated = generateAudioEditorSignal('noise', { sampleRate, color: 'pink', durationSeconds: 16, amplitude: 0.8 });
		const spectrum = calculateAudioSpectrum(generated.channels, sampleRate, { size: 65_536, average: true });
		const energy = (low: number) => spectrum.bins.filter(bin => bin.frequency >= low && bin.frequency < low * 2)
			.reduce((sum, bin) => sum + bin.amplitude ** 2, 0);
		const ratio = energy(20) / energy(80);
		assert.ok(ratio > 0.5 && ratio < 2, `${sampleRate} Hz: low-octave ratio ${ratio}`);
		assert.ok(generated.channels.every((channel: Float32Array) => channel.every(sample => Math.abs(sample) <= 0.800001)));
	}
});
