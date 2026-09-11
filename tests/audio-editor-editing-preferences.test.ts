/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_ASYMMETRIC_STEREO_HEIGHTS,
	AUDIO_EDITOR_CLOSE_GAP_BEHAVIORS,
	AUDIO_EDITOR_DELETE_BEHAVIORS,
	AUDIO_EDITOR_PASTE_BEHAVIORS,
	AUDIO_EDITOR_PASTE_INSERT_BEHAVIORS,
	AUDIO_EDITOR_RIPPLE_MODES,
	AUDIO_EDITOR_ZOOM_TOGGLE_PRESETS,
	audioEditorZoomPresetPixelsPerSecond,
	normalizeAudioEditorEditingPreferences,
	resolveAudioEditorDefaultDelete,
	resolveAudioEditorDefaultPaste,
	resolveAudioEditorZoomToggle,
	resolveAudioEditorZoomToggleTarget,
} from '../src/common/editor/editing-preferences.ts';
import {
	createAudioEditorPreferencesV1,
	deleteCustomAudioEditorWorkspace,
	loadAudioEditorPreferencesV1,
	updateAudioEditorPreferencesV1,
	validateAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';

const EXACT_DEFAULTS = {
	rippleMode: 'off',
	collisionBehavior: 'audacity',
	snapToZeroCrossings: false,
	zoomPrecision: 6,
	applyEffectsToAllAudio: true,
	deleteBehavior: 'not-set',
	closeGapBehavior: 'clip',
	pasteBehavior: 'overlap',
	pasteInsertBehavior: 'track',
	alwaysPasteAsNewClip: true,
	asymmetricStereoHeights: 'never',
	asymmetricStereoHeightWorkspaces: ['modern'],
	alwaysConvertToMono: false,
	zoomTogglePreset1: 'zoom-default',
	zoomTogglePreset2: 'four-pixels-per-sample',
};

test('Audacity 4 audio-editing preferences have exact defaults', () => {
	assert.deepEqual(normalizeAudioEditorEditingPreferences(), EXACT_DEFAULTS);
	assert.deepEqual(createAudioEditorPreferencesV1().editing, EXACT_DEFAULTS);

	const first = normalizeAudioEditorEditingPreferences();
	first.asymmetricStereoHeightWorkspaces.push('custom');
	assert.deepEqual(normalizeAudioEditorEditingPreferences().asymmetricStereoHeightWorkspaces, ['modern']);
});

test('every editing preference enum accepts its complete inventory', () => {
	for (const rippleMode of AUDIO_EDITOR_RIPPLE_MODES) {
		assert.equal(normalizeAudioEditorEditingPreferences({ rippleMode }).rippleMode, rippleMode);
	}
	for (const deleteBehavior of AUDIO_EDITOR_DELETE_BEHAVIORS) {
		assert.equal(normalizeAudioEditorEditingPreferences({ deleteBehavior }).deleteBehavior, deleteBehavior);
	}
	for (const closeGapBehavior of AUDIO_EDITOR_CLOSE_GAP_BEHAVIORS) {
		assert.equal(normalizeAudioEditorEditingPreferences({ closeGapBehavior }).closeGapBehavior, closeGapBehavior);
	}
	for (const pasteBehavior of AUDIO_EDITOR_PASTE_BEHAVIORS) {
		assert.equal(normalizeAudioEditorEditingPreferences({ pasteBehavior }).pasteBehavior, pasteBehavior);
	}
	for (const pasteInsertBehavior of AUDIO_EDITOR_PASTE_INSERT_BEHAVIORS) {
		assert.equal(normalizeAudioEditorEditingPreferences({ pasteInsertBehavior }).pasteInsertBehavior, pasteInsertBehavior);
	}
	for (const asymmetricStereoHeights of AUDIO_EDITOR_ASYMMETRIC_STEREO_HEIGHTS) {
		assert.equal(normalizeAudioEditorEditingPreferences({ asymmetricStereoHeights }).asymmetricStereoHeights, asymmetricStereoHeights);
	}
	for (const zoomTogglePreset1 of AUDIO_EDITOR_ZOOM_TOGGLE_PRESETS) {
		assert.equal(normalizeAudioEditorEditingPreferences({ zoomTogglePreset1 }).zoomTogglePreset1, zoomTogglePreset1);
		assert.equal(normalizeAudioEditorEditingPreferences({ zoomTogglePreset2: zoomTogglePreset1 }).zoomTogglePreset2, zoomTogglePreset1);
	}
});

test('every editing preference enum rejects unsupported values', () => {
	for (const field of [
		'rippleMode',
		'deleteBehavior',
		'closeGapBehavior',
		'pasteBehavior',
		'pasteInsertBehavior',
		'asymmetricStereoHeights',
		'zoomTogglePreset1',
		'zoomTogglePreset2',
	] as const) {
		assert.throws(
			() => normalizeAudioEditorEditingPreferences({ [field]: 'unsupported' }),
			new RegExp(`editing\\.${field}`),
		);
	}
});

test('editing booleans and workspace identities are validated strictly', () => {
	for (const field of [
		'snapToZeroCrossings',
		'applyEffectsToAllAudio',
		'alwaysPasteAsNewClip',
		'alwaysConvertToMono',
	] as const) {
		for (const value of [0, 1, 'false', null]) {
			assert.throws(
				() => normalizeAudioEditorEditingPreferences({ [field]: value }),
				new RegExp(`editing\\.${field}`),
			);
		}
	}

	assert.throws(
		() => normalizeAudioEditorEditingPreferences({ asymmetricStereoHeightWorkspaces: 'modern' }),
		/editing\.asymmetricStereoHeightWorkspaces/,
	);
	assert.throws(
		() => normalizeAudioEditorEditingPreferences({ asymmetricStereoHeightWorkspaces: ['modern', 'modern'] }),
		/duplicate/,
	);
	assert.throws(
		() => normalizeAudioEditorEditingPreferences({ asymmetricStereoHeightWorkspaces: [''] }),
		/asymmetricStereoHeightWorkspaces\[0\]/,
	);
	for (const value of [true, false, '6']) {
		assert.throws(
			() => normalizeAudioEditorEditingPreferences({ zoomPrecision: value }),
			/editing\.zoomPrecision/,
		);
	}
});

test('legacy V1 preferences may omit Audacity 4 fields and load with defaults', () => {
	const legacy = structuredClone(createAudioEditorPreferencesV1()) as unknown as Record<string, unknown>;
	legacy.editing = {
		rippleMode: 'per-track',
		collisionBehavior: 'audacity',
		snapToZeroCrossings: true,
		zoomPrecision: 7,
	};

	assert.equal(validateAudioEditorPreferencesV1(legacy), true);
	const loaded = loadAudioEditorPreferencesV1(legacy);
	assert.equal(loaded.readOnly, false);
	assert.deepEqual(loaded.preferences.editing, {
		...EXACT_DEFAULTS,
		rippleMode: 'per-track',
		snapToZeroCrossings: true,
		zoomPrecision: 7,
	});
});

test('partial updates preserve every editing preference sibling', () => {
	const preferences = createAudioEditorPreferencesV1({
		editing: {
			rippleMode: 'all-tracks',
			snapToZeroCrossings: true,
			zoomPrecision: 9,
			applyEffectsToAllAudio: false,
			deleteBehavior: 'close-gap',
			closeGapBehavior: 'all-tracks',
			pasteBehavior: 'insert',
			pasteInsertBehavior: 'all-tracks',
			alwaysPasteAsNewClip: false,
			asymmetricStereoHeights: 'workspace-dependent',
			asymmetricStereoHeightWorkspaces: ['music', 'custom'],
			alwaysConvertToMono: true,
			zoomTogglePreset1: 'minutes',
			zoomTogglePreset2: 'max-zoom',
		},
	});
	const expected = {
		...structuredClone(preferences.editing),
		applyEffectsToAllAudio: true,
	};

	const updated = updateAudioEditorPreferencesV1(preferences, {
		editing: { applyEffectsToAllAudio: true },
	});
	assert.deepEqual(updated.editing, expected);
	assert.deepEqual(updated.workspace, preferences.workspace);
	assert.notEqual(updated.editing.asymmetricStereoHeightWorkspaces, preferences.editing.asymmetricStereoHeightWorkspaces);
});

test('deleting a custom workspace removes it from asymmetric-height targeting', () => {
	const preferences = createAudioEditorPreferencesV1({
		editing: { asymmetricStereoHeightWorkspaces: ['modern', 'studio'] },
		workspace: {
			activeId: 'modern',
			custom: [{
				id: 'studio', name: 'Studio',
				layout: createAudioEditorPreferencesV1().workspace,
			}],
		},
	});

	assert.deepEqual(
		deleteCustomAudioEditorWorkspace(preferences, 'studio').editing.asymmetricStereoHeightWorkspaces,
		['modern'],
	);
});

test('default delete preference resolves to the exact Audacity edit route', () => {
	const editing = normalizeAudioEditorEditingPreferences();
	assert.throws(() => resolveAudioEditorDefaultDelete(), /not been chosen/u);
	assert.throws(() => resolveAudioEditorDefaultDelete({ pasteBehavior: 'insert' }), /not been chosen/u);
	assert.throws(() => resolveAudioEditorDefaultDelete(editing), /not been chosen/u);
	assert.deepEqual(resolveAudioEditorDefaultDelete({ ...editing, deleteBehavior: 'leave-gap' }), {
		rippleMode: 'none', allTracks: false,
	});
	assert.deepEqual(resolveAudioEditorDefaultDelete({ ...editing, deleteBehavior: 'close-gap', closeGapBehavior: 'clip' }), {
		rippleMode: 'clip', allTracks: false,
	});
	assert.deepEqual(resolveAudioEditorDefaultDelete({ ...editing, deleteBehavior: 'close-gap', closeGapBehavior: 'track' }), {
		rippleMode: 'track', allTracks: false,
	});
	assert.deepEqual(resolveAudioEditorDefaultDelete({ ...editing, deleteBehavior: 'close-gap', closeGapBehavior: 'all-tracks' }), {
		rippleMode: 'track', allTracks: true,
	});
});

test('default paste preference resolves to overlap, track insert, or all-track insert', () => {
	const editing = normalizeAudioEditorEditingPreferences();
	assert.equal(resolveAudioEditorDefaultPaste(), 'overlap');
	assert.equal(resolveAudioEditorDefaultPaste({ deleteBehavior: 'close-gap' }), 'overlap');
	assert.equal(resolveAudioEditorDefaultPaste(editing), 'overlap');
	assert.equal(resolveAudioEditorDefaultPaste({ ...editing, pasteBehavior: 'insert' }), 'insert-track');
	assert.equal(resolveAudioEditorDefaultPaste({
		...editing, pasteBehavior: 'insert', pasteInsertBehavior: 'all-tracks',
	}), 'insert-all');
});

const ZOOM_CONTEXT = {
	currentPixelsPerSecond: 20,
	sampleRate: 48_000,
	projectDurationFrames: 96_000,
	selection: { startFrame: 24_000, endFrame: 48_000 },
	viewportWidth: 1_200,
	defaultPixelsPerSecond: 40,
	maximumPixelsPerSecond: 6_000_000,
};

test('all 15 Audacity zoom presets resolve to their intended target', () => {
	const expected = new Map([
		['fit-to-width', 600],
		['zoom-to-selection', 2_400],
		['zoom-default', 40],
		['minutes', 5 / 60],
		['seconds', 5],
		['5ths-of-seconds', 25],
		['10ths-of-seconds', 50],
		['20ths-of-seconds', 100],
		['50ths-of-seconds', 250],
		['100ths-of-seconds', 500],
		['500ths-of-seconds', 2_500],
		['milliseconds', 5_000],
		['samples', 44_100],
		['four-pixels-per-sample', 176_400],
		['max-zoom', 6_000_000],
	]);
	assert.equal(expected.size, 15);
	assert.deepEqual(AUDIO_EDITOR_ZOOM_TOGGLE_PRESETS, [...expected.keys()]);
	for (const preset of AUDIO_EDITOR_ZOOM_TOGGLE_PRESETS) {
		assert.equal(audioEditorZoomPresetPixelsPerSecond(preset, ZOOM_CONTEXT), expected.get(preset), preset);
	}
});

test('zoom toggle chooses the preset furthest away by logarithmic distance', () => {
	const editing = normalizeAudioEditorEditingPreferences({
		zoomTogglePreset1: 'zoom-default',
		zoomTogglePreset2: 'seconds',
	});
	assert.equal(resolveAudioEditorZoomToggleTarget(editing, ZOOM_CONTEXT), 5);
	assert.equal(resolveAudioEditorZoomToggleTarget(undefined, ZOOM_CONTEXT), 176_400);
	assert.equal(resolveAudioEditorZoomToggleTarget({ zoomTogglePreset1: 'seconds' }, ZOOM_CONTEXT), 176_400);

	assert.equal(resolveAudioEditorZoomToggleTarget(editing, {
		...ZOOM_CONTEXT,
		currentPixelsPerSecond: 10,
		defaultPixelsPerSecond: 100,
	}), 100);

	assert.equal(resolveAudioEditorZoomToggleTarget({
		...editing,
		zoomTogglePreset1: 'seconds',
		zoomTogglePreset2: 'zoom-default',
	}, {
		...ZOOM_CONTEXT,
		currentPixelsPerSecond: 10,
		defaultPixelsPerSecond: 100,
	}), 100, 'ties choose state 2, matching Audacity');
});

test('zoom toggle reports which configured preset won', () => {
	assert.deepEqual(resolveAudioEditorZoomToggle({
		zoomTogglePreset1: 'fit-to-width',
		zoomTogglePreset2: 'seconds',
	}, ZOOM_CONTEXT), {
		preset: 'fit-to-width',
		pixelsPerSecond: 600,
	});
	assert.deepEqual(resolveAudioEditorZoomToggle({
		zoomTogglePreset1: 'zoom-to-selection',
		zoomTogglePreset2: 'seconds',
	}, { ...ZOOM_CONTEXT, currentPixelsPerSecond: 5 }), {
		preset: 'zoom-to-selection',
		pixelsPerSecond: 2_400,
	});
});
