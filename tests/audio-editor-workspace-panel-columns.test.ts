/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorPreferencesV1, applyAudioEditorWorkspace } from '../src/common/editor/preferences.js';
import { groupWorkspacePanelEntries, placeWorkspacePanel, setWorkspacePanelDockExtent } from '../src/common/editor/workspace-panel-layout.ts';
import { groupWorkspacePanelColumns } from '../src/common/editor/workspace-panel-columns.ts';

function fixture() {
	return createAudioEditorPreferencesV1({ workspace: { panels: {
		history: { visible: true, dock: 'right', width: 320 },
		metadata: { visible: true, dock: 'right', width: 380 },
	} } }).workspace.panels;
}

test('default meter positions occupy separate columns in each preset and on preference reload', () => {
	for (const preset of ['modern', 'audacity', 'classic', 'music', 'video-editor']) {
		const preferences = applyAudioEditorWorkspace(createAudioEditorPreferencesV1(), preset);
		const panels = createAudioEditorPreferencesV1(JSON.parse(JSON.stringify(preferences))).workspace.panels;
		assert.equal(panels['playback-meter'].column, 1);
		assert.equal(panels['recording-meter'].column, 2);
		assert.equal(panels['playback-meter'].dock, 'right');
		assert.equal(panels['recording-meter'].dock, 'right');
	}
});

test('placing a panel beside another creates a column while preserving stacked neighbors and independent widths', () => {
	let panels = fixture();
	panels = placeWorkspacePanel(panels, 'metadata', { kind: 'right', targetPanelId: 'history' });
	assert.equal(panels.history.column ?? 0, 0);
	assert.equal(panels.metadata.column, 1);
	assert.equal(panels.metadata.width, 380);
	const columns = groupWorkspacePanelColumns(groupWorkspacePanelEntries(Object.entries(panels).filter(([, panel]) => panel.visible)));
	assert.deepEqual(columns.map((column) => column.groups.map((group) => group.activePanelId)), [['history'], ['metadata']]);
	panels = placeWorkspacePanel(panels, 'labels', { kind: 'before', targetPanelId: 'metadata' });
	assert.equal(panels.labels.column, 1);
	panels = placeWorkspacePanel(panels, 'metadata', { kind: 'left', targetPanelId: 'history' });
	assert.equal(panels.metadata.column, 0);
	assert.equal(panels.history.column, 1);
	assert.equal(panels.labels.column, 2);
	assert.equal(panels['playback-meter'].column, 3, 'hidden columns retain their relative position');
	assert.equal(fixture().metadata.column, undefined, 'the input remains unchanged');
});

test('tabbing and docking join the target column and leaving a side dock clears column metadata', () => {
	let panels = placeWorkspacePanel(fixture(), 'metadata', { kind: 'right', targetPanelId: 'history' });
	panels = placeWorkspacePanel(panels, 'labels', { kind: 'tab', targetPanelId: 'metadata' });
	assert.equal(panels.labels.column, panels.metadata.column);
	panels = placeWorkspacePanel(panels, 'playback-meter', { kind: 'before', targetPanelId: 'history' });
	assert.equal(createAudioEditorPreferencesV1({ workspace: { panels } }).workspace.panels['playback-meter'].column, 0);
	panels = placeWorkspacePanel(panels, 'metadata', { kind: 'dock', dock: 'bottom', groupIndex: 0 });
	assert.equal(panels.metadata.column, undefined);
	assert.equal(panels.labels.column, 1);
	panels = placeWorkspacePanel(panels, 'metadata', { kind: 'after', targetPanelId: 'labels' });
	assert.equal(panels.metadata.column, 1);
	assert.throws(() => placeWorkspacePanel(panels, 'history', { kind: 'right', targetPanelId: 'mixer' }), /side dock/u);
});

test('column preferences validate indices and repair tab groups to one column', () => {
	for (const column of [-1, 0.5, '1', Number.NaN]) {
		assert.throws(() => createAudioEditorPreferencesV1({ workspace: { panels: { history: { column } } } }), /column/u);
	}
	const preferences = createAudioEditorPreferencesV1({ workspace: { panels: {
		history: { column: 4, tabGroup: 'inspectors', tabActive: true },
		metadata: { column: 6, tabGroup: 'inspectors' },
		mixer: { column: 3 },
	} } });
	assert.equal(preferences.workspace.panels.metadata.column, 4);
	assert.equal(preferences.workspace.panels.mixer.column, undefined);
});

test('resizing a side dock distributes its width among visible columns and preserves compact meters', () => {
	let panels = fixture();
	panels = placeWorkspacePanel(panels, 'metadata', { kind: 'right', targetPanelId: 'history' });
	panels = setWorkspacePanelDockExtent(panels, 'right', { width: 840 });
	assert.equal(panels.history.width, 384);
	assert.equal(panels.metadata.width, 456);
	const restored = createAudioEditorPreferencesV1({ workspace: { panels } }).workspace.panels;
	assert.equal(restored.metadata.width, 456);
	assert.equal(restored.metadata.column, 1);
	const meters = createAudioEditorPreferencesV1({ workspace: { panels: {
		'playback-meter': { visible: true }, 'recording-meter': { visible: true },
	} } }).workspace.panels;
	const resized = setWorkspacePanelDockExtent(meters, 'right', { width: 216 });
	assert.equal(resized['playback-meter'].width, 108);
	assert.equal(resized['recording-meter'].width, 108);
	assert.equal(resized.history.width, meters.history.width);
});

test('column resizing respects ordinary panel minima without increasing the restored total width', () => {
	let panels = fixture();
	panels = placeWorkspacePanel(panels, 'metadata', { kind: 'right', targetPanelId: 'history' });
	panels = { ...panels, metadata: { ...panels.metadata, width: 1000 } };
	const resized = setWorkspacePanelDockExtent(panels, 'right', { width: 480 });
	assert.equal(resized.history.width, 240);
	assert.equal(resized.metadata.width, 240);
});
