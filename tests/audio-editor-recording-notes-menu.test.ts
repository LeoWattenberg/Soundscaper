/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_BUILT_IN_WORKSPACES,
	applyAudioEditorWorkspace,
	createAudioEditorPreferencesV1,
	loadAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';
import { createApplicationWindowMenu } from '../src/common/editor/ui/application-window-menu.js';
import { APPLICATION_MENU_REFERENCE_BY_ID } from '../src/common/editor/ui/application-menu-reference.ts';
import { WORKSPACE_DISCOVERABLE_PANEL_IDS, workspacePanelLabel } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

test('recording notes stay hidden in every built-in workspace and older preferences', () => {
	const preferences = createAudioEditorPreferencesV1();
	for (const id of AUDIO_EDITOR_BUILT_IN_WORKSPACES) {
		const applied = applyAudioEditorWorkspace(preferences, id);
		assert.equal(applied.workspace.panels['recording-notes']?.visible, false, id);
	}
	const saved = structuredClone(preferences);
	delete saved.workspace.panels['recording-notes'];
	assert.equal(loadAudioEditorPreferencesV1(saved).preferences.workspace.panels['recording-notes']?.visible, false);
});

test('Window opens recording notes with a localized label and reflects panel visibility', () => {
	assert.ok(WORKSPACE_DISCOVERABLE_PANEL_IDS.includes('recording-notes'));
	assert.equal(workspacePanelLabel(ENGLISH_COPY, 'recording-notes'), 'Recording notes');
	assert.equal(workspacePanelLabel(GERMAN_COPY, 'recording-notes'), 'Aufnahmenotizen');
	const toggled: string[] = [];
	for (const visible of [false, true]) {
		const preferences = createAudioEditorPreferencesV1({
			workspace: { panels: { 'recording-notes': { visible } } },
		});
		const menu = createApplicationWindowMenu({
			blocked: false,
			capabilities: {},
			copy: ENGLISH_COPY,
			divider: () => ({ type: 'separator' }),
			preferences,
			productId: 'soundscaper',
			productItems: { mixer: [] },
			project: null,
			snapshot: {},
		}, { togglePanel: (id: string) => toggled.push(id) }, {});
		const item = menu.items.find((entry: { id?: string }) => entry.id === 'panel-recording-notes');
		assert.ok(item);
		assert.equal(item.label, 'Recording notes');
		assert.equal(item.checked, visible);
		assert.equal(item.visibilityToggle, true);
		item.onClick();
	}
	assert.deepEqual(toggled, ['recording-notes', 'recording-notes']);
	assert.deepEqual(APPLICATION_MENU_REFERENCE_BY_ID['panel-recording-notes']?.locations, ['Window']);
});
