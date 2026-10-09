/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAudioSpectrum } from '../src/common/editor/audio-spectrum.ts';
import { calculateAudioAnalysisReport } from '../src/common/editor/audio-analysis-report-worker-runtime.ts';

const RATE = 48_000;
const SIZE = 2048;

function endingRecording(): Float32Array {
	return Float32Array.from({ length: RATE }, (_, frame) => frame >= 47_200 && frame < 47_800
		? .5 * Math.sin(2 * Math.PI * 1500 * frame / RATE) : 0);
}

test('averaged Plot Spectrum includes a tone in the final ordinary recording remainder', () => {
	const input = endingRecording();
	const lastWindow = calculateAudioSpectrum([input], RATE, { size: SIZE, offsetFrame: input.length - SIZE });
	assert.ok(lastWindow.bins[64]!.amplitude > .1, 'The selection ending contains an audible 1500 Hz tone.');
	const actual = calculateAudioSpectrum([input], RATE, { size: SIZE, average: true });
	const completeWindows = Math.floor((input.length - SIZE) / (SIZE / 2)) + 1;
	const expected = lastWindow.bins[64]!.amplitude / Math.sqrt(completeWindows + 1);
	assert.ok(Math.abs(actual.bins[64]!.amplitude - expected) < 1e-12,
		`The complete ending window must contribute: ${actual.bins[64]!.amplitude} versus ${expected}.`);
});

test('the actual Plot Spectrum report worker identifies the selected ending tone', () => {
	const report = calculateAudioAnalysisReport({ kind: 'spectrum', channels: [endingRecording()],
		sampleRate: RATE, scope: 'master', range: { startFrame: 0, endFrame: RATE }, options: { size: SIZE } });
	assert.ok('peak' in report && report.peak, 'A spectrum report must include its peak.');
	assert.equal(report.peak.frequency, 1500);
	assert.ok(report.peak.db > -40, `The audible ending tone must appear above silence: ${report.peak.db}.`);
});

test('an offset analysis includes the final complete window without adding padded silence', () => {
	const input = endingRecording();
	const offsetFrame = 1000;
	const ending = calculateAudioSpectrum([input], RATE, { size: SIZE, offsetFrame: input.length - SIZE });
	const windows = Math.floor((input.length - offsetFrame - SIZE) / (SIZE / 2)) + 2;
	const averaged = calculateAudioSpectrum([input], RATE, { size: SIZE, offsetFrame, average: true });
	assert.ok(Math.abs(averaged.bins[64]!.amplitude - ending.bins[64]!.amplitude / Math.sqrt(windows)) < 1e-12);
});

test('hop-aligned complete selections retain their existing averaging weights', () => {
	const input = Float32Array.from({ length: SIZE + SIZE / 2 }, (_, frame) =>
		(frame < SIZE / 2 ? .1 : .5) * Math.sin(2 * Math.PI * 32 * frame / SIZE));
	const first = calculateAudioSpectrum([input], RATE, { size: SIZE }).bins[32]!.amplitude;
	const second = calculateAudioSpectrum([input], RATE, { size: SIZE, offsetFrame: SIZE / 2 }).bins[32]!.amplitude;
	const actual = calculateAudioSpectrum([input], RATE, { size: SIZE, average: true }).bins[32]!.amplitude;
	assert.ok(Math.abs(actual - Math.sqrt((first * first + second * second) / 2)) < 1e-12,
		'The final aligned window must be counted once.');
});
