import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_BUILT_IN_WORKSPACES,
	AUDIO_EDITOR_WORKSPACE_PRESETS,
	applyAudioEditorWorkspace,
	createAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';

test('built-in workspace preset exports remain frozen and complete', () => {
	assert.deepEqual(AUDIO_EDITOR_BUILT_IN_WORKSPACES, ['classic', 'music', 'modern', 'video-editor']);
	assert.deepEqual(Object.keys(AUDIO_EDITOR_WORKSPACE_PRESETS), AUDIO_EDITOR_BUILT_IN_WORKSPACES);
	assert.equal(Object.isFrozen(AUDIO_EDITOR_BUILT_IN_WORKSPACES), true);
	assert.equal(Object.isFrozen(AUDIO_EDITOR_WORKSPACE_PRESETS), true);

	for (const preset of Object.values(AUDIO_EDITOR_WORKSPACE_PRESETS)) {
		assert.equal(Object.isFrozen(preset), true);
		assert.equal(Object.isFrozen(preset.toolbars), true);
		assert.equal(Object.isFrozen(preset.toolbarButtons), true);
		assert.equal(Object.isFrozen(preset.panels), true);
	}
});

test('workspace presets retain their product-specific layout defaults', () => {
	const preferences = createAudioEditorPreferencesV1();
	const classic = applyAudioEditorWorkspace(preferences, 'classic');
	const music = applyAudioEditorWorkspace(preferences, 'music');
	const modern = applyAudioEditorWorkspace(preferences, 'modern');
	const video = applyAudioEditorWorkspace(preferences, 'video-editor');

	assert.deepEqual(classic.workspace.panels['project-bin'], {
		visible: false, dock: 'left', order: 0, size: 380,
		x: 24, y: 24, width: 380, height: 520,
	});
	assert.deepEqual(classic.workspace.panels.history, {
		visible: false, dock: 'left', order: 0, size: 300,
		x: 24, y: 24, width: 300, height: 320,
	});
	assert.deepEqual(music.workspace.panels.effects, {
		visible: true, dock: 'right', order: 0, size: 360,
		x: 96, y: 40, width: 360, height: 440,
	});
	assert.deepEqual(music.workspace.panels.mixer, {
		visible: true, dock: 'bottom', order: 0, size: 460,
		x: 40, y: 96, width: 460, height: 360,
	});
	assert.equal(modern.workspace.toolbarButtons.copy, false);
	assert.equal(modern.workspace.toolbarButtons['time-display'], true);
	assert.deepEqual(video.workspace.panels['project-bin'], {
		visible: true, dock: 'left', order: 0, size: 380,
		x: 24, y: 24, width: 380, height: 520,
	});
	assert.deepEqual(video.workspace.panels['video-preview'], {
		visible: true, dock: 'right', order: 0, size: 560,
		x: 72, y: 40, width: 560, height: 390,
	});

	assert.notEqual(modern.workspace.toolbars, AUDIO_EDITOR_WORKSPACE_PRESETS.modern.toolbars);
	assert.notEqual(modern.workspace.toolbarButtons, AUDIO_EDITOR_WORKSPACE_PRESETS.modern.toolbarButtons);
	assert.notEqual(modern.workspace.panels, AUDIO_EDITOR_WORKSPACE_PRESETS.modern.panels);
});
