/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_PLAYBACK_METER_SETTINGS } from '../src/common/editor/ui/meter-settings.ts';
import { resolveMeterPanelSettingsChange } from '../src/common/editor/ui/workspace/meter-panel-settings.ts';

test('choosing a meter panel opens it and toolbar or flyout placements close it', () => {
	const current = { ...DEFAULT_PLAYBACK_METER_SETTINGS };
	const opened = resolveMeterPanelSettingsChange(current, (settings) => ({ ...settings, position: 'panel' }));
	assert.equal(opened.panelVisible, true);
	assert.equal(opened.settings.position, 'panel');
	for (const position of ['top', 'flyout'] as const) {
		const closed = resolveMeterPanelSettingsChange(opened.settings, (settings) => ({ ...settings, position }), true);
		assert.equal(closed.panelVisible, false, position);
		assert.equal(closed.settings.position, position);
	}
	assert.deepEqual(current, DEFAULT_PLAYBACK_METER_SETTINGS, 'the stored source remains immutable');
});

test('editing a panel opened through View keeps the panel visible and resolves one updater', () => {
	const current = { ...DEFAULT_PLAYBACK_METER_SETTINGS };
	let calls = 0;
	const result = resolveMeterPanelSettingsChange(current, (settings) => {
		calls += 1;
		assert.equal(settings.position, 'panel');
		return { ...settings, dbRange: 96, style: 'gradient' };
	}, true);
	assert.equal(calls, 1);
	assert.equal(result.panelVisible, true);
	assert.deepEqual(result.settings, { ...current, position: 'panel', dbRange: 96, style: 'gradient' });
});

test('editing the default narrow meter keeps its panel placement', () => {
	const result = resolveMeterPanelSettingsChange(DEFAULT_PLAYBACK_METER_SETTINGS, (settings) => ({ ...settings, style: 'rms' }));
	assert.equal(result.panelVisible, true);
	assert.equal(result.settings.position, 'panel');
	assert.equal(result.settings.style, 'rms');
});
