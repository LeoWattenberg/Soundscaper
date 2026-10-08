/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { MediaPublicationReconciliationError } from '../src/common/editor/storage/media-asset-owned-publication.ts';
import { MediaAssetCleanupError } from '../src/common/editor/storage/media-asset-cleanup-error.ts';
import { MediaRepository } from '../src/common/editor/storage/media-repository.ts';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import type { OpfsSyncStoragePort } from '../src/common/editor/storage/opfs-sync-worker-client.ts';
import { createRepairFixture, assertNoRepairLease, deferred, REPAIR_BYTES, type RepairFixture } from './helpers/media-catalog-original-repair-fixture.ts';

test('a changed existing locator refuses after close without touching either retained body', async context => {
	const f = await createRepairFixture(context, 'opfs'), close = f.opfs.hold('close');
	const pending = f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]));
	try {
		await close.entered;
		f.opfs.files.set('concurrent-original.blob', new Blob([REPAIR_BYTES]));
		const winner = { ...f.row(), path: 'concurrent-original.blob' };
		f.indexedDB.seedRecord(f.databaseName, 'mediaAssets', winner); const roots = f.roots(); close.release();
		await assert.rejects(pending, /locator.*changed/iu);
		assert.deepEqual(f.row(), winner); assert.deepEqual(f.roots(), roots); assert.equal(f.opfs.files.size, 2); assertNoRepairLease(f);
	} finally { close.release(); await pending.catch(() => undefined); }
});

test('an absent-row capture cannot replace a row that appears while staging', async context => {
	const f = await createRepairFixture(context, 'opfs'), original = f.row()!;
	await f.removeRow(); const close = f.opfs.hold('close');
	const pending = f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]));
	try {
		await close.entered; f.indexedDB.seedRecord(f.databaseName, 'mediaAssets', original); close.release();
		await assert.rejects(pending, /locator.*changed/iu);
		assert.deepEqual(f.row(), original); assert.equal(f.opfs.files.size, 1); assertNoRepairLease(f);
	} finally { close.release(); await pending.catch(() => undefined); }
});

test('selected-root release while staging refuses repair and preserves the authoritative release', async context => {
	const f = await createRepairFixture(context, 'opfs'), close = f.opfs.hold('close');
	const pending = f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]));
	try {
		await close.entered; await f.media.catalogOriginals.release(f.binding.catalogId, [f.binding.photoId]);
		const row = f.row(); close.release(); await assert.rejects(pending, /root.*missing/iu);
		assert.deepEqual(f.roots(), []); assert.deepEqual(f.row(), row); assert.equal(f.opfs.files.size, 1); assertNoRepairLease(f);
	} finally { close.release(); await pending.catch(() => undefined); }
});

test('maintenance-generation invalidation refuses a closed staged body', async context => {
	const f = await createRepairFixture(context, 'opfs'), close = f.opfs.hold('close'), row = f.row(), roots = f.roots();
	const pending = f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]));
	try {
		await close.entered;
		await transact(f.database, 'mediaAssetStaging', 'readwrite', stores => f.media.invalidateAssetStagingStore(stores.mediaAssetStaging));
		close.release(); await assert.rejects(pending, /lease.*invalidated/iu);
		assert.deepEqual(f.row(), row); assert.deepEqual(f.roots(), roots); assert.equal(f.opfs.files.size, 1); assertNoRepairLease(f);
	} finally { close.release(); await pending.catch(() => undefined); }
});

for (const heldKind of ['write', 'close'] as const) {
	test(`maintenance joins a held native ${heldKind}, refuses overlapping repair and cleans its exact stage`, async context => {
		const f = await createRepairFixture(context, 'opfs'), held = f.opfs.hold(heldKind), row = f.row(), roots = f.roots();
		const pending = f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]));
		try {
			await held.entered;
			await assert.rejects(f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES])), /already pending/iu);
			const maintenance = f.media.beginAssetMaintenance(); let drained = false;
			const draining = maintenance.abortActive().then(() => { drained = true; });
			await assert.rejects(f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES])), /maintenance/iu);
			await Promise.resolve(); assert.equal(drained, false); held.release();
			await assert.rejects(pending, { name: 'AbortError' }); await draining; maintenance.release();
			assert.deepEqual(f.row(), row); assert.deepEqual(f.roots(), roots); assert.equal(f.opfs.files.size, 1); assertNoRepairLease(f);
		} finally { held.release(); await pending.catch(() => undefined); }
	});
}

