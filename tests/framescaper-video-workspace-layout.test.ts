/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorPreferencesV1, loadAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { setWorkspacePanelDockExtent } from '../src/common/editor/workspace-panel-layout.ts';

const VIDEO_PANEL_IDS = ['project-bin', 'video-preview', 'source-monitor'] as const;

test('the video workspace starts with three movable panels in one automatically sized top dock', () => {
	const preferences = createAudioEditorPreferencesV1({ workspace: { activeId: 'video-editor' } });
	for (const [order, id] of VIDEO_PANEL_IDS.entries()) {
		assert.equal(preferences.workspace.panels[id].dock, 'top', id);
		assert.equal(preferences.workspace.panels[id].order, order, id);
		assert.equal(preferences.workspace.panels[id].autoSize, true, id);
	}
});

test('a manual top dock resize persists its size and disables automatic monitor sizing', () => {
	const preferences = createAudioEditorPreferencesV1({ workspace: { activeId: 'video-editor' } });
	const panels = setWorkspacePanelDockExtent(preferences.workspace.panels, 'top', { size: 208 });
	const saved = loadAudioEditorPreferencesV1({ ...preferences, workspace: { ...preferences.workspace, panels } });
	for (const id of VIDEO_PANEL_IDS) {
		assert.equal(saved.preferences.workspace.panels[id].size, 208, id);
		assert.equal(saved.preferences.workspace.panels[id].autoSize, false, id);
	}
});

function legacyPreferences() {
	const preferences = createAudioEditorPreferencesV1({ workspace: { activeId: 'video-editor' } });
	const panels = { ...preferences.workspace.panels };
	for (const [id, dock, order, size] of [
		['project-bin', 'left', 0, 380], ['video-preview', 'right', 0, 560], ['source-monitor', 'right', 1, 460],
	] as const) {
		panels[id] = { ...panels[id], dock, order, size };
		delete panels[id].autoSize;
	}
	return { ...preferences, workspace: { ...preferences.workspace, panels } };
}

test('loading the original video layout moves its formerly fixed strip into the top dock', () => {
	const preferences = legacyPreferences();
	const saved = loadAudioEditorPreferencesV1(preferences);
	for (const [order, id] of VIDEO_PANEL_IDS.entries()) {
		assert.equal(saved.preferences.workspace.panels[id].dock, 'top', id);
		assert.equal(saved.preferences.workspace.panels[id].order, order, id);
		assert.equal(saved.preferences.workspace.panels[id].autoSize, true, id);
	}
	assert.deepEqual(saved.preferences.workspace.panels.effects, preferences.workspace.panels.effects);
	assert.deepEqual(loadAudioEditorPreferencesV1(saved.preferences).preferences, saved.preferences, 'migration is idempotent');
});

test('loading a customized video layout or another workspace retains panel placements', () => {
	const preferences = legacyPreferences();
	preferences.workspace.panels['video-preview'].dock = 'floating';
	assert.equal(loadAudioEditorPreferencesV1(preferences).preferences.workspace.panels['video-preview'].dock, 'floating');
	const modern = { ...legacyPreferences(), workspace: { ...legacyPreferences().workspace, activeId: 'modern' } };
	assert.equal(loadAudioEditorPreferencesV1(modern).preferences.workspace.panels['project-bin'].dock, 'left');
});

test('automatic panel sizing validates stored booleans and preserves an explicit opt-out', () => {
	const preferences = legacyPreferences();
	preferences.workspace.panels['project-bin'].autoSize = false;
	assert.equal(loadAudioEditorPreferencesV1(preferences).preferences.workspace.panels['project-bin'].dock, 'left');
	assert.throws(() => createAudioEditorPreferencesV1({ workspace: { panels: {
		'video-preview': { autoSize: 'yes' },
	} } }), /automatic sizing must be boolean/u);
});
