/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createHash } from 'node:crypto';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { MediaCatalogOriginalRepositoryV1 } from '../src/common/editor/storage/media-catalog-original-repository.ts';
import { CATALOG_ORIGINAL_ROOT_STORE_NAME } from '../src/common/editor/storage/media-catalog-original-schema.ts';
import { MediaAssetChunkRecords } from '../src/common/editor/storage/media-asset-chunk-records.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

function fixture() {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `catalog-custody-${crypto.randomUUID()}`;
	const create = () => createProjectStore({ indexedDB, databaseName, memoryFallback: false, preferOpfs: false });
	return { indexedDB, databaseName, create };
}

async function original(store: ReturnType<typeof createProjectStore>, photoId = 'photo', assetId = 'original-file') {
	const metadata = await store.writeMediaAsset(assetId, new Blob(['original camera file bytes']));
	return { photoId, assetId, sourceId: 'logical-camera-source', sha256: String(metadata.sha256), size: Number(metadata.size) };
}

test('catalog custody survives reopen and protects direct deletion, pruning and clear', async () => {
	const { create } = fixture();
	const first = create();
	const reference = await original(first);
	await first.mediaRepository.catalogOriginals.retain('catalog', [reference]);
	await first.close();
	const reopened = create();
	try {
		const page = await reopened.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog' });
		assert.equal(page.roots[0]?.assetId, reference.assetId);
		assert.equal(page.roots[0]?.sourceId, reference.sourceId);
		await assert.rejects(reopened.deleteMediaAsset(reference.assetId), /catalog original/u);
		const result = await reopened.pruneUnreferencedSources({ minimumAgeMs: 0, now: Date.now() + 172_800_000 });
		assert.deepEqual(result.deletedSourceIds, []);
		await assert.rejects(reopened.clear(), /catalog original/u);
		assert.ok(await reopened.loadMediaAsset(reference.assetId));
		await reopened.mediaRepository.catalogOriginals.release('catalog', [reference.photoId]);
		assert.ok(await reopened.getMediaAssetMetadata(reference.assetId));
		await reopened.deleteMediaAsset(reference.assetId);
		assert.equal(await reopened.getMediaAssetMetadata(reference.assetId), null);
	} finally { await reopened.close(); }
});

test('recoverable import roots promote without releasing other owners or deleting payloads', async () => {
	const { create } = fixture();
	const first = create();
	const reference = await original(first);
	await first.mediaRepository.catalogOriginals.stage('catalog', 'import-1', [reference]);
	await first.mediaRepository.catalogOriginals.stage('other-catalog', 'import-2', [{ ...reference, photoId: 'other-photo' }]);
	await first.close();
	const reopened = create();
	try {
		const custody = reopened.mediaRepository.catalogOriginals;
		assert.equal((await custody.readPage({ catalogId: 'catalog', importId: 'import-1' })).roots.length, 1);
		await custody.promote('catalog', 'import-1', ['photo']);
		await custody.releaseStaged('catalog', 'import-1', ['photo']);
		assert.equal((await custody.readPage({ catalogId: 'catalog' })).roots.length, 1);
		await custody.release('catalog', ['photo']);
		await assert.rejects(reopened.deleteMediaAsset(reference.assetId), /catalog original/u);
		await custody.releaseStaged('other-catalog', 'import-2', ['other-photo']);
		assert.ok(await reopened.loadMediaAsset(reference.assetId));
	} finally { await reopened.close(); }
});

test('root batches roll back on mismatched custody, write failure and cancellation', async () => {
	const { indexedDB, create } = fixture();
	const store = create();
	try {
		const reference = await original(store);
		const custody = store.mediaRepository.catalogOriginals;
		await assert.rejects(custody.retain('catalog', [reference, { ...reference, photoId: 'bad', sha256: '0'.repeat(64) }]), /identity/u);
		assert.deepEqual((await custody.readPage({ catalogId: 'catalog' })).roots, []);
		indexedDB.failNextPutForStore(CATALOG_ORIGINAL_ROOT_STORE_NAME, new Error('planned root write failure'));
		await assert.rejects(custody.stage('catalog', 'import', [reference]), /planned root write failure/u);
		assert.deepEqual((await custody.readPage({ catalogId: 'catalog', importId: 'import' })).roots, []);
		await assert.rejects(custody.retain('catalog', [reference], { signal: AbortSignal.abort() }), { name: 'AbortError' });
		await store.deleteMediaAsset(reference.assetId);
	} finally { await store.close(); }
});

