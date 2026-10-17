/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	getLabelMetrics, layoutTimelineLabels, moveLabelRange, stretchLabelRange,
} from '../src/common/editor/ui/timeline/label-design-geometry.ts';
import { normalizeAppearancePreferences } from '../src/common/editor/appearance-preferences.ts';
import { createAudioEditorPreferencesV1, loadAudioEditorPreferencesV1, updateAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';

test('label metrics scale the text strap while keeping the ears and stalk constant', () => {
	assert.deepEqual([getLabelMetrics(9).bannerHeight, getLabelMetrics(48).bannerHeight], [20, 96]);
	assert.equal(getLabelMetrics(48).earWidth, 10);
	assert.equal(getLabelMetrics(48).earHeight, 20);
	assert.equal(normalizeAppearancePreferences().labelTextSizePt, 9);
	assert.equal(normalizeAppearancePreferences({ labelTextSizePt: 24 }).labelTextSizePt, 24);
	assert.throws(() => normalizeAppearancePreferences({ labelTextSizePt: 500 }), /labelTextSizePt/u);
});

test('overlapping labels stack while exact adjacent regions share a single boundary', () => {
	const labels = [
		{ id: 'first', title: 'First', startFrame: 0, endFrame: 100 },
		{ id: 'point', title: 'Point', startFrame: 50, endFrame: 50 },
		{ id: 'second', title: 'Second', startFrame: 100, endFrame: 200 },
	];
	const layout = layoutTimelineLabels(labels, 100, 100, getLabelMetrics(9));
	assert.equal(layout.get('point')?.row, 1);
	assert.equal(layout.get('second')?.row, 0);
	assert.equal(layout.get('first')?.rightNeighbor?.id, 'second');
	assert.equal(layout.get('second')?.leftNeighbor?.id, 'first');
});

test('ear drags collapse at a six pixel detent, invert and magnetically join another edge', () => {
	assert.deepEqual(stretchLabelRange(104, 100, [], 100, 100), { startFrame: 100, endFrame: 100 });
	assert.deepEqual(stretchLabelRange(125, 100, [130], 100, 100), { startFrame: 100, endFrame: 130 });
	assert.deepEqual(stretchLabelRange(70, 100, [], 100, 100), { startFrame: 70, endFrame: 100 });
});

test('banner motion snaps either edge and keeps a frame-exact duration', () => {
	const label = { startFrame: 100, endFrame: 200 };
	assert.deepEqual(moveLabelRange(label, 96, [300], 100, 100), { startFrame: 200, endFrame: 300 });
	assert.deepEqual(moveLabelRange(label, -400, [], 100, 100), { startFrame: 0, endFrame: 100 });
});


test('label text size survives stored preferences and unrelated appearance changes', () => {
	const initial = createAudioEditorPreferencesV1({ appearance: { theme: 'dark', labelTextSizePt: 24 } });
	const resized = updateAudioEditorPreferencesV1(initial, { appearance: { labelTextSizePt: 36 } });
	const stored = loadAudioEditorPreferencesV1(JSON.parse(JSON.stringify(resized))).preferences;
	assert.equal(stored.appearance.labelTextSizePt, 36);
	assert.equal(stored.appearance.theme, 'dark');
	assert.equal(updateAudioEditorPreferencesV1(stored, { appearance: { theme: 'light' } }).appearance.labelTextSizePt, 36);
});