test('preflight hashing remains owned and performs no staging while a genuine Blob read is held', async context => {
	const f = await createRepairFixture(context), read = deferred(), entered = deferred();
	const nativeRead = Blob.prototype.arrayBuffer, stop = new AbortController();
	Blob.prototype.arrayBuffer = async function () { entered.resolve(); await read.promise; return nativeRead.call(this); };
	const pending = f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]), { signal: stop.signal });
	try {
		await entered.promise; const reason = new DOMException('cancel selected read', 'AbortError'); stop.abort(reason);
		const maintenance = f.media.beginAssetMaintenance(); let drained = false;
		const draining = maintenance.abortActive().then(() => { drained = true; });
		await Promise.resolve(); assert.equal(drained, false); assertNoRepairLease(f);
		read.resolve(); await assert.rejects(pending, failure => failure === reason); await draining; maintenance.release();
		assert.equal(f.indexedDB.recordCount(f.databaseName, 'mediaAssetChunks'), 0);
	} finally { read.resolve(); Blob.prototype.arrayBuffer = nativeRead; await pending.catch(() => undefined); }
});

test('cancellation joins a held staged abort before maintenance can finish', async context => {
	const f = await createRepairFixture(context, 'opfs'), write = f.opfs.hold('write'), stop = new AbortController();
	const pending = f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]), { signal: stop.signal });
	try {
		await write.entered; const abort = f.opfs.hold('abort'); stop.abort(); write.release(); await abort.entered;
		const maintenance = f.media.beginAssetMaintenance(); let drained = false;
		const draining = maintenance.abortActive().then(() => { drained = true; });
		await Promise.resolve(); assert.equal(drained, false); abort.release();
		await assert.rejects(pending, { name: 'AbortError' }); await draining; maintenance.release();
		assertNoRepairLease(f); assert.equal(f.opfs.files.size, 1);
	} finally { write.release(); await pending.catch(() => undefined); }
});

test('an arbitrary native cancellation reason cannot veto staged cleanup or maintenance settlement', async context => {
	const f = await createRepairFixture(context, 'opfs'), stop = new AbortController(), stagedRead = deferred(), entered = deferred();
	const previous = f.row(), roots = f.roots();
	const nativeRead = Blob.prototype.arrayBuffer; let reads = 0;
	Blob.prototype.arrayBuffer = async function () {
		if (++reads === 2) { entered.resolve(); await stagedRead.promise; }
		return nativeRead.call(this);
	};
	const reason = new Proxy({}, { getPrototypeOf() { throw new Error('caller reason must not be classified unsafely'); } });
	const pending = f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]), { signal: stop.signal });
	let releaseMaintenance: (() => void) | undefined;
	try {
		await entered.promise; stop.abort(reason);
		const maintenance = f.media.beginAssetMaintenance(); releaseMaintenance = () => { maintenance.release(); };
		let drained = false;
		const draining = maintenance.abortActive().then(() => { drained = true; });
		await Promise.resolve(); assert.equal(drained, false); stagedRead.resolve();
		await assert.rejects(pending, failure => failure === reason); await draining;
		assert.deepEqual(f.row(), previous); assert.deepEqual(f.roots(), roots); assertNoRepairLease(f); assert.equal(f.opfs.files.size, 1);
	} finally { stagedRead.resolve(); Blob.prototype.arrayBuffer = nativeRead; releaseMaintenance?.(); await pending.catch(() => undefined); }
});

for (const layout of ['inline', 'opfs'] as const) {
	test(`actual committed ${layout} repair survives lost acknowledgement and late external cancellation`, async context => {
		const f = await createRepairFixture(context, layout), previous = f.row(), roots = f.roots(), stop = new AbortController();
		loseRepairAcknowledgement(f, () => { stop.abort(); });
		const result = await f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]), { signal: stop.signal });
		assert.deepEqual(result, { assetId: f.binding.assetId, sha256: f.binding.sha256, size: f.binding.size });
		assert.equal(f.row()?.mediaContentToken, previous?.mediaContentToken); assert.deepEqual(f.roots(), roots); assertNoRepairLease(f);
		const loaded = await f.media.loadAsset(f.binding.assetId); assert.ok(loaded);
		assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), REPAIR_BYTES);
	});
}

