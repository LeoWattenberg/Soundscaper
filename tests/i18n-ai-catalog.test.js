/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	assertMachineTranslatableLocale,
	assertTranslationCatalogFile,
	assertTranslationCatalogLocale,
	assessTranslationCatalog,
	listTranslationCatalogLocales,
	readTranslationCatalog,
	renderTranslationCatalogIndex,
	serializeTranslationCatalog,
	writeTranslationCatalog,
	writeTranslationCatalogIndex,
} from '../scripts/i18n-ai/catalog.mjs';

const MACHINE = { model: 'qwen3.8:latest', modelDigest: 'sha256:test', promptVersion: 'i18n-machine-v1' };
const AUDACITY = {
	repository: 'audacity/audacity', headSha: 'b'.repeat(40), runId: 1, artifactId: 2, workflowUrl: 'https://github.com/audacity/audacity/actions/runs/1',
	archiveName: 'Audacity_locale_1.zip', archiveSha256: 'a'.repeat(64), archiveByteLength: 3, licenseSpdx: 'GPL-3.0-only',
	upstreamProjectUrl: 'https://github.com/audacity/audacity', upstreamLicenseUrl: 'https://github.com/audacity/audacity/blob/x/LICENSE.txt',
	modificationNotice: 'converted', mappingVersion: 2, mappingSha256: 'c'.repeat(64),
};

test('a catalog serves any known canonical locale; the machine translator only those without a bundled human catalog', () => {
	assert.equal(assertTranslationCatalogLocale('fr'), 'fr');
	assert.equal(assertTranslationCatalogLocale('en-GB'), 'en-GB');
	assert.equal(assertTranslationCatalogLocale('de'), 'de');
	assert.throws(() => assertTranslationCatalogLocale('fr_FR'), /Unknown or non-canonical/u);
	assert.throws(() => assertTranslationCatalogLocale('tlh'), /Unknown or non-canonical/u);
	assert.throws(() => assertTranslationCatalogLocale('../fr'), /Unknown or non-canonical/u);
	assert.equal(assertMachineTranslatableLocale('fr'), 'fr');
	assert.equal(assertMachineTranslatableLocale('zh-CN'), 'zh-CN');
	assert.equal(assertMachineTranslatableLocale('sr-Latn-BA'), 'sr-Latn-BA');
	assert.throws(() => assertMachineTranslatableLocale('en'), /bundled human catalog/u);
	assert.throws(() => assertMachineTranslatableLocale('en-GB'), /bundled human catalog/u);
	assert.throws(() => assertMachineTranslatableLocale('de'), /bundled human catalog/u);
	assert.throws(() => assertMachineTranslatableLocale('fr_FR'), /Unknown or non-canonical/u);
});

test('assessment sorts entries into current, stale, orphaned and missing, and owes only automatic work', () => {
	const english = { a: 'A', b: 'B', c: 'C', d: 'D', e: 'E' };
	const assessment = assessTranslationCatalog({
		entries: {
			a: ['machine', 'A', 'a'],
			b: ['audacity', 'B (old)', 'b'],
			d: ['human', 'D (old)', 'd'],
			e: ['human', 'E', 'e'],
			z: ['machine', 'Z', 'z'],
		},
	}, english);
	assert.deepEqual(assessment.current, { a: 'a', e: 'e' });
	assert.deepEqual(assessment.origins, { a: 'machine', e: 'human' });
	assert.deepEqual([...assessment.stale], ['b', 'd']);
	assert.deepEqual([...assessment.orphaned], ['z']);
	assert.deepEqual([...assessment.missing], ['c']);
	assert.deepEqual([...assessment.pending], ['b', 'c'], 'a stale human entry waits for a person');
	assert.equal(assessment.outdated, false);
	assert.deepEqual([...assessTranslationCatalog(null, english).pending], ['a', 'b', 'c', 'd', 'e']);
	assert.deepEqual([...assessTranslationCatalog(null, english, { excludedKeys: ['e'] }).missing], ['a', 'b', 'c', 'd']);
	const outdated = assessTranslationCatalog({
		provenance: { machine: { promptVersion: 'i18n-machine-v0' } },
		entries: { a: ['machine', 'A', 'a'], b: ['audacity', 'B', 'b'], e: ['human', 'E', 'e'] },
	}, english, { promptVersion: 'i18n-machine-v1' });
	assert.equal(outdated.outdated, true);
	assert.deepEqual(outdated.current, { a: 'a', b: 'b', e: 'e' });
	assert.deepEqual([...outdated.pending], ['a', 'b', 'c', 'd'], 'an outdated prompt owes every automatic entry, never a human one');
	assert.equal(assessTranslationCatalog({ provenance: { audacity: AUDACITY }, entries: { b: ['audacity', 'B', 'b'] } }, english, { promptVersion: 'i18n-machine-v1' }).outdated, false);
	assert.equal(assessTranslationCatalog(null, english, { promptVersion: 'i18n-machine-v1' }).outdated, false);
});

