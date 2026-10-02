import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorPreferencesV1, applyAudioEditorWorkspace } from '../src/common/editor/preferences.js';
import { AUDIO_EDITOR_BUILT_IN_WORKSPACES } from '../src/common/editor/workspace-layout-defaults.ts';
import { workspaceSideDockAllowsWidePanels } from '../src/common/editor/ui/workspace/workspace-side-dock-width.ts';

test('default side panels retain the responsive cap in every built-in workspace', () => {
	for (const workspaceId of AUDIO_EDITOR_BUILT_IN_WORKSPACES) {
		const preferences = applyAudioEditorWorkspace(createAudioEditorPreferencesV1(), workspaceId);
		for (const dock of ['left', 'right']) {
			const panels = Object.entries(preferences.workspace.panels).filter(([, panel]) => panel.visible && panel.dock === dock);
			assert.equal(workspaceSideDockAllowsWidePanels(panels, workspaceId), false, `${workspaceId} ${dock}`);
		}
	}
	assert.equal(workspaceSideDockAllowsWidePanels([['project-bin', { width: 380 }]]), false);
	assert.equal(workspaceSideDockAllowsWidePanels([['history', { width: 300 }]], 'classic'), false);
});

test('a resized side panel can exceed the responsive cap after preference reload', () => {
	const preferences = createAudioEditorPreferencesV1({
		workspace: { panels: { 'project-bin': { visible: true, dock: 'left', width: 580 } } },
	});
	const restored = createAudioEditorPreferencesV1(JSON.parse(JSON.stringify(preferences)));
	assert.equal(workspaceSideDockAllowsWidePanels([['project-bin', restored.workspace.panels['project-bin']]]), true);
	assert.equal(workspaceSideDockAllowsWidePanels([['project-bin', { width: 334 }]]), true,
		'a tablet resize below the nominal default still represents a customized width');
});

test('Clock and meter side panels can use their available width without changing untouched docks', () => {
	const preferences = createAudioEditorPreferencesV1();
	for (const panelId of ['clock', 'playback-meter', 'recording-meter']) {
		assert.equal(workspaceSideDockAllowsWidePanels([[panelId, preferences.workspace.panels[panelId]]]), true, panelId);
	}
	assert.equal(workspaceSideDockAllowsWidePanels([]), false);
	assert.equal(workspaceSideDockAllowsWidePanels([['history', { width: 320 }]]), false);
});
