import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_DEFAULT_SHORTCUTS,
	AUDIO_EDITOR_RESERVED_SHORTCUTS,
	AUDIO_EDITOR_SEARCH_ACTION_ID,
	AUDIO_EDITOR_SEARCH_SHORTCUTS,
	AUDIO_EDITOR_SHORTCUT_DEFAULTS_VERSION,
	createAudioEditorPreferencesV1,
	findAudioEditorShortcutConflicts,
	loadAudioEditorPreferencesV1,
	normalizeAudioEditorShortcut,
} from '../src/common/editor/preferences.js';
import {
	AUDACITY_ACTION_MANIFEST,
	AUDACITY_ACTION_STATUS,
} from '../src/common/editor/audacity-action-parity.js';
import {
	AUDACITY_SHORTCUT_BINDINGS_BY_ACTION,
	AUDIO_EDITOR_SUPPLEMENTAL_SHORTCUT_BINDINGS_BY_ACTION,
} from '../src/common/editor/audacity-shortcut-bindings.ts';

test('default editor shortcuts use the complete mapped Audacity profile', () => {
	assert.equal(AUDIO_EDITOR_DEFAULT_SHORTCUTS['zoom-default'][0], 'Ctrl+2');
	assert.equal(AUDIO_EDITOR_DEFAULT_SHORTCUTS['zoom-to-fit-project'][0], 'Ctrl+F');
	assert.equal(AUDIO_EDITOR_DEFAULT_SHORTCUTS['action://playback/play'][0], 'P');
	assert.deepEqual(AUDIO_EDITOR_DEFAULT_SHORTCUTS['action://delete'], ['Del', 'Backspace']);
	assert.deepEqual(AUDIO_EDITOR_DEFAULT_SHORTCUTS['track-view-toggle-selection'], ['Ctrl+Enter', 'Ctrl+Return', 'Return', 'NUMPAD_ENTER']);
	assert.deepEqual(AUDIO_EDITOR_DEFAULT_SHORTCUTS['split-tool'], ['S']);
	assert.deepEqual(AUDIO_EDITOR_DEFAULT_SHORTCUTS.split, ['Ctrl+I']);
	assert.deepEqual(AUDIO_EDITOR_DEFAULT_SHORTCUTS.fullscreen, ['F11']);
	assert.equal(AUDACITY_ACTION_MANIFEST.fullscreen.shortcut, 'F11');
	assert.deepEqual(findAudioEditorShortcutConflicts(AUDIO_EDITOR_DEFAULT_SHORTCUTS), []);
});

test('every implemented local-origin action ships its documented default shortcut', () => {
	// The mapped Audacity half of the defaults is re-verified exhaustively by
	// tests/audacity-shortcut-profile.test.ts. This is the matching completeness
	// check for the half derived straight from the manifest, so a local action
	// whose documented shortcut never reaches the defaults fails here.
	const expectedLocalDefaults = {};
	for (const action of Object.values(AUDACITY_ACTION_MANIFEST)) {
		if (action.status !== AUDACITY_ACTION_STATUS.IMPLEMENTED) continue;
		if (action.origin !== 'local' || !action.shortcut) continue;
		// A local action one of the binding tables also carries keeps that
		// entry's full sequence list rather than the manifest's single primary
		// spelling, in the order preferences.js resolves them: the supplemental
		// table is spread last and so wins, then the reviewed profile.
		if (Object.hasOwn(AUDIO_EDITOR_SUPPLEMENTAL_SHORTCUT_BINDINGS_BY_ACTION, action.id)) {
			expectedLocalDefaults[action.id] = [...AUDIO_EDITOR_SUPPLEMENTAL_SHORTCUT_BINDINGS_BY_ACTION[action.id]];
		} else if (Object.hasOwn(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION, action.id)) {
			expectedLocalDefaults[action.id] = [...AUDACITY_SHORTCUT_BINDINGS_BY_ACTION[action.id]];
		} else {
			expectedLocalDefaults[action.id] = [action.shortcut];
		}
	}

	assert.deepEqual(expectedLocalDefaults, {
		'decrease-all-track-heights': ['Ctrl+Shift+Down'],
		'increase-all-track-heights': ['Ctrl+Shift+Up'],
		'local://mute-all': ['Ctrl+U'],
		'local://unmute-all': ['Ctrl+Shift+U'],
		'mix-render': ['Ctrl+Shift+M'],
	});

	const installedLocalDefaults = {};
	for (const id of Object.keys(expectedLocalDefaults)) {
		installedLocalDefaults[id] = Object.hasOwn(AUDIO_EDITOR_DEFAULT_SHORTCUTS, id)
			? [...AUDIO_EDITOR_DEFAULT_SHORTCUTS[id]]
			: null;
	}
	assert.deepEqual(installedLocalDefaults, expectedLocalDefaults);
});