test('serialisation is canonical: one sorted triple per line, one provenance record per origin present', () => {
	const text = serializeTranslationCatalog({
		locale: 'fr',
		provenance: { audacity: { ...AUDACITY, extra: 'dropped' }, machine: { ...MACHINE, extra: 'dropped' } },
		entries: { zoomIn: ['machine', 'Zoom in', 'Zoom avant'], addTrack: ['audacity', 'Add track', 'Ajouter une piste'], play: ['human', 'Play', 'Lecture'] },
	});
	assert.equal(text, [
		'{',
		'\t"schemaVersion": 2,',
		'\t"locale": "fr",',
		'\t"provenance": {',
		`\t\t"machine": ${JSON.stringify(MACHINE)},`,
		`\t\t"audacity": ${JSON.stringify(AUDACITY)}`,
		'\t},',
		'\t"entries": {',
		'\t\t"addTrack": ["audacity","Add track","Ajouter une piste"],',
		'\t\t"play": ["human","Play","Lecture"],',
		'\t\t"zoomIn": ["machine","Zoom in","Zoom avant"]',
		'\t}',
		'}',
		'',
	].join('\n'));
	const parsed = JSON.parse(text);
	assert.deepEqual(Object.keys(parsed), ['schemaVersion', 'locale', 'provenance', 'entries']);
	assertTranslationCatalogFile(parsed, 'fr');
	assert.match(serializeTranslationCatalog({ locale: 'fr', entries: { a: ['human', 'A', 'a'] } }), /"provenance": \{\},/u);
});

test('a catalog file is refused when its shape, order, provenance or entries are wrong', () => {
	const valid = { schemaVersion: 2, locale: 'fr', provenance: { machine: MACHINE }, entries: { a: ['machine', 'A', 'a'], h: ['human', 'H', 'h'] } };
	assertTranslationCatalogFile(valid, 'fr');
	assertTranslationCatalogFile({ ...valid, provenance: {}, entries: { h: ['human', 'H', 'h'] } }, 'fr');
	assert.throws(() => assertTranslationCatalogFile({ ...valid, schemaVersion: 1 }, 'fr'), /schema/u);
	assert.throws(() => assertTranslationCatalogFile({ ...valid, locale: 'es' }, 'fr'), /declares locale/u);
	assert.throws(() => assertTranslationCatalogFile({ ...valid, provenance: {} }, 'fr'), /machine provenance/u);
	assert.throws(() => assertTranslationCatalogFile({ ...valid, provenance: { machine: { model: 'x' } } }, 'fr'), /missing modelDigest/u);
	assert.throws(() => assertTranslationCatalogFile({ ...valid, provenance: { machine: MACHINE, audacity: AUDACITY } }, 'fr'), /audacity provenance without audacity entries/u);
	assert.throws(() => assertTranslationCatalogFile({ ...valid, provenance: { machine: MACHINE, elsewhere: {} } }, 'fr'), /unknown origin/u);
	assert.throws(() => assertTranslationCatalogFile({ ...valid, entries: { a: valid.entries.a, b: ['audacity', 'B', 'b'], h: valid.entries.h } }, 'fr'), /Audacity provenance is missing/u);
	assert.throws(() => assertTranslationCatalogFile({ ...valid, provenance: { audacity: { ...AUDACITY, licenseSpdx: 'MIT' } }, entries: { b: ['audacity', 'B', 'b'] } }, 'fr'), /GPL-3\.0-only/u);
	assert.throws(() => assertTranslationCatalogFile({ ...valid, entries: { h: ['human', 'H', 'h'], a: ['machine', 'A', 'a'] } }, 'fr'), /sorted/u);
	assert.throws(() => assertTranslationCatalogFile({ ...valid, entries: { a: ['A', 'a'] } }, 'fr'), /triple/u);
	assert.throws(() => assertTranslationCatalogFile({ ...valid, entries: { a: ['elsewhere', 'A', 'a'] } }, 'fr'), /triple/u);
	assert.throws(() => assertTranslationCatalogFile({ ...valid, entries: { a: ['machine', 'A {n}', 'a'] } }, 'fr'), /acceptable/u);
	assert.throws(() => assertTranslationCatalogFile({ ...valid, entries: { a: ['machine', 'A', 'a…'] } }, 'fr'), /acceptable/u);
	assert.throws(() => assertTranslationCatalogFile({ ...valid, entries: {} }, 'fr'), /no entries/u);
	assert.throws(() => assertTranslationCatalogFile({ ...valid, locale: 'tlh' }, 'tlh'), /Unknown or non-canonical/u);
});