test('idempotent retention pins immutable originals and promotion rollback preserves staging', async () => {
	const { indexedDB, create } = fixture();
	const store = create();
	try {
		const reference = await original(store);
		const custody = store.mediaRepository.catalogOriginals;
		await custody.retain('catalog', [reference]);
		await custody.retain('catalog', [reference]);
		await assert.rejects(custody.retain('catalog', [{ ...reference, sourceId: 'replacement-source' }]), /immutable/u);
		await custody.stage('catalog', 'import', [{ ...reference, photoId: 'copy' }]);
		indexedDB.failNextPutForStore(CATALOG_ORIGINAL_ROOT_STORE_NAME, new Error('planned promotion failure'));
		await assert.rejects(custody.promote('catalog', 'import', ['copy']), /planned promotion failure/u);
		assert.equal((await custody.readPage({ catalogId: 'catalog', importId: 'import' })).roots.length, 1);
		assert.equal((await custody.readPage({ catalogId: 'catalog' })).roots.length, 1);
		await custody.release('catalog', ['photo']);
		await assert.rejects(store.deleteMediaAsset(reference.assetId), /catalog original/u);
	} finally { await store.close(); }
});

test('indexed digest pages return verified matching original identities and skip legacy claims', async () => {
	const { indexedDB, databaseName, create } = fixture();
	const store = create();
	try {
		const reference = await original(store, 'photo', 'verified');
		const row = indexedDB.records(databaseName, 'mediaAssets')[0];
		indexedDB.seedRecord(databaseName, 'mediaAssets', { ...row, sourceId: 'legacy', mediaContentDigestVersion: 0 });
		indexedDB.seedRecord(databaseName, 'mediaAssets', { ...row, sourceId: 'malformed', mediaContentToken: 'bad' });
		indexedDB.stats.getAllRequests.length = 0;
		const page = await store.mediaRepository.catalogOriginals.findDigestPage(reference.sha256);
		assert.deepEqual(page.matches.map(({ assetId }) => assetId), ['verified']);
		assert.equal(page.matches[0]?.size, reference.size);
		assert.equal(Object.hasOwn(page.matches[0] ?? {}, 'blob'), false);
		assert.equal(indexedDB.stats.getAllRequests.length, 0);
		await assert.rejects(store.mediaRepository.catalogOriginals.retain('catalog', [{ ...reference, assetId: 'legacy' }]), /verified/u);
	} finally { await store.close(); }
});

test('digest and recovery pagination bound reads while progressing through refused rows', async () => {
	const { indexedDB, databaseName, create } = fixture();
	const store = create();
	try {
		const reference = await original(store, 'photo', 'z-verified');
		const row = indexedDB.records(databaseName, 'mediaAssets')[0];
		for (let index = 0; index < 130; index += 1) indexedDB.seedRecord(databaseName, 'mediaAssets', {
			...row, sourceId: `a-${String(index).padStart(3, '0')}`, mediaContentDigestVersion: 0,
		});
		const first = await store.mediaRepository.catalogOriginals.findDigestPage(reference.sha256);
		assert.equal(first.matches.length, 0);
		assert.ok(first.afterAssetId);
		const second = await store.mediaRepository.catalogOriginals.findDigestPage(reference.sha256, first.afterAssetId);
		assert.equal(second.matches.length, 0);
		assert.ok(second.afterAssetId);
		const third = await store.mediaRepository.catalogOriginals.findDigestPage(reference.sha256, second.afterAssetId);
		assert.deepEqual(third.matches.map(({ assetId }) => assetId), ['z-verified']);
		assert.equal(third.afterAssetId, null);
		for (let index = 0; index < 80; index += 16) await store.mediaRepository.catalogOriginals.stage('catalog', 'import',
			Array.from({ length: 16 }, (_, offset) => ({ ...reference, photoId: `p-${String(index + offset).padStart(3, '0')}` })));
		const page = await store.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog', importId: 'import' });
		assert.equal(page.roots.length, 64);
		assert.ok(page.afterKey);
		const tail = await store.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog', importId: 'import', afterKey: page.afterKey });
		assert.equal(tail.roots.length, 16);
		assert.equal(tail.afterKey, null);
	} finally { await store.close(); }
});

