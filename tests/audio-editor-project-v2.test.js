import test from 'node:test';
import assert from 'node:assert/strict';

import {
	AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
	AUDIO_EDITOR_SOURCE_CHUNK_FRAMES,
	createAudioClipV2,
	createAudioEditorProjectV2,
	createAudioSourceV2,
	createAudioTrackV2,
	createLabelTrackV2,
	loadAudioEditorProjectV2,
	projectDurationFramesV2,
	validateAudioEditorProjectV2,
} from '../src/lib/tools/audio-editor/project-v2.js';
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
} from '../src/lib/tools/audio-editor/preferences.js';
import {
	migrateAudioEditorHistoryV1ToV2,
	migrateAudioEditorProject,
	migrateAudioEditorProjectV1ToV2,
	migrateAudioEditorStateV1ToV2,
} from '../src/lib/tools/audio-editor/migration.js';

const CREATED_AT = '2026-07-12T10:00:00.000Z';
const UPDATED_AT = '2026-07-13T11:30:00.000Z';

function v1Fixture() {
	return {
		schemaVersion: 1,
		id: 'project-v1',
		title: 'Migration session',
		revision: 17,
		createdAt: CREATED_AT,
		updatedAt: UPDATED_AT,
		sampleRate: 48_000,
		masterChannels: 2,
		selection: { startFrame: 120, endFrame: 360 },
		loop: { enabled: true, startFrame: 100, endFrame: 900 },
		sources: [{
			id: 'source-1',
			name: 'voice.wav',
			mimeType: 'audio/wav',
			storageKey: 'pcm/source-1',
			frameCount: 2_000,
			channelCount: 1,
			sampleRate: 48_000,
			originalSampleRate: 44_100,
			importFingerprint: 'legacy-source-metadata',
		}],
		clips: [{
			id: 'clip-1',
			sourceId: 'source-1',
			timelineStartFrame: 100,
			sourceStartFrame: 200,
			durationFrames: 800,
			gain: 0.8,
			fadeInFrames: 20,
			fadeOutFrames: 30,
			reversed: false,
			aupClipAttribute: 'kept',
		}],
		tracks: [{
			id: 'track-1',
			name: 'Voice',
			gain: 1,
			pan: -0.25,
			mute: false,
			solo: false,
			armed: true,
			effects: [],
			clipIds: ['clip-1'],
			legacyTrackColor: '#123456',
		}],
		master: { gain: 0.9, effects: [] },
		aupProjectNode: { name: 'unknown-node', bytes: [1, 2, 3] },
	};
}

