/* SPDX-License-Identifier: AGPL-3.0-only */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
	AUDIO_EDITOR_SOURCE_CHUNK_FRAMES,
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createLabelTrack,
} from '../src/common/editor/project-media-factory.ts';
import { projectDurationFrames } from '../src/common/editor/project.js';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import {
	applyAudioEditorWorkspace,
	createAudioEditorPreferencesV1,
	createCustomAudioEditorWorkspace,
	deleteCustomAudioEditorWorkspace,
	findAudioEditorShortcutConflicts,
	loadAudioEditorPreferencesV1,
	normalizeAudioEditorShortcut,
	updateAudioEditorPreferencesV1,
	updateCustomAudioEditorWorkspace,
	validateAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';
const CREATED_AT = '2026-07-12T10:00:00.000Z';
const UPDATED_AT = '2026-07-13T11:30:00.000Z';

function richAudioFoundationFixture() {
	const source = createAudioSource({
		id: 'source-hires',
		name: 'hires.wav',
		storageKey: 'pcm/hires',
		frameCount: 2_000,
		channelCount: 6,
		sampleRate: 44_100,
		originalSampleRate: 192_000,
		sampleFormat: 'int24',
	});
	const clip = createAudioClip({
		id: 'clip-hires',
		sourceId: source.id,
		title: 'Verse',
		timelineStartFrame: 960,
		sourceStartFrame: 100,
		durationFrames: 1_200,
		trimStartFrames: 100,
		trimEndFrames: 700,
		fadeInFrames: 30,
		envelope: [{ frame: 0, value: 0.5 }, { frame: 1_200, value: 1 }],
		groupId: 'group-1',
		color: 'blue',
		pitchCents: 300,
		speedRatio: 1.25,
		preserveFormants: true,
		renderCacheRevision: 4,
	});
	const audioTrack = createAudioTrack({
		id: 'track-audio',
		name: 'Hi-res clips',
		displayMode: 'multiview',
		clipIds: [clip.id],
	});
	const labelTrack = createLabelTrack({
		id: 'track-labels',
		name: 'Markers',
		labels: [
			{ id: 'label-point', title: 'Hit', startFrame: 1_000, endFrame: 1_000, color: 'auto', opaqueExtensions: {} },
			{ id: 'label-range', title: 'Verse', startFrame: 1_200, endFrame: 2_400, color: 'auto', opaqueExtensions: {} },
		],
	});
	return createAudioEditorProjectV17({
		id: 'project-audio-foundation',
		title: 'Arbitrary rates',
		revision: 3,
		now: CREATED_AT,
		updatedAt: UPDATED_AT,
		sampleRate: 96_000,
		masterChannels: 6,
		tempo: { bpm: 137.5, timeSignature: { numerator: 7, denominator: 8 }, detected: true },
		snap: { enabled: true, unit: '1/16-triplet', mode: 'nearest' },
		timeDisplay: { format: 'samples' },
		metadata: { title: 'Arbitrary rates', artist: 'kw.media', tags: { ISRC: 'TEST123' } },
		selection: {
			startFrame: 960,
			endFrame: 2_160,
			trackIds: [audioTrack.id, labelTrack.id],
			clipIds: [clip.id],
			frequencyRange: { minimumFrequency: 100, maximumFrequency: 40_000 },
		},
		loop: { enabled: true, startFrame: 960, endFrame: 2_160 },
		view: { scrollFrame: 500, pixelsPerSecond: 220, playheadFrame: 1_500, selectedTrackIds: [audioTrack.id] },
		sources: [source],
		clips: [clip],
		tracks: [audioTrack, labelTrack],
		master: { gain: 0.95, pan: 0, effects: [] },
		opaqueExtensions: { aup4: { attributes: [{ name: 'future', type: 'blob', value: new Uint8Array([1, 2]) }] } },
	});
}

test('current audio-foundation defaults are explicit and accept arbitrary project and source rates', () => {
	const empty = createAudioEditorProjectV17({ id: 'empty', now: CREATED_AT });
	assert.equal(empty.schemaVersion, AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION);
	assert.equal(empty.sampleRate, 48_000);
	assert.equal(empty.tempo.bpm, 120);
	assert.deepEqual(empty.tempo.timeSignature, { numerator: 4, denominator: 4 });
	assert.deepEqual(empty.selection, {
		startFrame: 0, endFrame: 0, trackIds: [], clipIds: [], frequencyRange: null, annotationIds: [],
	});
	assert.equal(empty.snap.unit, 'seconds');
	assert.equal(empty.timeDisplay.format, 'hh:mm:ss+milliseconds');
	assert.deepEqual(empty.master.envelope, []);
	assert.equal(empty.master.collapsed, true);

	const project = richAudioFoundationFixture();
	assert.equal(project.sampleRate, 96_000);
	assert.equal(project.sources[0].sampleRate, 44_100);
	assert.equal(project.sources[0].channelCount, 6);
	assert.equal(project.sources[0].sampleFormat, 'int24');
	assert.equal(project.sources[0].chunkFrames, AUDIO_EDITOR_SOURCE_CHUNK_FRAMES);
	assert.deepEqual(project.tracks.map((track) => track.type), ['audio', 'label']);
	for (const field of ['channelCount', 'channelLayout', 'sampleRate', 'sampleFormat']) {
		assert.equal(Object.hasOwn(project.tracks[0], field), false);
	}
	assert.equal(project.clips[0].pitchCents, 300);
	assert.equal(project.selection.frequencyRange.maximumFrequency, 40_000);
	assert.equal(projectDurationFrames(project), 2_400);
});

test('master and mixer buses normalize persistent envelope and collapsed row state without extending duration', () => {
	const project = createAudioEditorProjectV17({
		id: 'output-envelope-project',
		now: CREATED_AT,
		master: {
			gain: 0.75,
			envelope: [{ frame: 0, value: 1 }, { frame: 20_000, value: 0.5 }],
			collapsed: false,
			effects: [],
		},
		mixer: {
			groups: [{
				id: 'group-1', envelope: [{ frame: 10_000, value: 0.25 }], collapsed: false,
				clipIds: ['not-a-media-track'],
			}],
			sends: [{ id: 'send-1' }],
			routes: {},
		},
	});
	assert.deepEqual(project.master.envelope, [
		{ frame: 0, value: 1 },
		{ frame: 20_000, value: 0.5 },
	]);
	assert.equal(project.master.collapsed, false);
	assert.deepEqual(project.mixer.groups[0].envelope, [{ frame: 10_000, value: 0.25 }]);
	assert.equal(project.mixer.groups[0].collapsed, false);
	assert.deepEqual(project.mixer.sends[0].envelope, []);
	assert.equal(project.mixer.sends[0].collapsed, true);
	assert.equal(Object.hasOwn(project.mixer.groups[0], 'clipIds'), false);
	assert.equal(projectDurationFrames(project), 0);

	assert.throws(() => createAudioEditorProjectV17({
		id: 'bad-master-envelope', now: CREATED_AT,
		master: { envelope: [{ frame: 1, value: 1 }, { frame: 1, value: 0.5 }] },
	}), /strictly increasing frames/);
	assert.throws(() => createAudioEditorProjectV17({
		id: 'bad-send-envelope', now: CREATED_AT,
		mixer: { sends: [{ id: 'send-1', envelope: [{ frame: 0, value: 17 }] }] },
	}), /mixer\.send\.envelope\[0\]\.value/);
});

test('one audio track accepts sequential clips backed by mixed-rate mono and stereo sources', () => {
	const mono = createAudioSource({
		id: 'mono-44k',
		name: 'mono.wav',
		storageKey: 'pcm/mono-44k',
		frameCount: 44_100,
		channelCount: 1,
		sampleRate: 44_100,
		sampleFormat: 'int16',
	});
	const stereo = createAudioSource({
		id: 'stereo-96k',
		name: 'stereo.wav',
		storageKey: 'pcm/stereo-96k',
		frameCount: 96_000,
		channelCount: 2,
		sampleRate: 96_000,
		sampleFormat: 'float32',
	});
	const clips = [
		createAudioClip({
			id: 'mono-clip', sourceId: mono.id, timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: mono.frameCount, durationFrames: 48_000,
		}),
		createAudioClip({
			id: 'stereo-clip', sourceId: stereo.id, timelineStartFrame: 48_000,
			sourceStartFrame: 0, sourceDurationFrames: stereo.frameCount, durationFrames: 48_000,
		}),
	];
	const track = createAudioTrack({
		id: 'mixed-track', name: 'Mixed source formats', clipIds: clips.map((clip) => clip.id),
	});
	const project = createAudioEditorProjectV17({
		id: 'mixed-source-project',
		title: 'Mixed source formats',
		now: CREATED_AT,
		sampleRate: 48_000,
		sources: [mono, stereo],
		clips,
		tracks: [track],
	});

	assert.deepEqual(project.sources.map(({ sampleRate, channelCount }) => [sampleRate, channelCount]), [
		[44_100, 1],
		[96_000, 2],
	]);
	for (const field of ['channelCount', 'channelLayout', 'sampleRate', 'sampleFormat']) {
		assert.equal(Object.hasOwn(project.tracks[0], field), false);
	}
});

test('editor preferences default to Modern/system/Colorful and exclude OS, cloud, and plugin state', () => {
	const preferences = createAudioEditorPreferencesV1();
	assert.equal(preferences.workspace.activeId, 'modern');
	for (const buttonId of ['cutPerTrackRipple', 'copy', 'paste', 'split', 'deletePerTrackRipple']) {
		assert.equal(preferences.workspace.toolbarButtons[buttonId], false);
	}
	assert.deepEqual(
		preferences.workspace.panels['project-bin'],
		{
			visible: true,
			dock: 'left',
			order: 0,
			size: 380,
			x: 24,
			y: 24,
			width: 380,
			height: 520,
		},
	);
	assert.equal(preferences.appearance.theme, 'system');
	assert.equal(preferences.appearance.clipStyle, 'colorful');
	assert.equal(preferences.appearance.layout, 'auto');
	assert.equal(preferences.view.showMasterTrack, false);
	assert.equal(preferences.import.detectTempo, true);
	assert.equal(preferences.recording.retainInputs, true);
	assert.equal(preferences.playback.playAtSpeedMode, 'naive');
	assert.deepEqual(preferences.startup, { mode: 'continue-last-session', projectId: '' });
	assert.deepEqual(preferences.effects, { menuOrganization: 'default' });
	assert.equal(preferences.editing.collisionBehavior, 'audacity');
	// A whole octave a wheel notch: the speed this editor had before the control
	// existed, kept as the default rather than Audacity's own 6.
	assert.equal(preferences.editing.zoomPrecision, 1);
	assert.equal(validateAudioEditorPreferencesV1(preferences), true);
	assert.deepEqual(loadAudioEditorPreferencesV1(preferences), { preferences, readOnly: false, reason: null });
	const savedWithWebVcrOpen = structuredClone(preferences);
	savedWithWebVcrOpen.workspace.panels['web-vcr'] = {
		...savedWithWebVcrOpen.workspace.panels['web-vcr'], visible: true, dock: 'floating', x: 72, y: 96,
	};
	const restarted = loadAudioEditorPreferencesV1(savedWithWebVcrOpen).preferences.workspace.panels['web-vcr'];
	assert.equal(restarted.visible, false);
	assert.deepEqual({ dock: restarted.dock, x: restarted.x, y: restarted.y }, { dock: 'floating', x: 72, y: 96 });

	const custom = createAudioEditorPreferencesV1({
		appearance: { theme: 'high-contrast-dark', clipStyle: 'classic' },
		editing: { rippleMode: 'all-tracks', snapToZeroCrossings: true },
		view: { showMasterTrack: true },
		recording: { retainInputs: false },
		playback: { playAtSpeedMode: 'staffpad' },
		shortcuts: { 'clip.split': ['S', 'Shift+S'] },
		workspace: {
			activeId: 'podcast',
			custom: [{ id: 'podcast', name: 'Podcast', layout: { columns: 2 } }],
			panels: {
				history: {
					visible: true, dock: 'floating', size: 400,
					x: 36, y: 48, width: 440, height: 360,
				},
			},
		},
	});
	assert.equal(custom.workspace.panels.history.visible, true);
	assert.deepEqual(
		custom.workspace.panels.history,
		{ visible: true, dock: 'floating', order: 0, size: 400, x: 36, y: 48, width: 440, height: 360 },
	);
	assert.equal(custom.recording.retainInputs, false);
	assert.equal(custom.playback.playAtSpeedMode, 'staffpad');
	assert.deepEqual(
		createAudioEditorPreferencesV1({ startup: { mode: 'project', projectId: 'archive' } }).startup,
		{ mode: 'project', projectId: 'archive' },
	);
	assert.equal(custom.view.showMasterTrack, true);
	assert.deepEqual(custom.shortcuts['clip.split'], ['S', 'Shift+S']);
	assert.throws(() => createAudioEditorPreferencesV1({ audioDevice: 'usb-mic' }), /not an editor preference/);
	assert.throws(() => createAudioEditorPreferencesV1({ cloud: { account: 'ignored' } }), /not an editor preference/);
	assert.throws(() => createAudioEditorPreferencesV1({ plugins: ['vst'] }), /not an editor preference/);
	assert.deepEqual(loadAudioEditorPreferencesV1({ ...preferences, schemaVersion: 2 }), {
		preferences: { ...preferences, schemaVersion: 2 }, readOnly: true, reason: 'newer-schema',
	});
	const legacyPreferences = structuredClone(preferences);
	delete legacyPreferences.view;
	delete legacyPreferences.recording;
	delete legacyPreferences.playback;
	delete legacyPreferences.startup;
	delete legacyPreferences.effects;
	for (const panel of Object.values(legacyPreferences.workspace.panels)) {
		delete panel.x;
		delete panel.y;
		delete panel.width;
		delete panel.height;
	}
	delete legacyPreferences.editing.zoomPrecision;
	const loadedLegacyPreferences = loadAudioEditorPreferencesV1(legacyPreferences).preferences;
	assert.equal(loadedLegacyPreferences.view.showMasterTrack, false);
	assert.equal(loadedLegacyPreferences.recording.retainInputs, true);
	assert.equal(loadedLegacyPreferences.playback.playAtSpeedMode, 'naive');
	// Preferences saved before Program start existed keep continuing the last
	// session, which is what those sessions already did.
	assert.deepEqual(loadedLegacyPreferences.startup, { mode: 'continue-last-session', projectId: '' });
	assert.equal(loadedLegacyPreferences.editing.zoomPrecision, 1);
	assert.equal(loadedLegacyPreferences.effects.menuOrganization, 'default');
	assert.deepEqual(
		Object.keys(loadedLegacyPreferences.workspace.panels.history).sort(),
		['dock', 'height', 'order', 'size', 'visible', 'width', 'x', 'y'],
	);
	assert.equal(updateAudioEditorPreferencesV1(preferences, { recording: { retainInputs: false } }).recording.retainInputs, false);
	assert.equal(updateAudioEditorPreferencesV1(preferences, { view: { showMasterTrack: true } }).view.showMasterTrack, true);
	assert.equal(preferences.view.showMarkers, false);
	assert.equal(updateAudioEditorPreferencesV1(preferences, { view: { showMarkers: true } }).view.showMarkers, true);
	// Preferences stored before the marker toggle keep loading; only a stored
	// value of the wrong type is rejected.
	const withoutMarkerToggle = { ...preferences, view: { showMasterTrack: true } };
	assert.equal(validateAudioEditorPreferencesV1(withoutMarkerToggle), true);
	assert.equal(loadAudioEditorPreferencesV1(withoutMarkerToggle).preferences.view.showMarkers, false);
	assert.throws(() => validateAudioEditorPreferencesV1({
		...preferences, view: { showMasterTrack: true, showMarkers: 'yes' },
	}), /view\.showMarkers must be boolean/);
	assert.throws(() => validateAudioEditorPreferencesV1({
		...preferences, view: { showMasterTrack: 'yes' },
	}), /view\.showMasterTrack must be boolean/);
	assert.throws(() => validateAudioEditorPreferencesV1({
		...preferences, recording: { retainInputs: 'yes' },
	}), /recording\.retainInputs must be boolean/);
	assert.throws(() => validateAudioEditorPreferencesV1({
		...preferences, startup: { mode: 'start-empty', projectId: '' },
	}), /startup\.mode/);
	assert.throws(() => createAudioEditorPreferencesV1({ startup: { projectId: 7 } }), /startup\.projectId must be a string/);
	assert.equal(createAudioEditorPreferencesV1({ editing: { zoomPrecision: 12 } }).editing.zoomPrecision, 12);
	assert.throws(() => createAudioEditorPreferencesV1({ editing: { zoomPrecision: 0 } }), /editing\.zoomPrecision/);
	assert.throws(() => createAudioEditorPreferencesV1({ editing: { zoomPrecision: 17 } }), /editing\.zoomPrecision must be at most 16/);
	assert.equal(
		createAudioEditorPreferencesV1({ effects: { menuOrganization: 'sortby:name' } }).effects.menuOrganization,
		'sortby:name',
	);
	assert.throws(() => createAudioEditorPreferencesV1({ effects: { menuOrganization: 'groupby:publisher' } }), /effects\.menuOrganization/);
	assert.throws(() => validateAudioEditorPreferencesV1({
		...preferences, playback: { playAtSpeedMode: 'phase-vocoder' },
	}), /playback\.playAtSpeedMode has an unsupported value/);
});

test('workspace presets and custom workspace CRUD retain editor-only layout state', () => {
	const defaults = createAudioEditorPreferencesV1({ view: { showMasterTrack: true } });
	const music = applyAudioEditorWorkspace(defaults, 'music');
	assert.equal(music.view.showMasterTrack, true);
	assert.equal(music.workspace.activeId, 'music');
	assert.equal(music.workspace.panels.effects.visible, true);
	assert.equal(music.workspace.panels.mixer.visible, true);

	const customized = updateAudioEditorPreferencesV1(music, {
		appearance: { theme: 'dark', clipStyle: 'classic' },
		workspace: {
			toolbars: { edit: { visible: false, order: 2 } },
			panels: { labels: { visible: true, dock: 'left', order: 1, size: 280 } },
		},
	});
	const created = createCustomAudioEditorWorkspace(customized, { id: 'editing-suite', name: 'Editing suite' });
	assert.equal(created.view.showMasterTrack, true);
	assert.equal(created.workspace.activeId, 'editing-suite');
	assert.equal(created.workspace.custom[0].layout.panels.labels.visible, true);
	assert.equal(created.workspace.toolbars.edit.visible, false);

	const updated = updateCustomAudioEditorWorkspace(created, 'editing-suite', { name: 'Dialogue editing' });
	assert.equal(updated.view.showMasterTrack, true);
	assert.equal(updated.workspace.custom[0].name, 'Dialogue editing');
	const classic = deleteCustomAudioEditorWorkspace(updated, 'editing-suite');
	assert.equal(classic.view.showMasterTrack, true);
	assert.equal(classic.workspace.activeId, 'modern');
	assert.deepEqual(classic.workspace.custom, []);
});

test('shortcut normalization reports conflicts without persisting device-specific state', () => {
	assert.equal(normalizeAudioEditorShortcut('control+shift+s'), 'Ctrl+Shift+S');
	assert.deepEqual(findAudioEditorShortcutConflicts({
		'save-project-as': ['Ctrl+Shift+S'],
		'split-delete': ['control+shift+s'],
		play: ['Space'],
	}), [{ binding: 'Ctrl+Shift+S', actionIds: ['file-save-as', 'delete-per-clip-ripple'] }]);
});

test('the layout preference accepts the three chrome modes and defaults older documents to auto', () => {
	for (const layout of ['auto', 'compact', 'desktop']) {
		assert.equal(createAudioEditorPreferencesV1({ appearance: { layout } }).appearance.layout, layout);
	}
	assert.throws(() => createAudioEditorPreferencesV1({ appearance: { layout: 'phone' } }), RangeError);
	const saved = createAudioEditorPreferencesV1({ appearance: { theme: 'dark', clipStyle: 'classic' } });
	delete saved.appearance.layout;
	assert.deepEqual(
		loadAudioEditorPreferencesV1(saved).preferences.appearance,
		{ theme: 'dark', clipStyle: 'classic', layout: 'auto' },
	);
});
