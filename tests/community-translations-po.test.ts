/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { po } from 'gettext-parser';
import { createContributionSnapshot, createTranslationDraft, updateTranslationDraft } from '../src/common/i18n/community-translations.ts';
import { createTranslationPoManifest, emitTranslationPo } from '../src/common/i18n/community-translations-po.ts';
import { importTranslationPo } from '../scripts/community-translations-po.ts';

test('PO preserves context, escapes, Unicode and multiline translations', () => {
	const snapshot = createContributionSnapshot('fr', {
		first: 'Open "{name}"\nSave \\ .po', second: 'Open "{name}"\nSave \\ .po',
	}, { first: 'Ouvrir "{name}"\nSauver \\ .po', second: 'Autre "{name}"\nSauver \\ .po' }, null);
	const output = emitTranslationPo(snapshot);
	const parsed = po.parse(output, { validation: true });
	assert.equal(parsed.headers.Language, 'fr');
	assert.equal(parsed.translations.first?.[snapshot.entries.first!.source]?.msgstr[0], snapshot.entries.first?.baselineText);
	assert.equal(Object.keys(parsed.translations).length, 3);
	assert.equal(importTranslationPo(output, createTranslationPoManifest(snapshot)).entries.length, 0);
	const translated = output.replace('Ouvrir', 'Charger');
	const contribution = importTranslationPo(translated, createTranslationPoManifest(snapshot), 'Jane');
	assert.equal(contribution.entries.length, 1);
	assert.equal(contribution.entries[0]?.translation, 'Charger "{name}"\nSauver \\ .po');
	assert.equal(contribution.contributor, 'Jane');
});

test('PO importer rejects modified language, source, duplicate IDs and plurals', () => {
	const snapshot = createContributionSnapshot('fr', { save: 'Save' }, { save: 'Sauver' }, null);
	const output = emitTranslationPo(snapshot);
	const manifest = createTranslationPoManifest(snapshot);
	assert.throws(() => importTranslationPo(output.replace('Language: fr', 'Language: de'), manifest));
	assert.throws(() => importTranslationPo(output.replace('msgid "Save"', 'msgid "Save audio"'), manifest));
	assert.throws(() => importTranslationPo(`${output}\nmsgctxt "save"\nmsgid "Save"\nmsgstr "Foo"\n`, manifest));
	assert.throws(() => importTranslationPo(output.replace('msgstr "Sauver"', 'msgid_plural "Saves"\nmsgstr[0] "Sauver"'), manifest));
	assert.throws(() => importTranslationPo(output.replace('msgstr "Sauver"', 'msgstr "Enregistrer'), manifest));
});

test('fuzzy and obsolete PO entries do not become contributions', () => {
	const snapshot = createContributionSnapshot('fr', { save: 'Save' }, { save: 'Sauver' }, null);
	const output = emitTranslationPo(snapshot).replace('msgctxt "save"', '#, fuzzy\nmsgctxt "save"').replace('Sauver', 'Enregistrer');
	assert.equal(importTranslationPo(output, createTranslationPoManifest(snapshot)).entries.length, 0);
});

test('PO draft download preserves seeded baseline and exports draft wording and notes', () => {
	const snapshot = createContributionSnapshot('fr', { save: 'Save' }, { save: 'Sauver' });
	const draft = updateTranslationDraft(createTranslationDraft(snapshot), snapshot, 'save', 'Enregistrer', 'Verb\nButton label');
	const output = emitTranslationPo(snapshot, false, draft.entries.map(entry => ({ ...entry, contributor: 'Jane "A"\nTranslator' })));
	const contribution = importTranslationPo(output, createTranslationPoManifest(snapshot));
	assert.equal(snapshot.entries.save?.baselineText, 'Sauver');
	assert.equal(contribution.entries[0]?.baselineText, 'Sauver');
	assert.equal(contribution.entries[0]?.translation, 'Enregistrer');
	assert.equal(contribution.entries[0]?.note, 'Verb\nButton label');
	assert.equal(contribution.entries[0]?.contributor, 'Jane "A"\nTranslator');
});
