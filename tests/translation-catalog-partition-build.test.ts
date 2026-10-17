/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build, type BuildOptions } from 'vite';
import productionViteConfig from '../vite.config.mjs';
import { chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { createTranslationCatalogBundlePlugin } from '../scripts/lib/translation-catalog-bundle.mjs';
import { currentTranslations } from '../src/common/i18n/translation-catalog.js';

interface Catalog {
	schemaVersion: number;
	locale: string;
	provenance: Record<string, unknown>;
	entries: Record<string, [string, string, string]>;
	community?: Record<string, unknown>;
}
interface LoadedCatalog { default: Catalog; entries: Catalog['entries']; provenance: Catalog['provenance'] }
interface LoadedEntry { loaders: Record<string, () => Promise<LoadedCatalog>> }

async function hindiCatalog(): Promise<Catalog> {
	return JSON.parse(await readFile(new URL('../src/common/i18n/translations/hi.json', import.meta.url), 'utf8')) as Catalog;
}

function grownCatalog(): Catalog {
	const escaped = '";globalThis.catalogInjection=true;//\n\u2028\u2029\ud800\udfff\\';
	return { schemaVersion: 2, locale: 'fr', provenance: { machine: { model: 'Pinned' },
		audacity: { licenseSpdx: 'GPL-3.0-only' } }, entries: Object.fromEntries([
		['10', ['machine', 'Ten', 'Dix']], ['2', ['human', 'Two', 'Deux']],
		['__proto__', ['human', 'Prototype', 'Prototype']], ['constructor', ['human', escaped, escaped]],
		...Array.from({ length: 900 }, (_, index) => [`future${index}`, ['machine',
			`English ${index}: ${'A long future adjustment description '.repeat(12)}`,
			`Texte ${index}: ${'Une description étendue pour les réglages futurs '.repeat(12)}`]]),
		['retired', ['machine', 'Old English', 'Ancien anglais']],
		['current', ['audacity', 'Current English', 'Anglais actuel']],
	]), community: Object.fromEntries([['__proto__', { contributor: escaped,
		previousEntry: ['machine', 'Prototype', 'Prototype'] }]]) };
}

async function withBuiltCatalogs(catalogs: Catalog[], inspect: (context: {
	directory: string; output: Awaited<ReturnType<typeof build>>; snapshots: string[];
}) => Promise<void>, modulePreload: BuildOptions['modulePreload'] = false): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), 'scape-translation-catalog-parts-'));
	const catalogDirectory = join(directory, 'src/common/i18n/translations');
	const snapshots = catalogs.map(catalog => JSON.stringify(catalog));
	try {
		await mkdir(catalogDirectory, { recursive: true });
		for (let index = 0; index < catalogs.length; index++) {
			await writeFile(join(catalogDirectory, `${catalogs[index]!.locale}.json`), snapshots[index]!);
		}
		await writeFile(join(catalogDirectory, 'index.js'), `export const loaders={${catalogs.map(catalog =>
			`${JSON.stringify(catalog.locale)}:()=>import(${JSON.stringify(`./${catalog.locale}.json`)})`).join(',')}};`);
		await writeFile(join(directory, 'entry.js'), 'export {loaders} from "./src/common/i18n/translations/index.js";');
		const output = await build({ root: directory, configFile: false, logLevel: 'silent',
			plugins: [createTranslationCatalogBundlePlugin()], build: { outDir: join(directory, 'built'),
				modulePreload, rolldownOptions: { input: join(directory, 'entry.js'),
					preserveEntrySignatures: 'allow-extension', output: { entryFileNames: 'entry.mjs',
						chunkFileNames: '[name]-[hash].mjs', codeSplitting: { groups: chunkGroups, minSize: 20_000 },
						strictExecutionOrder: true } } } });
		await inspect({ directory, output, snapshots });
		for (let index = 0; index < catalogs.length; index++) {
			assert.equal(await readFile(join(catalogDirectory, `${catalogs[index]!.locale}.json`), 'utf8'), snapshots[index]);
			assert.equal(JSON.stringify(catalogs[index]), snapshots[index]);
		}
	} finally { await rm(directory, { recursive: true, force: true }); }
}

