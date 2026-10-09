/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { audioEditorPrimaryShortcut } from '../src/common/editor/audacity-shortcut-bindings.ts';
import { AUDIO_EDITOR_SHORTCUT_DEFAULTS_VERSION } from '../src/common/editor/shortcut-default-migration.ts';
import {
	createAudioEditorPreferencesV1,
	findAudioEditorShortcutConflicts,
	loadAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';

const PLAY_SELECTION = 'action://playback/play-selection';

test('new preferences bind Play Selection to W and publish the same primary shortcut', () => {
	const preferences = createAudioEditorPreferencesV1();
	assert.deepEqual(preferences.shortcuts[PLAY_SELECTION], ['W']);
	assert.equal(audioEditorPrimaryShortcut(PLAY_SELECTION), 'W');
	assert.deepEqual(findAudioEditorShortcutConflicts(preferences.shortcuts), []);
});

test('older preferences gain W when Play Selection and its key have no custom binding', () => {
	for (const shortcutDefaultsVersion of [0, 1, 2]) {
		const saved = createAudioEditorPreferencesV1();
		delete saved.shortcuts[PLAY_SELECTION];
		const loaded = loadAudioEditorPreferencesV1({ ...saved, shortcutDefaultsVersion }).preferences;
		assert.deepEqual(loaded.shortcuts[PLAY_SELECTION], ['W'], `version ${String(shortcutDefaultsVersion)}`);
		assert.equal(loaded.shortcutDefaultsVersion, AUDIO_EDITOR_SHORTCUT_DEFAULTS_VERSION);
	}
});

test('older preferences preserve Play Selection customizations and custom owners of W', () => {
	for (const shortcutDefaultsVersion of [0, 1, 2]) {
		for (const bindings of [['Alt+W'], []]) {
			const saved = createAudioEditorPreferencesV1({ shortcuts: { [PLAY_SELECTION]: bindings } });
			const loaded = loadAudioEditorPreferencesV1({ ...saved, shortcutDefaultsVersion }).preferences;
			assert.deepEqual(loaded.shortcuts[PLAY_SELECTION], bindings);
		}
		const saved = createAudioEditorPreferencesV1({ shortcuts: { 'custom-action': ['W'] } });
		const loaded = loadAudioEditorPreferencesV1({ ...saved, shortcutDefaultsVersion }).preferences;
		assert.deepEqual(loaded.shortcuts['custom-action'], ['W']);
		assert.equal(Object.hasOwn(loaded.shortcuts, PLAY_SELECTION), false);
	}
});

test('the W upgrade preserves removals of audition shortcuts installed in version two', () => {
	const saved = createAudioEditorPreferencesV1();
	delete saved.shortcuts[PLAY_SELECTION];
	delete saved.shortcuts['play-cut-preview'];
	delete saved.shortcuts['play-stop-select'];
	const loaded = loadAudioEditorPreferencesV1({ ...saved, shortcutDefaultsVersion: 2 }).preferences;
	assert.deepEqual(loaded.shortcuts[PLAY_SELECTION], ['W']);
	assert.equal(Object.hasOwn(loaded.shortcuts, 'play-cut-preview'), false);
	assert.equal(Object.hasOwn(loaded.shortcuts, 'play-stop-select'), false);
});

test('current preferences preserve an explicit removal of the W default', () => {
	const saved = createAudioEditorPreferencesV1();
	delete saved.shortcuts[PLAY_SELECTION];
	const loaded = loadAudioEditorPreferencesV1(saved).preferences;
	assert.equal(Object.hasOwn(loaded.shortcuts, PLAY_SELECTION), false);
});
