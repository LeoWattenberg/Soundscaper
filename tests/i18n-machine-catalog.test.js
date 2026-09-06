/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import test from 'node:test';

import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import {
	acceptableMachineTranslation,
	currentMachineEntries,
	loadMachineCatalog,
	machineCatalogLocale,
	protectedTokens,
} from '../src/common/i18n/machine-catalog.js';
import { MACHINE_CATALOG_LOADERS, MACHINE_CATALOG_LOCALES } from '../src/common/i18n/machine/index.js';
import { mergeCatalog, resolveCatalog } from '../src/common/i18n/runtime.js';

const BASE_URL = 'https://translations.example.test/runtime/translations/audacity/4/';

function catalog(locale, entries) {
	return { schemaVersion: 1, locale, provenance: { model: 'test', modelDigest: 'sha256:test', promptVersion: 'i18n-machine-v1' }, entries };
}

test('only entries whose recorded English is still current are shown', () => {
	const english = { fileMenu: 'File', editMenu: 'Edit', bandNumber: 'Band {number}', openProject: 'Open' };
	const entries = currentMachineEntries(catalog('fr', {
		fileMenu: ['File', 'Fichier'],
		editMenu: ['Edit (old)', 'Édition'],
		bandNumber: ['Band {number}', 'Bande {number}'],
		openProject: ['Open', 'Ouvrir'],
		retired: ['Gone', 'Parti'],
	}), english);
	assert.deepEqual(entries, { fileMenu: 'Fichier', bandNumber: 'Bande {number}', openProject: 'Ouvrir' });
	assert.ok(Object.isFrozen(entries));
});

test('a translation must keep placeholders, lines and protected tokens, avoid ellipses and carry text', () => {
	assert.equal(acceptableMachineTranslation('Band {number}', 'Bande {number}'), true);
	assert.equal(acceptableMachineTranslation('Band {number}', 'Bande {numero}'), false);
	assert.equal(acceptableMachineTranslation('Band {number}', 'Bande'), false);
	assert.equal(acceptableMachineTranslation('Open', 'Ouvrir…'), false);
	assert.equal(acceptableMachineTranslation('Open', 'Ouvrir...'), false);
	assert.equal(acceptableMachineTranslation('Open', '  '), false);
	assert.equal(acceptableMachineTranslation('Open', ' Ouvrir'), false);
	assert.equal(acceptableMachineTranslation('Open', 'Ouvrir <docs-ai-token id="0001"/>'), false);
	assert.equal(acceptableMachineTranslation('Open', 42), false);
	assert.equal(acceptableMachineTranslation('OK', 'OK'), true);
	assert.equal(acceptableMachineTranslation('Open', 'Ouvrir\nmaintenant'), false);
	assert.equal(acceptableMachineTranslation('; Comment\n(mult *track* 0.5)', '; Commentaire\n(mult *track* 0.5)'), true);
	assert.equal(acceptableMachineTranslation('; Comment\n(mult *track* 0.5)', '; Commentaire (mult *track* 0.5)'), false);
	assert.equal(acceptableMachineTranslation('; Comment\n(mult *track* 0.5)', '; Commentaire\n(mult *piste* 0.5)'), false);
	assert.equal(acceptableMachineTranslation('Open Audacity project (.aup3, .aup4)', 'Ouvrir un projet Audacity (.aup3, .aup4)'), true);
	assert.equal(acceptableMachineTranslation('Open Audacity project (.aup3, .aup4)', 'Ouvrir un projet Audacity (aup3, aup4)'), false);
	assert.equal(acceptableMachineTranslation('Gain 0.5 dB', 'Gain 0,5 dB'), true);
	assert.deepEqual(protectedTokens('Open (.aup3, .aup4) with *track* and *track* at 0.5'), ['.aup3', '.aup4', '*track*']);
	assert.deepEqual(protectedTokens('e.g. a sentence. Another one. Gain 0.5'), []);
	const entries = currentMachineEntries(catalog('fr', {
		bandNumber: ['Band {number}', 'Bande {numero}'],
		openProject: ['Open', 'Ouvrir…'],
		fileMenu: ['File', 'Fichier'],
		broken: 'not an entry',
	}), { bandNumber: 'Band {number}', openProject: 'Open', fileMenu: 'File', broken: 'Broken' });
	assert.deepEqual(entries, { fileMenu: 'Fichier' });
});