function richV2Fixture() {
	const source = createAudioSourceV2({
		id: 'source-hires',
		name: 'hires.wav',
		storageKey: 'pcm/hires',
		frameCount: 2_000,
		channelCount: 6,
		sampleRate: 44_100,
		originalSampleRate: 192_000,
		sampleFormat: 'int24',
	});
	const clip = createAudioClipV2({
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
	const audioTrack = createAudioTrackV2({
		id: 'track-audio',
		name: 'Six channels',
		channelCount: 6,
		channelLayout: '5.1',
		sampleRate: 44_100,
		sampleFormat: 'int24',
		displayMode: 'multiview',
		clipIds: [clip.id],
	});
	const labelTrack = createLabelTrackV2({
		id: 'track-labels',
		name: 'Markers',
		labels: [
			{ id: 'label-point', title: 'Hit', startFrame: 1_000, endFrame: 1_000 },
			{ id: 'label-range', title: 'Verse', startFrame: 1_200, endFrame: 2_400 },
		],
	});
	return createAudioEditorProjectV2({
		id: 'project-v2',
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

test('V2 defaults are explicit and editor projects accept arbitrary project and source rates', () => {
	const empty = createAudioEditorProjectV2({ id: 'empty', now: CREATED_AT });
	assert.equal(empty.schemaVersion, AUDIO_EDITOR_PROJECT_SCHEMA_VERSION);
	assert.equal(empty.sampleRate, 48_000);
	assert.equal(empty.tempo.bpm, 120);
	assert.deepEqual(empty.tempo.timeSignature, { numerator: 4, denominator: 4 });
	assert.deepEqual(empty.selection, {
		startFrame: 0, endFrame: 0, trackIds: [], clipIds: [], frequencyRange: null,
	});
	assert.equal(empty.snap.unit, 'seconds');
	assert.equal(empty.timeDisplay.format, 'hh:mm:ss+milliseconds');
	assert.equal(validateAudioEditorProjectV2(empty), true);

	const project = richV2Fixture();
	assert.equal(project.sampleRate, 96_000);
	assert.equal(project.sources[0].sampleRate, 44_100);
	assert.equal(project.sources[0].chunkFrames, AUDIO_EDITOR_SOURCE_CHUNK_FRAMES);
	assert.deepEqual(project.tracks.map((track) => track.type), ['audio', 'label']);
	assert.equal(project.clips[0].pitchCents, 300);
	assert.equal(project.selection.frequencyRange.maximumFrequency, 40_000);
	assert.equal(projectDurationFramesV2(project), 2_400);
	assert.equal(validateAudioEditorProjectV2(project), true);
	assert.deepEqual(loadAudioEditorProjectV2(project), { project, readOnly: false, reason: null });
});

test('V1 migration and V2 validation preserve multiple armed audio tracks', () => {
	const legacy = v1Fixture();
	legacy.tracks.push({
		...legacy.tracks[0],
		id: 'track-2',
		name: 'Room',
		clipIds: [],
	});
	const migrated = migrateAudioEditorProjectV1ToV2(legacy);
	assert.deepEqual(migrated.tracks.map((track) => track.armed), [true, true]);
	assert.equal(validateAudioEditorProjectV2(migrated), true);
});

test('V2 validation rejects broken references, overlapping clips, and invalid typed state', () => {
	const project = richV2Fixture();
	assert.throws(() => validateAudioEditorProjectV2({
		...project,
		selection: { ...project.selection, trackIds: ['missing-track'] },
	}), /missing track/);
	assert.throws(() => validateAudioEditorProjectV2({
		...project,
		clips: [...project.clips, { ...project.clips[0], id: 'overlap', timelineStartFrame: 1_000 }],
		tracks: [{ ...project.tracks[0], clipIds: ['clip-hires', 'overlap'] }, project.tracks[1]],
	}), /overlap/);
	assert.throws(() => validateAudioEditorProjectV2({
		...project,
		clips: [{ ...project.clips[0], trimEndFrames: 701 }],
	}), /trailing trim/);
	assert.throws(() => createLabelTrackV2({
		id: 'labels', labels: [{ id: 'duplicate' }, { id: 'duplicate' }],
	}), /Duplicate label ID/);
	assert.throws(() => validateAudioEditorProjectV2({ ...project, sources: undefined }), /must be arrays/);

	const future = { ...project, schemaVersion: 9, futurePayload: { unchanged: true } };
	const loaded = loadAudioEditorProjectV2(future);
	assert.equal(loaded.readOnly, true);
	assert.equal(loaded.reason, 'newer-schema');
	assert.deepEqual(loaded.project, future);
	assert.notEqual(loaded.project, future);
});

test('editor preferences default to Modern/system/Colorful and exclude OS, cloud, and plugin state', () => {
	const preferences = createAudioEditorPreferencesV1();
	assert.equal(preferences.workspace.activeId, 'modern');
	assert.equal(preferences.appearance.theme, 'system');
	assert.equal(preferences.appearance.clipStyle, 'colorful');
	assert.equal(preferences.import.detectTempo, true);
	assert.equal(preferences.recording.retainInputs, true);
	assert.equal(preferences.editing.collisionBehavior, 'audacity');
	assert.equal(validateAudioEditorPreferencesV1(preferences), true);
	assert.deepEqual(loadAudioEditorPreferencesV1(preferences), { preferences, readOnly: false, reason: null });

	const custom = createAudioEditorPreferencesV1({
		appearance: { theme: 'high-contrast-dark', clipStyle: 'classic' },
		editing: { rippleMode: 'all-tracks', snapToZeroCrossings: true },
		recording: { retainInputs: false },
		shortcuts: { 'clip.split': ['S', 'Shift+S'] },
		workspace: {
			activeId: 'podcast',
			custom: [{ id: 'podcast', name: 'Podcast', layout: { columns: 2 } }],
			panels: { history: { visible: true, dock: 'left', size: 400 } },
		},
	});
	assert.equal(custom.workspace.panels.history.visible, true);
	assert.equal(custom.workspace.panels.history.dock, 'left');
	assert.equal(custom.recording.retainInputs, false);
	assert.deepEqual(custom.shortcuts['clip.split'], ['S', 'Shift+S']);
	assert.throws(() => createAudioEditorPreferencesV1({ audioDevice: 'usb-mic' }), /not an editor preference/);
	assert.throws(() => createAudioEditorPreferencesV1({ cloud: { account: 'ignored' } }), /not an editor preference/);
	assert.throws(() => createAudioEditorPreferencesV1({ plugins: ['vst'] }), /not an editor preference/);
	assert.deepEqual(loadAudioEditorPreferencesV1({ ...preferences, schemaVersion: 2 }), {
		preferences: { ...preferences, schemaVersion: 2 }, readOnly: true, reason: 'newer-schema',
	});
	const legacyPreferences = structuredClone(preferences);
	delete legacyPreferences.recording;
	assert.equal(loadAudioEditorPreferencesV1(legacyPreferences).preferences.recording.retainInputs, true);
	assert.equal(updateAudioEditorPreferencesV1(preferences, { recording: { retainInputs: false } }).recording.retainInputs, false);
	assert.throws(() => validateAudioEditorPreferencesV1({
		...preferences, recording: { retainInputs: 'yes' },
	}), /recording\.retainInputs must be boolean/);
});

test('workspace presets and custom workspace CRUD retain editor-only layout state', () => {
	const defaults = createAudioEditorPreferencesV1();
	const music = applyAudioEditorWorkspace(defaults, 'music');
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
	assert.equal(created.workspace.activeId, 'editing-suite');
	assert.equal(created.workspace.custom[0].layout.panels.labels.visible, true);
	assert.equal(created.workspace.toolbars.edit.visible, false);

	const updated = updateCustomAudioEditorWorkspace(created, 'editing-suite', { name: 'Dialogue editing' });
	assert.equal(updated.workspace.custom[0].name, 'Dialogue editing');
	const classic = deleteCustomAudioEditorWorkspace(updated, 'editing-suite');
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

test('V1 migration preserves identity, PCM roots, revisions, timestamps, racks, and unknown fields', () => {
	const original = v1Fixture();
	const rollback = structuredClone(original);
	const migrated = migrateAudioEditorProjectV1ToV2(original);
	assert.deepEqual(original, rollback);
	assert.equal(migrated.schemaVersion, 2);
	assert.equal(migrated.id, original.id);
	assert.equal(migrated.revision, original.revision);
	assert.equal(migrated.createdAt, original.createdAt);
	assert.equal(migrated.updatedAt, original.updatedAt);
	assert.equal(migrated.sources[0].id, 'source-1');
	assert.equal(migrated.sources[0].storageKey, 'pcm/source-1');
	assert.equal(migrated.sources[0].sampleRate, 48_000);
	assert.equal(migrated.sources[0].originalSampleRate, 44_100);
	assert.equal(migrated.tracks[0].type, 'audio');
	assert.equal(migrated.tracks[0].channelCount, 1);
	assert.deepEqual(migrated.tracks[0].clipIds, ['clip-1']);
	assert.equal(migrated.clips[0].title, 'voice.wav');
	assert.equal(migrated.clips[0].trimStartFrames, 200);
	assert.equal(migrated.clips[0].trimEndFrames, 1_000);
	assert.deepEqual(migrated.selection.trackIds, []);
	assert.deepEqual(migrated.sources[0].opaqueExtensions.legacyV1, { importFingerprint: 'legacy-source-metadata' });
	assert.deepEqual(migrated.clips[0].opaqueExtensions.legacyV1, { aupClipAttribute: 'kept' });
	assert.deepEqual(migrated.tracks[0].opaqueExtensions.legacyV1, { legacyTrackColor: '#123456' });
	assert.deepEqual(migrated.opaqueExtensions.legacyV1.aupProjectNode, original.aupProjectNode);
	assert.equal(validateAudioEditorProjectV2(migrated), true);

	const result = migrateAudioEditorProject(original);
	assert.equal(result.migrated, true);
	assert.equal(result.fromVersion, 1);
	assert.equal(result.readOnly, false);
	assert.deepEqual(result.project, migrated);
	const alreadyV2 = migrateAudioEditorProject(migrated);
	assert.equal(alreadyV2.migrated, false);
	assert.notEqual(alreadyV2.project, migrated);
});

test('history and state migration are atomic and future schemas stay intact and read-only', () => {
	const present = v1Fixture();
	const previous = { ...v1Fixture(), revision: 16, updatedAt: CREATED_AT };
	const command = { type: 'clip/move', clipId: 'clip-1', timelineStartFrame: 100 };
	const history = {
		limit: 200,
		present,
		undoStack: [{ project: previous, command }],
		redoStack: [],
	};
	const rollback = structuredClone(history);
	const migrated = migrateAudioEditorHistoryV1ToV2(history);
	assert.deepEqual(history, rollback);
	assert.equal(migrated.present.schemaVersion, 2);
	assert.equal(migrated.undoStack[0].project.schemaVersion, 2);
	assert.deepEqual(migrated.undoStack[0].command, command);
	assert.notEqual(migrated.undoStack[0].command, command);

	const invalidHistory = structuredClone(history);
	invalidHistory.redoStack.push({
		project: { ...v1Fixture(), clips: [{ ...v1Fixture().clips[0], sourceId: 'missing' }] },
		command: { type: 'broken' },
	});
	const invalidRollback = structuredClone(invalidHistory);
	assert.throws(() => migrateAudioEditorHistoryV1ToV2(invalidHistory), /missing source/);
	assert.deepEqual(invalidHistory, invalidRollback);

	const stateResult = migrateAudioEditorStateV1ToV2({ project: present, history, clipboard: { sourceIds: ['source-1'] } });
	assert.equal(stateResult.migrated, true);
	assert.equal(stateResult.state.project.schemaVersion, 2);
	assert.deepEqual(stateResult.state.clipboard, { sourceIds: ['source-1'] });

	const future = { ...richV2Fixture(), schemaVersion: 3, opaqueFutureData: new Uint8Array([9, 8, 7]) };
	const futureResult = migrateAudioEditorProject(future);
	assert.equal(futureResult.readOnly, true);
	assert.equal(futureResult.reason, 'newer-schema');
	assert.deepEqual(futureResult.project, future);
	const futureState = migrateAudioEditorStateV1ToV2({ project: future, localState: { selected: true } });
	assert.equal(futureState.readOnly, true);
	assert.deepEqual(futureState.state, { project: future, localState: { selected: true } });
});
