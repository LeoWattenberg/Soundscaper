/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeStoredZip } from './helpers/stored-zip.js';
import {
	buildAudacityLayer,
	mergeAudacityMessages,
	renderAudacityLayerNotice,
	writeAudacityLayer,
} from '../scripts/lib/audacity-committed-layer.mjs';
import { readAudacityQtCatalogsFromZip } from '../scripts/lib/audacity-qt-catalog.mjs';
import { listTranslationCatalogLocales, readTranslationCatalog, writeTranslationCatalog } from '../scripts/i18n-ai/catalog.mjs';

const HEAD_SHA = 'b'.repeat(40);
const MACHINE = { model: 'aya-expanse:32b', modelDigest: 'sha256:test', promptVersion: 'i18n-machine-v1' };

function numberedMapping(count) {
	return Array.from({ length: count }, (_, index) => ({ key: `key${String(index).padStart(3, '0')}`, context: 'main', source: `Source ${index}`, comment: '' }));
}

function numberedCatalog(locale, mapping, finishedCount, { pad = false } = {}) {
	const messages = mapping.map((entry, index) => `<message><source>${entry.source}</source><translation${index < finishedCount ? '' : ' type="unfinished"'}>${pad ? ' ' : ''}Translation ${index}...${pad ? ' ' : ''}</translation></message>`).join('');
	return `<?xml version="1.0"?><!DOCTYPE TS><TS version="2.1" language="${locale}"><context><name>main</name>${messages}</context></TS>`;
}

function englishFor(mapping) {
	return Object.fromEntries(mapping.map((entry) => [entry.key, entry.source]));
}

function layerOptions(archiveBytes, mapping) {
	return {
		archiveBytes,
		licenseBytes: Buffer.from('GNU GENERAL PUBLIC LICENSE\nVersion 3'),
		mapping,
		source: {
			artifactId: 101,
			archiveName: 'Audacity_locale_101.zip',
			expectedSha256: createHash('sha256').update(archiveBytes).digest('hex'),
			expectedByteLength: archiveBytes.byteLength,
			repository: 'audacity/audacity',
			runId: 123456,
			headSha: HEAD_SHA,
			workflowUrl: 'https://github.com/audacity/audacity/actions/runs/123456',
		},
	};
}

test('the layer carries every locale with a reviewed string, trimmed, whatever its coverage', () => {
	const mapping = numberedMapping(10);
	const archiveBytes = makeStoredZip([
		{ name: 'audacity_en.ts', data: numberedCatalog('en_US', mapping, 0) },
		{ name: 'audacity_de.ts', data: numberedCatalog('de', mapping, 10, { pad: true }) },
		{ name: 'audacity_fr.ts', data: numberedCatalog('fr', mapping, 2) },
		{ name: 'audacity_es.ts', data: numberedCatalog('es', mapping, 0) },
		{ name: 'audacity_is.ts', data: numberedCatalog('is', mapping, 5) },
		{ name: 'CMakeLists.txt', data: 'ignored' },
	]);
	const layer = buildAudacityLayer(layerOptions(archiveBytes, mapping));
	assert.deepEqual([...layer.messagesByLocale.keys()], ['de', 'fr']);
	assert.deepEqual([...layer.unknownLocales], ['is']);
	assert.equal(Object.keys(layer.messagesByLocale.get('fr')).length, 2, 'a thin catalog is kept; nothing gates it');
	assert.equal(layer.messagesByLocale.get('de').key000, 'Translation 0', 'padding and ellipses go, wording stays');
	assert.equal(layer.audit.es.mapped, 0);
	assert.equal(layer.provenance.licenseSpdx, 'GPL-3.0-only');
	assert.equal(layer.provenance.headSha, HEAD_SHA);
	assert.equal(layer.provenance.archiveByteLength, archiveBytes.byteLength);
	assert.equal(layer.provenance.upstreamLicenseUrl, `https://github.com/audacity/audacity/blob/${HEAD_SHA}/LICENSE.txt`);
	assert.match(layer.provenance.mappingSha256, /^[a-f0-9]{64}$/u);
});