test('custody rejects unavailable durable storage and bounded admission errors', async () => {
	const custody = new MediaCatalogOriginalRepositoryV1({ memory: getMemoryDatabase(crypto.randomUUID()), database: async () => null });
	await assert.rejects(custody.readPage({ catalogId: 'catalog' }), /durable/u);
	await assert.rejects(custody.retain('catalog', Array.from({ length: 17 }, (_, index) => ({
		photoId: `photo-${index}`, sourceId: 'source', assetId: 'asset', sha256: '0'.repeat(64), size: 0,
	}))), /16/u);
	let getterCalls = 0;
	const hostile = Object.defineProperty({}, 'photoId', { enumerable: true, get() { getterCalls += 1; return 'photo'; } });
	await assert.rejects(custody.retain('catalog', [hostile]), /record|field|reference/u);
	assert.equal(getterCalls, 0);
});

test('shared v1 migration preserves original rows and appends durable custody indexes', async () => {
	const { indexedDB, databaseName } = fixture();
	const v1Factory = { open: (name: string) => indexedDB.open(name, 1) };
	const baseline = await openDatabase(v1Factory as unknown as IDBFactory, databaseName);
	assert.equal(baseline.version, 1);
	const legacy = { sourceId: 'legacy', storage: 'indexeddb-blob', blob: new Blob(['legacy file']), sha256: 'a'.repeat(64), size: 11 };
	indexedDB.seedRecord(databaseName, 'mediaAssets', legacy);
	indexedDB.seedRecord(databaseName, 'projects', { id: 'project', project: { sourceId: 'legacy' } });
	baseline.close();
	const upgraded = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	assert.equal(upgraded.version, 2);
	assert.deepEqual(indexedDB.records(databaseName, 'mediaAssets'), [legacy]);
	assert.equal(indexedDB.recordCount(databaseName, 'projects'), 1);
	assert.equal(upgraded.transaction('mediaAssets').objectStore('mediaAssets').indexNames.contains('sha256'), true);
	assert.equal(upgraded.objectStoreNames.contains(CATALOG_ORIGINAL_ROOT_STORE_NAME), true);
	upgraded.close();
});

test('authoritative roots protect zero-hint originals while unrelated caller hints cannot retain media', async () => {
	const { indexedDB, databaseName, create } = fixture();
	const store = create();
	try {
		const reference = await original(store);
		await store.mediaRepository.catalogOriginals.retain('catalog', [reference]);
		const row = indexedDB.records(databaseName, 'mediaAssets')[0];
		indexedDB.seedRecord(databaseName, 'mediaAssets', { ...row, catalogRootCount: 0 });
		const unrelated = await store.writeMediaAsset('unrelated', new Blob(['unrelated']), { catalogRootCount: 999 });
		assert.equal(Object.hasOwn(unrelated, 'catalogRootCount'), false);
		await assert.rejects(store.deleteSource(reference.assetId), /catalog original/u);
		const result = await store.pruneUnreferencedSources({ minimumAgeMs: 0, now: Date.now() + 172_800_000 });
		assert.deepEqual(result.deletedSourceIds, ['unrelated']);
		assert.ok(await store.loadMediaAsset(reference.assetId));
	} finally { await store.close(); }
});

test('owned streamed publication rollback and temporary cleanup preserve a catalog original', async () => {
	const { indexedDB, databaseName, create } = fixture();
	const store = create();
	try {
		const bytes = Uint8Array.of(7, 5, 3, 1);
		const sha256 = createHash('sha256').update(bytes).digest('hex');
		const writer = await store.beginMediaAssetWrite('streamed', {}, { expectedBytes: bytes.length, expectedSha256: sha256 });
		await writer.write(bytes);
		const publication = await writer.commitOwned();
		await store.mediaRepository.catalogOriginals.retain('catalog', [{ photoId: 'photo', assetId: 'streamed', sourceId: 'source', sha256, size: bytes.length }]);
		for (const row of indexedDB.records(databaseName, 'mediaAssetChunks')) indexedDB.seedRecord(databaseName, 'mediaAssetChunks', { ...row, createdAt: 0 });
		indexedDB.stats.getAllRequests.length = 0;
		await store.cleanupTemporaryAssets({ maximumAgeMs: 0 });
		assert.equal(indexedDB.stats.getAllRequests.some(({ store }: { store: string }) => store === 'mediaAssets'), false);
		await assert.rejects(publication.discardIfCurrent(), /catalog original/u);
		const retained = await store.loadMediaAsset('streamed');
		assert.ok(retained);
		assert.deepEqual(new Uint8Array(await retained.arrayBuffer()), bytes);
	} finally { await store.close(); }
});