test('actual production catalog plugin splits growing catalogs into bounded lazy owners without changing runtime data', async t => {
	const catalogs = [await hindiCatalog(), grownCatalog()];
	await withBuiltCatalogs(catalogs, async ({ directory, output }) => {
		assert.ok(!Array.isArray(output) && 'output' in output);
		const chunks = output.output.filter(chunk => chunk.type === 'chunk');
		t.diagnostic(JSON.stringify(chunks.map(chunk => ({ file: chunk.fileName, bytes: Buffer.byteLength(chunk.code) }))));
		const entry = chunks.find(chunk => chunk.isEntry); assert.ok(entry);
		const byName = new Map(chunks.map(chunk => [chunk.fileName, chunk]));
		const initial = new Set<string>();
		function visit(name: string): void {
			if (initial.has(name)) return;
			initial.add(name); for (const dependency of byName.get(name)?.imports ?? []) visit(dependency);
		}
		visit(entry.fileName);
		for (const chunk of chunks) {
			assert.ok(Buffer.byteLength(chunk.code) < 400_000,
				`${chunk.fileName} (${Buffer.byteLength(chunk.code)} bytes) must retain space below the unchanged 500 KB production limit.`);
			if (initial.has(chunk.fileName)) assert.ok(Object.keys(chunk.modules).every(id => !id.startsWith('\0scape:translation-catalog')));
		}
		for (const catalog of catalogs) {
			const parts = chunks.filter(chunk => Object.keys(chunk.modules).some(id =>
				id.startsWith('\0scape:translation-catalog-part:') && id.includes(`/${catalog.locale}.json:`)));
			assert.ok(parts.length > 1, `${catalog.locale} must own multiple bounded entry modules.`);
			for (const part of parts) {
				assert.match(part.fileName, new RegExp(`^locale-${catalog.locale}-entries-\\d+-`));
				assert.equal(Object.keys(part.modules).filter(id => id.startsWith('\0scape:translation-catalog-part:')).length, 1);
			}
		}
		const loaded = await import(pathToFileURL(join(directory, 'built', entry.fileName)).href) as LoadedEntry;
		for (const catalog of catalogs) {
			const module = await loaded.loaders[catalog.locale]!();
			assert.deepEqual(module.default, catalog); assert.equal(module.entries, module.default.entries);
			assert.equal(module.provenance, module.default.provenance);
			assert.deepEqual(Object.keys(module.default), Object.keys(catalog));
			assert.deepEqual(Object.keys(module.entries), Object.keys(catalog.entries));
			assert.equal(Object.getPrototypeOf(module.entries), Object.prototype);
		}
		const french = await loaded.loaders.fr!();
		const translated = currentTranslations(french.default, { retired: 'New English', current: 'Current English' }, { locale: 'fr' });
		assert.equal(Object.hasOwn(translated, 'retired'), false); assert.deepEqual(translated, { current: 'Anglais actuel' });
		assert.ok(Object.hasOwn(french.entries, '__proto__')); assert.ok(Object.hasOwn(french.default.community!, '__proto__'));
		assert.equal(Reflect.has(globalThis, 'catalogInjection'), false);
		french.entries.__proto__![1] = 'Changed';
		assert.equal(catalogs[1]!.entries.__proto__![1], 'Prototype');
	});
});

test('small catalogs keep one lazy module and preserve an explicitly empty entries property', async () => {
	const catalog: Catalog = { schemaVersion: 2, locale: 'fr', provenance: {}, entries: {}, community: {} };
	await withBuiltCatalogs([catalog], async ({ directory, output }) => {
		assert.ok(!Array.isArray(output) && 'output' in output);
		const chunks = output.output.filter(chunk => chunk.type === 'chunk');
		assert.equal(chunks.filter(chunk => Object.keys(chunk.modules).some(id => id.startsWith('\0scape:translation-catalog-part:'))).length, 0);
		const entry = chunks.find(chunk => chunk.isEntry); assert.ok(entry);
		const loaded = await import(pathToFileURL(join(directory, 'built', entry.fileName)).href) as LoadedEntry;
		const module = await loaded.loaders.fr!();
		assert.deepEqual(module.default, catalog); assert.equal(module.entries, module.default.entries);
	});
});

test('production preloading keeps locale entry-part filenames out of the eager loader graph', async () => {
	await withBuiltCatalogs([await hindiCatalog(), grownCatalog()], async ({ output }) => {
		assert.ok(!Array.isArray(output) && 'output' in output);
		const chunks = output.output.filter(chunk => chunk.type === 'chunk');
		const entry = chunks.find(chunk => chunk.isEntry); assert.ok(entry);
		const byName = new Map(chunks.map(chunk => [chunk.fileName, chunk])), initial = new Set<string>();
		function visit(name: string): void {
			if (initial.has(name)) return;
			initial.add(name); for (const dependency of byName.get(name)?.imports ?? []) visit(dependency);
		}
		visit(entry.fileName);
		const eagerCode = [...initial].map(name => byName.get(name)!.code).join('\n');
		const parts = chunks.filter(chunk => Object.keys(chunk.modules).some(id => id.startsWith('\0scape:translation-catalog-part:')));
		assert.ok(parts.length > 1);
		for (const part of parts) {
			assert.equal(eagerCode.includes(part.fileName), false,
				`Optional ${part.fileName} must be discovered by its lazy catalog root.`);
			assert.ok(chunks.some(chunk => !initial.has(chunk.fileName) && chunk.imports.includes(part.fileName)),
				'The native module graph still requires every part before resolving its catalog import.');
		}
	}, productionViteConfig.build?.modulePreload ?? true);
});
