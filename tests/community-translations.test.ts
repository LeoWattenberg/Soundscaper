/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessTranslationContribution, createContributionSnapshot, createTranslationDraft,
	parseTranslationContribution, previewTranslationDraft, serializeTranslationContribution,
	updateTranslationDraft, mergeTranslationContributions,
} from '../src/common/i18n/community-translations.ts';

const english = { open: 'Open {name}', save: 'Save .po' };
const published = { open: 'Ouvrir {name}', save: 'Enregistrer .po' };

test('executable input is excluded from snapshots and cannot be imported as a correction', () => {
	const copy = { ...english, nyquistPromptDefault: '(print "hello")' };
	const snapshot = createContributionSnapshot('fr', copy, copy);
	assert.equal(snapshot.entries.nyquistPromptDefault, undefined);
	const contribution = parseTranslationContribution({ ...createTranslationDraft(snapshot), entries: [{
		key: 'nyquistPromptDefault', source: copy.nyquistPromptDefault, baselineText: copy.nyquistPromptDefault,
		baselineEntry: null, translation: '(print "bonjour")',
	}] });
	assert.deepEqual(assessTranslationContribution(contribution, snapshot).invalid.map(({ key }) => key), ['nyquistPromptDefault']);
	assert.deepEqual(previewTranslationDraft(contribution, snapshot), {});
});

test('community snapshots capture immutable catalog and bundled baselines', () => {
	const entry = ['human', english.open, published.open] as const;
	const catalog = { locale: 'fr', entries: { open: entry } };
	const snapshot = createContributionSnapshot('fr', english, published, catalog);
	assert.deepEqual(snapshot.entries.open?.baselineEntry, entry);
	assert.equal(snapshot.entries.save?.baselineText, published.save);
	assert.ok(Object.isFrozen(snapshot.entries.open?.baselineEntry));
	assert.ok(Object.isFrozen(snapshot.entries));
	assert.throws(() => createContributionSnapshot('en', english, published, null));
	assert.throws(() => createContributionSnapshot('xx', english, published, null));
	assert.throws(() => createContributionSnapshot('af', english, published, null));
	assert.equal(createContributionSnapshot('de', english, english).locale, 'de');
	assert.equal(createContributionSnapshot('en-GB', english, english).locale, 'en-GB');
});

test('sparse contributions export only changed text and round trip notes', () => {
	const snapshot = createContributionSnapshot('fr', english, published, null);
	let draft = createTranslationDraft(snapshot);
	draft = updateTranslationDraft(draft, snapshot, 'open', 'Charger {name}', 'Used for audio');
	assert.equal(draft.entries.length, 1);
	assert.deepEqual(parseTranslationContribution(serializeTranslationContribution(draft)), draft);
	assert.deepEqual(previewTranslationDraft(draft, snapshot), { open: 'Charger {name}' });
	draft = updateTranslationDraft(draft, snapshot, 'open', published.open);
	assert.equal(draft.entries.length, 0);
});

test('source and catalog baseline changes retain edits but exclude them from preview', () => {
	const snapshot = createContributionSnapshot('fr', english, published, null);
	const draft = updateTranslationDraft(createTranslationDraft(snapshot), snapshot, 'open', 'Charger {name}');
	const sourceChanged = createContributionSnapshot('fr', { ...english, open: 'Open audio {name}' }, published, null);
	assert.equal(assessTranslationContribution(draft, sourceChanged).stale.length, 1);
	assert.deepEqual(previewTranslationDraft(draft, sourceChanged), {});
	const translatedChanged = createContributionSnapshot('fr', english, { ...published, open: 'Ajouter {name}' }, null);
	assert.equal(assessTranslationContribution(draft, translatedChanged).conflicts.length, 1);
	const ownershipChanged = createContributionSnapshot('fr', english, published, {
		locale: 'fr', entries: { open: ['human', english.open, published.open] },
	});
	assert.equal(assessTranslationContribution(draft, ownershipChanged).conflicts.length, 1);
	assert.equal(draft.entries[0]?.source, english.open);
});

test('invalid text is retained for correction and cannot be previewed', () => {
	const snapshot = createContributionSnapshot('fr', english, published, null);
	const draft = updateTranslationDraft(createTranslationDraft(snapshot), snapshot, 'open', 'Charger');
	assert.equal(assessTranslationContribution(draft, snapshot).invalid.length, 1);
	assert.deepEqual(previewTranslationDraft(draft, snapshot), {});
	assert.throws(() => parseTranslationContribution({ ...draft, version: 2 }));
	assert.throws(() => parseTranslationContribution({ ...draft, entries: [...draft.entries, ...draft.entries] }));
	assert.throws(() => parseTranslationContribution({ ...draft, locale: 'en' }));
	assert.throws(() => parseTranslationContribution({ ...draft, entries: [{ ...draft.entries[0],
		baselineEntry: [['machine'], english.open, published.open],
	}] }));
});

test('imports add independent keys and preserve conflicting local drafts', () => {
	const snapshot = createContributionSnapshot('fr', english, published, null);
	const left = updateTranslationDraft(createTranslationDraft(snapshot), snapshot, 'open', 'Charger {name}');
	const right = updateTranslationDraft(createTranslationDraft(snapshot), snapshot, 'save', 'Sauver .po');
	assert.equal(mergeTranslationContributions(left, right).entries.length, 2);
	const conflict = updateTranslationDraft(createTranslationDraft(snapshot), snapshot, 'open', 'Ajouter {name}');
	assert.throws(() => mergeTranslationContributions(left, conflict));
	assert.equal(left.entries[0]?.translation, 'Charger {name}');
});

test('merging files retains each translation author independently of the handoff submitter', () => {
	const snapshot = createContributionSnapshot('fr', english, published);
	const jane = { ...updateTranslationDraft(createTranslationDraft(snapshot), snapshot, 'open', 'Charger {name}'), contributor: 'Jane' };
	const bob = { ...updateTranslationDraft(createTranslationDraft(snapshot), snapshot, 'save', 'Sauver .po'), contributor: 'Bob' };
	const merged = mergeTranslationContributions(jane, bob);
	assert.equal(merged.contributor, 'Bob');
	assert.equal(merged.entries.find(({ key }) => key === 'open')?.contributor, 'Jane');
	assert.equal(merged.entries.find(({ key }) => key === 'save')?.contributor, 'Bob');
	const handoff = parseTranslationContribution(serializeTranslationContribution({ ...merged, contributor: 'Submitter' }));
	const edited = updateTranslationDraft(handoff, snapshot, 'open', 'Ajouter {name}');
	assert.equal(edited.entries.find(({ key }) => key === 'open')?.contributor, 'Jane');
	assert.equal(Object.hasOwn(jane.entries[0]!, 'contributor'), false);
});

test('an explicit entry author takes precedence over a file submitter during a merge', () => {
	const snapshot = createContributionSnapshot('fr', english, published);
	const draft = updateTranslationDraft(createTranslationDraft(snapshot), snapshot, 'open', 'Charger {name}');
	const credited = parseTranslationContribution({ ...draft, contributor: 'Submitter',
		entries: draft.entries.map(entry => ({ ...entry, contributor: 'Original author' })),
	});
	const merged = mergeTranslationContributions(createTranslationDraft(snapshot), credited);
	assert.equal(merged.entries[0]?.contributor, 'Original author');
	assert.throws(() => parseTranslationContribution({ ...draft,
		entries: draft.entries.map(entry => ({ ...entry, contributor: 1 })),
	}));
});
