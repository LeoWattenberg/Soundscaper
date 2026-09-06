/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { currentMachineEntries } from '../src/common/i18n/machine-catalog.js';
import { MACHINE_CATALOG_LOADERS, MACHINE_CATALOG_LOCALES } from '../src/common/i18n/machine/index.js';
import {
	MACHINE_CATALOG_DIRECTORY,
	assertMachineCatalogFile,
	assertMachineCatalogLocale,
	assessMachineCatalog,
	listMachineCatalogLocales,
	readMachineCatalog,
	renderMachineCatalogIndex,
	serializeMachineCatalog,
	writeMachineCatalog,
	writeMachineCatalogIndex,
} from '../scripts/i18n-ai/catalog.mjs';

const PROVENANCE = { model: 'qwen3.8:latest', modelDigest: 'sha256:test', promptVersion: 'i18n-machine-v1' };

test('every committed machine catalog is well formed and listed exactly once in the index', async (t) => {
	const locales = await listMachineCatalogLocales();
	assert.deepEqual(locales, [...MACHINE_CATALOG_LOCALES]);
	assert.deepEqual(Object.keys(MACHINE_CATALOG_LOADERS), locales);
	assert.equal(await readFile(join(MACHINE_CATALOG_DIRECTORY, 'index.js'), 'utf8'), renderMachineCatalogIndex(locales));
	for (const locale of locales) {
		const catalog = await readMachineCatalog(locale);
		assert.ok(catalog, locale);
		assert.equal(await readFile(join(MACHINE_CATALOG_DIRECTORY, `${locale}.json`), 'utf8'), serializeMachineCatalog(catalog), `${locale} is serialised canonically`);
		const loaded = await MACHINE_CATALOG_LOADERS[locale]();
		assert.deepEqual(loaded.default, catalog, `${locale} loader`);
		const assessment = assessMachineCatalog(catalog, ENGLISH_COPY);
		const shown = currentMachineEntries(catalog, ENGLISH_COPY, { locale });
		assert.deepEqual(Object.keys(shown), Object.keys(assessment.current), `${locale} runtime and generator agree`);
		t.diagnostic(`${locale}: ${Object.keys(assessment.current).length} current, ${assessment.stale.length} stale, ${assessment.missing.length} missing, ${assessment.orphaned.length} orphaned`);
	}
});

test('a machine catalog serves a known locale that no bundled human catalog covers', () => {
	assert.equal(assertMachineCatalogLocale('fr'), 'fr');
	assert.equal(assertMachineCatalogLocale('zh-CN'), 'zh-CN');
	assert.equal(assertMachineCatalogLocale('sr-Latn-BA'), 'sr-Latn-BA');
	assert.throws(() => assertMachineCatalogLocale('en'), /bundled human catalog/u);
	assert.throws(() => assertMachineCatalogLocale('en-GB'), /bundled human catalog/u);
	assert.throws(() => assertMachineCatalogLocale('de'), /bundled human catalog/u);
	assert.throws(() => assertMachineCatalogLocale('fr_FR'), /Unknown or non-canonical/u);
	assert.throws(() => assertMachineCatalogLocale('tlh'), /Unknown or non-canonical/u);
	assert.throws(() => assertMachineCatalogLocale('../fr'), /Unknown or non-canonical/u);
});

test('assessment sorts entries into current, stale, orphaned and missing', () => {
	const english = { a: 'A', b: 'B', c: 'C' };
	const assessment = assessMachineCatalog({ entries: { a: ['A', 'a'], b: ['B (old)', 'b'], z: ['Z', 'z'] } }, english);
	assert.deepEqual(assessment.current, { a: 'a' });
	assert.deepEqual([...assessment.stale], ['b']);
	assert.deepEqual([...assessment.orphaned], ['z']);
	assert.deepEqual([...assessment.missing], ['c']);
	assert.deepEqual([...assessment.pending], ['b', 'c']);
	assert.deepEqual([...assessMachineCatalog(null, english).pending], ['a', 'b', 'c']);
	assert.equal(assessment.outdated, false);
	const outdated = assessMachineCatalog({ provenance: { promptVersion: 'i18n-machine-v0' }, entries: { a: ['A', 'a'] } }, english, { promptVersion: 'i18n-machine-v1' });
	assert.equal(outdated.outdated, true);
	assert.deepEqual(outdated.current, { a: 'a' });
	assert.deepEqual([...outdated.pending], ['a', 'b', 'c']);
	assert.equal(assessMachineCatalog(null, english, { promptVersion: 'i18n-machine-v1' }).outdated, false);
});

