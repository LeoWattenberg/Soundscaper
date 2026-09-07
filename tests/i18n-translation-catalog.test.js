/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import { COMMITTED_LOCALE_TAGS, LOCALE_BY_TAG } from '../src/common/i18n/locales.js';
import {
	acceptableTranslation,
	currentTranslations,
	loadTranslationCatalog,
	protectedTokens,
	translationCatalogLocale,
} from '../src/common/i18n/translation-catalog.js';
import { TRANSLATION_CATALOG_LOADERS, TRANSLATION_CATALOG_LOCALES } from '../src/common/i18n/translations/index.js';
import { mergeCatalog, resolveCatalog } from '../src/common/i18n/runtime.js';
import {
	TRANSLATION_CATALOG_DIRECTORY,
	assessTranslationCatalog,
	listTranslationCatalogLocales,
	readTranslationCatalog,
	renderTranslationCatalogIndex,
	serializeTranslationCatalog,
} from '../scripts/i18n-ai/catalog.mjs';

function catalog(locale, entries) {
	return { schemaVersion: 2, locale, provenance: {}, entries };
}

test('every committed translation catalog is well formed, listed once in the index, loadable and current', async (t) => {
	const locales = await listTranslationCatalogLocales();
	assert.deepEqual(locales, [...TRANSLATION_CATALOG_LOCALES]);
	assert.deepEqual(Object.keys(TRANSLATION_CATALOG_LOADERS), locales);
	assert.equal(await readFile(join(TRANSLATION_CATALOG_DIRECTORY, 'index.js'), 'utf8'), renderTranslationCatalogIndex(locales));
	const totals = { machine: 0, audacity: 0, human: 0 };
	for (const locale of locales) {
		const committed = await readTranslationCatalog(locale);
		assert.ok(LOCALE_BY_TAG[locale], locale);
		assert.equal(await readFile(join(TRANSLATION_CATALOG_DIRECTORY, `${locale}.json`), 'utf8'), serializeTranslationCatalog(committed), `${locale} is serialised canonically`);
		const loaded = await TRANSLATION_CATALOG_LOADERS[locale]();
		assert.deepEqual(loaded.default, committed, `${locale} loader`);
		const assessment = assessTranslationCatalog(committed, ENGLISH_COPY);
		const shown = currentTranslations(committed, ENGLISH_COPY, { locale });
		assert.deepEqual(Object.keys(shown), Object.keys(assessment.current), `${locale}: runtime and tooling agree`);
		for (const origin of Object.values(assessment.origins)) totals[origin] += 1;
		t.diagnostic(`${locale}: ${Object.keys(assessment.current).length} current, ${assessment.stale.length} stale, ${assessment.missing.length} missing, ${assessment.orphaned.length} orphaned`);
	}
	t.diagnostic(`${locales.length} catalogs: ${totals.machine} machine, ${totals.audacity} audacity, ${totals.human} human entries`);
	for (const locale of COMMITTED_LOCALE_TAGS) {
		if (locale === 'en') continue;
		assert.ok(locales.includes(locale), `${locale} has a catalog`);
		if (locale !== 'de' && locale !== 'en-GB') {
			const assessment = assessTranslationCatalog(await readTranslationCatalog(locale), ENGLISH_COPY);
			assert.ok(assessment.missing.length <= 1, `${locale} is fully translated (${assessment.missing.length} missing)`);
		}
	}
	const notice = await readFile(join(TRANSLATION_CATALOG_DIRECTORY, 'NOTICE.md'), 'utf8');
	assert.match(notice, /GPL-3\.0-only/u);
	assert.match(notice, new RegExp((await readTranslationCatalog('fr')).provenance.audacity.headSha, 'u'));
	assert.match(await readFile(join(TRANSLATION_CATALOG_DIRECTORY, 'LICENSE.txt'), 'utf8'), /GNU GENERAL PUBLIC LICENSE/u);
});

