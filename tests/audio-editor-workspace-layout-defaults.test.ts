import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_BUILT_IN_WORKSPACES,
	AUDIO_EDITOR_WORKSPACE_PRESETS,
	applyAudioEditorWorkspace,
	createAudioEditorPreferencesV1,
	loadAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';
import {
	DEFAULT_TOOLBAR_BUTTONS,
	workspaceViewDefaults,
} from '../src/common/editor/workspace-layout-defaults.ts';
import {
	DEFAULT_PLAYBACK_METER_SETTINGS,
	DEFAULT_RECORDING_METER_SETTINGS,
} from '../src/common/editor/ui/meter-settings.ts';

test('built-in workspace preset exports remain frozen and complete', () => {
	assert.deepEqual(AUDIO_EDITOR_BUILT_IN_WORKSPACES, ['classic', 'music', 'modern', 'audacity', 'video-editor']);
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
	assert.equal(modern.workspace.toolbarButtons.metronome, false);
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

test('the Audacity preset mirrors the 4.0.0 Modern layout while the others keep the new chrome hidden', () => {
	const audacity = AUDIO_EDITOR_WORKSPACE_PRESETS.audacity;
	const modern = AUDIO_EDITOR_WORKSPACE_PRESETS.modern;

	assert.equal(DEFAULT_TOOLBAR_BUTTONS.snap, false);
	assert.equal(DEFAULT_TOOLBAR_BUTTONS['workspace-switcher'], false);
	for (const id of ['classic', 'music', 'modern', 'video-editor'] as const) {
		assert.equal(AUDIO_EDITOR_WORKSPACE_PRESETS[id].toolbarButtons.snap, false, id);
		assert.equal(AUDIO_EDITOR_WORKSPACE_PRESETS[id].toolbarButtons['workspace-switcher'], false, id);
	}

	assert.equal(audacity.toolbars, modern.toolbars);
	assert.deepEqual(audacity.toolbarButtons, {
		...modern.toolbarButtons,
		'play-at-speed': false,
		'spectral-box-select': false,
		'spectral-brush': false,
		'zoom-fit': false,
		snap: true,
		'workspace-switcher': true,
	});
	assert.equal(audacity.toolbarButtons['zoom-in'], true);
	assert.equal(audacity.toolbarButtons['zoom-out'], true);
	assert.equal(audacity.toolbarButtons['time-display'], true);
	assert.deepEqual(audacity.panels, {
		...modern.panels,
		'project-bin': { visible: false, dock: 'left', order: 0, size: 380 },
	});

	const applied = applyAudioEditorWorkspace(createAudioEditorPreferencesV1(), 'audacity');
	assert.equal(applied.workspace.activeId, 'audacity');
	assert.equal(applied.workspace.toolbarButtons.snap, true);
	assert.equal(applied.workspace.toolbarButtons['workspace-switcher'], true);
	assert.equal(applied.workspace.toolbarButtons['zoom-fit'], false);
	assert.equal(applied.workspace.toolbarButtons['play-at-speed'], false);
	assert.equal(applied.workspace.panels['project-bin'].visible, false);
});

test('workspace view defaults describe the meter and ruler state of a preset without being persisted', () => {
	assert.deepEqual(workspaceViewDefaults('audacity'), {
		verticalRulers: false,
		playbackMeterPosition: 'side',
		recordingMeterPosition: 'flyout',
	});
	assert.deepEqual(workspaceViewDefaults('modern'), {
		verticalRulers: true,
		playbackMeterPosition: 'side',
		recordingMeterPosition: 'side',
	});
	assert.equal(workspaceViewDefaults('classic'), null);
	assert.equal(workspaceViewDefaults('music'), null);
	assert.equal(workspaceViewDefaults('video-editor'), null);
	assert.equal(workspaceViewDefaults('custom-workspace'), null);
	assert.equal(workspaceViewDefaults(''), null);
	assert.equal(Object.isFrozen(workspaceViewDefaults('audacity')), true);

	// First boot needs no application: the Soundscaper preset matches the scalar defaults.
	const modernView = workspaceViewDefaults('modern');
	assert.equal(modernView?.playbackMeterPosition, DEFAULT_PLAYBACK_METER_SETTINGS.position);
	assert.equal(modernView?.recordingMeterPosition, DEFAULT_RECORDING_METER_SETTINGS.position);
	assert.equal(modernView?.verticalRulers, true);

	for (const id of AUDIO_EDITOR_BUILT_IN_WORKSPACES) {
		const applied = applyAudioEditorWorkspace(createAudioEditorPreferencesV1(), id);
		assert.equal(Object.hasOwn(applied.workspace, 'view'), false, id);
		assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(applied)).workspace, 'view'), false, id);
	}
});

test('a saved document that predates a toolbar button loads it hidden rather than shown', () => {
	const saved = JSON.parse(JSON.stringify(createAudioEditorPreferencesV1()));
	delete saved.workspace.toolbarButtons.snap;
	delete saved.workspace.toolbarButtons['workspace-switcher'];
	saved.workspace.toolbarButtons.metronome = true;
	const { preferences } = loadAudioEditorPreferencesV1(saved);
	assert.equal(preferences.workspace.toolbarButtons.snap, false, 'the toolbar shows any button that is not explicitly hidden');
	assert.equal(preferences.workspace.toolbarButtons['workspace-switcher'], false);
	assert.equal(preferences.workspace.toolbarButtons.metronome, true, 'stored choices survive the fill-in');
});
