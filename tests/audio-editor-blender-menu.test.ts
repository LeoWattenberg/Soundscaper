/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBlenderApplicationMenuItems } from '../src/common/editor/ui/blender-application-menu.ts';
import { materializeApplicationMenu } from '../src/common/editor/ui/application-menu-materialization.ts';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../src/common/i18n/editor-copy-inventory.ts';

test('Blender export and connection are localized opt-in menu entries', () => {
	const context = { blocked: false, materialAvailable: true, copy: EDITOR_ENGLISH_COPY };
	assert.deepEqual(createBlenderApplicationMenuItems(null, context), { file: [], tools: [] });
	let active = false;
	const calls: string[] = [];
	const port = { active: () => active, busy: () => false,
		exportTracks: () => { calls.push('export'); }, toggleLiveSync: () => { active = !active; calls.push('sync'); } };
	const menu = createBlenderApplicationMenuItems(port, context);
	assert.equal(menu.file[0]?.label, 'Export track list for Blender');
	assert.equal(menu.tools[0]?.label, 'Start live Blender sync');
	menu.file[0]?.onClick();
	menu.tools[0]?.onClick();
	assert.deepEqual(calls, ['export', 'sync']);
	assert.equal(materializeApplicationMenu(menu.tools[0]!).disabled, true);
	assert.equal(materializeApplicationMenu(menu.tools[1]!).disabled, false);
	assert.equal(materializeApplicationMenu(menu.file[0]!).disabled, true);
	const german = createBlenderApplicationMenuItems(port, { ...context, copy: EDITOR_GERMAN_COPY });
	assert.equal(german.file[0]?.label, 'Spurliste für Blender exportieren');
	assert.equal(german.tools[1]?.label, 'Live-Synchronisierung mit Blender beenden');
});

test('Blender sync can always stop after audio removal or a blocked editing state', () => {
	const port = { active: () => true, busy: () => false, exportTracks: () => undefined, toggleLiveSync: () => undefined };
	const menu = createBlenderApplicationMenuItems(port, { copy: {}, blocked: true, materialAvailable: false });
	assert.equal(menu.file[0]?.disabled, true);
	assert.equal(menu.tools[1]?.disabled, false);
	const pending = createBlenderApplicationMenuItems({ ...port, busy: () => true }, { copy: {}, blocked: false, materialAvailable: true });
	assert.equal(pending.file[0]?.disabled, true);
	assert.equal(pending.tools[1]?.disabled, false, 'a running render can be stopped from its menu');
});
