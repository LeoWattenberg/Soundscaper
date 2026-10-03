/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	scaleWaveformAmplitude,
	unscaleWaveformAmplitude,
	WAVEFORM_DB_RANGE,
} from '../src/common/editor/waveform-amplitude-scale.ts';

test('the logarithmic waveform shows the Audacity default 60 dB range', () => {
	assert.equal(WAVEFORM_DB_RANGE, 60);
	for (const [amplitude, display] of [[0.001, 0], [0.01, 1 / 3], [0.1, 2 / 3], [1, 1]]) {
		assert.ok(Math.abs(scaleWaveformAmplitude(amplitude!, 'db') - display!) < 1e-12);
		assert.ok(Math.abs(scaleWaveformAmplitude(-amplitude!, 'db') + display!) < 1e-12);
	}
});

test('silence, non-finite samples and samples below the dB floor remain at zero', () => {
	for (const sample of [0, -0, 0.0001, -0.0001, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.equal(scaleWaveformAmplitude(sample, 'db'), 0);
	}
});

test('logarithmic amplitude keeps over-unity signals beyond the full scale boundary', () => {
	assert.ok(scaleWaveformAmplitude(2, 'db') > 1);
	assert.ok(scaleWaveformAmplitude(-2, 'db') < -1);
	assert.ok(scaleWaveformAmplitude(0.1, 'db') > scaleWaveformAmplitude(0.01, 'db'));
});

test('the default amplitude transform preserves linear sample values', () => {
	for (const sample of [-2, -1, -0.1, 0, 0.1, 1, 2]) {
		assert.equal(scaleWaveformAmplitude(sample), sample);
		assert.equal(scaleWaveformAmplitude(sample, 'linear'), sample);
		assert.equal(unscaleWaveformAmplitude(sample), sample);
		assert.equal(unscaleWaveformAmplitude(sample, 'linear'), sample);
	}
});

test('sample editing inverts signed logarithmic amplitudes above the display floor', () => {
	for (const sample of [-2, -1, -0.1, -0.01, 0.01, 0.1, 1, 2]) {
		const display = scaleWaveformAmplitude(sample, 'db');
		assert.ok(Math.abs(unscaleWaveformAmplitude(display, 'db') - sample) < 1e-12);
	}
	for (const value of [0, -0, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.equal(unscaleWaveformAmplitude(value, 'db'), 0);
	}
	assert.ok(Math.abs(unscaleWaveformAmplitude(0.5, 'db') - 10 ** (-30 / 20)) < 1e-12);
});