test('a catalog with the wrong shape or locale is refused outright', () => {
	assert.throws(() => currentMachineEntries(null, ENGLISH_COPY), /object/u);
	assert.throws(() => currentMachineEntries({ ...catalog('fr', {}), schemaVersion: 2 }, ENGLISH_COPY), /schema/u);
	assert.throws(() => currentMachineEntries(catalog('fr_FR', {}), ENGLISH_COPY), /canonical/u);
	assert.throws(() => currentMachineEntries(catalog('fr', {}), ENGLISH_COPY, { locale: 'es' }), /does not match/u);
	assert.throws(() => currentMachineEntries({ ...catalog('fr', {}), entries: [] }, ENGLISH_COPY), /entries/u);
	assert.throws(() => currentMachineEntries(catalog('fr', {}), null), /English reference/u);
});

test('a locale is served by the catalog of its exact canonical tag and by nothing else', () => {
	const loaders = { fr: () => {}, 'zh-CN': () => {}, 'sr-Latn-BA': () => {} };
	assert.equal(machineCatalogLocale('fr', loaders), 'fr');
	assert.equal(machineCatalogLocale('FR', loaders), 'fr');
	assert.equal(machineCatalogLocale('fr-CA', loaders), null);
	assert.equal(machineCatalogLocale('fr_FR', loaders), null);
	assert.equal(machineCatalogLocale('zh-CN', loaders), 'zh-CN');
	assert.equal(machineCatalogLocale('zh_CN', loaders), 'zh-CN');
	assert.equal(machineCatalogLocale('zh-TW', loaders), null);
	assert.equal(machineCatalogLocale('sr-Latn-BA', loaders), 'sr-Latn-BA');
	assert.equal(machineCatalogLocale('sr', loaders), null);
	assert.equal(machineCatalogLocale('en-GB', loaders), null);
	assert.equal(machineCatalogLocale('', loaders), null);
});

test('loading resolves the lazy module, unwraps its default export and filters it', async () => {
	const loads = [];
	const loaders = {
		fr: async () => {
			loads.push('fr');
			return { default: catalog('fr', { fileMenu: [ENGLISH_COPY.fileMenu, 'Fichier'], editMenu: ['stale', 'Édition'] }) };
		},
		es: async () => catalog('es', { fileMenu: [ENGLISH_COPY.fileMenu, 'Archivo'] }),
	};
	assert.deepEqual(await loadMachineCatalog('fr', { loaders, englishCopy: ENGLISH_COPY }), { fileMenu: 'Fichier' });
	assert.deepEqual(await loadMachineCatalog('es', { loaders, englishCopy: ENGLISH_COPY }), { fileMenu: 'Archivo' });
	assert.equal(await loadMachineCatalog('pl', { loaders, englishCopy: ENGLISH_COPY }), null);
	assert.deepEqual(loads, ['fr']);
	await assert.rejects(
		() => loadMachineCatalog('fr', { loaders: { fr: async () => { throw new TypeError('Failed to fetch dynamically imported module'); } }, englishCopy: ENGLISH_COPY }),
		/dynamically imported/u,
	);
});

test('the generated index lists exactly the loaders it exports', () => {
	assert.ok(Object.isFrozen(MACHINE_CATALOG_LOCALES));
	assert.ok(Object.isFrozen(MACHINE_CATALOG_LOADERS));
	assert.deepEqual([...MACHINE_CATALOG_LOCALES], Object.keys(MACHINE_CATALOG_LOADERS));
	for (const locale of MACHINE_CATALOG_LOCALES) {
		assert.equal(typeof MACHINE_CATALOG_LOADERS[locale], 'function', locale);
		assert.notEqual(locale, 'en');
		assert.notEqual(locale, 'de');
	}
});

test('machine strings sit above the bundled copy and below Audacity', () => {
	const merged = mergeCatalog('fr', { fileMenu: 'Fichier (Audacity)' }, {
		machine: { fileMenu: 'Fichier (machine)', editMenu: 'Édition (machine)' },
	});
	assert.equal(merged.fileMenu, 'Fichier (Audacity)');
	assert.equal(merged.editMenu, 'Édition (machine)');
	assert.equal(merged.viewMenu, ENGLISH_COPY.viewMenu);
	assert.equal(mergeCatalog('fr', null, { machine: { editMenu: 'Édition' } }).editMenu, 'Édition');
	assert.equal(mergeCatalog('de', {}, { machine: { editMenu: 'nicht' } }).fileMenu, GERMAN_COPY.fileMenu);
	assert.throws(() => mergeCatalog('fr', { openProject: 'Open…' }, { machine: {} }), /ellipsis/u);
});

