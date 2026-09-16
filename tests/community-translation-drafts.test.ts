/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTranslationDraftStore } from '../src/common/editor/controller/preferences/translation-drafts.ts';
import { createContributionSnapshot, createTranslationDraft, updateTranslationDraft } from '../src/common/i18n/community-translations.ts';

test('failed persistence retains exportable memory and separates locale drafts', async () => {
	const fr = createContributionSnapshot('fr', { save: 'Save' }, { save: 'Sauver' }, null);
	const de = createContributionSnapshot('de', { save: 'Save' }, { save: 'Speichern' }, null);
	const store = createTranslationDraftStore({
		loadSetting: () => Promise.resolve(null),
		persistSetting: () => Promise.reject(new Error('Storage unavailable')),
	});
	const draft = updateTranslationDraft(createTranslationDraft(fr), fr, 'save', 'Enregistrer');
	const saved = await store.save(draft);
	assert.equal(saved.draft.entries[0]?.translation, 'Enregistrer');
	assert.equal(saved.persistenceError, 'Storage unavailable');
	assert.equal((await store.load(fr)).draft.entries[0]?.translation, 'Enregistrer');
	assert.equal((await store.load(de)).draft.entries.length, 0);
	const cleared = await store.clear(fr);
	assert.equal(cleared.draft.entries.length, 0);
});

test('stored old snapshots load without rebasing immutable source baselines', async () => {
	const initial = createContributionSnapshot('fr', { save: 'Save' }, { save: 'Sauver' }, null);
	const draft = updateTranslationDraft(createTranslationDraft(initial), initial, 'save', 'Enregistrer');
	const current = createContributionSnapshot('fr', { save: 'Save audio' }, { save: 'Sauver audio' }, null);
	const store = createTranslationDraftStore({
		loadSetting: () => Promise.resolve(draft), persistSetting: () => Promise.resolve(),
	});
	const loaded = await store.load(current);
	assert.equal(loaded.draft.snapshotId, initial.snapshotId);
	assert.equal(loaded.draft.entries[0]?.source, 'Save');
});

test('unreadable saved draft produces recoverable empty state', async () => {
	const snapshot = createContributionSnapshot('fr', { save: 'Save' }, { save: 'Sauver' }, null);
	const store = createTranslationDraftStore({
		loadSetting: () => Promise.resolve({ version: 99 }), persistSetting: () => Promise.resolve(),
	});
	const loaded = await store.load(snapshot);
	assert.equal(loaded.draft.entries.length, 0);
	assert.match(loaded.persistenceError ?? '', /Unsupported/u);
});
