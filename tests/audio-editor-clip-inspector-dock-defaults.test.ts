/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyAudioEditorWorkspace,
	createAudioEditorPreferencesV1,
	createCustomAudioEditorWorkspace,
	loadAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';

const AUDIO_PRESETS = ['classic', 'music', 'modern', 'audacity'] as const;

test('audio presets place opt-in Clip properties beside the meters and Source monitor below the timeline', () => {
	for (const id of AUDIO_PRESETS) {
		const { panels } = applyAudioEditorWorkspace(createAudioEditorPreferencesV1(), id).workspace;
		assert.equal(panels['clip-properties'].dock, 'right', id);
		assert.equal(panels['clip-properties'].column ?? 0, 0, id);
		assert.equal(panels['playback-meter'].column, 1, id);
		assert.equal(panels['recording-meter'].column, 2, id);
		assert.equal(panels['source-monitor'].dock, 'bottom', id);
		assert.equal(panels['clip-properties'].visible, false, id);
		assert.equal(panels['source-monitor'].visible, false, id);
	}
	const { panels } = createAudioEditorPreferencesV1({ workspace: { activeId: 'video-editor' } }).workspace;
	assert.equal(panels['source-monitor'].dock, 'top', 'the dedicated video preset retains its monitor strip');
	assert.equal(panels['source-monitor'].autoSize, true);
});

test('loading old generated audio docks updates their placement once while preserving visibility', () => {
	for (const activeId of AUDIO_PRESETS) {
		const older = oldGeneratedPreferences(activeId);
		older.workspace.panels['clip-properties'].visible = true;
		older.workspace.panels['source-monitor'].visible = true;
		const restored = loadAudioEditorPreferencesV1(older).preferences;
		assert.equal(restored.workspace.panels['clip-properties'].dock, 'right', activeId);
		assert.equal(restored.workspace.panels['source-monitor'].dock, 'bottom', activeId);
		assert.equal(restored.workspace.panels['clip-properties'].visible, true, activeId);
		assert.equal(restored.workspace.panels['source-monitor'].visible, true, activeId);
		assert.deepEqual(restored.workspace.panels.history, older.workspace.panels.history);
		assert.deepEqual(loadAudioEditorPreferencesV1(restored).preferences, restored, 'reload is idempotent');

		// After migration, choosing either former placement is an explicit preference.
		restored.workspace.panels['clip-properties'].dock = 'bottom';
		restored.workspace.panels['source-monitor'].dock = 'floating';
		const customized = loadAudioEditorPreferencesV1(restored).preferences;
		assert.equal(customized.workspace.panels['clip-properties'].dock, 'bottom');
		assert.equal(customized.workspace.panels['source-monitor'].dock, 'floating');
	}
});

test('old customized docks, resized geometry, and tab groups retain their placements', () => {
	for (const patch of [
		{ dock: 'left' }, { order: 2 }, { width: 540 }, { height: 380 }, { size: 380 },
		{ x: 300 }, { y: 100 }, { dock: 'right', column: 1 }, { autoSize: false },
	]) {
		const older = oldGeneratedPreferences();
		const inspector = Object.assign(older.workspace.panels['clip-properties'], patch);
		const source = Object.assign(older.workspace.panels['source-monitor'], patch);
		const restored = loadAudioEditorPreferencesV1(older).preferences;
		assert.equal(restored.workspace.panels['clip-properties'].dock, inspector.dock, JSON.stringify(patch));
		assert.equal(restored.workspace.panels['source-monitor'].dock, source.dock, JSON.stringify(patch));
	}
	const tabbed = oldGeneratedPreferences();
	Object.assign(tabbed.workspace.panels['clip-properties'], { tabGroup: 'inspection', tabActive: true });
	Object.assign(tabbed.workspace.panels.history, { dock: 'bottom', tabGroup: 'inspection', tabActive: false });
	const restored = loadAudioEditorPreferencesV1(tabbed).preferences;
	assert.equal(restored.workspace.panels['clip-properties'].dock, 'bottom');
	assert.equal(restored.workspace.panels['clip-properties'].tabGroup, restored.workspace.panels.history.tabGroup);
});

test('explicit current docks, custom workspace snapshots, and the video preset skip the audio migration', () => {
	const current = createAudioEditorPreferencesV1({ workspace: { panels: {
		'clip-properties': { dock: 'bottom', order: 15, size: 400 },
		'source-monitor': { dock: 'floating', order: 1, size: 460 },
	} } });
	assert.equal(loadAudioEditorPreferencesV1(current).preferences.workspace.panels['clip-properties'].dock, 'bottom');
	assert.equal(loadAudioEditorPreferencesV1(current).preferences.workspace.panels['source-monitor'].dock, 'floating');
	const older = oldGeneratedPreferences();
	const custom = createCustomAudioEditorWorkspace(older, { id: 'my-studio', name: 'My studio' });
	const unversionedCustom = withoutPanelDefaultsVersion(custom);
	const restoredCustom = loadAudioEditorPreferencesV1(unversionedCustom).preferences;
	assert.equal(restoredCustom.workspace.panels['clip-properties'].dock, 'bottom');
	assert.equal(restoredCustom.workspace.panels['source-monitor'].dock, 'floating');
	assert.deepEqual(restoredCustom.workspace.custom, custom.workspace.custom);
	const video = oldGeneratedPreferences('video-editor');
	assert.equal(loadAudioEditorPreferencesV1(video).preferences.workspace.panels['source-monitor'].dock, 'floating');
});

function oldGeneratedPreferences(activeId = 'modern') {
	const preferences = withoutPanelDefaultsVersion(createAudioEditorPreferencesV1({ workspace: { activeId } }));
	preferences.workspace.panels['clip-properties'] = {
		visible: false, dock: 'bottom', order: 15, size: 400, x: 272, y: 192, width: 400, height: 520,
	};
	preferences.workspace.panels['source-monitor'] = {
		visible: false, dock: 'floating', order: 1, size: 460, x: 96, y: 72, width: 460, height: 420,
	};
	return preferences;
}

function withoutPanelDefaultsVersion(preferences: ReturnType<typeof createAudioEditorPreferencesV1>) {
	const workspace: Omit<typeof preferences.workspace, 'panelDefaultsVersion'> & { panelDefaultsVersion?: number } = { ...preferences.workspace };
	delete workspace.panelDefaultsVersion;
	return { ...preferences, workspace };
}
