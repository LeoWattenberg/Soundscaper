/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { MediaAssetLoadRepository, type MediaAssetBodyLoader, type MediaAssetLoadOptions } from '../src/common/editor/storage/media-asset-load-repository.ts';
import { MediaAssetLifecycleCoordinator } from '../src/common/editor/storage/media-asset-lifecycle-coordinator.ts';
import { MediaRepository } from '../src/common/editor/storage/media-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import type { StorageRecord } from '../src/common/editor/storage/media-records.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

class CountingLifecycle extends MediaAssetLifecycleCoordinator {
	registrations = 0;
	override register(...args: Parameters<MediaAssetLifecycleCoordinator['register']>) {
		this.registrations++; return super.register(...args);
	}
}

function fixture(context: TestContext) {
	const memory = getMemoryDatabase(`expected-media-size-${crypto.randomUUID()}`), body = new Blob(['raw']);
	const lifecycle = new CountingLifecycle(), loaded: StorageRecord[] = [];
	let databaseReads = 0;
	let readDatabase: () => Promise<IDBDatabase | null> = async () => null;
	const port = { memory, database: () => { databaseReads++; return readDatabase(); } };
	const loader: MediaAssetBodyLoader = { async load(record) { loaded.push(record); return body; } };
	const repository = new MediaAssetLoadRepository(port, loader, lifecycle);
	memory.mediaAssets.set('original', { sourceId: 'original', storage: 'indexeddb-blob', size: body.size, blob: body });
	context.after(async () => { const maintenance = lifecycle.beginMaintenance({ permanent: true }); await maintenance.abortActive(); });
	return { memory, body, lifecycle, loaded, repository, databaseReads: () => databaseReads,
		readDatabase: (next: typeof readDatabase) => { readDatabase = next; } };
}

test('a requested size mismatch refuses the authoritative stored row before opening its body', async context => {
	const f = fixture(context);
	await assert.rejects(f.repository.load('original', { expectedSize: 4 }), /media asset is missing/iu);
	assert.equal(f.loaded.length, 0); assert.equal(f.databaseReads(), 1); assert.equal(f.lifecycle.registrations, 1);
	assert.equal((f.memory.mediaAssets.get('original') as StorageRecord).size, 3);
	assert.equal((await f.repository.load('original', { expectedSize: 3 }))?.size, 3);
	assert.equal(f.loaded.length, 1); assert.equal(f.loaded[0]?.size, 3);
});

test('expected size is captured before the asynchronous storage read and checked against that exact read', async context => {
	const f = fixture(context), options = { expectedSize: 3 };
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	f.readDatabase(async () => { await gate; return null; });
	const pending = f.repository.load('original', options);
	options.expectedSize = 4; release();
	assert.equal((await pending)?.size, 3);
	f.readDatabase(async () => {
		f.memory.mediaAssets.set('original', { sourceId: 'original', size: 4, blob: f.body }); return null;
	});
	await assert.rejects(f.repository.load('original', { expectedSize: 3 }), /media asset is missing/iu);
	assert.equal(f.loaded.length, 1);
});

test('invalid requested sizes refuse before lifecycle admission or database access', context => {
	const f = fixture(context);
	for (const expectedSize of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, null, '3', true]) {
		assert.throws(() => f.repository.load('original', { expectedSize } as unknown as MediaAssetLoadOptions), /nonnegative safe integer/iu);
	}
	assert.equal(f.lifecycle.registrations, 0); assert.equal(f.databaseReads(), 0); assert.equal(f.loaded.length, 0);
});

