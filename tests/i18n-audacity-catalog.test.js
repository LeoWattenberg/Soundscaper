/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import {
	audacityCatalogLocale,
	currentAudacityMessages,
	loadAudacityCatalog,
} from '../src/common/i18n/audacity-catalog.js';
import { AUDACITY_CATALOG_LOADERS, AUDACITY_CATALOG_LOCALES } from '../src/common/i18n/audacity/index.js';
import { COMMITTED_LOCALE_TAGS, LOCALE_BY_TAG } from '../src/common/i18n/locales.js';
import { mergeCatalog, resolveCatalog } from '../src/common/i18n/runtime.js';
import {
	AUDACITY_LAYER_DIRECTORY,
	listAudacityLayerLocales,
	readAudacityCatalog,
	renderAudacityLayerIndex,
	serializeAudacityCatalog,
} from '../scripts/lib/audacity-committed-layer.mjs';

const PROVENANCE = {
	repository: 'audacity/audacity', headSha: 'a'.repeat(40), runId: 1, artifactId: 2, workflowUrl: 'https://github.com/audacity/audacity/actions/runs/1',
	archiveName: 'Audacity_locale_1.zip', archiveSha256: 'b'.repeat(64), archiveByteLength: 3, licenseSpdx: 'GPL-3.0-only',
	upstreamProjectUrl: 'https://github.com/audacity/audacity', upstreamLicenseUrl: 'https://github.com/audacity/audacity/blob/a/LICENSE.txt',
	modificationNotice: 'converted', mappingVersion: 2, mappingSha256: 'c'.repeat(64),
};

function catalog(locale, messages) {
	return { schemaVersion: 1, locale, provenance: PROVENANCE, messages };
}

test('every committed Audacity catalog is well formed, listed once in the index, and loadable', async (t) => {
	const locales = await listAudacityLayerLocales();
	assert.deepEqual(locales, [...AUDACITY_CATALOG_LOCALES]);
	assert.deepEqual(Object.keys(AUDACITY_CATALOG_LOADERS), locales);
	assert.equal(await readFile(join(AUDACITY_LAYER_DIRECTORY, 'index.js'), 'utf8'), renderAudacityLayerIndex(locales));
	assert.ok(locales.length > 0);
	let shown = 0;
	for (const locale of locales) {
		const committed = await readAudacityCatalog(locale);
		assert.ok(LOCALE_BY_TAG[locale], locale);
		assert.equal(await readFile(join(AUDACITY_LAYER_DIRECTORY, `${locale}.json`), 'utf8'), serializeAudacityCatalog(committed), `${locale} is serialised canonically`);
		const loaded = await AUDACITY_CATALOG_LOADERS[locale]();
		assert.deepEqual(loaded.default, committed, `${locale} loader`);
		const messages = currentAudacityMessages(committed, ENGLISH_COPY, { locale });
		shown += Object.keys(messages).length;
		assert.equal(Object.keys(messages).length, Object.keys(committed.messages).length, `${locale}: every committed string applies to the current English copy`);
	}
	t.diagnostic(`${locales.length} Audacity catalogs, ${shown} reviewed strings`);
	for (const locale of COMMITTED_LOCALE_TAGS) {
		if (locale === 'en') continue;
		assert.ok(locales.includes(locale), `${locale} has reviewed strings`);
	}
	const notice = await readFile(join(AUDACITY_LAYER_DIRECTORY, 'NOTICE.md'), 'utf8');
	assert.match(notice, /GPL-3\.0-only/u);
	assert.match(notice, new RegExp((await readAudacityCatalog('fr')).provenance.headSha, 'u'));
	assert.match(await readFile(join(AUDACITY_LAYER_DIRECTORY, 'LICENSE.txt'), 'utf8'), /GNU GENERAL PUBLIC LICENSE/u);
});

test('only strings whose key still exists and whose shape still fits are shown', () => {
	const english = { fileMenu: 'File', bandNumber: 'Band {number}', openProject: 'Open' };
	const messages = currentAudacityMessages(catalog('fr', {
		bandNumber: 'Bande {numero}',
		fileMenu: 'Fichier',
		openProject: 'Ouvrir…',
		retired: 'Parti',
	}), english);
	assert.deepEqual(messages, { fileMenu: 'Fichier' });
	assert.ok(Object.isFrozen(messages));
	assert.throws(() => currentAudacityMessages(null, english), /object/u);
	assert.throws(() => currentAudacityMessages({ ...catalog('fr', {}), schemaVersion: 2 }, english), /schema/u);
	assert.throws(() => currentAudacityMessages(catalog('fr_FR', {}), english), /canonical/u);
	assert.throws(() => currentAudacityMessages(catalog('fr', {}), english, { locale: 'es' }), /does not match/u);
	assert.throws(() => currentAudacityMessages(catalog('fr', {}), null), /English reference/u);
});