test('installed shortcut defaults hold exactly the mapped, supplemental and local bindings', () => {
	const accountedFor = new Set([
		...Object.keys(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION),
		...Object.keys(AUDIO_EDITOR_SUPPLEMENTAL_SHORTCUT_BINDINGS_BY_ACTION),
		...Object.values(AUDACITY_ACTION_MANIFEST)
			.filter((action) => (
				action.status === AUDACITY_ACTION_STATUS.IMPLEMENTED
				&& action.origin === 'local'
				&& action.shortcut
			))
			.map((action) => action.id),
	]);
	const installed = Object.keys(AUDIO_EDITOR_DEFAULT_SHORTCUTS);

	assert.deepEqual(installed.filter((id) => !accountedFor.has(id)), [], 'unexplained default binding');
	assert.deepEqual(
		[...accountedFor].filter((id) => !Object.hasOwn(AUDIO_EDITOR_DEFAULT_SHORTCUTS, id)),
		[],
		'documented binding missing from the installed defaults',
	);
	for (const [id, sequences] of Object.entries(AUDIO_EDITOR_SUPPLEMENTAL_SHORTCUT_BINDINGS_BY_ACTION)) {
		assert.deepEqual(AUDIO_EDITOR_DEFAULT_SHORTCUTS[id], [...sequences], id);
	}
});

test('new editor preferences identify the installed shortcut-default profile', () => {
	assert.equal(
		createAudioEditorPreferencesV1().shortcutDefaultsVersion,
		AUDIO_EDITOR_SHORTCUT_DEFAULTS_VERSION,
	);
});

test('fixed search accelerators participate in shortcut conflict detection', () => {
	assert.deepEqual(AUDIO_EDITOR_SEARCH_SHORTCUTS, ['Ctrl+K']);
	assert.deepEqual(AUDIO_EDITOR_RESERVED_SHORTCUTS, {
		[AUDIO_EDITOR_SEARCH_ACTION_ID]: ['Ctrl+K'],
	});
	assert.deepEqual(findAudioEditorShortcutConflicts({
		'custom-find': ['control+k'],
	}), [
		{ binding: 'Ctrl+K', actionIds: ['custom-find', AUDIO_EDITOR_SEARCH_ACTION_ID] },
	]);
	assert.deepEqual(findAudioEditorShortcutConflicts({
		'custom-find': ['Meta+K'],
	}), [
		{ binding: 'Meta+K', actionIds: ['custom-find', AUDIO_EDITOR_SEARCH_ACTION_ID] },
	], 'Ctrl and Meta spellings collide because Ctrl is the platform-primary modifier');
});

test('shortcut conflicts distinguish the combined Ctrl+Meta chord from platform-primary chords', () => {
	assert.deepEqual(findAudioEditorShortcutConflicts({
		primary: ['Ctrl+O'],
		macPrimary: ['Meta+O'],
		combined: ['Ctrl+Meta+O'],
	}), [
		{ binding: 'Ctrl+O', actionIds: ['primary', 'macPrimary'] },
	]);
});

