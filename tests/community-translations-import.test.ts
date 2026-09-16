/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createContributionSnapshot, createTranslationDraft, updateTranslationDraft, mergeTranslationContributions } from '../src/common/i18n/community-translations.ts';
import { selectCommunityTranslations } from '../scripts/community-translations-import.ts';

test('maintainer selection promotes only explicit clean keys and retains upstream notices', () => {
	const provenance = { audacity: { licenseSpdx: 'GPL-3.0-only', modificationNotice: 'Translated upstream' } };
	const catalog = { schemaVersion: 2, locale: 'fr', provenance, entries: { save: ['audacity', 'Save', 'Sauver'] as const } };
	const snapshot = createContributionSnapshot('fr', { save: 'Save', open: 'Open' }, { save: 'Sauver', open: 'Ouvrir' }, catalog);
	let draft = updateTranslationDraft(createTranslationDraft(snapshot), snapshot, 'save', 'Enregistrer', 'Verb');
	draft = { ...updateTranslationDraft(draft, snapshot, 'open', 'Charger'), contributor: 'Jane' };
	assert.throws(() => selectCommunityTranslations(draft, snapshot, catalog, []));
	const selected = selectCommunityTranslations(draft, snapshot, catalog, ['save']);
	assert.deepEqual(selected.entries.save, ['human', 'Save', 'Enregistrer']);
	assert.equal(selected.entries.open, undefined);
	assert.equal(selected.community.save?.contributor, 'Jane');
	assert.equal(selected.community.save?.note, 'Verb');
	assert.deepEqual(selected.community.save?.upstreamProvenance, provenance.audacity);
	assert.deepEqual(catalog.entries.save, ['audacity', 'Save', 'Sauver']);
});

test('maintainer cannot select source changes, concurrent human edits or invalid translations', () => {
	const english = { open: 'Open {name}' };
	const snapshot = createContributionSnapshot('fr', english, { open: 'Ouvrir {name}' }, null);
	const draft = updateTranslationDraft(createTranslationDraft(snapshot), snapshot, 'open', 'Charger {name}');
	const sourceChanged = createContributionSnapshot('fr', { open: 'Open audio {name}' }, english, null);
	assert.throws(() => selectCommunityTranslations(draft, sourceChanged, null, ['open']));
	const edited = createContributionSnapshot('fr', english, { open: 'Ajouter {name}' }, null);
	assert.throws(() => selectCommunityTranslations(draft, edited, null, ['open']));
	const invalid = updateTranslationDraft(createTranslationDraft(snapshot), snapshot, 'open', 'Charger');
	assert.throws(() => selectCommunityTranslations(invalid, snapshot, null, ['open']));
	assert.throws(() => selectCommunityTranslations(draft, snapshot, null, ['unknown']));
});

test('selected corrections retain individual authors after multiple files are merged', () => {
	const english = { open: 'Open', save: 'Save' };
	const snapshot = createContributionSnapshot('fr', english, english);
	const jane = { ...updateTranslationDraft(createTranslationDraft(snapshot), snapshot, 'open', 'Ouvrir'), contributor: 'Jane' };
	const bob = { ...updateTranslationDraft(createTranslationDraft(snapshot), snapshot, 'save', 'Enregistrer'), contributor: 'Bob' };
	const contribution = { ...mergeTranslationContributions(jane, bob), contributor: 'Maintainer' };
	const selected = selectCommunityTranslations(contribution, snapshot, null, ['open', 'save']);
	assert.equal(selected.community.open?.contributor, 'Jane');
	assert.equal(selected.community.save?.contributor, 'Bob');
});