test('the archive is held to its verified digest, length and licence', () => {
	const mapping = numberedMapping(3);
	const archiveBytes = makeStoredZip([{ name: 'audacity_en.ts', data: numberedCatalog('en_US', mapping, 0) }, { name: 'audacity_fr.ts', data: numberedCatalog('fr', mapping, 3) }]);
	const options = layerOptions(archiveBytes, mapping);
	assert.throws(() => buildAudacityLayer({ ...options, source: { ...options.source, expectedSha256: 'a'.repeat(64) } }), /SHA-256/u);
	assert.throws(() => buildAudacityLayer({ ...options, source: { ...options.source, expectedByteLength: 1 } }), /byte length/u);
	assert.throws(() => buildAudacityLayer({ ...options, licenseBytes: Buffer.alloc(0) }), /license/iu);
	assert.throws(() => buildAudacityLayer({ ...options, source: { ...options.source, repository: 'someone/else' } }), /audacity\/audacity/u);
});

test('a legacy alias beside the canonical catalog is left alone instead of failing the archive', () => {
	const mapping = numberedMapping(2);
	const canonical = makeStoredZip([
		{ name: 'audacity_en.ts', data: numberedCatalog('en_US', mapping, 0) },
		{ name: 'audacity_fil.ts', data: numberedCatalog('fil', mapping, 2) },
		{ name: 'audacity_tl.ts', data: numberedCatalog('tl', mapping, 1) },
	]);
	const { catalogs } = readAudacityQtCatalogsFromZip(canonical);
	assert.equal(catalogs.get('fil').archivePath, 'audacity_fil.ts');
	const aliasFirst = makeStoredZip([
		{ name: 'audacity_en.ts', data: numberedCatalog('en_US', mapping, 0) },
		{ name: 'audacity_tl.ts', data: numberedCatalog('tl', mapping, 1) },
		{ name: 'audacity_fil.ts', data: numberedCatalog('fil', mapping, 2) },
	]);
	assert.equal(readAudacityQtCatalogsFromZip(aliasFirst).catalogs.get('fil').archivePath, 'audacity_fil.ts');
	assert.equal(readAudacityQtCatalogsFromZip(aliasFirst).catalogs.get('fil').code, 'fil');
});

test('reviewed strings replace machine and older Audacity entries, never a human one, and retire with the artifact', () => {
	const english = { a: 'A', b: 'B', c: 'C', d: 'D', e: 'E' };
	const provenance = { headSha: HEAD_SHA, licenseSpdx: 'GPL-3.0-only' };
	const catalog = {
		locale: 'fr',
		provenance: { machine: MACHINE, audacity: { headSha: 'a'.repeat(40) } },
		entries: {
			a: ['machine', 'A', 'a (machine)'],
			b: ['human', 'B', 'b (human)'],
			c: ['audacity', 'C (old)', 'c (old audacity)'],
			d: ['audacity', 'D', 'd (audacity)'],
			e: ['machine', 'E', 'e (machine)'],
		},
	};
	const { catalog: merged, summary } = mergeAudacityMessages(catalog, 'fr', { a: 'a (reviewed)', b: 'b (reviewed)', c: 'c (reviewed)', unknown: 'dropped' }, provenance, english);
	assert.deepEqual(merged.entries, {
		a: ['audacity', 'A', 'a (reviewed)'],
		b: ['human', 'B', 'b (human)'],
		c: ['audacity', 'C', 'c (reviewed)'],
		e: ['machine', 'E', 'e (machine)'],
	});
	assert.deepEqual(summary, { locale: 'fr', written: 2, kept: 0, removed: 1, humanKept: 1 });
	assert.deepEqual(merged.provenance, { machine: MACHINE, audacity: provenance });
	const again = mergeAudacityMessages(merged, 'fr', { a: 'a (reviewed)', c: 'c (reviewed)' }, provenance, english);
	assert.deepEqual(again.catalog.entries, merged.entries);
	assert.deepEqual(again.summary, { locale: 'fr', written: 0, kept: 2, removed: 0, humanKept: 0 });
	assert.deepEqual(mergeAudacityMessages(null, 'es', { a: 'a' }, provenance, english).catalog.entries, { a: ['audacity', 'A', 'a'] });
	assert.equal(mergeAudacityMessages(null, 'es', { a: 'a' }, provenance, english).catalog.provenance.audacity, provenance);
});