test('a committed repair with failed acknowledgement reconciliation retains its actual new payload', async context => {
	const f = await createRepairFixture(context, 'opfs'), previous = f.row(), roots = f.roots();
	loseRepairAcknowledgement(f, () => undefined, new Error('repair reconciliation offline'));
	await assert.rejects(f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES])), MediaPublicationReconciliationError);
	assert.notEqual(f.row()?.path, previous?.path); assert.equal(f.opfs.files.size, 2);
	assert.equal(f.row()?.mediaContentToken, previous?.mediaContentToken); assert.deepEqual(f.roots(), roots); assertNoRepairLease(f);
});

for (const layout of ['chunks', 'opfs'] as const) {
	test(`a legitimately superseded ${layout} repair retains its committed body after delayed lost acknowledgement`, async context => {
		const f = await createRepairFixture(context, layout), acknowledgement = deferred(), committed = deferred();
		const roots = f.roots();
		loseRepairAcknowledgement(f, () => undefined, undefined, { entered: committed, resume: acknowledgement });
		const first = f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]));
		try {
			await committed.promise;
			const firstRow = f.row()!;
			const second = new MediaRepository(f.port, f.storage);
			context.after(async () => { await second.beginAssetMaintenance({ permanent: true }).abortActive(); });
			await second.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]));
			const current = f.row()!; acknowledgement.resolve();
			await assert.rejects(first, MediaPublicationReconciliationError);
			assert.deepEqual(f.row(), current); assert.deepEqual(f.roots(), roots); assertNoRepairLease(f);
			if (layout === 'opfs') assert.ok(f.opfs.files.has(String(firstRow.path)));
			else assert.ok((f.indexedDB.records(f.databaseName, 'mediaAssetChunks') as Array<Record<string, unknown>>)
				.some(row => row.mediaChunkToken === firstRow.mediaChunkToken));
			const loaded = await second.loadAsset(f.binding.assetId); assert.ok(loaded);
			assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), REPAIR_BYTES);
		} finally { acknowledgement.resolve(); await first.catch(() => undefined); }
	});
}

test('actual row-put rollback removes only its new staged chunk body and leaves custody unchanged', async context => {
	const f = await createRepairFixture(context), previous = f.row(), roots = f.roots();
	f.indexedDB.failNextPutForStore('mediaAssets', new Error('repair publication refused'));
	await assert.rejects(f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES])), /publication refused/u);
	assert.deepEqual(f.row(), previous); assert.deepEqual(f.roots(), roots); assertNoRepairLease(f);
	assert.equal(f.indexedDB.recordCount(f.databaseName, 'mediaAssetChunks'), 0);
});

test('lease-completion failure atomically rolls back the media row and removes only staged chunks', async context => {
	const f = await createRepairFixture(context), previous = f.row(), roots = f.roots();
	f.indexedDB.failNextDeleteForStore('mediaAssetStaging', new Error('repair lease completion refused'));
	await assert.rejects(f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES])), /lease completion refused/u);
	assert.deepEqual(f.row(), previous); assert.deepEqual(f.roots(), roots); assertNoRepairLease(f);
	assert.equal(f.indexedDB.recordCount(f.databaseName, 'mediaAssetChunks'), 0);
});

test('absent-row reconstruction survives a real committed write with lost acknowledgement', async context => {
	const f = await createRepairFixture(context), originalToken = f.row()?.mediaContentToken, roots = f.roots();
	await f.removeRow(); loseRepairAcknowledgement(f, () => undefined);
	await f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]));
	assert.equal(f.row()?.mediaContentToken, originalToken); assert.deepEqual(f.roots(), roots); assertNoRepairLease(f);
	assert.equal(f.indexedDB.recordCount(f.databaseName, 'mediaAssetChunks'), 1);
});

test('a consumed lease prevents uncertain payload disposal when the reconstructed row disappears before reconciliation', async context => {
	const f = await createRepairFixture(context), committed = deferred(), acknowledgement = deferred(), roots = f.roots();
	await f.removeRow(); loseRepairAcknowledgement(f, () => undefined, undefined, { entered: committed, resume: acknowledgement });
	const pending = f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]));
	try {
		await committed.promise; await f.removeRow(); acknowledgement.resolve();
		await assert.rejects(pending, MediaPublicationReconciliationError);
		assert.equal(f.row(), undefined); assert.deepEqual(f.roots(), roots); assertNoRepairLease(f);
		assert.equal(f.indexedDB.recordCount(f.databaseName, 'mediaAssetChunks'), 1);
	} finally { acknowledgement.resolve(); await pending.catch(() => undefined); }
});