test('shortcut normalization understands every Audacity key spelling', () => {
	assert.equal(normalizeAudioEditorShortcut('Del'), 'Delete');
	assert.equal(normalizeAudioEditorShortcut('Esc'), 'Escape');
	assert.equal(normalizeAudioEditorShortcut('Ctrl+Return'), 'Ctrl+Enter');
	assert.equal(normalizeAudioEditorShortcut('PgUp'), 'PageUp');
	assert.equal(normalizeAudioEditorShortcut('PgDown'), 'PageDown');
	assert.equal(normalizeAudioEditorShortcut('NUMPAD_ENTER'), 'NumpadEnter');
});

test('legacy shortcut action IDs migrate to the canonical runtime registry IDs', () => {
	const preferences = createAudioEditorPreferencesV1({
		shortcuts: {
			'new-project': ['Alt+N'],
			'save-project': ['Alt+S'],
			play: ['P'],
			'quick-help': ['F2'],
			'zoom-fit': ['Alt+F'],
			'mixdown-to': ['Alt+M'],
		},
	});

	assert.deepEqual(preferences.shortcuts, {
		'file-new': ['Alt+N'],
		'file-save': ['Alt+S'],
		'action://playback/play': ['P'],
		'online-handbook': ['F2'],
		'zoom-to-fit-project': ['Alt+F'],
		'mix-render': ['Alt+M'],
	});
});

test('prototype-named custom shortcut action IDs remain literal own fields', () => {
	const shortcuts = JSON.parse('{"constructor":["Alt+C"],"__proto__":["Alt+P"]}');
	const saved = createAudioEditorPreferencesV1({ shortcuts });

	for (const normalized of [saved.shortcuts, loadAudioEditorPreferencesV1(saved).preferences.shortcuts]) {
		assert.deepEqual(Object.keys(normalized).sort(), ['__proto__', 'constructor']);
		assert.deepEqual(Object.getOwnPropertyDescriptor(normalized, 'constructor')?.value, ['Alt+C']);
		assert.deepEqual(Object.getOwnPropertyDescriptor(normalized, '__proto__')?.value, ['Alt+P']);
		assert.equal(Object.getPrototypeOf(normalized), Object.prototype);
	}
});

test('pre-profile preferences receive imported defaults without replacing custom bindings or removals', () => {
	const saved = createAudioEditorPreferencesV1({
		shortcuts: {
			'file-new': ['Ctrl+N'],
			'project-import': ['Ctrl+I'],
			'file-save': ['Alt+S'],
			'file-save-as': ['Ctrl+Shift+S'],
			'zoom-fit': ['Ctrl+0'],
			'zoom-in': ['Ctrl+1'],
			'action://trackedit/paste-insert': ['Insert'],
			split: ['S'],
			play: ['Space'],
			'custom-delete': ['Backspace'],
			'custom-search-only': ['Ctrl+K'],
			'custom-unrelated': ['Alt+Q'],
			constructor: ['Alt+C'],
		},
	});
	delete saved.shortcutDefaultsVersion;

	const loaded = loadAudioEditorPreferencesV1(saved).preferences;
	assert.equal(loaded.shortcutDefaultsVersion, AUDIO_EDITOR_SHORTCUT_DEFAULTS_VERSION);
	assert.deepEqual(loaded.shortcuts['file-new'], ['Ctrl+N']);
	assert.equal(Object.hasOwn(loaded.shortcuts, 'file-open'), false);
	assert.deepEqual(loaded.shortcuts['project-import'], ['Ctrl+Shift+I']);
	assert.deepEqual(loaded.shortcuts['file-save'], ['Alt+S']);
	assert.equal(Object.hasOwn(loaded.shortcuts, 'file-save-as'), false);
	assert.deepEqual(loaded.shortcuts['zoom-to-fit-project'], ['Ctrl+F']);
	assert.deepEqual(loaded.shortcuts['zoom-in'], ['Ctrl+=']);
	assert.deepEqual(loaded.shortcuts.insert, ['Shift+V']);
	assert.equal(Object.hasOwn(loaded.shortcuts, 'action://trackedit/paste-insert'), false);
	assert.deepEqual(loaded.shortcuts.split, ['Ctrl+I']);
	assert.deepEqual(loaded.shortcuts['split-tool'], ['S']);
	assert.deepEqual(loaded.shortcuts['action://playback/play'], ['P']);
	assert.deepEqual(loaded.shortcuts['action://delete'], ['Del']);
	assert.deepEqual(loaded.shortcuts['custom-delete'], ['Backspace']);
	assert.deepEqual(loaded.shortcuts['custom-search-only'], []);
	assert.deepEqual(loaded.shortcuts['custom-unrelated'], ['Alt+Q']);
	assert.deepEqual(Object.getOwnPropertyDescriptor(loaded.shortcuts, 'constructor')?.value, ['Alt+C']);
	assert.deepEqual(loadAudioEditorPreferencesV1(loaded).preferences, loaded);
});

