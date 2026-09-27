/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_PANELS } from '../src/common/editor/workspace-layout-defaults.ts';
import { normalizePanelEntries } from '../src/common/editor/workspace-preference-normalization.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

const retired = ['spectrum', 'clipping', 'contrast', 'ebu-r128'];

test('offline analyzers retire their saved workspace panels while the live Analysis panel remains opt-in', () => {
	const normalized = normalizePanelEntries(Object.fromEntries(retired.map((id) => [id, {
		visible: true, dock: 'right', order: 1, size: 380,
	}])));
	assert.equal(normalized.analysis.visible, true, 'a visible retired analyzer reopens the combined panel');
	assert.equal(normalizePanelEntries({}).analysis.visible, false);
	assert.equal(DEFAULT_PANELS.analysis.visible, false);
	for (const id of retired) {
		assert.equal(WORKSPACE_PANEL_IDS.includes(id), false);
		assert.equal(Object.hasOwn(DEFAULT_PANELS, id), false);
		assert.equal(Object.hasOwn(normalized, id), false);
	}
});