test('a locale is served by the catalog of its exact canonical tag', async () => {
	const loaders = { fr: async () => ({ default: catalog('fr', { fileMenu: 'Fichier' }) }), 'en-GB': async () => catalog('en-GB', { audioTrack: 'Audio track (UK)' }) };
	assert.equal(audacityCatalogLocale('fr', loaders), 'fr');
	assert.equal(audacityCatalogLocale('fr-CA', loaders), null);
	assert.equal(audacityCatalogLocale('en_GB', loaders), 'en-GB');
	assert.deepEqual(await loadAudacityCatalog('fr', { loaders, englishCopy: ENGLISH_COPY }), { fileMenu: 'Fichier' });
	assert.deepEqual(await loadAudacityCatalog('en-GB', { loaders, englishCopy: ENGLISH_COPY }), { audioTrack: 'Audio track (UK)' });
	assert.equal(await loadAudacityCatalog('pl', { loaders, englishCopy: ENGLISH_COPY }), null);
	await assert.rejects(
		() => loadAudacityCatalog('fr', { loaders: { fr: async () => { throw new TypeError('Failed to fetch dynamically imported module'); } }, englishCopy: ENGLISH_COPY }),
		/dynamically imported/u,
	);
});

test('resolving a locale lays the committed Audacity strings over the machine layer', async () => {
	const machineLoaders = {
		fr: async () => ({
			schemaVersion: 1, locale: 'fr', provenance: { model: 'm', modelDigest: 'd', promptVersion: 'p' },
			entries: { fileMenu: [ENGLISH_COPY.fileMenu, 'Fichier (machine)'], editMenu: [ENGLISH_COPY.editMenu, 'Édition (machine)'] },
		}),
	};
	const audacityLoaders = { fr: async () => catalog('fr', { fileMenu: 'Fichier (Audacity)' }) };
	const copy = await resolveCatalog('fr', { machineLoaders, audacityLoaders });
	assert.equal(copy.fileMenu, 'Fichier (Audacity)');
	assert.equal(copy.editMenu, 'Édition (machine)');
	assert.equal(copy.viewMenu, ENGLISH_COPY.viewMenu);
	assert.ok(Object.isFrozen(copy));

	const german = await resolveCatalog('de', { machineLoaders: {}, audacityLoaders: { de: async () => catalog('de', { play: 'Audacity-Wiedergabe' }) } });
	assert.equal(german.play, 'Audacity-Wiedergabe');
	assert.equal(german.fileMenu, GERMAN_COPY.fileMenu);

	const regional = await resolveCatalog('en-GB', { machineLoaders: {}, audacityLoaders: { 'en-GB': async () => catalog('en-GB', { audioTrack: 'Audio track (UK)' }) } });
	assert.equal(regional.audioTrack, 'Audio track (UK)');
	assert.equal(regional.fileMenu, ENGLISH_COPY.fileMenu);
	const english = await resolveCatalog('en', { machineLoaders: {}, audacityLoaders: { en: async () => { throw new Error('must not load'); } } });
	assert.equal(english.audioTrack, ENGLISH_COPY.audioTrack);
});

test('each lazy layer fails on its own, and a retired chunk is reported as a stale-build candidate', async () => {
	const fallbacks = [];
	const staleCandidates = [];
	const copy = await resolveCatalog('fr', {
		machineLoaders: { fr: async () => ({ schemaVersion: 1, locale: 'fr', provenance: {}, entries: { editMenu: [ENGLISH_COPY.editMenu, 'Édition (machine)'] } }) },
		audacityLoaders: { fr: async () => { throw new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/fr-abc.js'); } },
		onFallback: (error) => fallbacks.push(error.message),
		reportStaleBuildCandidate: (error) => staleCandidates.push(error.message),
	});
	assert.equal(copy.editMenu, 'Édition (machine)');
	assert.equal(copy.fileMenu, ENGLISH_COPY.fileMenu);
	assert.equal(fallbacks.length, 1);
	assert.deepEqual(staleCandidates, fallbacks);

	fallbacks.length = 0;
	staleCandidates.length = 0;
	const other = await resolveCatalog('fr', {
		machineLoaders: { fr: async () => { throw new Error('Unsupported machine catalog schema.'); } },
		audacityLoaders: { fr: async () => catalog('fr', { fileMenu: 'Fichier (Audacity)' }) },
		onFallback: (error) => fallbacks.push(error.message),
		reportStaleBuildCandidate: (error) => staleCandidates.push(error.message),
	});
	assert.equal(other.fileMenu, 'Fichier (Audacity)');
	assert.deepEqual(fallbacks, ['Unsupported machine catalog schema.']);
	assert.deepEqual(staleCandidates, []);
	assert.throws(() => mergeCatalog('fr', { openProject: 'Open…' }), /ellipsis/u);
	assert.throws(() => mergeCatalog('fr', { bandNumber: 'Bande' }), /placeholder/u);
	assert.throws(() => mergeCatalog('fr', { unknownKey: 'x' }), /unknown key/u);
});
