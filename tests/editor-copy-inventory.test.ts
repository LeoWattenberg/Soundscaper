/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import {
	EDITOR_COPY_METADATA,
	EDITOR_ENGLISH_COPY,
	EDITOR_GERMAN_COPY,
	buildEditorCopyInventory,
} from '../src/common/i18n/editor-copy-inventory.ts';
import { resolveMacroManagerCopy } from '../src/common/editor/ui/inspector/macro-manager-copy.ts';
import { resolveTrackAutomationCopy } from '../src/common/editor/ui/timeline/track-automation-copy.ts';
import { resolveSoundscaperRoutingGraphCopy } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-copy.ts';
import { resolveSoundscaperNativeServicesCopy } from '../src/common/editor/ui/soundscaper-native-services-copy.ts';
import { acceptableTranslation, currentTranslations } from '../src/common/i18n/translation-catalog.js';
import { resolveCatalog } from '../src/common/i18n/runtime.js';

test('editor inventory preserves legacy identities and isolates independently owned meanings', () => {
	for (const [key, value] of Object.entries(ENGLISH_COPY)) assert.equal(EDITOR_ENGLISH_COPY[key], value, key);
	for (const [key, value] of Object.entries(GERMAN_COPY)) assert.equal(EDITOR_GERMAN_COPY[key], value, key);
	assert.equal(EDITOR_ENGLISH_COPY['ui.routing.confirmDelete'], 'Confirm delete');
	assert.equal(EDITOR_ENGLISH_COPY.confirmDelete, 'Delete permanently');
	assert.equal(EDITOR_ENGLISH_COPY['ui.soundscaperNative.audioDevices'], 'Audio devices');
	assert.equal(EDITOR_ENGLISH_COPY.audioDevices, 'Audio setup');
	assert.equal(EDITOR_ENGLISH_COPY['ui.effectMacroTemplate.templates'], undefined);
	assert.equal(EDITOR_ENGLISH_COPY['ui.effectMacroTemplate.names.fade-ends'], undefined);
	assert.equal(EDITOR_ENGLISH_COPY['ui.macroManager.deleteProgram'], 'Delete program');
	assert.equal(EDITOR_GERMAN_COPY['ui.macroManager.runProgram'], 'Programm ausführen');
	assert.equal(EDITOR_COPY_METADATA['ui.macroManager.runProgram']?.owner, 'macroManager');
	assert.deepEqual(Object.keys(EDITOR_COPY_METADATA), Object.keys(EDITOR_ENGLISH_COPY));
	for (const [key, source] of Object.entries(EDITOR_ENGLISH_COPY)) {
		assert.equal(acceptableTranslation(source, source), true, key);
		if (EDITOR_GERMAN_COPY[key]) assert.equal(acceptableTranslation(source, EDITOR_GERMAN_COPY[key]), true, key);
	}
});

test('published locale loading and topical resolvers use the same namespaced source reference', async () => {
	const source = EDITOR_ENGLISH_COPY['ui.macroManager.runProgram'];
	const french = await resolveCatalog('fr', { translationLoaders: {
		fr: async () => ({ schemaVersion: 2, locale: 'fr', entries: {
			'ui.macroManager.runProgram': ['human', source, 'Exécuter le programme'],
			'ui.trackAutomation.addAutomation': ['human', 'Add automation', 'Ajouter une automatisation'],
			'ui.routing.confirmDelete': ['human', 'Confirm delete', 'Confirmer la suppression'],
			'ui.soundscaperNative.audioDevices': ['human', 'Audio devices', 'Périphériques audio'],
		} }),
	} });
	assert.equal(resolveMacroManagerCopy('fr', french).runProgram, 'Exécuter le programme');
	assert.equal(resolveTrackAutomationCopy('fr', french).addAutomation, 'Ajouter une automatisation');
	assert.equal(resolveSoundscaperRoutingGraphCopy(french).confirmDelete, 'Confirmer la suppression');
	assert.equal(resolveSoundscaperNativeServicesCopy(french).audioDevices, 'Périphériques audio');
	assert.equal(resolveMacroManagerCopy('de', await resolveCatalog('de')).runProgram, 'Programm ausführen');
	assert.deepEqual(currentTranslations({ schemaVersion: 2, locale: 'fr', entries: {
		'ui.macroManager.runProgram': ['human', 'Run program (old)', 'Ancienne traduction'],
	} }, EDITOR_ENGLISH_COPY), {});
});

test('inventory refuses ambiguous keys and malformed owned source before publication', () => {
	assert.throws(() => buildEditorCopyInventory({ 'ui.a.label': 'Old' }, {}, [
		{ owner: 'a', en: { label: 'New' } },
	]), /duplicate/i);
	assert.throws(() => buildEditorCopyInventory({}, {}, [
		{ owner: 'a', en: { label: 'Open…' } },
	]), /source/i);
	assert.throws(() => buildEditorCopyInventory({}, {}, [
		{ owner: 'a', en: { label: 'Band {number}' }, de: { label: 'Band {nummer}' } },
	]), /German/i);
});
