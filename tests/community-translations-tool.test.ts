/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { importCommunityTranslationFile, exportCommunityTranslationPo } from '../scripts/community-translations.ts';
import { createContributionSnapshot, createTranslationDraft, updateTranslationDraft } from '../src/common/i18n/community-translations.ts';

test('JSON dry-run leaves catalogs untouched; applying writes only selected human keys and index', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'scape-community-'));
	try {
		const catalogDirectory = join(directory, 'catalogs');
		await mkdir(catalogDirectory);
		const englishCopy = { save: 'Save', open: 'Open' };
		const snapshot = createContributionSnapshot('fr', englishCopy, englishCopy, null);
		let draft = updateTranslationDraft(createTranslationDraft(snapshot), snapshot, 'save', 'Enregistrer', 'Verb');
		draft = { ...updateTranslationDraft(draft, snapshot, 'open', 'Ouvrir'), contributor: 'Jane' };
		const file = join(directory, 'contribution.json');
		await writeFile(file, JSON.stringify(draft));
		const options = { file, englishCopy, germanCopy: {}, catalogDirectory };
		const report = await importCommunityTranslationFile(options);
		assert.deepEqual(report.clean, ['open', 'save']);
		assert.deepEqual(report.diffs.find(({ key }) => key === 'save'), {
			key: 'save', source: 'Save', currentSource: 'Save', before: 'Save', current: 'Save',
			after: 'Enregistrer', origin: 'missing', note: 'Verb',
		});
		assert.deepEqual(await readdir(catalogDirectory), []);
		await assert.rejects(importCommunityTranslationFile({ ...options, apply: true }));
		await assert.rejects(importCommunityTranslationFile({ ...options, apply: true, keys: ['unknown'] }));
		const applied = await importCommunityTranslationFile({ ...options, apply: true, keys: ['save'] });
		assert.deepEqual(applied.applied, ['save']);
		const raw: unknown = JSON.parse(await readFile(join(catalogDirectory, 'fr.json'), 'utf8'));
		const catalog = raw as { entries: Record<string, unknown>; community: Record<string, { contributor: string; note: string }> };
		assert.deepEqual(catalog.entries, { save: ['human', 'Save', 'Enregistrer'] });
		assert.equal(catalog.community.save?.contributor, 'Jane');
		assert.equal(catalog.community.save?.note, 'Verb');
		assert.match(await readFile(join(catalogDirectory, 'index.js'), 'utf8'), /fr: \(\) => import/u);
		assert.deepEqual((await importCommunityTranslationFile(options)).conflicts, ['save']);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('PO ZIP round-trip imports only changed entries and supports German bundled baselines', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'scape-community-po-'));
	try {
		const englishCopy = { save: 'Save' };
		const germanCopy = { save: 'Speichern' };
		const options = { englishCopy, germanCopy, catalogDirectory: directory };
		const output = join(directory, 'de.zip');
		await exportCommunityTranslationPo('de', output, options);
		assert.deepEqual((await importCommunityTranslationFile({ ...options, file: output })).clean, []);
		const archive = unzipSync(await readFile(output));
		assert.match(strFromU8(archive['messages.pot']!), /msgctxt "save"\nmsgid "Save"\nmsgstr ""/u);
		archive['messages.po'] = strToU8(strFromU8(archive['messages.po']!).replace('msgstr "Speichern"', 'msgstr "Sichern"'));
		await writeFile(output, zipSync(archive));
		const report = await importCommunityTranslationFile({ ...options, file: output, apply: true, keys: ['save'] });
		assert.deepEqual(report.clean, ['save']);
		const raw: unknown = JSON.parse(await readFile(join(directory, 'de.json'), 'utf8'));
		assert.deepEqual((raw as { entries: Record<string, unknown> }).entries, { save: ['human', 'Save', 'Sichern'] });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
