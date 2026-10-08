/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js/index-native.js';
import { exportPhotoCatalogArchiveV3 } from '../src/lightscaper/archive/catalog-archive-export-v3.ts';
import { normalizePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { readValidatedPhotoCatalogRootV1 } from '../src/lightscaper/catalog/documents.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

const root = (photoCount = 0) => normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1,
	kind: 'photo-catalog', id: 'catalog-1', name: 'Saved library', revision: 17, photoCount,
	folders: [{ id: 'folder', name: 'Folder', parentId: null }], keywords: [{ id: 'keyword', name: 'Keyword', parentId: null }],
	collections: [{ id: 'manual', kind: 'manual', name: 'Manual' }] });
const state = (collectionCount: number, revision = 29) => ({ schemaVersion: 1, kind: 'photo-smart-collections-state',
	catalogId: 'catalog-1', collectionCount, revision });
const definition = (index = 0, predicate: unknown = { kind: 'any', terms: [
	{ kind: 'folder', id: 'folder' }, { kind: 'not', term: { kind: 'keyword', id: 'keyword' } },
] }) => normalizePhotoSmartCollectionV1({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: 'catalog-1',
	id: `saved-${String(index).padStart(4, '0')}`, name: `Saved ${String(index)}`, revision: 11,
	query: { schemaVersion: 2, kind: 'photo-catalog-query', text: 'needle', filter: { kind: 'collection', id: 'manual' },
		sort: { field: 'capture-time', direction: 'descending' }, predicate } });

async function entries(blob: Blob) {
	const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false }), values = new Map<string, Uint8Array>();
	try { for (const entry of await reader.getEntries()) if (!entry.directory) values.set(entry.filename, await entry.getData(new Uint8ArrayWriter())); }
	finally { await reader.close(); }
	return values;
}
function destination() {
	const parts: Uint8Array<ArrayBuffer>[] = [], events: string[] = [];
	const writable = new WritableStream<Uint8Array>({ write(bytes) { parts.push(new Uint8Array(bytes)); events.push('write'); },
		close() { events.push('close'); }, abort() { events.push('abort'); parts.length = 0; } });
	return { parts, events, writable };
}
function primaryFailure(error: unknown): unknown {
	return error instanceof AggregateError ? primaryFailure(error.errors[0]) : error;
}

test('archive3 emits full saved criteria alongside unchanged photo and stack formats', async () => {
	const photo = photoArchiveFixture(), recipes = [definition()];
	const result = await exportPhotoCatalogArchiveV3(root(1), [photo], [], state(1), recipes);
	assert.ok(result.blob); assert.equal(result.manifest.formatVersion, 1); assert.equal(result.manifest.project.schemaVersion, 3);
	assert.deepEqual(result.document.savedCollectionState, state(1));
	assert.deepEqual(result.document.savedCollectionPacks.map(pack => pack.collectionCount), [1]);
	assert.deepEqual(result.manifest.assets.map(asset => asset.kind), ['photo-catalog-pack', 'photo-smart-collection-pack']);
	const bodies = await entries(result.blob), saved = bodies.get('assets/saved-collection-pack-000001.bin'); assert.ok(saved);
	assert.equal(new TextDecoder().decode(saved.subarray(0, 8)), 'LSSMART1');
	assert.deepEqual(JSON.parse(new TextDecoder().decode(saved.subarray(12))), recipes[0]);
	assert.deepEqual(JSON.parse(new TextDecoder().decode(bodies.get('project.json'))), result.document);
});

test('65 small complete recipes split at 64 without placing predicates in the project document', async () => {
	const result = await exportPhotoCatalogArchiveV3(root(), [], [], state(65), Array.from({ length: 65 }, (_, index) => definition(index)));
	assert.deepEqual(result.document.savedCollectionPacks.map(pack => pack.collectionCount), [64, 1]);
	assert.equal('query' in result.document, false);
	assert.ok(result.blob); assert.ok(new TextEncoder().encode(JSON.stringify(result.document)).byteLength < 4_096);
});