test('the writer merges into the catalogs, refreshes the index, notice and licence, and is idempotent', async () => {
	const mapping = numberedMapping(3);
	const english = englishFor(mapping);
	const archiveBytes = makeStoredZip([
		{ name: 'audacity_en.ts', data: numberedCatalog('en_US', mapping, 0) },
		{ name: 'audacity_fr.ts', data: numberedCatalog('fr', mapping, 3) },
		{ name: 'audacity_zh_CN.ts', data: numberedCatalog('zh_CN', mapping, 1) },
	]);
	const layer = buildAudacityLayer(layerOptions(archiveBytes, mapping));
	const notice = renderAudacityLayerNotice(layer.provenance, ['fr', 'zh-CN']);
	assert.match(notice, /GPL-3\.0-only/u);
	assert.match(notice, new RegExp(HEAD_SHA, 'u'));
	assert.match(notice, /section 13/u);
	assert.match(notice, /Locales with Audacity entries: fr, zh-CN\./u);

	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-audacity-layer-'));
	await writeTranslationCatalog({ locale: 'fr', provenance: { machine: MACHINE }, entries: { key000: ['machine', 'Source 0', 'machine 0'], key001: ['human', 'Source 1', 'human 1'] } }, directory);
	await writeTranslationCatalog({ locale: 'es', provenance: { audacity: layer.provenance }, entries: { key000: ['audacity', 'Source 0', 'stale audacity 0'] } }, directory);
	await writeTranslationCatalog({ locale: 'pl', provenance: { machine: MACHINE }, entries: { key000: ['machine', 'Source 0', 'machine 0'] } }, directory);
	const { locales, summaries } = await writeAudacityLayer(layer, directory, { englishCopy: english });
	assert.deepEqual(locales, ['fr', 'pl', 'zh-CN'], 'es lost its only entry and its file; pl was untouched');
	assert.deepEqual(summaries, [
		{ locale: 'es', written: 0, kept: 0, removed: 1, humanKept: 0 },
		{ locale: 'fr', written: 2, kept: 0, removed: 0, humanKept: 1 },
		{ locale: 'zh-CN', written: 1, kept: 0, removed: 0, humanKept: 0 },
	]);
	assert.deepEqual((await readdir(directory)).sort(), ['LICENSE.txt', 'NOTICE.md', 'fr.json', 'index.js', 'pl.json', 'zh-CN.json']);
	assert.deepEqual(await listTranslationCatalogLocales(directory), ['fr', 'pl', 'zh-CN']);
	assert.equal(await readFile(join(directory, 'LICENSE.txt'), 'utf8'), 'GNU GENERAL PUBLIC LICENSE\nVersion 3');
	assert.equal(await readFile(join(directory, 'NOTICE.md'), 'utf8'), notice);
	const french = await readTranslationCatalog('fr', directory);
	assert.deepEqual(french.entries, {
		key000: ['audacity', 'Source 0', 'Translation 0'],
		key001: ['human', 'Source 1', 'human 1'],
		key002: ['audacity', 'Source 2', 'Translation 2'],
	});
	assert.deepEqual(Object.keys(french.provenance), ['machine', 'audacity'].filter((origin) => origin !== 'machine'), 'machine provenance goes with the last machine entry');
	assert.equal(french.provenance.audacity.headSha, HEAD_SHA);
	assert.deepEqual((await readTranslationCatalog('zh-CN', directory)).entries, { key000: ['audacity', 'Source 0', 'Translation 0'] });
	const text = await readFile(join(directory, 'fr.json'), 'utf8');
	const second = await writeAudacityLayer(layer, directory, { englishCopy: english });
	assert.deepEqual(second.locales, ['fr', 'pl', 'zh-CN']);
	assert.deepEqual(second.summaries.map((summary) => [summary.locale, summary.written, summary.kept]), [['fr', 0, 2], ['zh-CN', 0, 1]]);
	assert.equal(await readFile(join(directory, 'fr.json'), 'utf8'), text, 'rewriting is idempotent');
});
