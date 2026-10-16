/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	applyAudioEditorWorkspace, createAudioEditorPreferencesV1,
	createCustomAudioEditorWorkspace, loadAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';
import { AUDIO_EDITOR_BUILT_IN_WORKSPACES } from '../src/common/editor/workspace-layout-defaults.ts';
import { placeWorkspacePanel } from '../src/common/editor/workspace-panel-layout.ts';
import { WORKSPACE_DISCOVERABLE_PANEL_IDS, workspacePanelLabel } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { workspacePanelAvailable } from '../src/common/editor/ui/framescaper-capture-ui-model.ts';
import { workspacePanelAvailable as soundscaperPanelAvailable } from '../src/soundscaper/editor-workspace-panel-runtime.ts';
import { APPLICATION_MENU_REFERENCE_ENTRIES } from '../src/common/editor/ui/application-menu-reference.ts';

test('audio.com is a hidden, discoverable Soundscaper panel and migrates older preferences', () => {
	const preferences = createAudioEditorPreferencesV1();
	assert.deepEqual(preferences.workspace.panels.audiocom, {
		visible: false, dock: 'right', order: 17, size: 400,
		x: 288, y: 232, width: 440, height: 560,
	});
	const older = { ...preferences, workspace: { ...preferences.workspace, panels: { ...preferences.workspace.panels } } };
	delete older.workspace.panels.audiocom;
	assert.deepEqual(loadAudioEditorPreferencesV1(older).preferences.workspace.panels.audiocom,
		preferences.workspace.panels.audiocom);
	assert.ok(WORKSPACE_DISCOVERABLE_PANEL_IDS.includes('audiocom'));
	assert.equal(workspacePanelLabel({}, 'audiocom'), 'audio.com');
	assert.equal(workspacePanelAvailable('soundscaper', 'audiocom'), true);
	assert.equal(workspacePanelAvailable('framescaper', 'audiocom'), false);
	assert.equal(soundscaperPanelAvailable('soundscaper', 'audiocom'), true);
	assert.ok(APPLICATION_MENU_REFERENCE_ENTRIES.some((entry) => entry.id === 'panel-audiocom' && entry.locations.includes('Window')));
});

test('built-in workspaces hide audio.com and a custom workspace retains its chosen dock', () => {
	const preferences = createAudioEditorPreferencesV1({ workspace: { panels: {
		history: { visible: true, dock: 'top' }, audiocom: { visible: true, dock: 'right' },
	} } });
	for (const id of AUDIO_EDITOR_BUILT_IN_WORKSPACES) {
		assert.equal(applyAudioEditorWorkspace(preferences, id).workspace.panels.audiocom.visible, false, id);
	}
	const panels = placeWorkspacePanel(preferences.workspace.panels, 'audiocom', { kind: 'tab', targetPanelId: 'history' });
	const saved = createCustomAudioEditorWorkspace(createAudioEditorPreferencesV1({
		...preferences, workspace: { ...preferences.workspace, panels },
	}), { id: 'publishing', name: 'Publishing' });
	const switched = applyAudioEditorWorkspace(saved, 'classic');
	const restored = applyAudioEditorWorkspace(loadAudioEditorPreferencesV1(switched).preferences, 'publishing');
	assert.equal(restored.workspace.panels.audiocom.visible, true);
	assert.equal(restored.workspace.panels.audiocom.dock, 'top');
	assert.equal(restored.workspace.panels.audiocom.tabGroup, restored.workspace.panels.history.tabGroup);
});
