/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import { translationCatalogPartChunkName, translationCatalogPreloadDependencies } from '../scripts/lib/build-chunk-translation-catalogs.mjs';
import { createTranslationCatalogBundlePlugin, renderTranslationCatalogModule } from '../scripts/lib/translation-catalog-bundle.mjs';
import { assembleTranslationCatalogModule, partitionTranslationCatalog, translationCatalogPartId,
	TRANSLATION_CATALOG_MODULE_BYTES } from '../scripts/lib/translation-catalog-partition.mjs';

function catalog(locale = 'fr'): Record<string, unknown> {
	return { schemaVersion: 2, locale, provenance: { machine: { model: 'Pinned' } }, entries: Object.fromEntries(
		Array.from({ length: 600 }, (_, index) => [`key${index}`, ['machine',
			`English ${index}: ${'Long source message '.repeat(20)}`,
			`Text ${index}: ${'Long translated message '.repeat(20)}`]])) };
}

async function evaluate(value: Record<string, unknown>): Promise<Record<string, unknown>> {
	const partition = partitionTranslationCatalog(value, renderTranslationCatalogModule), path = '/fr.json';
	let source = assembleTranslationCatalogModule(partition, path);
	for (const [index, part] of partition.parts.entries()) {
		assert.ok(Buffer.byteLength(part) <= TRANSLATION_CATALOG_MODULE_BYTES);
		source = source.replaceAll(JSON.stringify(translationCatalogPartId(path, index)),
			JSON.stringify(`data:text/javascript,${encodeURIComponent(part)}`));
	}
	const module = await import(`data:text/javascript,${encodeURIComponent(source)}`) as { default: Record<string, unknown> };
	return module.default;
}

test('partitioned generic JSON retains malformed rows for the unchanged runtime validator', async () => {
	const value = catalog();
	value.entries = { ...value.entries as object,
		invalid: ['machine', 'Only two cells'], arbitrary: { notATuple: true }, nullable: null };
	value.provenance = { ...value.provenance as object, omitted: undefined, date: new Date('2026-10-09T00:00:00Z') };
	const before = JSON.stringify(value), expected: unknown = JSON.parse(before);
	assert.deepEqual(await evaluate(value), expected); assert.equal(JSON.stringify(value), before);
});

test('non-object and absent entries keep their exact JSON serialization semantics', async () => {
	for (const entries of [undefined, null, [], ['machine', 'English', 'Text'], 'not an object']) {
		const value = { schemaVersion: 2, locale: 'fr', entries };
		const partition = partitionTranslationCatalog(value, renderTranslationCatalogModule);
		assert.deepEqual(partition.parts, []);
		assert.deepEqual(await evaluate(value), JSON.parse(JSON.stringify(value)) as unknown);
	}
});

test('an oversized indivisible entry or attribution field fails explicitly without dropping catalog data', () => {
	for (const [value, reason] of [
		[{ entries: { huge: ['machine', 'E'.repeat(250_000), 'T'.repeat(250_000)] } }, /entry exceeds/u],
		[{ ...catalog(), community: { contributor: 'A'.repeat(250_000) } }, /metadata exceeds/u],
	] as const) {
		const before = JSON.stringify(value);
		assert.throws(() => partitionTranslationCatalog(value, renderTranslationCatalogModule), reason);
		assert.equal(JSON.stringify(value), before);
	}
});

test('generated part owners include locale and ordinal and preserve Windows path admission', () => {
	for (const path of ['/workspace/src/common/i18n/translations/fr.json', 'C:\\workspace\\src\\common\\i18n\\translations\\fr.json']) {
		const id = translationCatalogPartId(path, 12);
		assert.equal(translationCatalogPartChunkName(id), 'locale-fr-entries-12');
		assert.equal(chunkGroupForModulePath(id), 'locale-fr-entries-12');
	}
	assert.equal(translationCatalogPartChunkName('/workspace/fr.json:12.mjs'), null);
	assert.equal(translationCatalogPartChunkName('\0scape:translation-catalog-part:/fr.json:invalid.mjs'), null);
});

test('catalog preload filtering preserves unrelated dependencies and the input inventory', () => {
	const root = 'assets/fr.json-abcd.js', dependencies = [root, 'assets/locale-fr-entries-0-abcd.js',
		'assets/vendor-react-abcd.js', 'assets/locale-fr-entries-1-efgh.js', 'assets/style-abcd.css',
		'assets/locale-fr-settings-abcd.js', 'assets/locale-fr-entries-invalid-abcd.js'];
	const before = [...dependencies];
	assert.deepEqual(translationCatalogPreloadDependencies(root, dependencies), [
		'assets/vendor-react-abcd.js', 'assets/style-abcd.css', 'assets/locale-fr-settings-abcd.js',
		'assets/locale-fr-entries-invalid-abcd.js']);
	assert.deepEqual(dependencies, before);
	assert.equal(translationCatalogPreloadDependencies('assets/editor-abcd.js', dependencies), dependencies);
	const ordinary = ['assets/vendor-react-abcd.js', 'assets/style-abcd.css'];
	assert.equal(translationCatalogPreloadDependencies(root, ordinary), ordinary);
});

