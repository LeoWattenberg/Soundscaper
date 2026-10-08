/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { exportPhotoLibraryBackupV1, type PhotoLibraryBackupPortsV1 } from '../src/lightscaper/controller/photo-library-backup-v1.ts';
import { importPhotoCatalogArchiveV1 } from '../src/lightscaper/archive/catalog-archive-import.ts';
import { PHOTO_CATALOG_PACK_LIMITS_V1 } from '../src/lightscaper/archive/catalog-pack.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

async function fixture(count = 2, chunked = false) {
	const indexedDB = createInstrumentedIndexedDB();
	const suffix = crypto.randomUUID();
	const databaseName = `lightscaper-backup-catalog-${suffix}`;
	const mediaName = `lightscaper-backup-media-${suffix}`;
	const factory = indexedDB as unknown as IDBFactory;
	const media = new PhotoMediaStoreV1({ indexedDB: factory, databaseName: mediaName, locks: null, preferOpfs: false });
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB: factory, databaseName, verifyOriginal: media.verifyOriginal });
	const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: '東京 photo library', revision: 0, photoCount: 0,
		folders: [{ id: 'folder', name: '旅行', parentId: null }], keywords: [{ id: 'keyword', name: 'Landscape', parentId: null }],
		collections: [{ id: 'collection', name: 'Selected', kind: 'manual' }] });
	await catalog.createCatalog(root);
	let current = root;
	for (let offset = 0; offset < count; offset += 16) {
		const photos = [];
		for (let index = offset; index < Math.min(offset + 16, count); index++) {
			const original = photoArchiveFixture(index + 1, new Uint8Array([index % 256, 2, 3]));
			const photo = normalizePhotoDocumentV1({ ...original.photo, folderId: 'folder', keywordIds: ['keyword'], collectionIds: ['collection'],
				metadata: { ...original.photo.metadata, title: `Title ${index}`, caption: 'Line one\nLine two', captureTime: { local: '2026-10-08T12:00:00.000', offsetMinutes: null } } });
			if (chunked) {
				const writer = await media.mediaRepository.beginAssetWrite(photo.original.storageKey, { mimeType: photo.original.mimeType }, {
					expectedBytes: photo.original.byteLength, expectedSha256: photo.original.contentSha256 });
				try { await writer.write(new Uint8Array(await original.original.arrayBuffer())); await writer.commit(); }
				catch (error) { await writer.abort(); throw error; }
			} else { await media.mediaRepository.writeAsset(photo.original.storageKey, original.original); }
			await media.mediaRepository.catalogOriginals.retain(root.id, [{ photoId: photo.id, assetId: photo.original.storageKey,
				sourceId: photo.original.id, sha256: photo.original.contentSha256, size: photo.original.byteLength }]);
			photos.push(photo);
		}
		current = await catalog.publishPhotos(root.id, current.revision, photos);
	}
	const ports: PhotoLibraryBackupPortsV1 = { catalog,
		loadOriginal: (original, signal) => media.mediaRepository.loadAsset(original.storageKey, { signal, expectedSize: original.byteLength }) };
	return { indexedDB, catalog, media, ports, root: current, databaseName, mediaName, factory,
		close: async () => { await Promise.all([catalog.close(), media.close()]); } };
}

function destination() {
	const parts: Uint8Array<ArrayBuffer>[] = [];
	let aborted = false, closed = false;
	const writable = new WritableStream<Uint8Array>({
		write(bytes) { parts.push(new Uint8Array(bytes)); },
		abort() { aborted = true; parts.length = 0; }, close() { closed = true; },
	});
	return { writable, parts, aborted: () => aborted, closed: () => closed };
}