test('prune advances over complete retained pages without accumulating the catalog inventory', async () => {
	const { indexedDB, databaseName, create } = fixture();
	const store = create();
	try {
		const reference = await original(store);
		await store.mediaRepository.catalogOriginals.retain('catalog', [reference]);
		const media = indexedDB.records(databaseName, 'mediaAssets')[0];
		const root = indexedDB.records(databaseName, CATALOG_ORIGINAL_ROOT_STORE_NAME)[0];
		for (let index = 0; index < 130; index += 1) {
			const photoId = `a-${String(index).padStart(3, '0')}`;
			indexedDB.seedRecord(databaseName, 'mediaAssets', { ...media, sourceId: photoId });
			indexedDB.seedRecord(databaseName, CATALOG_ORIGINAL_ROOT_STORE_NAME, { ...root,
				photoId, assetId: photoId, key: JSON.stringify(['catalog', null, photoId]),
			});
		}
		await store.writeMediaAsset('z-unrelated', new Blob(['not in catalog']));
		indexedDB.stats.getAllRequests.length = 0;
		const result = await store.pruneUnreferencedSources({ minimumAgeMs: 0, now: Date.now() + 172_800_000 });
		assert.deepEqual(result.deletedSourceIds, ['z-unrelated']);
		assert.deepEqual(result.retainedSourceIds, []);
		assert.equal(indexedDB.recordCount(databaseName, 'mediaAssets'), 131);
		assert.equal(indexedDB.stats.getAllRequests.some(({ store }: { store: string }) => store === 'mediaAssets'), false);
		await assert.rejects(store.clear(), /catalog original/u);
		assert.equal(indexedDB.stats.getAllRequests.some(({ store }: { store: string }) => store === 'mediaAssets'), false);
	} finally { await store.close(); }
});

test('failed root release rolls back root and count; interrupted admission does not publish', async () => {
	const { indexedDB, databaseName, create } = fixture();
	const store = create();
	try {
		const reference = await original(store);
		const custody = store.mediaRepository.catalogOriginals;
		await custody.retain('catalog', [reference]);
		indexedDB.failNextPutForStore('mediaAssets', new Error('planned count failure'));
		await assert.rejects(custody.release('catalog', ['photo']), /planned count failure/u);
		assert.equal((await custody.readPage({ catalogId: 'catalog' })).roots.length, 1);
		assert.equal(indexedDB.records(databaseName, 'mediaAssets')[0]?.catalogRootCount, 1);
		const controller = new AbortController();
		indexedDB.onNextGetForStore('mediaAssets', () => controller.abort());
		await assert.rejects(custody.stage('catalog', 'interrupted', [{ ...reference, photoId: 'copy' }], { signal: controller.signal }));
		assert.equal((await custody.readPage({ catalogId: 'catalog', importId: 'interrupted' })).roots.length, 0);
	} finally { await store.close(); }
});

test('stale chunk deletion rereads the current row and checks current token references', async () => {
	const { indexedDB, databaseName } = fixture();
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	const port = { memory: getMemoryDatabase(databaseName), database: async () => database };
	indexedDB.seedRecord(databaseName, 'mediaAssetChunks', { key: 'chunk', mediaChunkToken: 'old-token', createdAt: 0 });
	indexedDB.onNextGetForStore('mediaAssetChunks', () => {
		indexedDB.seedRecord(databaseName, 'mediaAssetChunks', { key: 'chunk', mediaChunkToken: 'new-token', createdAt: 10 });
	});
	await new MediaAssetChunkRecords(port).cleanupStale(new Set(), 5);
	assert.equal(indexedDB.recordCount(databaseName, 'mediaAssetChunks'), 1);
	assert.equal(indexedDB.records(databaseName, 'mediaAssetChunks')[0]?.mediaChunkToken, 'new-token');
	database.close();
});

