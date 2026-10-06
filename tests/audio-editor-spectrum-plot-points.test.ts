/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAudioSpectrum } from '../src/common/editor/audio-spectrum.ts';
import { spectrumPlotPoints } from '../src/common/editor/ui/dialogs/spectrum-plot-points.ts';

test('the logarithmic curve retains measured narrow-band peaks across the audio range', () => {
	for (const frequency of [100, 440, 1_000, 10_000, 22_000]) {
		const channel = Float32Array.from({ length: 48_000 }, (_, frame) => 0.35 * Math.sin(2 * Math.PI * frequency * frame / 48_000));
		const spectrum = calculateAudioSpectrum([channel], 48_000, { average: true });
		const measuredPeak = Math.max(...spectrum.bins.map(({ db }) => db));
		const plottedPeak = -Math.min(...spectrumPlotPoints(spectrum.bins).split(' ').map((point) => Number(point.split(',')[1]))) / 150 * 120;
		assert.ok(Math.abs(plottedPeak - measuredPeak) < 0.5, `${String(frequency)} Hz: ${String(plottedPeak)} versus ${String(measuredPeak)} dB`);
	}
});

test('silence and empty reports remain at the graph floor', () => {
	for (const bins of [[], [{ db: -120 }]]) {
		assert.ok(spectrumPlotPoints(bins).split(' ').every((point) => point.endsWith(',150')));
	}
});
