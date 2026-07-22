import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDACITY_ACTION_MANIFEST,
	AUDACITY_ACTION_STATUS,
} from '../src/common/editor/audacity-action-parity.js';
import {
	AUDIO_EDITOR_DEFAULT_SHORTCUTS,
	AUDIO_EDITOR_RESERVED_SHORTCUTS,
	AUDIO_EDITOR_SEARCH_ACTION_ID,
	AUDIO_EDITOR_SEARCH_SHORTCUTS,
	createAudioEditorPreferencesV1,
	findAudioEditorShortcutConflicts,
	loadAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';

test('default editor shortcuts are derived from implemented pinned-manifest actions', () => {
	const expected = Object.fromEntries(Object.values(AUDACITY_ACTION_MANIFEST)
		.filter((action) => action.status === AUDACITY_ACTION_STATUS.IMPLEMENTED && action.shortcut)
		.map((action) => [action.id, [action.shortcut]]));
	expected['delete-all-tracks-ripple'] = ['Ctrl+Delete', 'Ctrl+Backspace'];

	assert.deepEqual(AUDIO_EDITOR_DEFAULT_SHORTCUTS, expected);
	assert.equal(AUDIO_EDITOR_DEFAULT_SHORTCUTS['zoom-default'][0], 'Ctrl+2');
	assert.equal(AUDIO_EDITOR_DEFAULT_SHORTCUTS['zoom-to-fit-project'][0], 'Ctrl+0');
	assert.equal(AUDIO_EDITOR_DEFAULT_SHORTCUTS['action://playback/play'][0], 'Space');
	assert.equal(Object.hasOwn(AUDIO_EDITOR_DEFAULT_SHORTCUTS, 'spectral-brush'), false);
	assert.deepEqual(findAudioEditorShortcutConflicts(AUDIO_EDITOR_DEFAULT_SHORTCUTS), []);
});

test('fixed search accelerators participate in shortcut conflict detection', () => {
	assert.deepEqual(AUDIO_EDITOR_SEARCH_SHORTCUTS, ['Ctrl+F', 'F3']);
	assert.deepEqual(AUDIO_EDITOR_RESERVED_SHORTCUTS, {
		[AUDIO_EDITOR_SEARCH_ACTION_ID]: ['Ctrl+F', 'F3'],
	});
	assert.deepEqual(findAudioEditorShortcutConflicts({
		'custom-find': ['control+f'],
		'custom-find-next': ['f3'],
	}), [
		{ binding: 'Ctrl+F', actionIds: ['custom-find', AUDIO_EDITOR_SEARCH_ACTION_ID] },
		{ binding: 'f3', actionIds: ['custom-find-next', AUDIO_EDITOR_SEARCH_ACTION_ID] },
	]);
});

test('legacy shortcut action IDs migrate to the canonical runtime registry IDs', () => {
	const preferences = createAudioEditorPreferencesV1({
		shortcuts: {
			'new-project': ['Alt+N'],
			'save-project': ['Alt+S'],
			play: ['P'],
			'quick-help': ['F2'],
			'zoom-fit': ['Alt+F'],
		},
	});

	assert.deepEqual(preferences.shortcuts, {
		'file-new': ['Alt+N'],
		'file-save': ['Alt+S'],
		'action://playback/play': ['P'],
		'online-handbook': ['F2'],
		'zoom-to-fit-project': ['Alt+F'],
	});
});

test('loading saved shortcuts migrates search reservations and the former zoom binding idempotently', () => {
	const saved = createAudioEditorPreferencesV1({
		shortcuts: {
			'zoom-fit': ['Ctrl+F', 'Alt+F', 'control+0'],
			'zoom-in': ['Ctrl+0', 'Ctrl+1'],
			'file-save': ['Ctrl+F', 'Ctrl+S'],
			split: ['F3', 'S'],
			'custom-search-only': ['F3'],
			'custom-unrelated': ['Alt+Q'],
		},
	});

	const loaded = loadAudioEditorPreferencesV1(saved).preferences;
	assert.deepEqual(loaded.shortcuts, {
		'zoom-to-fit-project': ['Ctrl+0', 'Alt+F'],
		'zoom-in': ['Ctrl+1'],
		'file-save': ['Ctrl+S'],
		split: ['S'],
		'custom-search-only': [],
		'custom-unrelated': ['Alt+Q'],
	});
	assert.deepEqual(loadAudioEditorPreferencesV1(loaded).preferences, loaded);
});

test('loading current custom shortcuts does not reserve Ctrl+0 when zoom no longer uses its former default', () => {
	const saved = createAudioEditorPreferencesV1({
		shortcuts: {
			'zoom-to-fit-project': ['Alt+F'],
			'custom-zero': ['Ctrl+0'],
			'custom-search': ['Ctrl+F', 'Alt+S'],
		},
	});

	assert.deepEqual(loadAudioEditorPreferencesV1(saved).preferences.shortcuts, {
		'zoom-to-fit-project': ['Alt+F'],
		'custom-zero': ['Ctrl+0'],
		'custom-search': ['Alt+S'],
	});
});

test('loading current Fit project defaults resolves Ctrl+0 collisions in favor of Fit project', () => {
	const saved = createAudioEditorPreferencesV1({
		shortcuts: {
			'zoom-to-fit-project': ['Ctrl+0'],
			'custom-zero': ['Ctrl+0', 'Alt+0'],
		},
	});

	assert.deepEqual(loadAudioEditorPreferencesV1(saved).preferences.shortcuts, {
		'zoom-to-fit-project': ['Ctrl+0'],
		'custom-zero': ['Alt+0'],
	});
});