test('v2 migration failure preserves v1 rows and schema for a clean retry', async () => {
	const { indexedDB, databaseName } = fixture();
	const baseline = await openDatabase({ open: (name: string) => indexedDB.open(name, 1) } as unknown as IDBFactory, databaseName);
	const row = { sourceId: 'legacy', storage: 'indexeddb-blob', blob: new Blob(['unchanged original']), size: 18 };
	indexedDB.seedRecord(databaseName, 'mediaAssets', row);
	baseline.close();
	const planned = new Error('planned v2 index failure');
	const factory = { open(name: string, version: number) {
		const opening = indexedDB.open(name, version) as unknown as IDBOpenDBRequest;
		return new Proxy(opening, { set(target, key, value: unknown) {
			if (key !== 'onupgradeneeded') { Reflect.set(target, key, value); return true; }
			target.onupgradeneeded = (event: IDBVersionChangeEvent) => {
				const transaction = target.transaction;
				assert.ok(transaction);
				const objectStore = transaction.objectStore.bind(transaction);
				transaction.objectStore = (storeName: string) => {
					const store = objectStore(storeName);
					if (storeName === 'mediaAssets') store.createIndex = () => { throw planned; };
					return store;
				};
				assert.equal(typeof value, 'function');
				Reflect.apply(value as (event: IDBVersionChangeEvent) => void, target, [event]);
			};
			return true;
		} });
	} };
	await assert.rejects(openDatabase(factory as unknown as IDBFactory, databaseName), (error: unknown) => error === planned);
	assert.deepEqual(indexedDB.records(databaseName, 'mediaAssets'), [row]);
	const previous = await openDatabase({ open: (name: string) => indexedDB.open(name, 1) } as unknown as IDBFactory, databaseName);
	assert.equal(previous.version, 1);
	assert.equal(previous.objectStoreNames.contains(CATALOG_ORIGINAL_ROOT_STORE_NAME), false);
	assert.equal(previous.transaction('mediaAssets').objectStore('mediaAssets').indexNames.contains('sha256'), false);
	previous.close();
	const retried = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	assert.equal(retried.version, 2);
	assert.deepEqual(indexedDB.records(databaseName, 'mediaAssets'), [row]);
	retried.close();
});

test('OPFS original custody survives indexed temporary cleanup without a media inventory', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `catalog-opfs-custody-${crypto.randomUUID()}`;
	const files = new Map<string, Blob>();
	const fileHandle = (path: string) => ({ kind: 'file',
		async createWritable() {
			const parts: BlobPart[] = [];
			return { async write(part: BlobPart) { parts.push(part); }, async close() { files.set(path, new Blob(parts)); }, async abort() { files.delete(path); } };
		},
		async getFile() {
			const file = files.get(path);
			if (!file) throw new DOMException('missing', 'NotFoundError');
			Object.defineProperty(file, 'lastModified', { configurable: true, value: 0 });
			return file;
		},
	});
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string, options: { create?: boolean } = {}) {
			if (!files.has(path) && !options.create) throw new DOMException('missing', 'NotFoundError');
			return fileHandle(path);
		},
		async removeEntry(path: string) { files.delete(path); },
		async *entries() { for (const path of files.keys()) yield [path, fileHandle(path)]; },
	};
	const create = () => createProjectStore({ indexedDB, databaseName, memoryFallback: false,
		preferOpfs: true, opfsRoot: directory as unknown as FileSystemDirectoryHandle });
	const first = create();
	const reference = await original(first);
	await first.mediaRepository.catalogOriginals.stage('catalog', 'recoverable', [reference]);
	await first.close();
	const reopened = create();
	try {
		files.set('unrelated-expired-file', new Blob(['orphan']));
		indexedDB.stats.getAllRequests.length = 0;
		await reopened.cleanupTemporaryAssets({ maximumAgeMs: 0 });
		assert.equal(files.size, 1);
		assert.equal(files.has('unrelated-expired-file'), false);
		assert.equal(indexedDB.stats.getAllRequests.some(({ store }: { store: string }) => store === 'mediaAssets'), false);
		const body = await reopened.loadMediaAsset(reference.assetId);
		assert.ok(body);
		assert.equal(new TextDecoder().decode(await body.arrayBuffer()), 'original camera file bytes');
		await assert.rejects(reopened.deleteMediaAsset(reference.assetId), /catalog original/u);
	} finally { await reopened.close(); }
});

