/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { DEFAULT_FLOATING_PANEL_GEOMETRY, DEFAULT_PANELS } from '../src/common/editor/workspace-layout-defaults.ts';
import { placeWorkspacePanel, setWorkspacePanelDockExtent, setWorkspacePanelFrameSize } from '../src/common/editor/workspace-panel-layout.ts';
import { clampFloatingPanelGeometry, workspacePanelMinimumWidth } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { DEFAULT_PLAYBACK_METER_SETTINGS, METER_POSITIONS, normalizeMeterSettings } from '../src/common/editor/ui/meter-settings.ts';

test('sidebar meter preferences migrate to the single panel position', () => {
	assert.deepEqual(METER_POSITIONS, ['flyout', 'top', 'panel']);
	assert.equal(DEFAULT_PLAYBACK_METER_SETTINGS.position, 'panel');
	assert.equal(normalizeMeterSettings({ position: 'side' }, { ...DEFAULT_PLAYBACK_METER_SETTINGS, position: 'top' }).position, 'panel');
	assert.equal(normalizeMeterSettings({ position: 'top' }, DEFAULT_PLAYBACK_METER_SETTINGS).position, 'top');
});

test('meter dock and floating defaults retain the current 72-pixel sidebar width', () => {
	const preferences = createAudioEditorPreferencesV1();
	for (const panelId of ['playback-meter', 'recording-meter'] as const) {
		assert.equal(DEFAULT_PANELS[panelId].width, 72);
		assert.equal(DEFAULT_PANELS[panelId].size, 260, 'side dock height remains useful for stacked panels');
		assert.equal(DEFAULT_FLOATING_PANEL_GEOMETRY[panelId].width, 72);
		assert.equal(preferences.workspace.panels[panelId].width, 72);
		assert.equal(workspacePanelMinimumWidth(panelId), 72);
		assert.equal(clampFloatingPanelGeometry({ width: 20, height: 520 }, { width: 800, height: 600 }, panelId).width, 72);
		assert.equal(clampFloatingPanelGeometry({ width: 20, height: 520 }, {}, panelId).width, 72);
		assert.equal(clampFloatingPanelGeometry({ width: 500, height: 520 }, { width: 50, height: 600 }, panelId).width, 50);
	}
	assert.equal(workspacePanelMinimumWidth('history'), 240);
	assert.equal(clampFloatingPanelGeometry({ width: 72, height: 520 }, { width: 800, height: 600 }, 'history').width, 240);
});

test('meter widths survive saving and narrow dock resizing without weakening other panel limits', () => {
	const preferences = createAudioEditorPreferencesV1({ workspace: { panels: {
		'playback-meter': { visible: true, dock: 'left', size: 72, width: 72 },
		'recording-meter': { visible: true, dock: 'right', size: 72, width: 72 },
	} } });
	const restored = createAudioEditorPreferencesV1(JSON.parse(JSON.stringify(preferences)));
	assert.equal(restored.workspace.panels['playback-meter'].width, 72);
	const resized = setWorkspacePanelDockExtent(restored.workspace.panels, 'right', { width: 72 });
	assert.equal(resized['recording-meter']?.width, 72);
	assert.equal(setWorkspacePanelFrameSize(resized, 'recording-meter', 72)['recording-meter']?.size, 72);
	assert.throws(() => setWorkspacePanelDockExtent(resized, 'right', { width: 71 }), /between 72 and 4096/u);
	assert.throws(() => setWorkspacePanelDockExtent(resized, 'left', { width: 71 }), /between 72 and 4096/u);
	assert.throws(() => setWorkspacePanelFrameSize(resized, 'history', 72), /between 80 and 4096/u);
	assert.throws(() => createAudioEditorPreferencesV1({ workspace: { panels: { history: { width: 72 } } } }), /between 80 and 4096/u);
	const mixedDock = { ...resized, history: { ...resized.history, visible: true, dock: 'right' } };
	assert.throws(() => setWorkspacePanelDockExtent(mixedDock, 'right', { width: 72 }), /between 80 and 4096/u);
});

