/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorPreferencesV1, normalizeAudioEditorShortcut } from '../src/common/editor/preferences.js';
import { migrateAudioEditorShortcutDefaults } from '../src/common/editor/shortcut-default-migration.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

const defaults = createAudioEditorPreferencesV1().shortcuts;
const migrate = (shortcuts: Record<string, string[]>) => migrateAudioEditorShortcutDefaults({ shortcuts,
	currentDefaults: defaults, formerDefaults: {}, shortcutDefaultsVersion: 4,
	normalizedKey: value => normalizeAudioEditorShortcut(value).toLowerCase(),
});

test('new installations reserve S for stretch handles and C for the split tool', () => {
	assert.deepEqual(defaults['split-tool'], ['C']);
	assert.deepEqual(defaults['play-cut-preview'], []);
});

test('bundled keyboard help agrees with the default split key and contextual clip handles', () => {
	const splitKey = defaults['split-tool'][0];
	for (const copy of [ENGLISH_COPY, GERMAN_COPY]) {
		assert.ok(copy.keyboardHelp.includes(`${splitKey}:`), 'help names the configured default split key');
		assert.match(copy.keyboardHelp, /F\/T\/S:/u);
		assert.doesNotMatch(copy.keyboardHelp, /(?:^| · )S:/u);
	}
});

test('untouched former split/cut-preview bindings migrate together without collisions', () => {
	const migrated = migrate({ 'split-tool': ['S'], 'play-cut-preview': ['C'], custom: ['Alt+U'] });
	assert.deepEqual(migrated['split-tool'], ['C']);
	assert.deepEqual(migrated['play-cut-preview'], []);
	assert.deepEqual(migrated.custom, ['Alt+U']);
});

test('custom and removed bindings retain ownership when adopting the new clip keys', () => {
	assert.deepEqual(migrate({ 'split-tool': ['Alt+S'], 'play-cut-preview': ['C'] })['split-tool'], ['Alt+S']);
	assert.deepEqual(migrate({ 'split-tool': [], 'play-cut-preview': ['C'] })['split-tool'], []);
	assert.deepEqual(migrate({ 'split-tool': ['S'], custom: ['C'] })['split-tool'], ['S']);
	assert.deepEqual(migrate({ 'split-tool': ['S'], 'play-cut-preview': ['Alt+C'] })['play-cut-preview'], ['Alt+C']);
});