test('backup enumerates actual durable rows across a page and preserves every authored field and original', async () => {
	const f = await fixture(65);
	const observed = new Map<string, { photo: unknown; bytes: Uint8Array }>();
	let pageReads = 0, originalReads = 0;
	try {
		const before = await f.catalog.readSnapshot(f.root.id);
		const result = await exportPhotoLibraryBackupV1(f.root.id, { ...f.ports, catalog: {
			readSnapshot: (...args) => f.catalog.readSnapshot(...args), loadPhoto: (...args) => f.catalog.loadPhoto(...args),
			readSummaryPage: async (...args) => { pageReads++; const page = await f.catalog.readSummaryPage(...args); assert.ok(page.items.length <= 64); return page; },
		}, loadOriginal: async (...args) => { originalReads++; return f.ports.loadOriginal(...args); } });
		assert.ok(result.blob); assert.equal(result.byteLength, result.blob.size);
		assert.deepEqual(await importPhotoCatalogArchiveV1(result.blob, async () => ({
			async writePhoto(photo, chunks) {
				const parts = []; for await (const bytes of chunks) parts.push(new Uint8Array(bytes));
				observed.set(photo.id, { photo, bytes: new Uint8Array(await new Blob(parts).arrayBuffer()) });
			}, async publish() { assert.equal(observed.size, 65); }, async rollback() { assert.fail('The valid backup must publish.'); },
		})), f.root);
		assert.equal(pageReads, 2); assert.equal(originalReads, 65);
		for (const [photoId, entry] of observed) {
			const photo = await f.catalog.loadPhoto(f.root.id, photoId); assert.ok(photo); assert.deepEqual(entry.photo, photo);
			const body = await f.ports.loadOriginal(photo.original); assert.ok(body instanceof Blob);
			assert.deepEqual(entry.bytes, new Uint8Array(await body.arrayBuffer()));
		}
		assert.deepEqual(await f.catalog.readSnapshot(f.root.id), before);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await f.close(); }
});

test('streaming backup releases its destination and an empty durable catalog produces a valid Scape archive', async () => {
	const f = await fixture(0), target = destination();
	try {
		const result = await exportPhotoLibraryBackupV1(f.root.id, f.ports, { writable: target.writable });
		assert.equal(result.blob, null); assert.ok(result.byteLength > 0); assert.equal(target.closed(), true);
		assert.equal(target.writable.locked, false); assert.equal(target.aborted(), false);
		assert.deepEqual(await importPhotoCatalogArchiveV1(new Blob(target.parts), async () => ({
			async writePhoto() { assert.fail('Empty archives contain no originals.'); }, async publish() {}, async rollback() { assert.fail('Valid empty archive'); },
		})), f.root);
	} finally { await f.close(); }
});

test('a photo edited after its archived bytes were read refuses the complete mixed snapshot before destination close', async () => {
	const f = await fixture(2), target = destination();
	let reads = 0;
	try {
		await assert.rejects(exportPhotoLibraryBackupV1(f.root.id, { ...f.ports, loadOriginal: async (...args) => {
			if (++reads === 2) {
				const first = await f.catalog.loadPhoto(f.root.id, 'photo-1'); assert.ok(first);
				await f.catalog.savePhoto({ ...first, rating: 5 }, first.revision);
			}
			return f.ports.loadOriginal(...args);
		} }, { writable: target.writable }), failure => contains(failure, /revision changed/iu));
		assert.equal(target.closed(), false); assert.equal(target.aborted(), true); assert.equal(target.writable.locked, false);
		assert.equal((await f.catalog.loadPhoto(f.root.id, 'photo-1'))?.rating, 5);
		assert.equal((await f.catalog.loadCatalog(f.root.id))?.revision, f.root.revision);
	} finally { await f.close(); }
});

test('a summary that became stale before aggregate access refuses before reading any original', async () => {
	const f = await fixture(), target = destination();
	let originalReads = 0;
	try {
		await assert.rejects(exportPhotoLibraryBackupV1(f.root.id, { ...f.ports, catalog: {
			readSnapshot: (...args) => f.catalog.readSnapshot(...args), loadPhoto: (...args) => f.catalog.loadPhoto(...args),
			readSummaryPage: async (...args) => {
				const page = await f.catalog.readSummaryPage(...args), first = await f.catalog.loadPhoto(f.root.id, 'photo-1'); assert.ok(first);
				await f.catalog.savePhoto({ ...first, rating: 4 }, first.revision); return page;
			},
		}, loadOriginal: async (...args) => { originalReads++; return f.ports.loadOriginal(...args); } }, { writable: target.writable }), failure => contains(failure, /revision changed/iu));
		assert.equal(originalReads, 0); assert.equal(target.aborted(), true); assert.equal(target.closed(), false);
	} finally { await f.close(); }
});

