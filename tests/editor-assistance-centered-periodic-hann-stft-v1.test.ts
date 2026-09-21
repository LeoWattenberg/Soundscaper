/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_CENTERED_PERIODIC_HANN_FFT_SIZE_V1,
	ASSISTANCE_CENTERED_PERIODIC_HANN_HOP_FRAMES_V1,
	centeredPeriodicHannIstftChannelsV1,
	centeredPeriodicHannStftChannelV1,
	periodicHannWindowFloat64V1,
	reflectedFloat32SampleV1,
} from '../src/common/editor/assistance/internal/centered-periodic-hann-stft-v1.ts';

function sourceSignal(): Float32Array {
	return Float32Array.from({ length: 2_049 }, (_, frame) => Math.fround(
		0.2 * Math.sin(frame / 17) + (frame % 113 === 0 ? 0.3 : 0),
	));
}

test('centered assistance STFT owns the exact 2048/512 periodic-Hann geometry', () => {
	assert.equal(ASSISTANCE_CENTERED_PERIODIC_HANN_FFT_SIZE_V1, 2_048);
	assert.equal(ASSISTANCE_CENTERED_PERIODIC_HANN_HOP_FRAMES_V1, 512);
	const window = periodicHannWindowFloat64V1();
	assert.equal(window.length, 2_048);
	assert.equal(window[0], 0);
	assert.equal(window[1], 0.00000235309521190441);
	assert.equal(window[1_024], 1);
	assert.equal(window[2_047], 0.00000235309521190441);
});

test('centered assistance STFT uses PyTorch-compatible reflection without repeating an edge', () => {
	const channel = Float32Array.of(10, 20, 30, 40);
	assert.equal(reflectedFloat32SampleV1(channel, -1), 20);
	assert.equal(reflectedFloat32SampleV1(channel, -4), 30);
	assert.equal(reflectedFloat32SampleV1(channel, 4), 30);
	assert.equal(reflectedFloat32SampleV1(channel, 7), 20);
});

test('centered assistance STFT/ISTFT retains the pinned spectrum and overlap-add output', () => {
	const source = sourceSignal();
	const spectrum = centeredPeriodicHannStftChannelV1(source);
	assert.equal(spectrum.timeFrameCount, 5);
	assert.equal(spectrum.frequencyBinCount, 1_025);
	assert.equal(spectrum.real[17], -40.37555694580078);
	assert.equal(spectrum.imaginary[17], -1.4051260155412137e-14);
	assert.equal(spectrum.real[1_042], 8.889944076538086);
	assert.equal(spectrum.imaginary[1_042], -12.366141319274902);
	assert.equal(spectrum.real[3_187], 0.29054126143455505);
	assert.equal(spectrum.imaginary[3_187], 0.11272712796926498);

	const [restored] = centeredPeriodicHannIstftChannelsV1(
		[spectrum], spectrum.timeFrameCount, source.length,
	);
	assert.equal(restored![0], 0.30000001192092896);
	assert.equal(restored![17], 0.16829419136047363);
	assert.equal(restored![1_024], -0.10368938744068146);
	assert.equal(restored![2_048], 0.1773316115140915);
});