test('resolving a locale loads the machine layer and the Audacity pack together', async () => {
	const pack = encodeJson({ schemaVersion: 1, locale: 'fr', messages: { fileMenu: 'Fichier (Audacity)' } });
	const sha256 = createHash('sha256').update(pack).digest('hex');
	const manifest = {
		schemaVersion: 1,
		locales: { fr: { eligible: true, path: `packs/${sha256}.json`, sha256, byteLength: pack.byteLength } },
	};
	const fetchImpl = async (url) => (String(url).endsWith('latest.json') ? response(encodeJson(manifest)) : response(pack));
	const machineLoaders = {
		fr: async () => catalog('fr', {
			fileMenu: [ENGLISH_COPY.fileMenu, 'Fichier (machine)'],
			editMenu: [ENGLISH_COPY.editMenu, 'Édition (machine)'],
			viewMenu: ['View (old)', 'Affichage (stale)'],
		}),
	};
	const copy = await resolveCatalog('fr', { baseUrl: BASE_URL, fetchImpl, cryptoImpl: webcrypto, machineLoaders });
	assert.equal(copy.fileMenu, 'Fichier (Audacity)');
	assert.equal(copy.editMenu, 'Édition (machine)');
	assert.equal(copy.viewMenu, ENGLISH_COPY.viewMenu);
	assert.ok(Object.isFrozen(copy));
});

test('each layer fails on its own: no manifest keeps the machine layer, a retired chunk keeps Audacity and is reported', async () => {
	const fallbacks = [];
	const machineLoaders = { fr: async () => catalog('fr', { editMenu: [ENGLISH_COPY.editMenu, 'Édition (machine)'] }) };
	const offline = await resolveCatalog('fr', {
		baseUrl: BASE_URL,
		fetchImpl: async () => { throw new Error('R2 unavailable'); },
		machineLoaders,
		onFallback: (error) => fallbacks.push(error.message),
	});
	assert.equal(offline.editMenu, 'Édition (machine)');
	assert.equal(offline.fileMenu, ENGLISH_COPY.fileMenu);
	assert.deepEqual(fallbacks, ['R2 unavailable']);

	const pack = encodeJson({ schemaVersion: 1, locale: 'fr', messages: { fileMenu: 'Fichier (Audacity)' } });
	const sha256 = createHash('sha256').update(pack).digest('hex');
	const manifest = {
		schemaVersion: 1,
		locales: { fr: { eligible: true, path: `packs/${sha256}.json`, sha256, byteLength: pack.byteLength } },
	};
	fallbacks.length = 0;
	const staleCandidates = [];
	const retired = await resolveCatalog('fr', {
		baseUrl: BASE_URL,
		fetchImpl: async (url) => (String(url).endsWith('latest.json') ? response(encodeJson(manifest)) : response(pack)),
		cryptoImpl: webcrypto,
		machineLoaders: { fr: async () => { throw new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/fr-abc.js'); } },
		onFallback: (error) => fallbacks.push(error.message),
		reportStaleBuildCandidate: (error) => staleCandidates.push(error.message),
	});
	assert.equal(retired.fileMenu, 'Fichier (Audacity)');
	assert.equal(retired.editMenu, ENGLISH_COPY.editMenu);
	assert.equal(fallbacks.length, 1);
	assert.deepEqual(staleCandidates, fallbacks);

	staleCandidates.length = 0;
	await resolveCatalog('fr', {
		baseUrl: BASE_URL,
		fetchImpl: async () => { throw new Error('offline'); },
		machineLoaders: { fr: async () => { throw new Error('Unsupported machine catalog schema.'); } },
		onFallback: () => {},
		reportStaleBuildCandidate: (error) => staleCandidates.push(error.message),
	});
	assert.deepEqual(staleCandidates, []);
});

test('German and exact English never consult the machine layer', async () => {
	let loads = 0;
	const machineLoaders = {
		de: async () => { loads += 1; return catalog('de', { fileMenu: [ENGLISH_COPY.fileMenu, 'Nein'] }); },
		en: async () => { loads += 1; return catalog('en', { fileMenu: [ENGLISH_COPY.fileMenu, 'Nope'] }); },
	};
	const german = await resolveCatalog('de-AT', { baseUrl: BASE_URL, fetchImpl: async () => { throw new Error('offline'); }, machineLoaders });
	assert.equal(german.fileMenu, GERMAN_COPY.fileMenu);
	const english = await resolveCatalog('en', { fetchImpl: async () => { throw new Error('must not fetch'); }, machineLoaders });
	assert.equal(english.fileMenu, ENGLISH_COPY.fileMenu);
	assert.equal(loads, 0);
});

function encodeJson(value) {
	return new TextEncoder().encode(JSON.stringify(value));
}

function response(bytes, status = 200) {
	return new Response(bytes, {
		status,
		headers: { 'content-length': String(bytes.byteLength), 'content-type': 'application/json' },
	});
}