test('writing a catalog and its index round-trips through the reader and the loader shape', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-translation-catalog-'));
	assert.deepEqual(await listTranslationCatalogLocales(directory), []);
	assert.equal(await readTranslationCatalog('fr', directory), null);
	await writeTranslationCatalog({ locale: 'fr', provenance: { machine: MACHINE, audacity: AUDACITY }, entries: { b: ['machine', 'B', 'b'], a: ['human', 'A', 'a'] } }, directory);
	await writeTranslationCatalog({ locale: 'zh-CN', provenance: { machine: MACHINE }, entries: { a: ['machine', 'A', '甲'] } }, directory);
	await writeTranslationCatalog({ locale: 'en-GB', provenance: { audacity: AUDACITY }, entries: { a: ['audacity', 'A', 'A (UK)'] } }, directory);
	assert.deepEqual(await writeTranslationCatalogIndex(directory), ['en-GB', 'fr', 'zh-CN']);
	assert.deepEqual(await listTranslationCatalogLocales(directory), ['en-GB', 'fr', 'zh-CN']);
	const catalog = await readTranslationCatalog('fr', directory);
	assert.deepEqual(Object.keys(catalog.entries), ['a', 'b']);
	assert.deepEqual(Object.keys(catalog.provenance), ['machine'], 'provenance follows the origins present');
	const index = await readFile(join(directory, 'index.js'), 'utf8');
	assert.equal(index, renderTranslationCatalogIndex(['en-GB', 'fr', 'zh-CN']));
	assert.match(index, /fr: \(\) => import\('\.\/fr\.json'\),/u);
	assert.doesNotMatch(index, /with: \{ type/u);
	assert.match(index, /'zh-CN': \(\) => import\('\.\/zh-CN\.json'/u);
	assert.match(renderTranslationCatalogIndex([]), /TRANSLATION_CATALOG_LOADERS = Object\.freeze\(\{\}\)/u);
	await writeTranslationCatalog({ locale: 'zh-CN', provenance: { machine: MACHINE }, entries: {} }, directory);
	assert.deepEqual(await writeTranslationCatalogIndex(directory), ['en-GB', 'fr'], 'a catalog with nothing left is removed');
	assert.deepEqual((await readdir(directory)).sort(), ['en-GB.json', 'fr.json', 'index.js']);
	await assert.rejects(() => writeTranslationCatalog({ locale: 'fr', provenance: { machine: MACHINE }, entries: { a: ['machine', 'A', ''] } }, directory), /acceptable/u);
	await assert.rejects(() => writeTranslationCatalog({ locale: 'tlh', provenance: { machine: MACHINE }, entries: { a: ['machine', 'A', 'a'] } }, directory), /Unknown or non-canonical/u);
});
