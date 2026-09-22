import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createNyquistArchiveStore } from '../src/common/editor/nyquist/archive-store.js';
import {
	parseNyquistArchiveManifest,
	parseNyquistArchiveMetadata,
	installNyquistArchivePlugin,
} from '../src/common/editor/nyquist/archive-catalog.js';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const source = '$nyquist plug-in\n$version 4\n$type process\n$name "Test Effect"\n(mult *track* 0.5)\n';
const bytes = new TextEncoder().encode(source);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const artifact = {
	fileName: 'Test-Effect.ny', byteLength: bytes.length, sha256: sha256(bytes),
	publicUrl: 'https://assets.soundscaper.org/plugins/nyquist/audacityteam.org/ed168a19631ec48d0029dfb5c17d16c339a174c1/files/Test-Effect.ny',
};
const manifest = { schemaVersion: 1, archiveId: 'audacityteam-nyquist-plugins-ed168a19631ec48d0029dfb5c17d16c339a174c1', artifacts: [artifact] };
const memoryStorage = () => {
	const values = new Map();
	return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test('archive installation checks manifest and source bytes, then persists a parsed effect', async () => {
	const store = createNyquistArchiveStore(memoryStorage());
	const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
	assert.equal((await parseNyquistArchiveManifest(manifestBytes, sha256(manifestBytes))).artifacts.length, 1);
	const fetchImpl = async () => new Response(bytes);
	const plugin = await installNyquistArchivePlugin(store, artifact, { fetchImpl });
	assert.equal(plugin.id, 'nyquist:archive:Test-Effect.ny');
	assert.equal(plugin.category, 'legacy');
	assert.equal(plugin.name, 'Test Effect');
	assert.equal(store.list().length, 1);
	assert.equal(store.source(plugin.id), source);
	assert.equal(createNyquistArchiveStore(store.storage).source(plugin.id), source);
});

test('archive refuses substituted bytes, unsafe URLs, and controls unavailable in the browser', async () => {
	const store = createNyquistArchiveStore(memoryStorage());
	await assert.rejects(() => installNyquistArchivePlugin(store, artifact, {
		fetchImpl: async () => new Response(new TextEncoder().encode(source.replace('0.5', '0.6'))),
	}), /length|digest/i);
	await assert.rejects(() => installNyquistArchivePlugin(store, { ...artifact, publicUrl: 'https://example.org/plugin.ny' }, {
		fetchImpl: async () => new Response(bytes),
	}), /archive URL/i);
	const fileSource = '$nyquist plug-in\n$type process\n$control FILE "File" file "" ""\n(mult *track* 0.5)';
	const fileBytes = new TextEncoder().encode(fileSource);
	await assert.rejects(() => installNyquistArchivePlugin(store, {
		...artifact, byteLength: fileBytes.length, sha256: sha256(fileBytes),
	}, { fetchImpl: async () => new Response(fileBytes) }), /unavailable in the browser/i);
	assert.equal(store.list().length, 0);
});

test('archive rejects a modified manifest', async () => {
	const bytes = new TextEncoder().encode(JSON.stringify(manifest));
	await assert.rejects(() => parseNyquistArchiveManifest(bytes, '0'.repeat(64)), /digest/i);
});

test('pinned catalog metadata supplies titles and descriptions for every archived file', async () => {
	const manifestBytes = gunzipSync(readFileSync(new URL('./fixtures/nyquist-archive/manifest.json.gz', import.meta.url)));
	const pinnedManifest = await parseNyquistArchiveManifest(manifestBytes);
	const metadataBytes = readFileSync(new URL('../evidence/nyquist-plugin-publication/catalog-metadata-ed168a19631ec48d0029dfb5c17d16c339a174c1.json', import.meta.url));
	const catalog = await parseNyquistArchiveMetadata(metadataBytes, pinnedManifest, sha256(metadataBytes));
	assert.equal(catalog.artifacts.length, 115);
	assert.deepEqual(catalog.artifacts.find(({ fileName }) => fileName === '10bandeq.ny')?.title, 'Ten Band EQ');
	assert.match(catalog.artifacts.find(({ fileName }) => fileName === '10bandeq.ny')?.description ?? '', /one band at a time/u);
	await assert.rejects(() => parseNyquistArchiveMetadata(metadataBytes, pinnedManifest, '0'.repeat(64)), /digest/i);
	await assert.rejects(() => parseNyquistArchiveMetadata(metadataBytes, {
		...pinnedManifest, artifacts: [...pinnedManifest.artifacts].reverse(),
	}, sha256(metadataBytes)), /metadata|order/i);
});

test('an earlier local install takes on its catalog title when metadata is loaded', () => {
	const store = createNyquistArchiveStore(memoryStorage());
	store.install({ id: 'nyquist:archive:Test-Effect.ny', fileName: 'Test-Effect.ny',
		archiveId: manifest.archiveId, source });
	store.updateCatalogMetadata([{ fileName: 'Test-Effect.ny', title: 'Catalog Title',
		description: 'Catalog description.' }]);
	const installed = createNyquistArchiveStore(store.storage).list()[0];
	assert.equal(installed.name, 'Catalog Title');
	assert.equal(installed.description, 'Catalog description.');
});