test('memory fallback temporary cleanup preserves committed streamed media chunks', async () => {
	const databaseName = `catalog-memory-cleanup-${crypto.randomUUID()}`;
	const store = createProjectStore({ indexedDB: null, databaseName, memoryFallback: true, preferOpfs: false });
	try {
		const bytes = Uint8Array.of(9, 7, 5);
		const writer = await store.beginMediaAssetWrite('original', {}, { expectedBytes: bytes.length,
			expectedSha256: createHash('sha256').update(bytes).digest('hex') });
		await writer.write(bytes);
		await writer.commit();
		const memory = getMemoryDatabase(databaseName);
		for (const [key, row] of memory.mediaAssetChunks) memory.mediaAssetChunks.set(key, { ...(row as Record<string, unknown>), createdAt: 0 });
		await store.cleanupTemporaryAssets({ maximumAgeMs: 0 });
		assert.equal(memory.mediaAssetChunks.size, 1);
		const retained = await store.loadMediaAsset('original');
		assert.ok(retained);
		assert.deepEqual(new Uint8Array(await retained.arrayBuffer()), bytes);
	} finally { await store.close(); }
});

test('digest continuations advance over unsupported long identifiers and never stringify foreign keys', async () => {
	const { indexedDB, databaseName, create } = fixture();
	const store = create();
	try {
		const reference = await original(store, 'photo', 'z-valid');
		const row = indexedDB.records(databaseName, 'mediaAssets')[0];
		for (let index = 0; index < 65; index += 1) indexedDB.seedRecord(databaseName, 'mediaAssets', {
			...row, sourceId: 'a'.repeat(257) + String(index).padStart(3, '0'),
		});
		indexedDB.seedRecord(databaseName, 'mediaAssets', { ...row, sourceId: 7 });
		const custody = store.mediaRepository.catalogOriginals;
		const first = await custody.findDigestPage(reference.sha256);
		assert.deepEqual(first.matches, []);
		assert.ok(first.afterAssetId);
		const tail = await custody.findDigestPage(reference.sha256, first.afterAssetId);
		assert.deepEqual(tail.matches.map(({ assetId }) => assetId), ['z-valid']);
		assert.equal(tail.afterAssetId, null);
	} finally { await store.close(); }
});

test('media maintenance aborts and drains an admitted custody change before close', async () => {
	const { create } = fixture();
	const store = create();
	try {
		const reference = await original(store);
		const pending = store.mediaRepository.catalogOriginals.stage('catalog', 'import', [reference]);
		const outcome = pending.then(() => 'unsafe root publication', (error: unknown) => error);
		const maintenance = store.mediaRepository.beginAssetMaintenance({ permanent: true });
		await maintenance.abortActive();
		assert.equal((await outcome as Error).name, 'AbortError');
		await assert.rejects(store.mediaRepository.catalogOriginals.retain('catalog', [reference]), /closed/u);
	} finally { await store.close(); }
});

test('media maintenance joins custody cancellation after the write transaction captured its database', async () => {
	const { indexedDB, databaseName, create } = fixture();
	const store = create();
	try {
		const reference = await original(store);
		let draining: Promise<void> | undefined;
		indexedDB.onNextGetForStore('mediaAssets', () => {
			draining = store.mediaRepository.beginAssetMaintenance({ permanent: true }).abortActive();
		});
		await assert.rejects(store.mediaRepository.catalogOriginals.stage('catalog', 'captured', [reference]));
		assert.ok(draining);
		await draining;
		assert.equal(indexedDB.recordCount(databaseName, CATALOG_ORIGINAL_ROOT_STORE_NAME), 0);
		assert.equal(indexedDB.records(databaseName, 'mediaAssets')[0]?.catalogRootCount, undefined);
	} finally { await store.close(); }
});