test('only entries whose recorded English is still current are shown, whatever their origin', () => {
	const english = { fileMenu: 'File', editMenu: 'Edit', bandNumber: 'Band {number}', openProject: 'Open', play: 'Play' };
	const entries = currentTranslations(catalog('fr', {
		fileMenu: ['machine', 'File', 'Fichier'],
		editMenu: ['machine', 'Edit (old)', 'Édition'],
		bandNumber: ['human', 'Band {number}', 'Bande {number}'],
		openProject: ['audacity', 'Open (old)', 'Ouvrir'],
		play: ['audacity', 'Play', 'Lecture'],
		retired: ['machine', 'Gone', 'Parti'],
		odd: ['elsewhere', 'Play', 'Nope'],
	}), english);
	assert.deepEqual(entries, { fileMenu: 'Fichier', bandNumber: 'Bande {number}', play: 'Lecture' });
	assert.ok(Object.isFrozen(entries));
	assert.deepEqual(currentTranslations(catalog('fr', { fileMenu: ['machine', 'File', 'Fichier'], play: ['audacity', 'Play', 'Lecture'] }), english, { origins: ['audacity'] }), { play: 'Lecture' });
});

test('a translation must keep placeholders, lines and protected tokens, avoid ellipses and carry text', () => {
	assert.equal(acceptableTranslation('Band {number}', 'Bande {number}'), true);
	assert.equal(acceptableTranslation('Band {number}', 'Bande {numero}'), false);
	assert.equal(acceptableTranslation('Open', 'Ouvrir…'), false);
	assert.equal(acceptableTranslation('Open', ' Ouvrir'), false);
	assert.equal(acceptableTranslation('Open', 'Ouvrir <docs-ai-token id="0001"/>'), false);
	assert.equal(acceptableTranslation('Open', 42), false);
	assert.equal(acceptableTranslation('OK', 'OK'), true);
	assert.equal(acceptableTranslation('Open', 'Ouvrir\nmaintenant'), false);
	assert.equal(acceptableTranslation('; Comment\n(mult *track* 0.5)', '; Commentaire\n(mult *piste* 0.5)'), false);
	assert.equal(acceptableTranslation('Open Audacity project (.aup3, .aup4)', 'Ouvrir un projet Audacity (aup3, aup4)'), false);
	assert.deepEqual(protectedTokens('Open (.aup3, .aup4) with *track* and *track* at 0.5'), ['.aup3', '.aup4', '*track*']);
});

test('a catalog with the wrong shape or locale is refused outright', () => {
	assert.throws(() => currentTranslations(null, ENGLISH_COPY), /object/u);
	assert.throws(() => currentTranslations({ ...catalog('fr', {}), schemaVersion: 1 }, ENGLISH_COPY), /schema/u);
	assert.throws(() => currentTranslations(catalog('fr_FR', {}), ENGLISH_COPY), /canonical/u);
	assert.throws(() => currentTranslations(catalog('fr', {}), ENGLISH_COPY, { locale: 'es' }), /does not match/u);
	assert.throws(() => currentTranslations({ ...catalog('fr', {}), entries: [] }, ENGLISH_COPY), /entries/u);
	assert.throws(() => currentTranslations(catalog('fr', {}), null), /English reference/u);
});

test('a locale is served by the catalog of its exact canonical tag and by nothing else', async () => {
	const loaders = { fr: async () => ({ default: catalog('fr', { fileMenu: ['machine', ENGLISH_COPY.fileMenu, 'Fichier'] }) }), 'zh-CN': async () => catalog('zh-CN', {}) };
	assert.equal(translationCatalogLocale('fr', loaders), 'fr');
	assert.equal(translationCatalogLocale('FR', loaders), 'fr');
	assert.equal(translationCatalogLocale('fr-CA', loaders), null);
	assert.equal(translationCatalogLocale('zh_CN', loaders), 'zh-CN');
	assert.equal(translationCatalogLocale('zh-TW', loaders), null);
	assert.deepEqual(await loadTranslationCatalog('fr', { loaders, englishCopy: ENGLISH_COPY }), { fileMenu: 'Fichier' });
	assert.equal(await loadTranslationCatalog('pl', { loaders, englishCopy: ENGLISH_COPY }), null);
	await assert.rejects(
		() => loadTranslationCatalog('fr', { loaders: { fr: async () => { throw new TypeError('Failed to fetch dynamically imported module'); } }, englishCopy: ENGLISH_COPY }),
		/dynamically imported/u,
	);
});

