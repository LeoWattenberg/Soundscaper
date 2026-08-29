/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The peak pyramid version is a contract between the analysis code that stamps
 * it and the renderer that refuses anything else. Both sides once declared the
 * number themselves, so bumping one — the reason to bump it at all being that
 * the stored values changed — made the renderer reject every freshly generated
 * pyramid instead of redrawing it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	WAVEFORM_PEAKS_VERSION,
	generateWaveformPeaksFallback,
} from '../src/common/editor/controller/waveform-analysis.ts';
import {
	validateWaveformPeakLevels,
} from '../src/common/editor/design-system-adapters/waveform-internals.ts';
import {
	WAVEFORM_PEAKS_VERSION as CONTRACT_VERSION,
} from '../src/common/editor/waveform-peak-contract.ts';

test('the renderer accepts the pyramid the analysis code produces', () => {
	const peaks = generateWaveformPeaksFallback([new Float32Array(4_096).fill(0.25)]);

	assert.equal(peaks.version, WAVEFORM_PEAKS_VERSION);
	const validated = validateWaveformPeakLevels(peaks);
	assert.equal(validated.levels.length, peaks.levels.length);
});

test('one contract module owns the peak pyramid version', () => {
	assert.equal(WAVEFORM_PEAKS_VERSION, CONTRACT_VERSION);
});
