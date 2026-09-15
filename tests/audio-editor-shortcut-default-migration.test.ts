import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorPreferencesV1, loadAudioEditorPreferencesV1, normalizeAudioEditorShortcut } from '../src/common/editor/preferences.js';
import {
	AUDIO_EDITOR_SHORTCUT_DEFAULTS_VERSION,
	migrateAudioEditorShortcutDefaults,
} from '../src/common/editor/shortcut-default-migration.ts';

const normalizedKey = (binding: string): string => normalizeAudioEditorShortcut(binding).toLowerCase();
const conflictKey = (binding: string): string => normalizedKey(binding).replace(/^(?:ctrl|meta)(?=\+)/u, 'primary');

test('shortcut-default migration distinguishes untouched, customized, removed, and new actions', () => {
	const shortcuts = JSON.parse(`{
		"file-new":["control+n"],
		"file-save":["Alt+S"],
		"file-save-as":["Ctrl+Shift+S"],
		"custom-action":["Alt+P"],
		"__proto__":["Alt+R"],
		"constructor":["Alt+C"]
	}`) as Record<string, string[]>;
	const migrated = migrateAudioEditorShortcutDefaults({
		shortcuts,
		currentDefaults: {
			'file-new': ['Ctrl+Shift+N'],
			'file-open': ['Ctrl+O'],
			'file-save': ['Ctrl+S'],
			'new-action': ['Alt+P', 'Alt+N'],
		},
		formerDefaults: {
			'file-new': ['Ctrl+N'],
			'file-open': ['Ctrl+O'],
			'file-save': ['Ctrl+S'],
			'file-save-as': ['Ctrl+Shift+S'],
		},
		shortcutDefaultsVersion: 0,
		normalizedKey,
	});

	assert.deepEqual(migrated['file-new'], ['Ctrl+Shift+N']);
	assert.equal(Object.hasOwn(migrated, 'file-open'), false);
	assert.deepEqual(migrated['file-save'], ['Alt+S']);
	assert.equal(Object.hasOwn(migrated, 'file-save-as'), false);
	assert.deepEqual(migrated['custom-action'], ['Alt+P']);
	assert.deepEqual(migrated['new-action'], ['Alt+N']);
	assert.deepEqual(Object.getOwnPropertyDescriptor(migrated, '__proto__')?.value, ['Alt+R']);
	assert.deepEqual(Object.getOwnPropertyDescriptor(migrated, 'constructor')?.value, ['Alt+C']);
	assert.equal(Object.getPrototypeOf(migrated), Object.prototype);
});

test('shortcut-default migration preserves a customized primary binding order', () => {
	const migrated = migrateAudioEditorShortcutDefaults({
		shortcuts: {
			'delete-all-tracks-ripple': ['Ctrl+Backspace', 'Ctrl+Delete'],
		},
		currentDefaults: {
			'delete-all-tracks-ripple': ['Ctrl+Del', 'Ctrl+Backspace'],
		},
		formerDefaults: {
			'delete-all-tracks-ripple': ['Ctrl+Delete', 'Ctrl+Backspace'],
		},
		shortcutDefaultsVersion: 0,
		normalizedKey,
	});

	assert.deepEqual(migrated['delete-all-tracks-ripple'], ['Ctrl+Backspace', 'Ctrl+Delete']);
});

test('a current shortcut-default marker preserves removals while enforcing reserved chords', () => {
	const migrated = migrateAudioEditorShortcutDefaults({
		shortcuts: {
			'custom-action': ['Ctrl+K', 'Alt+Q'],
		},
		currentDefaults: {
			'file-new': ['Ctrl+N'],
		},
		formerDefaults: {},
		shortcutDefaultsVersion: AUDIO_EDITOR_SHORTCUT_DEFAULTS_VERSION,
		normalizedKey,
		reservedBindings: ['Ctrl+K'],
	});

	assert.deepEqual(migrated, {
		'custom-action': ['Alt+Q'],
	});
});

test('migration uses runtime conflict equivalence without mistaking Meta customizations for old Ctrl defaults', () => {
	const migrated = migrateAudioEditorShortcutDefaults({
		shortcuts: {
			'file-new': ['Meta+N'],
			'custom-search': ['Meta+K', 'Ctrl+Meta+K'],
		},
		currentDefaults: {
			'file-new': ['Ctrl+Shift+N'],
			'new-action': ['Ctrl+N'],
		},
		formerDefaults: {
			'file-new': ['Ctrl+N'],
		},
		shortcutDefaultsVersion: 0,
		normalizedKey,
		conflictKey,
		reservedBindings: ['Ctrl+K'],
	});

	assert.deepEqual(migrated, {
		'file-new': ['Meta+N'],
		'custom-search': ['Ctrl+Meta+K'],
	});
});

test('version one preferences gain C and X while preserving previous explicit removals and custom bindings', () => {
	const options = {
		currentDefaults: { 'file-new': ['Ctrl+N'], 'play-cut-preview': ['C'], 'play-stop-select': ['X'] },
		formerDefaults: {}, shortcutDefaultsVersion: 1, normalizedKey,
	};
	const upgraded = migrateAudioEditorShortcutDefaults({
		...options, shortcuts: { 'custom-action': ['Alt+P'] },
	});
	assert.deepEqual(upgraded, { 'custom-action': ['Alt+P'], 'play-cut-preview': ['C'], 'play-stop-select': ['X'] });
	assert.equal(Object.hasOwn(upgraded, 'file-new'), false);
	assert.deepEqual(migrateAudioEditorShortcutDefaults({
		...options, shortcuts: { 'custom-action': ['C'], 'play-stop-select': [] },
	}), { 'custom-action': ['C'], 'play-stop-select': [] });
	assert.deepEqual(migrateAudioEditorShortcutDefaults({
		...options, shortcuts: { 'play-cut-preview': ['Alt+C'], 'play-stop-select': ['Alt+X'] },
	}), { 'play-cut-preview': ['Alt+C'], 'play-stop-select': ['Alt+X'] });
});

test('preferences saved before the profile gain new audition keys even though the manifest now documents them', () => {
	const saved = createAudioEditorPreferencesV1();
	delete saved.shortcuts['play-cut-preview'];
	delete saved.shortcuts['play-stop-select'];
	const legacy = { ...saved, shortcutDefaultsVersion: 0 };
	const loaded = loadAudioEditorPreferencesV1(legacy).preferences;
	assert.deepEqual(loaded.shortcuts['play-cut-preview'], ['C']);
	assert.deepEqual(loaded.shortcuts['play-stop-select'], ['X']);
});