test('resolving a locale lays its catalog over the bundled copy, and German keeps its bundled base', async () => {
	const translationLoaders = {
		fr: async () => catalog('fr', {
			fileMenu: ['audacity', ENGLISH_COPY.fileMenu, 'Fichier (Audacity)'],
			editMenu: ['machine', ENGLISH_COPY.editMenu, 'Édition (machine)'],
			viewMenu: ['machine', 'View (old)', 'Affichage (stale)'],
		}),
		de: async () => catalog('de', { play: ['audacity', ENGLISH_COPY.play, 'Audacity-Wiedergabe'] }),
		'en-GB': async () => catalog('en-GB', { audioTrack: ['audacity', ENGLISH_COPY.audioTrack, 'Audio track (UK)'] }),
		en: async () => { throw new Error('must not load'); },
	};
	const french = await resolveCatalog('fr', { translationLoaders });
	assert.equal(french.fileMenu, 'Fichier (Audacity)');
	assert.equal(french.editMenu, 'Édition (machine)');
	assert.equal(french.viewMenu, ENGLISH_COPY.viewMenu);
	assert.ok(Object.isFrozen(french));
	const german = await resolveCatalog('de', { translationLoaders });
	assert.equal(german.play, 'Audacity-Wiedergabe');
	assert.equal(german.fileMenu, GERMAN_COPY.fileMenu);
	const austrian = await resolveCatalog('de-AT', { translationLoaders });
	assert.equal(austrian.fileMenu, GERMAN_COPY.fileMenu);
	const regional = await resolveCatalog('en-GB', { translationLoaders });
	assert.equal(regional.audioTrack, 'Audio track (UK)');
	assert.equal(regional.fileMenu, ENGLISH_COPY.fileMenu);
	const english = await resolveCatalog('en', { translationLoaders });
	assert.equal(english.audioTrack, ENGLISH_COPY.audioTrack);
	assert.throws(() => mergeCatalog('fr', { openProject: 'Open…' }), /ellipsis/u);
	assert.throws(() => mergeCatalog('fr', { bandNumber: 'Bande' }), /placeholder/u);
	assert.throws(() => mergeCatalog('fr', { unknownKey: 'x' }), /unknown key/u);
});

test('a catalog that fails to load falls back to the bundled copy, and a retired chunk is reported', async () => {
	const fallbacks = [];
	const staleCandidates = [];
	const retired = await resolveCatalog('fr', {
		translationLoaders: { fr: async () => { throw new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/fr-abc.js'); } },
		onFallback: (error) => fallbacks.push(error.message),
		reportStaleBuildCandidate: (error) => staleCandidates.push(error.message),
	});
	assert.equal(retired.fileMenu, ENGLISH_COPY.fileMenu);
	assert.equal(fallbacks.length, 1);
	assert.deepEqual(staleCandidates, fallbacks);
	staleCandidates.length = 0;
	const malformed = await resolveCatalog('fr', {
		translationLoaders: { fr: async () => { throw new Error('Unsupported translation catalog schema.'); } },
		onFallback: (error) => fallbacks.push(error.message),
		reportStaleBuildCandidate: (error) => staleCandidates.push(error.message),
	});
	assert.equal(malformed.fileMenu, ENGLISH_COPY.fileMenu);
	assert.deepEqual(staleCandidates, []);
	assert.equal(fallbacks.length, 2);
});
