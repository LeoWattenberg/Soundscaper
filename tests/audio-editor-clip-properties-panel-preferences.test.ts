/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyAudioEditorWorkspace,
	createAudioEditorPreferencesV1,
	createCustomAudioEditorWorkspace,
	loadAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';
import { AUDIO_EDITOR_BUILT_IN_WORKSPACES } from '../src/common/editor/workspace-layout-defaults.ts';
import { placeWorkspacePanel, setWorkspacePanelDockExtent } from '../src/common/editor/workspace-panel-layout.ts';
import {
	WORKSPACE_DISCOVERABLE_PANEL_IDS,
	workspacePanelLabel,
} from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

test('Clip properties is an optional hidden bottom panel in fresh and older preferences', () => {
	const preferences = createAudioEditorPreferencesV1();
	assert.deepEqual(preferences.workspace.panels['clip-properties'], {
		visible: false, dock: 'bottom', order: 15, size: 400,
		x: 272, y: 192, width: 400, height: 520,
	});
	const older = { ...preferences, workspace: { ...preferences.workspace, panels: { ...preferences.workspace.panels } } };
	delete older.workspace.panels['clip-properties'];
	const restored = loadAudioEditorPreferencesV1(older).preferences;
	assert.deepEqual(restored.workspace.panels['clip-properties'], preferences.workspace.panels['clip-properties']);
	assert.ok(WORKSPACE_DISCOVERABLE_PANEL_IDS.includes('clip-properties'));
	assert.equal(workspacePanelLabel(ENGLISH_COPY, 'clip-properties'), ENGLISH_COPY.clipPropertiesCommand);
	assert.equal(workspacePanelLabel(GERMAN_COPY, 'clip-properties'), GERMAN_COPY.clipPropertiesCommand);
});

test('switching to every built-in preset hides an opened Clip properties panel', () => {
	const preferences = createAudioEditorPreferencesV1({
		workspace: { panels: { 'clip-properties': { visible: true, dock: 'floating' } } },
	});
	for (const workspaceId of AUDIO_EDITOR_BUILT_IN_WORKSPACES) {
		const applied = applyAudioEditorWorkspace(preferences, workspaceId);
		assert.equal(applied.workspace.panels['clip-properties'].visible, false, workspaceId);
		assert.equal(applied.workspace.panels['clip-properties'].dock, 'bottom', workspaceId);
	}
});

test('a saved custom workspace restores Clip properties as an active resized docking tab', () => {
	const preferences = createAudioEditorPreferencesV1({
		workspace: { panels: {
			history: { visible: true, dock: 'top', order: 0 },
			'clip-properties': { visible: true, dock: 'right', order: 0 },
		} },
	});
	let panels = placeWorkspacePanel(preferences.workspace.panels, 'clip-properties', { kind: 'tab', targetPanelId: 'history' });
	panels = setWorkspacePanelDockExtent(panels, 'top', { size: 420 });
	const saved = createCustomAudioEditorWorkspace(createAudioEditorPreferencesV1({
		...preferences, workspace: { ...preferences.workspace, panels },
	}), { id: 'inspection', name: 'Inspection' });
	const switched = applyAudioEditorWorkspace(saved, 'classic');
	const restored = applyAudioEditorWorkspace(loadAudioEditorPreferencesV1(switched).preferences, 'inspection');
	const inspector = restored.workspace.panels['clip-properties'];
	assert.equal(inspector.visible, true);
	assert.equal(inspector.dock, 'top');
	assert.equal(inspector.size, 420);
	assert.equal(inspector.tabGroup, restored.workspace.panels.history.tabGroup);
	assert.equal(inspector.tabActive, true);
	assert.equal(restored.workspace.panels.history.tabActive, false);
});
