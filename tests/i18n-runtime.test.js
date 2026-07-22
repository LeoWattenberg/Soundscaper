import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import test from 'node:test';

import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import { AUDACITY_ACTION_MANIFEST } from '../src/common/editor/audacity-action-parity.js';
import {
	loadTranslationManifest,
	mergeCatalog,
	normalizeLocale,
	resolveCatalog,
} from '../src/common/i18n/runtime.js';

const BASE_URL = 'https://translations.example.test/runtime/translations/audacity/4/';

test('bundled catalogs are complete and user-visible values contain no ellipses', () => {
	assert.deepEqual(Object.keys(GERMAN_COPY), Object.keys(ENGLISH_COPY));
	assert.ok(Object.keys(ENGLISH_COPY).length >= 700);
	for (const [locale, catalog] of Object.entries({ en: ENGLISH_COPY, de: GERMAN_COPY })) {
		for (const [key, value] of Object.entries(catalog)) {
			assert.equal(typeof value, 'string', `${locale}.${key}`);
			assert.doesNotMatch(value, /…|\.\.\./u, `${locale}.${key}`);
		}
	}
	for (const definition of Object.values(AUDACITY_ACTION_MANIFEST)) {
		assert.doesNotMatch(definition.label, /…|\.\.\./u, definition.id);
		for (const reason of Object.values(definition.reason || {})) assert.doesNotMatch(reason, /…|\.\.\./u, definition.id);
	}
});

test('normalizes explicit BCP-47 locales without a German/English clamp', () => {
	assert.equal(normalizeLocale('pt_BR'), 'pt-BR');
	assert.equal(normalizeLocale('ar'), 'ar');
	assert.equal(normalizeLocale('not a locale'), 'en');
});

test('merges English, then German fallback, then Audacity overrides', () => {
	const copy = mergeCatalog('de', { fileMenu: 'Audacity-Datei' });
	assert.equal(copy.fileMenu, 'Audacity-Datei');
	assert.equal(copy.editMenu, GERMAN_COPY.editMenu);
	assert.equal(copy.title, GERMAN_COPY.title);
	assert.ok(Object.isFrozen(copy));
});

test('verifies a remote catalog before resolving it', async () => {
	const pack = encodeJson({ schemaVersion: 1, locale: 'fr', messages: { fileMenu: 'Fichier' } });
	const sha256 = createHash('sha256').update(pack).digest('hex');
	const manifest = {
		schemaVersion: 1,
		locales: {
			fr: { eligible: true, coverage: 0.9, path: `packs/${sha256}.json`, sha256, byteLength: pack.byteLength },
		},
	};
	const fetchImpl = async (url) => {
		if (String(url).endsWith('latest.json')) return response(encodeJson(manifest));
		return response(pack);
	};
	const copy = await resolveCatalog('fr', { baseUrl: BASE_URL, fetchImpl, cryptoImpl: webcrypto });
	assert.equal(copy.fileMenu, 'Fichier');
	assert.equal(copy.editMenu, ENGLISH_COPY.editMenu);
});

test('loads a regional English pack while exact English stays bundled', async () => {
	const pack = encodeJson({ schemaVersion: 1, locale: 'en-GB', messages: { audioTrack: 'Audio track (UK)' } });
	const sha256 = createHash('sha256').update(pack).digest('hex');
	let requests = 0;
	const fetchImpl = async (url) => {
		requests += 1;
		if (String(url).endsWith('latest.json')) return response(encodeJson({
			schemaVersion: 1,
			locales: {
				'en-GB': { eligible: true, path: `packs/${sha256}.json`, sha256, byteLength: pack.byteLength },
			},
		}));
		return response(pack);
	};
	const regional = await resolveCatalog('en-GB', { baseUrl: BASE_URL, fetchImpl, cryptoImpl: webcrypto });
	assert.equal(regional.audioTrack, 'Audio track (UK)');
	assert.equal(requests, 2);

	const english = await resolveCatalog('en', { fetchImpl: async () => { throw new Error('must not fetch'); } });
	assert.equal(english.audioTrack, ENGLISH_COPY.audioTrack);
});

test('falls back without constructing a partial catalog on corruption or R2 failure', async () => {
	let fallbackError;
	const manifest = {
		schemaVersion: 1,
		locales: {
			de: { eligible: true, path: `packs/${'0'.repeat(64)}.json`, sha256: '0'.repeat(64), byteLength: 2 },
		},
	};
	const copy = await resolveCatalog('de', {
		baseUrl: BASE_URL,
		cryptoImpl: webcrypto,
		fetchImpl: async (url) => String(url).endsWith('latest.json')
			? response(encodeJson(manifest))
			: response(new TextEncoder().encode('{}')),
		onFallback: (error) => { fallbackError = error; },
	});
	assert.equal(copy.fileMenu, GERMAN_COPY.fileMenu);
	assert.match(fallbackError.message, /digest/i);

	const offline = await resolveCatalog('fr', {
		baseUrl: BASE_URL,
		fetchImpl: async () => { throw new Error('R2 unavailable'); },
	});
	assert.equal(offline.fileMenu, ENGLISH_COPY.fileMenu);
});

test('rejects cross-origin packs and generated ellipses', async () => {
	await assert.rejects(
		() => loadTranslationManifest({
			baseUrl: BASE_URL,
			fetchImpl: async () => response(encodeJson({
				schemaVersion: 1,
				locales: {
					fr: { eligible: true, path: 'https://attacker.test/packs/a.json', sha256: '0'.repeat(64) },
				},
			})),
		}),
		/invalid path|translation origin/i,
	);
	assert.throws(() => mergeCatalog('fr', { openProject: 'Open…' }), /ellipsis/i);
	assert.throws(() => mergeCatalog('fr', { bandNumber: 'Bande' }), /placeholder/i);
});

test('times out manifest requests and returns the bundled fallback', async () => {
	const copy = await resolveCatalog('de', {
		baseUrl: BASE_URL,
		timeoutMs: 5,
		fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
			options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
		}),
	});
	assert.equal(copy.fileMenu, GERMAN_COPY.fileMenu);
});

test('timeout remains active while a response body stalls', async () => {
	const prefix = new TextEncoder().encode('{"schemaVersion":1,"locales":');
	const copy = await resolveCatalog('fr', {
		baseUrl: BASE_URL,
		timeoutMs: 5,
		fetchImpl: async (_url, options) => new Response(new ReadableStream({
			start(controller) {
				controller.enqueue(prefix);
				options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true });
			},
		})),
	});
	assert.equal(copy.fileMenu, ENGLISH_COPY.fileMenu);
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