test('an original that cannot fit an existing archive pack is refused before opening its body', async () => {
	const f = await fixture(1), target = destination();
	let reads = 0;
	try {
		await assert.rejects(exportPhotoLibraryBackupV1(f.root.id, { ...f.ports, catalog: {
			readSnapshot: (...args) => f.catalog.readSnapshot(...args), readSummaryPage: (...args) => f.catalog.readSummaryPage(...args),
			loadPhoto: async (...args) => {
				const photo = await f.catalog.loadPhoto(...args); assert.ok(photo);
				return normalizePhotoDocumentV1({ ...photo, original: { ...photo.original, byteLength: PHOTO_CATALOG_PACK_LIMITS_V1.maximumPackBytes } });
			},
		}, loadOriginal: async () => { reads++; throw new Error('Oversized body must not be opened.'); } }, { writable: target.writable }), failure => contains(failure, /cannot fit the bounded archive pack/iu));
		assert.equal(reads, 0); assert.equal(target.aborted(), true); assert.equal(target.closed(), false); assert.equal(target.writable.locked, false);
	} finally { await f.close(); }
});

test('backup rejects a changed durable media size before traversing any original chunks', async () => {
	const f = await fixture(1, true), target = destination();
	try {
		const before = await f.catalog.readSnapshot(f.root.id);
		const records = f.indexedDB.records(f.mediaName, 'mediaAssets') as { sourceId: string; size: number; mediaChunkBytes: number }[];
		const stored = records[0]; assert.ok(stored); assert.ok(stored.mediaChunkBytes > 0);
		const size = PHOTO_CATALOG_PACK_LIMITS_V1.maximumPackBytes;
		f.indexedDB.seedRecord(f.mediaName, 'mediaAssets', { ...stored, size, mediaChunkCount: Math.ceil(size / stored.mediaChunkBytes) });
		const cursors = f.indexedDB.stats.cursorRequests.length;
		await assert.rejects(exportPhotoLibraryBackupV1(f.root.id, f.ports, { writable: target.writable }), failure => contains(failure, /requested local media asset is missing/iu));
		assert.equal(f.indexedDB.stats.cursorRequests.slice(cursors).filter((entry: { store: string }) => entry.store === 'mediaAssetChunks').length, 0);
		assert.equal(target.aborted(), true); assert.equal(target.closed(), false); assert.equal(target.writable.locked, false);
		assert.deepEqual(await f.catalog.readSnapshot(f.root.id), before);
	} finally { await f.close(); }
});

test('missing bytes, wrong bytes and cancellation abort output while preserving the durable catalog and custody', async () => {
	for (const mode of ['missing', 'digest', 'cancel'] as const) {
		const f = await fixture(), target = destination(), controller = new AbortController();
		const expected = mode === 'missing' ? /photo backup original is missing/iu : mode === 'digest' ? /Photo pack original digest differs/iu : /Explicit backup cancellation/u;
		try {
			const before = await f.catalog.readSnapshot(f.root.id), roots = await f.media.mediaRepository.catalogOriginals.readPage({ catalogId: f.root.id });
			await assert.rejects(exportPhotoLibraryBackupV1(f.root.id, { ...f.ports, loadOriginal: async (...args) => {
				if (mode === 'missing') return null;
				if (mode === 'digest') return new Blob([new Uint8Array([9, 9, 9])]);
				controller.abort(new DOMException('Explicit backup cancellation', 'AbortError')); return f.ports.loadOriginal(...args);
			} }, { writable: target.writable, signal: controller.signal }), failure => contains(failure, expected));
			assert.equal(target.aborted(), true); assert.equal(target.closed(), false); assert.equal(target.writable.locked, false);
			assert.deepEqual(await f.catalog.readSnapshot(f.root.id), before);
			assert.deepEqual(await f.media.mediaRepository.catalogOriginals.readPage({ catalogId: f.root.id }), roots);
		} finally { await f.close(); }
	}
});

