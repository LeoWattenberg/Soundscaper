import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDACITY_ACTION_MANIFEST,
	AUDACITY_ACTION_STATUS,
} from '../src/lib/tools/audio-editor/audacity-action-parity.js';
import {
	AUDIO_EDITOR_DEFAULT_SHORTCUTS,
	createAudioEditorPreferencesV1,
	findAudioEditorShortcutConflicts,
} from '../src/lib/tools/audio-editor/preferences.js';

test('default editor shortcuts are derived from implemented pinned-manifest actions', () => {
	const expected = Object.fromEntries(Object.values(AUDACITY_ACTION_MANIFEST)
		.filter((action) => action.status === AUDACITY_ACTION_STATUS.IMPLEMENTED && action.shortcut)
		.map((action) => [action.id, [action.shortcut]]));

	assert.deepEqual(AUDIO_EDITOR_DEFAULT_SHORTCUTS, expected);
	assert.equal(AUDIO_EDITOR_DEFAULT_SHORTCUTS['zoom-default'][0], 'Ctrl+2');
	assert.equal(AUDIO_EDITOR_DEFAULT_SHORTCUTS['action://playback/play'][0], 'Space');
	assert.equal(Object.hasOwn(AUDIO_EDITOR_DEFAULT_SHORTCUTS, 'spectral-brush'), false);
	assert.deepEqual(findAudioEditorShortcutConflicts(AUDIO_EDITOR_DEFAULT_SHORTCUTS), []);
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