test('pre-profile preferences treat modified legacy defaults as custom bindings', () => {
	const saved = createAudioEditorPreferencesV1({
		shortcuts: {
			'zoom-fit': ['Ctrl+0', 'Alt+F'],
			'action://trackedit/paste-insert': ['Insert', 'Alt+V'],
			'file-save': ['Ctrl+S', 'Alt+S'],
		},
	});
	delete saved.shortcutDefaultsVersion;

	const loaded = loadAudioEditorPreferencesV1(saved).preferences;
	assert.deepEqual(loaded.shortcuts['zoom-to-fit-project'], ['Ctrl+0', 'Alt+F']);
	assert.deepEqual(loaded.shortcuts.insert, ['Insert', 'Alt+V']);
	assert.deepEqual(loaded.shortcuts['file-save'], ['Ctrl+S', 'Alt+S']);
});

test('the profile marker keeps current explicit removals removed on later loads', () => {
	const saved = createAudioEditorPreferencesV1();
	delete saved.shortcuts['action://delete'];

	const loaded = loadAudioEditorPreferencesV1(saved).preferences;
	assert.equal(Object.hasOwn(loaded.shortcuts, 'action://delete'), false);
	assert.deepEqual(loadAudioEditorPreferencesV1(loaded).preferences, loaded);
});

test('loading current custom shortcuts does not reserve Ctrl+F when zoom no longer uses its default', () => {
	const saved = createAudioEditorPreferencesV1({
		shortcuts: {
			'zoom-to-fit-project': ['Alt+F'],
			'custom-find': ['Ctrl+F'],
			'custom-search': ['Ctrl+K', 'Alt+S'],
		},
	});

	assert.deepEqual(loadAudioEditorPreferencesV1(saved).preferences.shortcuts, {
		'zoom-to-fit-project': ['Alt+F'],
		'custom-find': ['Ctrl+F'],
		'custom-search': ['Alt+S'],
	});
});

test('loading current shortcuts preserves custom collisions for the shortcut editor to resolve', () => {
	const saved = createAudioEditorPreferencesV1({
		shortcuts: {
			'zoom-to-fit-project': ['Ctrl+F'],
			'custom-find': ['Ctrl+F', 'Alt+F'],
		},
	});

	assert.deepEqual(loadAudioEditorPreferencesV1(saved).preferences.shortcuts, {
		'zoom-to-fit-project': ['Ctrl+F'],
		'custom-find': ['Ctrl+F', 'Alt+F'],
	});
});

test('loading shortcuts removes a Meta spelling of the platform-primary reserved search chord', () => {
	const saved = createAudioEditorPreferencesV1({
		shortcuts: {
			'custom-search': ['Meta+K', 'Ctrl+Meta+K'],
		},
	});

	assert.deepEqual(loadAudioEditorPreferencesV1(saved).preferences.shortcuts, {
		'custom-search': ['Ctrl+Meta+K'],
	});
});