test('the former meter panel default width migrates while resized panel widths are retained', () => {
	const preferences = createAudioEditorPreferencesV1({ workspace: { panels: {
		'playback-meter': { visible: false, dock: 'right', size: 240, width: 240, height: 520 },
		'recording-meter': { visible: true, dock: 'floating', size: 240, width: 410, height: 520 },
	} } });
	assert.equal(preferences.workspace.panels['playback-meter'].width, 72);
	assert.equal(preferences.workspace.panels['playback-meter'].size, 260, 'migrate the legacy tuple only once');
	assert.equal(preferences.workspace.panels['recording-meter'].width, 410);
	const resized = createAudioEditorPreferencesV1({ workspace: { panels: {
		...preferences.workspace.panels,
		'playback-meter': { ...preferences.workspace.panels['playback-meter'], width: 240 },
	} } });
	assert.equal(resized.workspace.panels['playback-meter'].width, 240, 'an intentional resize may use the former default width');
	const restored = createAudioEditorPreferencesV1(JSON.parse(JSON.stringify(resized)));
	assert.equal(restored.workspace.panels['playback-meter'].width, 240, 'the resized width also survives a subsequent save and reload');
});

test('ordinary panels can join a narrow meter dock and tab group without invalid persisted geometry', () => {
	const initial = createAudioEditorPreferencesV1({ workspace: { panels: {
		'playback-meter': { visible: true, dock: 'right', width: 72 },
		history: { visible: true, dock: 'left', width: 320 },
	} } });
	for (const kind of ['before', 'tab', 'after'] as const) {
		const panels = placeWorkspacePanel(initial.workspace.panels, 'history', { kind, targetPanelId: 'playback-meter' });
		assert.ok(Number(panels.history?.width) >= 80, kind);
		if (kind !== 'tab') assert.equal(panels.history?.width, 320, 'a narrow meter dock retains the incoming panel width');
		assert.doesNotThrow(() => createAudioEditorPreferencesV1({ workspace: { panels } }), kind);
	}
	const panels = placeWorkspacePanel(initial.workspace.panels, 'history', { kind: 'dock', dock: 'right', groupIndex: 1 });
	assert.doesNotThrow(() => createAudioEditorPreferencesV1({ workspace: { panels } }));
});

test('a spreadsheet keeps its useful width when passing through a narrow meter dock before floating', () => {
	for (const meterWidth of [72, 76]) {
		const initial = createAudioEditorPreferencesV1({ workspace: { panels: {
			'playback-meter': { visible: true, dock: 'right', width: meterWidth },
			'recording-meter': { visible: true, dock: 'right', width: meterWidth },
			'clip-spreadsheet': { visible: true, dock: 'bottom', width: 1000 },
		} } });
		const side = placeWorkspacePanel(initial.workspace.panels, 'clip-spreadsheet', { kind: 'dock', dock: 'right', groupIndex: 2 });
		assert.equal(side['clip-spreadsheet']?.width, 1000);
		assert.equal(side['playback-meter']?.width, meterWidth, 'a placement preserves the meter width preference');
		const floated = placeWorkspacePanel(side, 'clip-spreadsheet', { kind: 'dock', dock: 'floating', groupIndex: 0 });
		const restored = createAudioEditorPreferencesV1({ workspace: { panels: floated } });
		const geometry = clampFloatingPanelGeometry(restored.workspace.panels['clip-spreadsheet'], { width: 1200, height: 800 }, 'clip-spreadsheet');
		assert.equal(geometry.width, 1000);
		assert.equal(clampFloatingPanelGeometry({ ...geometry, width: geometry.width - 48 }, { width: 1200, height: 800 }, 'clip-spreadsheet').width, 952);
	}
});
