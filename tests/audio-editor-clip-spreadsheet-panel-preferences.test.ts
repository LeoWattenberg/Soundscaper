/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	applyAudioEditorWorkspace, createAudioEditorPreferencesV1,
	createCustomAudioEditorWorkspace, loadAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';
import { AUDIO_EDITOR_BUILT_IN_WORKSPACES } from '../src/common/editor/workspace-layout-defaults.ts';
import { placeWorkspacePanel, setWorkspacePanelDockExtent } from '../src/common/editor/workspace-panel-layout.ts';
import { WORKSPACE_DISCOVERABLE_PANEL_IDS, workspacePanelLabel } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { workspacePanelAvailable } from '../src/common/editor/ui/framescaper-capture-ui-model.ts';

test('the clip spreadsheet is a hidden bottom panel in new and restored preferences', () => {
	const preferences = createAudioEditorPreferencesV1();
	assert.deepEqual(preferences.workspace.panels['clip-spreadsheet'], {
		visible: false, dock: 'bottom', order: 16, size: 360,
		x: 48, y: 96, width: 1000, height: 460,
	});
	const older = { ...preferences, workspace: { ...preferences.workspace, panels: { ...preferences.workspace.panels } } };
	delete older.workspace.panels['clip-spreadsheet'];
	assert.deepEqual(loadAudioEditorPreferencesV1(older).preferences.workspace.panels['clip-spreadsheet'],
		preferences.workspace.panels['clip-spreadsheet']);
	assert.ok(WORKSPACE_DISCOVERABLE_PANEL_IDS.includes('clip-spreadsheet'));
	assert.equal(workspacePanelLabel(EDITOR_ENGLISH_COPY, 'clip-spreadsheet'), 'Clip spreadsheet');
	assert.equal(workspacePanelLabel(EDITOR_GERMAN_COPY, 'clip-spreadsheet'), 'Clip-Tabelle');
	assert.equal(workspacePanelAvailable('soundscaper', 'clip-spreadsheet'), true);
	assert.equal(workspacePanelAvailable('framescaper', 'clip-spreadsheet'), false);
});

test('all built-in workspaces leave the spreadsheet hidden until opened from the menu', () => {
	const preferences = createAudioEditorPreferencesV1({
		workspace: { panels: { 'clip-spreadsheet': { visible: true, dock: 'floating' } } },
	});
	for (const workspaceId of AUDIO_EDITOR_BUILT_IN_WORKSPACES) {
		const applied = applyAudioEditorWorkspace(preferences, workspaceId);
		assert.equal(applied.workspace.panels['clip-spreadsheet'].visible, false, workspaceId);
		assert.equal(applied.workspace.panels['clip-spreadsheet'].dock, 'bottom', workspaceId);
	}
});

test('a custom workspace restores the resized spreadsheet as a docking tab', () => {
	const preferences = createAudioEditorPreferencesV1({ workspace: { panels: {
		history: { visible: true, dock: 'top', order: 0 },
		'clip-spreadsheet': { visible: true, dock: 'right', order: 0 },
	} } });
	let panels = placeWorkspacePanel(preferences.workspace.panels, 'clip-spreadsheet', { kind: 'tab', targetPanelId: 'history' });
	panels = setWorkspacePanelDockExtent(panels, 'top', { size: 420 });
	const saved = createCustomAudioEditorWorkspace(createAudioEditorPreferencesV1({
		...preferences, workspace: { ...preferences.workspace, panels },
	}), { id: 'spreadsheet', name: 'Spreadsheet' });
	const switched = applyAudioEditorWorkspace(saved, 'classic');
	const restored = applyAudioEditorWorkspace(loadAudioEditorPreferencesV1(switched).preferences, 'spreadsheet');
	const panel = restored.workspace.panels['clip-spreadsheet'];
	assert.equal(panel.visible, true);
	assert.equal(panel.dock, 'top');
	assert.equal(panel.size, 420);
	assert.equal(panel.tabGroup, restored.workspace.panels.history.tabGroup);
	assert.equal(panel.tabActive, true);
});
