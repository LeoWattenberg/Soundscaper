/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transform } from 'esbuild';

import {
	createTranslationCatalogBundlePlugin,
	renderTranslationCatalogModule,
} from '../scripts/lib/translation-catalog-bundle.mjs';

async function loadModule(source: string): Promise<Record<string, unknown>> {
	return await import(`data:text/javascript,${encodeURIComponent(source)}`) as Record<string, unknown>;
}

test('compact catalogs retain translation tuples, provenance and community attribution exactly', async () => {
	const catalog = {
		schemaVersion: 2,
		locale: 'fr',
		provenance: { machine: { model: 'gpt-6-luna' }, audacity: { licenseSpdx: 'GPL-3.0-only' } },
		entries: Object.fromEntries([
			['__proto__', ['human', 'Old English', 'Texte']],
			['a', ['machine', 'Use {name}\n"machine"', 'Utiliser {name}\n"machine"']],
			['b', ['audacity', 'Play', 'Lecture']],
			['c', ['human', 'Close', 'Fermer']],
		]),
		community: { c: { contributor: 'A translator', previousEntry: ['machine', 'Close', 'Fermer'] } },
	};
	const module = await loadModule(renderTranslationCatalogModule(catalog));
	assert.deepEqual(module.default, catalog);
	for (const [key, value] of Object.entries(catalog)) assert.deepEqual(module[key], value);
});

test('repeated escaped translation text compacts without interpreting tuple-like text or prototype keys', async () => {
	const english = 'Literal ["machine", "audacity", "human"] and {name}: \\ path\n'.repeat(8);
	const translated = 'Texte "__proto__": ["machine", `${globalThis.poisoned = true}`]\n\u2028\u2029\ud800\udfff'.repeat(6);
	const catalog = {
		schemaVersion: 2, locale: 'fr',
		provenance: JSON.parse('{"__proto__":{"license":"AGPL-3.0-only"}}') as unknown,
		entries: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
			index === 0 ? '__proto__' : `entry-${index}`,
			[index % 2 === 0 ? 'machine' : 'human', english, translated],
		])),
		community: Object.fromEntries([['__proto__', { previousEntry: ['audacity', english, translated] }]]),
	};
	const source = renderTranslationCatalogModule(catalog);
	assert.ok(Buffer.byteLength(source) < Buffer.byteLength(JSON.stringify(catalog)) / 2,
		'Repeated long strings should pay for their declarations and references.');
	const { code } = await transform(source, { minify: true, charset: 'utf8' });
	const module = await loadModule(code);
	assert.deepEqual(module.default, catalog);
	const actual = module.default as typeof catalog;
	assert.equal(Object.getPrototypeOf(actual.entries), Object.prototype);
	assert.equal(Object.getPrototypeOf(actual.community), Object.prototype);
	assert.ok(Object.hasOwn(actual.entries, '__proto__'));
	assert.ok(Object.hasOwn(actual.community, '__proto__'));
});

test('catalog rendering preserves JSON serialization semantics before interning values', async () => {
	const missing = Array<unknown>(3);
	missing[2] = 'human';
	const catalog = {
		schemaVersion: 2, locale: 'fr',
		provenance: { omitted: undefined, time: new Date('2026-10-08T00:00:00Z') },
		entries: { numbers: [NaN, Infinity, -Infinity, -0], missing },
		community: undefined,
	};
	const expected: unknown = JSON.parse(JSON.stringify(catalog));
	const source = renderTranslationCatalogModule(catalog);
	assert.deepEqual((await loadModule(source)).default, expected);
	const { code } = await transform(source, { minify: true, charset: 'utf8' });
	assert.deepEqual((await loadModule(code)).default, expected);
});

test('short repetitions and unique strings do not add an unprofitable string dictionary', async () => {
	const catalog = { schemaVersion: 2, locale: 'fr',
		entries: Array.from({ length: 64 }, (_, index) => ['a', 'b', `unique-${index}`]) };
	const source = renderTranslationCatalogModule(catalog);
	assert.ok(Buffer.byteLength(source) <= Buffer.byteLength(JSON.stringify(catalog)) + 256,
		'Short values must remain literals when references cannot recover their own cost.');
	assert.deepEqual((await loadModule(source)).default, catalog);
});

test('the bundle plugin only substitutes lazy imports from the generated catalog index', async () => {
	const plugin = createTranslationCatalogBundlePlugin();
	const importer = fileURLToPath(new URL('../src/common/i18n/translations/index.js', import.meta.url));
	assert.equal(plugin.resolveId('./hi.json', '/workspace/another/index.js'), null);
	assert.equal(plugin.resolveId('../hi.json', importer), null);
	assert.equal(plugin.resolveId('./hi.json?raw', importer), null);
	assert.equal(await plugin.load.call({ addWatchFile() {} }, '\0unrelated'), null);
	const id = plugin.resolveId('./hi.json', importer);
	assert.equal(typeof id, 'string');
	assert.ok(id);
	const watched: string[] = [];
	const source = await plugin.load.call({ addWatchFile: (path: string) => watched.push(path) }, id);
	assert.ok(source);
	const path = fileURLToPath(new URL('../src/common/i18n/translations/hi.json', import.meta.url));
	assert.deepEqual(watched, [path]);
	const catalog: unknown = JSON.parse(await readFile(path, 'utf8'));
	assert.deepEqual((await loadModule(source)).default, catalog);
});

test('the complete Hindi catalog fits the production chunk budget without removing entries', async () => {
	const catalog = JSON.parse(await readFile(new URL('../src/common/i18n/translations/hi.json', import.meta.url), 'utf8')) as Record<string, unknown>;
	const { code } = await transform(renderTranslationCatalogModule(catalog), { minify: true, charset: 'utf8' });
	assert.ok(Buffer.byteLength(code) < 490_000, 'Leave room for the bundler runtime under the 500 KB ceiling.');
	assert.deepEqual((await loadModule(code)).default, catalog);
});