test('serialisation is canonical: one sorted entry per line with the provenance fields only', () => {
	const text = serializeMachineCatalog({
		locale: 'fr',
		provenance: { ...PROVENANCE, extra: 'dropped' },
		entries: { zoomIn: ['Zoom in', 'Zoom avant'], addTrack: ['Add track', 'Ajouter une piste'] },
	});
	assert.equal(text, [
		'{',
		'\t"schemaVersion": 1,',
		'\t"locale": "fr",',
		'\t"provenance": {"model":"qwen3.8:latest","modelDigest":"sha256:test","promptVersion":"i18n-machine-v1"},',
		'\t"entries": {',
		'\t\t"addTrack": ["Add track","Ajouter une piste"],',
		'\t\t"zoomIn": ["Zoom in","Zoom avant"]',
		'\t}',
		'}',
		'',
	].join('\n'));
	const parsed = JSON.parse(text);
	assert.deepEqual(Object.keys(parsed), ['schemaVersion', 'locale', 'provenance', 'entries']);
	assertMachineCatalogFile(parsed, 'fr');
});

test('a catalog file is refused when its shape, order or entries are wrong', () => {
	const valid = { schemaVersion: 1, locale: 'fr', provenance: PROVENANCE, entries: { a: ['A', 'a'] } };
	assertMachineCatalogFile(valid, 'fr');
	assert.throws(() => assertMachineCatalogFile({ ...valid, schemaVersion: 2 }, 'fr'), /schema/u);
	assert.throws(() => assertMachineCatalogFile({ ...valid, locale: 'es' }, 'fr'), /declares locale/u);
	assert.throws(() => assertMachineCatalogFile({ ...valid, provenance: { model: 'x' } }, 'fr'), /provenance/u);
	assert.throws(() => assertMachineCatalogFile({ ...valid, entries: { b: ['B', 'b'], a: ['A', 'a'] } }, 'fr'), /sorted/u);
	assert.throws(() => assertMachineCatalogFile({ ...valid, entries: { a: ['A'] } }, 'fr'), /pair/u);
	assert.throws(() => assertMachineCatalogFile({ ...valid, entries: { a: ['A {n}', 'a'] } }, 'fr'), /acceptable/u);
	assert.throws(() => assertMachineCatalogFile({ ...valid, entries: { a: ['A', 'a…'] } }, 'fr'), /acceptable/u);
	assert.throws(() => assertMachineCatalogFile({ ...valid, locale: 'de' }, 'de'), /bundled human catalog/u);
});

test('writing a catalog and its index round-trips through the reader and the loader shape', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-machine-catalog-'));
	assert.deepEqual(await listMachineCatalogLocales(directory), []);
	assert.equal(await readMachineCatalog('fr', directory), null);
	await writeMachineCatalog({ locale: 'fr', provenance: PROVENANCE, entries: { b: ['B', 'b'], a: ['A', 'a'] } }, directory);
	await writeMachineCatalog({ locale: 'zh-CN', provenance: PROVENANCE, entries: { a: ['A', '甲'] } }, directory);
	assert.deepEqual(await writeMachineCatalogIndex(directory), ['fr', 'zh-CN']);
	assert.deepEqual(await listMachineCatalogLocales(directory), ['fr', 'zh-CN']);
	const catalog = await readMachineCatalog('fr', directory);
	assert.deepEqual(Object.keys(catalog.entries), ['a', 'b']);
	const index = await readFile(join(directory, 'index.js'), 'utf8');
	assert.match(index, /fr: \(\) => import\('\.\/fr\.json'\),/u);
	assert.doesNotMatch(index, /with: \{ type/u);
	assert.match(index, /'zh-CN': \(\) => import\('\.\/zh-CN\.json'/u);
	assert.equal(renderMachineCatalogIndex([]), await readFile(join(MACHINE_CATALOG_DIRECTORY, 'index.js'), 'utf8').then((text) => (MACHINE_CATALOG_LOCALES.length ? renderMachineCatalogIndex([]) : text)));
	await assert.rejects(() => writeMachineCatalog({ locale: 'fr', provenance: PROVENANCE, entries: { a: ['A', ''] } }, directory), /acceptable/u);
	await assert.rejects(() => writeMachineCatalog({ locale: 'de', provenance: PROVENANCE, entries: {} }, directory), /bundled human catalog/u);
});
