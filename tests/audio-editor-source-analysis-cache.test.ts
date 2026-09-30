/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FREQUENCY_WAVEFORM_CACHE_PREFIX,
	LEGACY_WAVEFORM_PEAK_CACHE_PREFIX,
	SOURCE_ANALYSIS_CACHE_PREFIXES,
	WAVEFORM_PEAK_CACHE_PREFIX,
	frequencyWaveformCacheKey,
	legacyPeakCacheKey,
	peakCacheKey,
} from '../src/common/editor/source-analysis-cache.ts';

test('source analysis cache owner preserves every persisted namespace and key byte', () => {
	assert.deepEqual(SOURCE_ANALYSIS_CACHE_PREFIXES, [
		'audio-editor-peaks-v1:',
		'audio-editor-peaks-v2:',
		'audio-editor-frequency-waveform-v1:',
	]);
	assert.equal(LEGACY_WAVEFORM_PEAK_CACHE_PREFIX, 'audio-editor-peaks-v1:');
	assert.equal(WAVEFORM_PEAK_CACHE_PREFIX, 'audio-editor-peaks-v2:');
	assert.equal(FREQUENCY_WAVEFORM_CACHE_PREFIX, 'audio-editor-frequency-waveform-v1:');
	assert.equal(legacyPeakCacheKey('source / one'), 'audio-editor-peaks-v1:source / one');
	assert.equal(peakCacheKey('source / one'), 'audio-editor-peaks-v2:source / one');
	assert.equal(frequencyWaveformCacheKey('source / one'), 'audio-editor-frequency-waveform-v1:source / one');
	assert.equal(peakCacheKey(null), 'audio-editor-peaks-v2:null');
	assert.equal(Object.isFrozen(SOURCE_ANALYSIS_CACHE_PREFIXES), true);
});