test('physical absence and retained empty revisions produce distinct archive3 documents', async () => {
	for (const retained of [null, state(0, 0), state(0, 37)]) {
		const result = await exportPhotoCatalogArchiveV3(root(), [], [], retained, []);
		assert.deepEqual(result.document.savedCollectionState, retained); assert.deepEqual(result.document.savedCollectionPacks, []);
		assert.equal(result.manifest.project.schemaVersion, 3);
	}
});

test('a fully admitted immutable catalog root remains one borrowed object through final verification and output', async () => {
	const admitted = readValidatedPhotoCatalogRootV1(root()); let verified = false;
	const result = await exportPhotoCatalogArchiveV3(admitted, [], [], null, [], { async verifySource() { verified = true; } });
	assert.equal(verified, true); assert.equal(result.document.catalog, admitted);
});

test('missing hidden references, cross-pack duplicates and exact state mismatches abort the destination', async () => {
	const candidates = [
		{ state: state(1), recipes: [definition(0, { kind: 'any', terms: [{ kind: 'text', column: 'caption', operator: 'equals', value: '' },
			{ kind: 'not', term: { kind: 'keyword', id: 'missing' } }] })] },
		{ state: state(65), recipes: [...Array.from({ length: 64 }, (_, index) => definition(index)), definition(0)] },
		{ state: state(2), recipes: [definition()] }, { state: null, recipes: [definition()] },
		{ state: state(1), recipes: [{ ...definition(), id: 'manual' }] },
	];
	for (const candidate of candidates) {
		const target = destination();
		await assert.rejects(exportPhotoCatalogArchiveV3(root(), [], [], candidate.state, candidate.recipes, { writable: target.writable }));
		assert.equal(target.events.at(-1), 'abort'); assert.equal(target.writable.locked, false); assert.equal(target.parts.length, 0);
	}
});

test('a final source fence joins before output close and drift aborts an already written archive', async () => {
	const target = destination(), failure = new Error('Saved inventory changed'); let fenced = false;
	await assert.rejects(exportPhotoCatalogArchiveV3(root(), [], [], state(1), [definition()], { writable: target.writable,
		async verifySource() { assert.ok(target.events.includes('write')); assert.ok(!target.events.includes('close')); fenced = true; throw failure; } }),
		error => primaryFailure(error) === failure);
	assert.equal(fenced, true); assert.equal(target.events.at(-1), 'abort'); assert.equal(target.parts.length, 0);
	assert.equal(target.writable.locked, false);
});

test('held final verification stays joined to cancellation and successful verification precedes close', async () => {
	let enter!: () => void, release!: () => void;
	const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
	const target = destination(), stop = new AbortController(), reason = new Error('Cancel held fence'); let settled = false;
	const operation = exportPhotoCatalogArchiveV3(root(), [], [], null, [], { signal: stop.signal, writable: target.writable,
		async verifySource() { enter(); await held; } });
	void operation.then(() => { settled = true; }, () => { settled = true; });
	await entered; stop.abort(reason); await Promise.resolve(); assert.equal(settled, false); release();
	await assert.rejects(operation, error => primaryFailure(error) === reason); assert.equal(target.events.at(-1), 'abort');
	const successful = destination();
	await exportPhotoCatalogArchiveV3(root(), [], [], state(0, 7), [], { writable: successful.writable,
		async verifySource() { successful.events.push('verify'); } });
	assert.ok(successful.events.indexOf('verify') < successful.events.indexOf('close')); assert.equal(successful.writable.locked, false);
});

test('the admitted final verifier remains bound when caller options change during held enumeration', async () => {
	let enter!: () => void, release!: () => void;
	const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
	const target = destination(), failure = new Error('Captured inventory drift'); let verifies = 0;
	const options: { writable: WritableStream<Uint8Array>; verifySource?: () => Promise<void> } = {
		writable: target.writable, verifySource: async () => { verifies += 1; throw failure; },
	};
	async function* recipes() { enter(); await held; yield definition(); }
	const operation = exportPhotoCatalogArchiveV3(root(), [], [], state(1), recipes(), options);
	await entered; delete options.verifySource; release();
	await assert.rejects(operation, error => primaryFailure(error) === failure);
	assert.equal(verifies, 1); assert.equal(target.events.at(-1), 'abort'); assert.equal(target.writable.locked, false);
});