test('backup refuses hostile options before resource reads and preserves shared Blob output limits', async () => {
	const f = await fixture();
	let getters = 0, reads = 0;
	try {
		const hostile = { get signal() { getters++; return undefined; } };
		await assert.rejects(exportPhotoLibraryBackupV1(f.root.id, { ...f.ports, catalog: {
			readSnapshot: async (...args) => { reads++; return f.catalog.readSnapshot(...args); },
			loadPhoto: (...args) => f.catalog.loadPhoto(...args), readSummaryPage: (...args) => f.catalog.readSummaryPage(...args),
		} }, hostile), /data property/iu);
		assert.equal(getters, 0); assert.equal(reads, 0);
		const controller = new AbortController();
		Object.defineProperty(controller.signal, 'throwIfAborted', { value: () => { getters++; throw new Error('Caller signal method evaluated'); } });
		await assert.rejects(exportPhotoLibraryBackupV1(f.root.id, f.ports, { signal: controller.signal }), /native signal behavior/iu);
		assert.equal(getters, 0);
		await assert.rejects(exportPhotoLibraryBackupV1(f.root.id, f.ports, { maximumBlobBytes: 10 }), failure => contains(failure, /maximum/iu));
	} finally { await f.close(); }
});

test('an exact full terminal page is exhausted without retaining an IndexedDB transaction', async () => {
	const f = await fixture(64);
	let pages = 0;
	try {
		const result = await exportPhotoLibraryBackupV1(f.root.id, { ...f.ports, catalog: {
			readSnapshot: (...args) => f.catalog.readSnapshot(...args), loadPhoto: (...args) => f.catalog.loadPhoto(...args),
			readSummaryPage: async (...args) => { pages++; const page = await f.catalog.readSummaryPage(...args); assert.equal(f.indexedDB.stats.activeTransactions, 0); return page; },
		} });
		assert.ok(result.blob); assert.equal(result.document.catalog.photoCount, 64); assert.equal(pages, 2);
	} finally { await f.close(); }
});

test('cancellation during an original read waits for that borrowed operation before releasing output', async () => {
	const f = await fixture(), target = destination(), controller = new AbortController();
	let started!: () => void, release!: (value: Blob) => void, settled = false;
	const begun = new Promise<void>(resolve => { started = resolve; });
	const held = new Promise<Blob>(resolve => { release = resolve; });
	const pending = exportPhotoLibraryBackupV1(f.root.id, { ...f.ports, loadOriginal: async () => { started(); return held; } }, { writable: target.writable, signal: controller.signal });
	void pending.then(() => { settled = true; }, () => { settled = true; });
	try {
		await begun; controller.abort(new DOMException('Held backup read cancelled', 'AbortError'));
		await new Promise<void>(resolve => { setImmediate(resolve); });
		assert.equal(settled, false); assert.equal(target.writable.locked, true); assert.equal(target.aborted(), false);
		release(new Blob([new Uint8Array([0, 2, 3])]));
		await assert.rejects(pending, failure => contains(failure, /Held backup read cancelled/u));
		assert.equal(target.writable.locked, false); assert.equal(target.aborted(), true); assert.equal(target.closed(), false);
	} finally { release(new Blob()); await pending.catch(() => undefined); await f.close(); }
});

test('root edits and failed writable output each abort the complete archive and release the destination', async () => {
	for (const mode of ['root', 'write'] as const) {
		const f = await fixture();
		let aborted = false, closed = false;
		const writable = new WritableStream<Uint8Array>({
			write() { if (mode === 'write') throw new Error('Disk output failed'); },
			abort() { aborted = true; }, close() { closed = true; },
		});
		try {
			let reads = 0;
			await assert.rejects(exportPhotoLibraryBackupV1(f.root.id, { ...f.ports, loadOriginal: async (...args) => {
				if (mode === 'root' && ++reads === 1) await f.catalog.saveCatalog({ ...f.root, name: 'Changed catalog title' }, f.root.revision);
				return f.ports.loadOriginal(...args);
			} }, { writable }), failure => contains(failure, mode === 'root' ? /revision changed/iu : /Disk output failed/u));
			assert.equal(writable.locked, false); assert.equal(closed, false);
			// A native stream already errored by its write callback does not invoke
			// the sink abort callback; its released lock is the cleanup witness.
			assert.equal(aborted, mode === 'root');
		} finally { await f.close(); }
	}
});

function contains(value: unknown, pattern: RegExp): boolean {
	return value instanceof Error && (pattern.test(value.message) || (value instanceof AggregateError && value.errors.some(error => contains(error, pattern))));
}