test('omitted sizes preserve ordinary loads and zero is an admitted exact size', async context => {
	const f = fixture(context);
	assert.equal((await f.repository.load('original'))?.size, 3);
	assert.equal((await f.repository.load('original', { expectedSize: undefined }))?.size, 3);
	const memory = getMemoryDatabase(`expected-empty-media-${crypto.randomUUID()}`), lifecycle = new MediaAssetLifecycleCoordinator();
	const empty = new Blob(); memory.mediaAssets.set('empty', { sourceId: 'empty', size: 0, blob: empty });
	const repository = new MediaAssetLoadRepository({ memory, database: async () => null }, { async load() { return empty; } }, lifecycle);
	assert.equal((await repository.load('empty', { expectedSize: 0 }))?.size, 0);
	await assert.rejects(f.repository.load('original', { expectedSize: 0 }), /media asset is missing/iu);
	assert.equal(f.loaded.length, 2);
});

test('missing rows still return null and provenance or invalid stored size still refuse without a body read', async context => {
	const f = fixture(context);
	assert.equal(await f.repository.load('absent', { expectedSize: 3 }), null);
	assert.equal(await f.repository.load('absent', { expectedSize: Number.MAX_SAFE_INTEGER }), null);
	for (const extra of [{ size: -1 }, { size: 1.5 }, { size: Number.NaN }, { size: '3' },
		{ mediaContentDigestVersion: 2, mediaContentToken: 'invalid' }]) {
		f.memory.mediaAssets.set('original', { sourceId: 'original', size: 3, blob: f.body, ...extra });
		await assert.rejects(f.repository.load('original', { expectedSize: 3 }), /media asset is missing/iu);
	}
	assert.equal(f.loaded.length, 0);
});

test('an exact size does not bypass cancellation or loaded-body size verification', async context => {
	const f = fixture(context), controller = new AbortController(), reason = new DOMException('Requested media cancelled', 'AbortError');
	controller.abort(reason);
	await assert.rejects(f.repository.load('original', { expectedSize: 3, signal: controller.signal }), failure => failure === reason);
	assert.equal(f.databaseReads(), 0); assert.equal(f.loaded.length, 0);
	f.memory.mediaAssets.set('original', { sourceId: 'original', size: 4, blob: f.body });
	await assert.rejects(f.repository.load('original', { expectedSize: 4 }), /media asset is missing/iu);
	assert.equal(f.loaded.length, 1);
});

test('actual IndexedDB chunk storage refuses a size mismatch before any chunk inventory or body request', async context => {
	const indexedDB = createInstrumentedIndexedDB(), databaseName = `expected-size-chunks-${crypto.randomUUID()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	const memory = getMemoryDatabase(databaseName);
	const media = new MediaRepository({ memory, database: async () => database }, new OpfsRepository({ preferOpfs: false }));
	context.after(async () => { const maintenance = media.beginAssetMaintenance({ permanent: true }); await maintenance.abortActive(); database.close(); });
	const bytes = Uint8Array.of(10, 20, 30);
	const writer = await media.beginAssetWrite('original', { mimeType: 'image/png' }, {
		expectedBytes: bytes.byteLength, expectedSha256: createHash('sha256').update(bytes).digest('hex') });
	try { await writer.write(bytes); await writer.commit(); } catch (error) { await writer.abort(); throw error; }
	const before = { get: indexedDB.stats.getRequests.length, cursor: indexedDB.stats.cursorRequests.length,
		all: indexedDB.stats.getAllRequests.length, keys: indexedDB.stats.keyCursorRequests.length };
	await assert.rejects(media.loadAsset('original', { expectedSize: 4 }), /media asset is missing/iu);
	assert.deepEqual(indexedDB.stats.getRequests.slice(before.get).map((entry: { store: string }) => entry.store), ['mediaAssets']);
	assert.equal(indexedDB.stats.cursorRequests.length, before.cursor);
	assert.equal(indexedDB.stats.getAllRequests.length, before.all); assert.equal(indexedDB.stats.keyCursorRequests.length, before.keys);
	assert.equal(indexedDB.stats.activeTransactions, 0);
	const loaded = await media.loadAsset('original', { expectedSize: bytes.byteLength }); assert.ok(loaded);
	assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), bytes);
	const ordinary = await media.loadAsset('original'); assert.ok(ordinary);
	assert.deepEqual(new Uint8Array(await ordinary.arrayBuffer()), bytes);
});
