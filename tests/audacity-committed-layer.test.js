/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeStoredZip } from './helpers/stored-zip.js';
import {
	AUDACITY_LAYER_SCHEMA_VERSION,
	assertAudacityCatalogFile,
	buildAudacityLayer,
	listAudacityLayerLocales,
	readAudacityCatalog,
	renderAudacityLayerIndex,
	renderAudacityLayerNotice,
	serializeAudacityCatalog,
	writeAudacityLayer,
} from '../scripts/lib/audacity-committed-layer.mjs';
import { readAudacityQtCatalogsFromZip } from '../scripts/lib/audacity-qt-catalog.mjs';

const HEAD_SHA = 'b'.repeat(40);

function numberedMapping(count) {
	return Array.from({ length: count }, (_, index) => ({ key: `key${String(index).padStart(3, '0')}`, context: 'main', source: `Source ${index}`, comment: '' }));
}

function numberedCatalog(locale, mapping, finishedCount, { pad = false } = {}) {
	const messages = mapping.map((entry, index) => `<message><source>${entry.source}</source><translation${index < finishedCount ? '' : ' type="unfinished"'}>${pad ? ' ' : ''}Translation ${index}...${pad ? ' ' : ''}</translation></message>`).join('');
	return `<?xml version="1.0"?><!DOCTYPE TS><TS version="2.1" language="${locale}"><context><name>main</name>${messages}</context></TS>`;
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
	assert.deepEqual([...layer.catalogs.keys()], ['de', 'fr']);
	assert.deepEqual([...layer.unknownLocales], ['is']);
	assert.equal(Object.keys(layer.catalogs.get('fr').messages).length, 2, 'a thin catalog is kept; nothing gates it');
	assert.equal(layer.catalogs.get('de').messages.key000, 'Translation 0', 'padding and ellipses go, wording stays');
	assert.equal(layer.audit.es.mapped, 0);
	assert.equal(layer.provenance.licenseSpdx, 'GPL-3.0-only');
	assert.equal(layer.provenance.headSha, HEAD_SHA);
	assert.equal(layer.provenance.archiveByteLength, archiveBytes.byteLength);
	assert.equal(layer.provenance.upstreamLicenseUrl, `https://github.com/audacity/audacity/blob/${HEAD_SHA}/LICENSE.txt`);
	assert.match(layer.provenance.mappingSha256, /^[a-f0-9]{64}$/u);
	assert.equal(layer.catalogs.get('fr').schemaVersion, AUDACITY_LAYER_SCHEMA_VERSION);
	for (const catalog of layer.catalogs.values()) assertAudacityCatalogFile(catalog, catalog.locale);
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

test('serialisation, the index and the notice are canonical and the writer retires stale files', async () => {
	const mapping = numberedMapping(3);
	const archiveBytes = makeStoredZip([
		{ name: 'audacity_en.ts', data: numberedCatalog('en_US', mapping, 0) },
		{ name: 'audacity_fr.ts', data: numberedCatalog('fr', mapping, 3) },
		{ name: 'audacity_zh_CN.ts', data: numberedCatalog('zh_CN', mapping, 1) },
	]);
	const layer = buildAudacityLayer(layerOptions(archiveBytes, mapping));
	const text = serializeAudacityCatalog(layer.catalogs.get('fr'));
	const parsed = JSON.parse(text);
	assert.deepEqual(Object.keys(parsed), ['schemaVersion', 'locale', 'provenance', 'messages']);
	assert.deepEqual(Object.keys(parsed.messages), ['key000', 'key001', 'key002']);
	assert.equal(text.split('\n').length, 11, 'one message per line, a trailing newline');
	assert.match(renderAudacityLayerIndex(['fr', 'zh-CN']), /'zh-CN': \(\) => import\('\.\/zh-CN\.json'\),/u);
	assert.doesNotMatch(renderAudacityLayerIndex(['fr']), /with: \{ type/u);
	const notice = renderAudacityLayerNotice(layer.provenance, ['fr', 'zh-CN']);
	assert.match(notice, /GPL-3\.0-only/u);
	assert.match(notice, new RegExp(HEAD_SHA, 'u'));
	assert.match(notice, /section 13/u);

	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-audacity-layer-'));
	await writeFile(join(directory, 'stale.json'), '{}');
	assert.deepEqual(await writeAudacityLayer(layer, directory), ['fr', 'zh-CN']);
	assert.deepEqual((await readdir(directory)).sort(), ['LICENSE.txt', 'NOTICE.md', 'fr.json', 'index.js', 'zh-CN.json']);
	assert.deepEqual(await listAudacityLayerLocales(directory), ['fr', 'zh-CN']);
	assert.equal(await readFile(join(directory, 'LICENSE.txt'), 'utf8'), 'GNU GENERAL PUBLIC LICENSE\nVersion 3');
	const reread = await readAudacityCatalog('fr', directory);
	assert.deepEqual(reread.messages, { key000: 'Translation 0', key001: 'Translation 1', key002: 'Translation 2' });
	assert.equal(await readAudacityCatalog('es', directory), null);
	assert.deepEqual(await writeAudacityLayer(layer, directory), ['fr', 'zh-CN'], 'rewriting is idempotent');
	assert.equal(await readFile(join(directory, 'fr.json'), 'utf8'), text);
});

test('a catalog file is refused when its shape, provenance, order or strings are wrong', () => {
	const provenance = {
		repository: 'audacity/audacity', headSha: HEAD_SHA, runId: 1, artifactId: 2, workflowUrl: 'https://github.com/audacity/audacity/actions/runs/1',
		archiveName: 'Audacity_locale_1.zip', archiveSha256: 'a'.repeat(64), archiveByteLength: 3, licenseSpdx: 'GPL-3.0-only',
		upstreamProjectUrl: 'https://github.com/audacity/audacity', upstreamLicenseUrl: 'https://github.com/audacity/audacity/blob/x/LICENSE.txt',
		modificationNotice: 'converted', mappingVersion: 2, mappingSha256: 'c'.repeat(64),
	};
	const valid = { schemaVersion: 1, locale: 'fr', provenance, messages: { a: 'A', b: 'B' } };
	assertAudacityCatalogFile(valid, 'fr');
	assert.throws(() => assertAudacityCatalogFile({ ...valid, schemaVersion: 2 }, 'fr'), /schema/u);
	assert.throws(() => assertAudacityCatalogFile({ ...valid, locale: 'es' }, 'fr'), /declares locale/u);
	assert.throws(() => assertAudacityCatalogFile({ ...valid, locale: 'tlh' }, 'tlh'), /declares locale/u);
	assert.throws(() => assertAudacityCatalogFile({ ...valid, provenance: { ...provenance, headSha: '' } }, 'fr'), /missing headSha/u);
	assert.throws(() => assertAudacityCatalogFile({ ...valid, provenance: { ...provenance, licenseSpdx: 'MIT' } }, 'fr'), /GPL-3\.0-only/u);
	assert.throws(() => assertAudacityCatalogFile({ ...valid, messages: {} }, 'fr'), /no messages/u);
	assert.throws(() => assertAudacityCatalogFile({ ...valid, messages: { b: 'B', a: 'A' } }, 'fr'), /sorted/u);
	assert.throws(() => assertAudacityCatalogFile({ ...valid, messages: { a: ' A' } }, 'fr'), /trimmed/u);
	assert.throws(() => assertAudacityCatalogFile({ ...valid, messages: { a: 'A…' } }, 'fr'), /ellipsis/u);
});