test('catalog reloads and build epochs discard obsolete parts and prohibit cross-locale part imports', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'scape-translation-catalog-watch-'));
	const catalogDirectory = join(directory, 'src/common/i18n/translations');
	const importer = join(catalogDirectory, 'index.js'), plugin = createTranslationCatalogBundlePlugin();
	const watched: string[] = [], context = { addWatchFile: (path: string) => watched.push(path) };
	try {
		await mkdir(catalogDirectory, { recursive: true });
		for (const locale of ['fr', 'hi']) await writeFile(join(catalogDirectory, `${locale}.json`), JSON.stringify(catalog(locale)));
		const french = plugin.resolveId('./fr.json', importer), hindi = plugin.resolveId('./hi.json', importer);
		assert.ok(french); assert.ok(hindi);
		await plugin.load.call(context, french); await plugin.load.call(context, hindi);
		const part = translationCatalogPartId(join(catalogDirectory, 'fr.json'), 0);
		assert.equal(plugin.resolveId(part, french), part); assert.equal(plugin.resolveId(part, hindi), null);
		assert.ok(await plugin.load.call(context, part));
		await writeFile(join(catalogDirectory, 'fr.json'), '{"schemaVersion":2,"locale":"fr","entries":{}}');
		const source = await plugin.load.call(context, french); assert.ok(source);
		assert.doesNotMatch(source, /translation-catalog-part/u);
		assert.equal(plugin.resolveId(part, french), null); assert.equal(await plugin.load.call(context, part), null);
		const hindiPart = translationCatalogPartId(join(catalogDirectory, 'hi.json'), 0);
		assert.equal(plugin.resolveId(hindiPart, hindi), hindiPart);
		plugin.buildStart();
		assert.equal(plugin.resolveId(hindiPart, hindi), null); assert.equal(await plugin.load.call(context, hindiPart), null);
		await plugin.load.call(context, hindi); assert.equal(plugin.resolveId(hindiPart, hindi), hindiPart);
		assert.ok(watched.every(path => path === join(catalogDirectory, 'fr.json') || path === join(catalogDirectory, 'hi.json')));
	} finally { await rm(directory, { recursive: true, force: true }); }
});

type LoadOutcome = Readonly<{ ok: true; source: string | null }> | Readonly<{ ok: false; error: unknown }>;
async function withHeldRead(run: (context: Readonly<{
	plugin: ReturnType<typeof createTranslationCatalogBundlePlugin>; path: string; root: string;
	load: (id: string) => Promise<string | null>; release: () => void; outcome: Promise<LoadOutcome>;
}>) => Promise<void>): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), 'scape-translation-catalog-held-read-'));
	const catalogDirectory = join(directory, 'src/common/i18n/translations'), path = join(catalogDirectory, 'fr.json');
	await mkdir(catalogDirectory, { recursive: true }); await writeFile(path, JSON.stringify(catalog()));
	const plugin = createTranslationCatalogBundlePlugin(), root = plugin.resolveId('./fr.json', join(catalogDirectory, 'index.js'));
	assert.ok(root);
	const nativeRead = fs.readFile;
	let release = () => {}, readReady = () => {}, first = true;
	const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { readReady = resolve; });
	fs.readFile = (async (...args: Parameters<typeof nativeRead>) => {
		const bytes = await Reflect.apply(nativeRead, fs, args) as Awaited<ReturnType<typeof nativeRead>>;
		if (args[0] === path && first) { first = false; readReady(); await gate; }
		return bytes;
	}) as typeof nativeRead;
	syncBuiltinESMExports();
	const load = async (id: string) => await plugin.load.call({ addWatchFile() {} }, id);
	const outcome = load(root).then((source): LoadOutcome => ({ ok: true, source }), (error: unknown): LoadOutcome => ({ ok: false, error }));
	try { await ready; await run({ plugin, path, root, load, release, outcome }); }
	finally {
		release(); await outcome; fs.readFile = nativeRead; syncBuiltinESMExports();
		await rm(directory, { recursive: true, force: true });
	}
}

function assertSuperseded(outcome: LoadOutcome): void {
	assert.equal(outcome.ok, false, 'A held obsolete read must refuse publication.');
	if (outcome.ok) assert.fail('Obsolete read unexpectedly published.');
	assert.ok(outcome.error instanceof Error); assert.match(outcome.error.message, /superseded/u);
}

test('a held read cannot republish catalog parts after a new build starts', async () => {
	await withHeldRead(async ({ plugin, path, root, load, release, outcome }) => {
		plugin.buildStart(); release(); assertSuperseded(await outcome);
		const part = translationCatalogPartId(path, 0);
		assert.equal(plugin.resolveId(part, root), null); assert.equal(await load(part), null);
		await load(root); assert.equal(plugin.resolveId(part, root), part);
	});
});

test('a held older read cannot replace or clear the newer parts of its own catalog', async () => {
	await withHeldRead(async ({ plugin, path, root, load, release, outcome }) => {
		const newer = catalog(), entries = newer.entries as Record<string, unknown>;
		entries.key0 = ['human', 'New source English', 'New translated text'];
		await writeFile(path, JSON.stringify(newer)); await load(root);
		const part = translationCatalogPartId(path, 0), fresh = await load(part); assert.ok(fresh);
		release(); assertSuperseded(await outcome);
		assert.equal(plugin.resolveId(part, root), part); assert.equal(await load(part), fresh);
		const module = await import(`data:text/javascript,${encodeURIComponent(fresh)}`) as { entries: Record<string, unknown> };
		assert.deepEqual(module.entries.key0, entries.key0);
	});
});
