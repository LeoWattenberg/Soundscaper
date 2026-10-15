/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { rolldown, type OutputChunk } from 'rolldown';

import { chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
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

test('the bundle plugin only substitutes lazy imports from the generated catalog index', async () => {
	const plugin = createTranslationCatalogBundlePlugin();
	const importer = fileURLToPath(new URL('../src/common/i18n/translations/index.js', import.meta.url));
	assert.equal(plugin.resolveId('./hi.json', '/workspace/another/index.js'), null);
	assert.equal(plugin.resolveId('../hi.json', importer), null);
	assert.equal(plugin.resolveId('./hi.json?raw', importer), null);
	assert.equal(await plugin.load.call({ addWatchFile() {} }, '\0unrelated'), null);
	const id = plugin.resolveId('./af.json', importer);
	assert.equal(typeof id, 'string');
	assert.ok(id);
	const watched: string[] = [];
	const source = await plugin.load.call({ addWatchFile: (path: string) => watched.push(path) }, id);
	assert.ok(source);
	const path = fileURLToPath(new URL('../src/common/i18n/translations/af.json', import.meta.url));
	assert.deepEqual(watched, [path]);
	const catalog: unknown = JSON.parse(await readFile(path, 'utf8'));
	assert.deepEqual((await loadModule(source)).default, catalog);
});

test('production chunks preserve complete catalogs within the chunk budget', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'translation-catalog-bundle-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const importer = fileURLToPath(new URL('../src/common/i18n/translations/index.js', import.meta.url));
	const bundle = await rolldown({
		input: importer,
		preserveEntrySignatures: 'allow-extension',
		plugins: [createTranslationCatalogBundlePlugin()],
	});
	try {
		const result = await bundle.write({
			dir: directory, format: 'es', minify: true, strictExecutionOrder: true,
			entryFileNames: 'index.mjs', chunkFileNames: '[name]-[hash].mjs',
			codeSplitting: { groups: chunkGroups, minSize: 20_000 },
		});
		const chunks = result.output.filter((item): item is OutputChunk => item.type === 'chunk');
		for (const chunk of chunks) {
			assert.ok(Buffer.byteLength(chunk.code) < 490_000,
				`${chunk.fileName} must leave room under the unchanged 500 KB ceiling.`);
		}
		for (const owner of ['core', 'motion']) {
			assert.ok(chunks.some(chunk => chunk.fileName.startsWith(`translation-hi-${owner}-`)),
				`The complete Hindi catalog must keep its ${owner} owner separate.`);
		}
		const entry = chunks.find(chunk => chunk.isEntry);
		assert.ok(entry);
		const pending = [entry];
		const visited = new Set<string>();
		for (const chunk of pending) {
			if (visited.has(chunk.fileName)) continue;
			visited.add(chunk.fileName);
			assert.ok(Object.keys(chunk.modules).every(id => !id.startsWith('\0scape:translation-catalog:')),
				'Catalog bytes stay behind the locale loader.');
			for (const name of chunk.imports) {
				const dependency = chunks.find(candidate => candidate.fileName === name);
				assert.ok(dependency);
				pending.push(dependency);
			}
		}
		for (const name of entry.dynamicImports) {
			const locale = chunks.find(chunk => chunk.fileName === name);
			assert.ok(locale);
			assert.ok(locale.imports.every(dependency => !dependency.startsWith('translation-')),
				`${name} must keep expanded catalog data out of the boot preload list.`);
		}
		const built = await import(pathToFileURL(join(directory, 'index.mjs')).href) as {
			TRANSLATION_CATALOG_LOADERS: Record<string, () => Promise<{ default: Record<string, unknown> }>>;
		};
		for (const [locale, load] of Object.entries(built.TRANSLATION_CATALOG_LOADERS)) {
			const catalog: unknown = JSON.parse(await readFile(new URL(`../src/common/i18n/translations/${locale}.json`, import.meta.url), 'utf8'));
			assert.deepEqual((await load()).default, catalog, locale);
		}
	} finally { await bundle.close(); }
});
