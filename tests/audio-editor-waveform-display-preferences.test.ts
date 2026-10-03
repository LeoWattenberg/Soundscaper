/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAudioEditorPreferencesV1,
	loadAudioEditorPreferencesV1,
	updateAudioEditorPreferencesV1,
	validateAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';
import {
	DEFAULT_WAVEFORM_DISPLAY_PREFERENCES,
	normalizeWaveformDisplayPreferences,
} from '../src/common/editor/waveform-display-preferences.ts';

test('waveform display preferences supply compatible defaults for older stored preferences', () => {
	assert.deepEqual(normalizeWaveformDisplayPreferences(), {
		rulerFormat: 'linear-db', halfWave: false,
	});
	assert.deepEqual(normalizeWaveformDisplayPreferences({ halfWave: true }), {
		rulerFormat: 'linear-db', halfWave: true,
	});
	assert.ok(Object.isFrozen(DEFAULT_WAVEFORM_DISPLAY_PREFERENCES));
	assert.ok(Object.isFrozen(normalizeWaveformDisplayPreferences({})));
	const legacy: Record<string, unknown> = { ...createAudioEditorPreferencesV1() };
	delete legacy.waveformDisplay;
	assert.deepEqual(loadAudioEditorPreferencesV1(legacy).preferences.waveformDisplay,
		DEFAULT_WAVEFORM_DISPLAY_PREFERENCES);
});

test('waveform display preferences merge independently and survive persistence', () => {
	for (const rulerFormat of ['linear-db', 'linear-amp', 'logarithmic-db'] as const) {
		const preferences = createAudioEditorPreferencesV1({
			waveformDisplay: { rulerFormat, halfWave: true },
		});
		const updated = updateAudioEditorPreferencesV1(preferences, {
			waveformDisplay: { halfWave: false },
		});
		assert.deepEqual(updated.waveformDisplay, { rulerFormat, halfWave: false });
		assert.deepEqual(preferences.waveformDisplay, { rulerFormat, halfWave: true });
		assert.deepEqual(updated.waveformVisualization, preferences.waveformVisualization);
		assert.deepEqual(loadAudioEditorPreferencesV1(JSON.parse(JSON.stringify(updated)))
			.preferences.waveformDisplay, updated.waveformDisplay);
		assert.equal(validateAudioEditorPreferencesV1(updated), true);
	}
});

test('waveform display preferences reject invalid values and non-data records', () => {
	for (const value of [null, [], false, 'linear-db', new Date(), { unknown: true },
		{ [Symbol('unexpected')]: true }]) {
		assert.throws(() => normalizeWaveformDisplayPreferences(value), TypeError);
	}
	for (const rulerFormat of [null, false, 1, '', 'linear', 'db']) {
		assert.throws(() => normalizeWaveformDisplayPreferences({ rulerFormat }), RangeError);
	}
	for (const halfWave of [null, 'true', 1, {}]) {
		assert.throws(() => normalizeWaveformDisplayPreferences({ halfWave }), TypeError);
	}
	let getterRead = false;
	const accessor = Object.defineProperty({}, 'halfWave', {
		enumerable: true, get() { getterRead = true; return true; },
	});
	assert.throws(() => normalizeWaveformDisplayPreferences(accessor), TypeError);
	assert.equal(getterRead, false);
	assert.throws(() => normalizeWaveformDisplayPreferences(
		Object.defineProperty({}, 'rulerFormat', { value: 'linear-amp' }),
	), TypeError);
	assert.deepEqual(normalizeWaveformDisplayPreferences(Object.create(null)),
		DEFAULT_WAVEFORM_DISPLAY_PREFERENCES);
	assert.throws(() => createAudioEditorPreferencesV1({ waveformDisplay: { halfWave: 1 } }), TypeError);
	assert.throws(() => validateAudioEditorPreferencesV1({
		...createAudioEditorPreferencesV1(), waveformDisplay: { rulerFormat: 'invalid' },
	}), RangeError);
});