test('failed exact staged-file removal reports cleanup failure without a false repaired receipt', async context => {
	const f = await createRepairFixture(context, 'opfs'), previous = f.row(), roots = f.roots();
	f.indexedDB.failNextPutForStore('mediaAssets', new Error('repair publication refused')); f.opfs.failRemoval();
	await assert.rejects(f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES])), MediaAssetCleanupError);
	assert.deepEqual(f.row(), previous); assert.deepEqual(f.roots(), roots); assertNoRepairLease(f);
	assert.equal(f.opfs.files.size, 2);
});

for (const removable of [false, true]) {
	test(`failed sync writer admission ${removable ? 'verifies removal before chunk fallback' : 'retains its failed-path lease and refuses fallback'}`, async context => {
		const f = await createRepairFixture(context), previous = f.row(), roots = f.roots();
		let removes = 0;
		const sync: OpfsSyncStoragePort = {
			initialize: async () => true, isAvailable: () => true,
			read: async () => { throw new Error('unexpected worker read'); }, snapshot: async () => { throw new Error('unexpected worker snapshot'); },
			openWriter: async (_operation, path) => { f.opfs.files.set(path, new Blob(['failed partial stage'])); throw new Error('sync open refused'); },
			remove: async path => { removes++; if (!removable || removes === 1) throw new DOMException('sync remove refused', 'NotAllowedError'); f.opfs.files.delete(path); },
			close() {},
		};
		const storage = new OpfsRepository({ preferOpfs: true, opfsRoot: f.opfs.directory as unknown as FileSystemDirectoryHandle, syncWorkerClient: sync });
		const media = new MediaRepository(f.port, storage);
		context.after(async () => { await media.beginAssetMaintenance({ permanent: true }).abortActive(); storage.close(); });
		if (removable) {
			await media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]));
			assertNoRepairLease(f); assert.equal(f.opfs.files.size, 0); assert.ok(removes >= 2);
			assert.equal(f.row()?.storage, 'indexeddb-media-chunks-v1'); assert.equal(f.row()?.mediaContentToken, previous?.mediaContentToken);
		} else {
			await assert.rejects(media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES])), MediaAssetCleanupError);
			assert.deepEqual(f.row(), previous); assert.equal(f.opfs.files.size, 1);
			const leases = f.indexedDB.records(f.databaseName, 'mediaAssetStaging') as Array<Record<string, unknown>>;
			assert.equal(leases.filter(({ kind }) => kind === 'lease').length, 1);
			assert.equal(f.indexedDB.recordCount(f.databaseName, 'mediaAssetChunks'), 0);
		}
		assert.deepEqual(f.roots(), roots);
	});
}

function loseRepairAcknowledgement(f: RepairFixture, completed: () => void, reconciliationError?: Error,
	held?: { entered: ReturnType<typeof deferred>; resume: ReturnType<typeof deferred> }): void {
	const nativeTransaction = f.database.transaction.bind(f.database); let injected = false;
	f.database.transaction = (names, mode, options) => {
		const scope = typeof names === 'string' ? [names] : [...names];
		if (injected && reconciliationError && mode === 'readonly' && scope.includes('mediaAssets') && scope.includes('mediaAssetStaging')) {
			const error = reconciliationError; reconciliationError = undefined; throw error;
		}
		const transaction = nativeTransaction(names, mode, options);
		if (!injected && mode === 'readwrite' && scope.includes('mediaAssets') && scope.includes('catalogOriginalRoots') && scope.includes('mediaAssetStaging')) {
			injected = true;
			Object.defineProperty(transaction, 'oncomplete', { configurable: true, set() {}, get() {
				return () => {
					const fail = () => { completed(); Object.defineProperty(transaction, 'error', { configurable: true, value: new Error('repair acknowledgement lost') });
						transaction.onerror?.(new Event('error')); };
					if (held) { held.entered.resolve(); void held.resume.promise.then(fail); } else fail();
				};
			} });
		}
		return transaction;
	};
}
