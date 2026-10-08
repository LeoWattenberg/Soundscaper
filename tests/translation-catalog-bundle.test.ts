/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transform } from 'esbuild';
import { COMMITTED_LOCALE_TAGS } from '../src/common/i18n/locales.js';

import {
	createTranslationCatalogBundlePlugin,
	renderTranslationCatalogModule,
} from '../scripts/lib/translation-catalog-bundle.mjs';

async function loadModule(source: string): Promise<Record<string, unknown>> {
	return await import(`data:text/javascript,${encodeURIComponent(source)}`) as Record<string, unknown>;
}

function literalModule(catalog: Record<string, unknown>): string {
	return [`const catalog = ${JSON.stringify(catalog)};`,
		...Object.keys(catalog).map(key => `export const ${key} = catalog.${key};`), 'export default catalog;'].join('\n');
}
function contiguousCatalog(count: number) {
	return { schemaVersion: 2, locale: 'fr', provenance: {}, entries: Object.fromEntries(
		Array.from({ length: count }, (_, index) => [`entry${index}`, ['machine', `English${index}`, `Texte${index}`]])) };
}
function originInternedModule(catalog: ReturnType<typeof contiguousCatalog>): string {
	const entries = Object.entries(catalog.entries).map(([key, tuple]) =>
		`${JSON.stringify(key)}:[$t0,${JSON.stringify(tuple[1])},${JSON.stringify(tuple[2])}]`).join(',');
	return ['const $t0="machine";', `const catalog={schemaVersion:2,locale:"fr",provenance:{},entries:{${entries}}};`,
		...Object.keys(catalog).map(key => `export const ${key}=catalog.${key};`), 'export default catalog;'].join('\n');
}

test('contiguous origin tables save complete emitted and minified bytes against an already-interned origin', async () => {
	const catalog = contiguousCatalog(256), before = JSON.stringify(catalog);
	const source = renderTranslationCatalogModule(catalog), baseline = originInternedModule(catalog);
	assert.match(source, /Object\.fromEntries/u, 'A profitable origin run should use the table representation.');
	assert.ok(Buffer.byteLength(source) < Buffer.byteLength(baseline), 'Charge the complete table factory and module exports.');
	const [compact, original] = await Promise.all([transform(source, { minify: true, charset: 'utf8' }),
		transform(baseline, { minify: true, charset: 'utf8' })]);
	assert.ok(Buffer.byteLength(compact.code) < Buffer.byteLength(original.code), 'Array keys stay quoted after minification; include that cost.');
	assert.deepEqual((await loadModule(compact.code)).default, catalog); assert.equal(JSON.stringify(catalog), before);
});

test('table tuples retain property order, prototype names, escaped Unicode and independent mutable arrays', async () => {
	const escaped = '";globalThis.catalogInjection=true;//\n\u2028\u2029\ud800\udfff\\';
	const entries = Object.fromEntries([
		['10', ['human', escaped, escaped]], ['2', ['machine', 'Numeric', 'Nombre']],
		['__proto__', ['audacity', 'Prototype', 'Prototype']], ['constructor', ['human', escaped, escaped]],
		...Object.entries(contiguousCatalog(256).entries),
		['last', ['audacity', 'Last', 'Dernier']],
	]);
	const catalog = { schemaVersion: 2, locale: 'fr', provenance: { machine: { model: 'Pinned' } }, entries,
		community: { constructor: { contributor: escaped } } }, before = JSON.stringify(catalog);
	const source = renderTranslationCatalogModule(catalog); assert.match(source, /Object\.fromEntries/u);
	const { code } = await transform(source, { minify: true, charset: 'utf8' }), module = await loadModule(code);
	const actual = module.default as typeof catalog;
	assert.deepEqual(actual, catalog); assert.deepEqual(Object.keys(actual.entries), Object.keys(catalog.entries));
	assert.equal(Object.getPrototypeOf(actual.entries), Object.prototype); assert.ok(Object.hasOwn(actual.entries, '__proto__'));
	assert.ok(Object.hasOwn(actual.entries, 'constructor')); assert.equal(module.entries, actual.entries);
	const constructorTuple: unknown = Object.getOwnPropertyDescriptor(actual.entries, 'constructor')?.value;
	assert.ok(Array.isArray(constructorTuple)); assert.notEqual(actual.entries.__proto__, constructorTuple);
	assert.equal(Reflect.has(globalThis, 'catalogInjection'), false);
	actual.entries.__proto__![1] = 'Authored';
	assert.equal(constructorTuple[1], escaped); assert.equal(JSON.stringify(catalog), before);
});

test('table admission preserves generic JSON shapes and its profitability boundary never regresses minified bytes', async () => {
	for (const invalid of [null, ['machine', 'English'], ['machine', 'English', 'Texte', 'extra'], [1, 'English', 'Texte'],
		['machine', undefined, 'Texte'], { arbitrary: true }]) {
		const catalog = { ...contiguousCatalog(128), entries: { ...contiguousCatalog(128).entries, invalid } };
		const source = renderTranslationCatalogModule(catalog); assert.doesNotMatch(source, /Object\.fromEntries/u);
		const { code } = await transform(source, { minify: true, charset: 'utf8' });
		assert.deepEqual((await loadModule(code)).default, JSON.parse(JSON.stringify(catalog)) as unknown);
	}
	for (const count of [1, 2, 4, 8, 16, 32, 64, 128, 256]) {
		const catalog = contiguousCatalog(count), source = renderTranslationCatalogModule(catalog);
		// The existing renderer interns this sole repeated value only when its
		// complete emitted declaration pays for itself; retain that exact baseline.
		const saving = count * Buffer.byteLength('"machine"') - Buffer.byteLength('const $t0="machine";\n') - count * 3;
		const baseline = saving > 0 ? originInternedModule(catalog) : literalModule(catalog);
		const [compact, original] = await Promise.all([source, baseline]
			.map(value => transform(value, { minify: true, charset: 'utf8' })));
		assert.ok(Buffer.byteLength(compact!.code) <= Buffer.byteLength(original!.code),
			`Complete minified table costs must be profitable at ${count} entries.`);
		assert.deepEqual((await loadModule(compact!.code)).default, catalog);
	}
});

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

test('small but proven byte savings are retained after charging the complete declaration overhead', async () => {
	const catalog = { schemaVersion: 2, locale: 'fr',
		entries: { a: ['machine', 'Repeated value', 'Premier'], b: ['human', 'Repeated value', 'Deuxième'],
			c: ['audacity', 'Repeated value', 'Troisième'] } };
	const literalSource = [`const catalog = ${JSON.stringify(catalog)};`,
		...Object.keys(catalog).map(key => `export const ${key} = catalog.${key};`), 'export default catalog;'].join('\n');
	const source = renderTranslationCatalogModule(catalog);
	assert.ok(Buffer.byteLength(source) < Buffer.byteLength(literalSource),
		'Interning must recover its own complete declaration, reference and newline bytes.');
	const [compact, literal] = await Promise.all([transform(source, { minify: true, charset: 'utf8' }),
		transform(literalSource, { minify: true, charset: 'utf8' })]);
	assert.ok(Buffer.byteLength(compact.code) < Buffer.byteLength(literal.code));
	const actual = (await loadModule(compact.code)).default as typeof catalog;
	assert.deepEqual(actual, catalog); assert.notEqual(actual.entries.a, actual.entries.b);
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

test('every published machine catalog retains all tuples and named exports within the production ceiling', async t => {
	const locales = COMMITTED_LOCALE_TAGS.filter(locale => !['en', 'de'].includes(new Intl.Locale(locale).language));
	for (const locale of locales) await t.test(locale, async () => {
		const catalog = JSON.parse(await readFile(new URL(`../src/common/i18n/translations/${locale}.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
		const { code } = await transform(renderTranslationCatalogModule(catalog), { minify: true, charset: 'utf8' });
		assert.ok(Buffer.byteLength(code) < 500_000, `${locale} must preserve the production JavaScript chunk ceiling.`);
		const module = await loadModule(code); assert.deepEqual(module.default, catalog);
		for (const [key, value] of Object.entries(catalog)) assert.deepEqual(module[key], value, `${locale}.${key}`);
	});
});
