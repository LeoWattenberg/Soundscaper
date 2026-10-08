/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2 } from '../src/lightscaper/storage/photo-library-location-v2.ts';
import { PHOTO_MEDIA_NAMESPACES_V1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { holdOriginalRecoveryRetryV1, originalRecoveryRetryStateV1, prepareOriginalRecoveryRetryV1, releaseOriginalRecoveryRetryV1 } from './helpers/lightscaper-original-recovery-ui-fixture.ts';
import { remainsPending } from './helpers/async-test-control.ts';

// Protocol qualification only: genuine IndexedDB completion and browser lease
// ownership remain assertions of the native recovery browser spec.
function protocol() {
	const calls: { receiver: object; name: string; options: unknown }[] = [];
	class Database {
		constructor(readonly name: string) {}
		transaction(names: readonly string[], mode: IDBTransactionMode) { return new Transaction(this, names, mode); }
	}
	class Transaction extends EventTarget {
		readonly objectStoreNames: { contains: (name: string) => boolean };
		constructor(readonly db: Database, names: readonly string[], readonly mode: IDBTransactionMode) {
			super(); this.objectStoreNames = { contains: name => names.includes(name) };
		}
	}
	class Store {
		constructor(readonly transaction: Transaction, readonly name = 'mediaAssets') {}
		put(_value: unknown, _key?: IDBValidKey) { return {} as IDBRequest<IDBValidKey>; }
	}
	class Locks {
		request(name: string, options?: unknown): Promise<string> {
			calls.push({ receiver: this, name, options }); return Promise.resolve(name);
		}
	}
	const entries = { IDBDatabase: Database, IDBObjectStore: Store, LockManager: Locks };
	const originals = Object.keys(entries).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
	for (const [key, value] of Object.entries(entries)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
	return { Database, Store, Locks, calls, restore() {
		releaseOriginalRecoveryRetryV1();
		for (const [key, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
		}
	} };
}

const stores = ['mediaAssets', 'catalogOriginalRoots', 'mediaAssetStaging'];
const catalogLease = `lightscaper-photo-library:namespace:${PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2}`;
const assetId = 'selected-original';

test('the Session request captured before arming observes the actual post-publication lease', async () => {
	const f = protocol();
	try {
		prepareOriginalRecoveryRetryV1();
		const locks = new f.Locks(), captured = locks.request.bind(locks);
		await captured(catalogLease);
		holdOriginalRecoveryRetryV1(assetId);
		const transaction = new f.Database(PHOTO_MEDIA_NAMESPACES_V1.databaseName).transaction(stores, 'readwrite');
		new f.Store(transaction).put({ sourceId: assetId }); transaction.dispatchEvent(new Event('complete'));
		const held = captured(catalogLease);
		assert.equal(await remainsPending(held), true);
		assert.deepEqual(originalRecoveryRetryStateV1(), { publicationCompleted: true, entered: true, released: false });
		releaseOriginalRecoveryRetryV1(); assert.equal(await held, catalogLease);
		assert.equal(await captured(catalogLease), catalogLease); // The captured observer becomes transparent after release.
	} finally { f.restore(); }
});

test('matching publication holds exactly the selected physical catalog lease until release', async () => {
	const f = protocol();
	try {
		const nativeTransaction = f.Database.prototype.transaction, nativePut = f.Store.prototype.put, nativeRequest = f.Locks.prototype.request;
		prepareOriginalRecoveryRetryV1();
		holdOriginalRecoveryRetryV1(assetId);
		const locks = new f.Locks(), options = { mode: 'exclusive', ifAvailable: true };
		await locks.request(catalogLease, options); // Readiness before the repair ACK remains untouched.
		const transaction = new f.Database(PHOTO_MEDIA_NAMESPACES_V1.databaseName).transaction(stores, 'readwrite');
		new f.Store(transaction).put({ sourceId: assetId });
		assert.deepEqual(originalRecoveryRetryStateV1(), { publicationCompleted: false, entered: false, released: false });
		transaction.dispatchEvent(new Event('complete'));
		for (const name of ['lightscaper-photo-catalog:photo-library-default',
			`lightscaper-photo-library:namespace:${PHOTO_MEDIA_NAMESPACES_V1.databaseName}`,
			`${catalogLease}-other`, 'lightscaper-photo-catalog:selected-catalog']) {
			const request = locks.request(name, options);
			assert.equal(await remainsPending(request), false, `Unrelated lease was held: ${name}`);
			assert.equal(await request, name);
		}
		const before = f.calls.length, held = locks.request(catalogLease, options);
		assert.equal(await remainsPending(held), true);
		assert.equal(f.calls.length, before);
		assert.deepEqual(originalRecoveryRetryStateV1(), { publicationCompleted: true, entered: true, released: false });
		assert.throws(() => holdOriginalRecoveryRetryV1(assetId), /already pending/u);
		releaseOriginalRecoveryRetryV1();
		assert.equal(await held, catalogLease);
		assert.deepEqual(f.calls.at(-1), { receiver: locks, name: catalogLease, options });
		assert.equal(f.Database.prototype.transaction, nativeTransaction);
		assert.equal(f.Store.prototype.put, nativePut);
		assert.equal(f.Locks.prototype.request, nativeRequest);
		assert.deepEqual(originalRecoveryRetryStateV1(), { publicationCompleted: true, entered: true, released: true });
	} finally { f.restore(); }
});

test('unrelated writes and aborted publication cannot arm the readiness witness', async () => {
	const f = protocol();
	try {
		prepareOriginalRecoveryRetryV1();
		holdOriginalRecoveryRetryV1(assetId);
		for (const [databaseName, mode, names, sourceId] of [
			['another-media', 'readwrite', stores, assetId],
			[PHOTO_MEDIA_NAMESPACES_V1.databaseName, 'readonly', stores, assetId],
			[PHOTO_MEDIA_NAMESPACES_V1.databaseName, 'readwrite', ['mediaAssets', 'catalogOriginalRoots'], assetId],
			[PHOTO_MEDIA_NAMESPACES_V1.databaseName, 'readwrite', stores, 'another-original'],
		] as const) {
			const transaction = new f.Database(databaseName).transaction(names, mode);
			new f.Store(transaction).put({ sourceId }); transaction.dispatchEvent(new Event('complete'));
			assert.equal(originalRecoveryRetryStateV1()?.publicationCompleted, false);
		}
		const transaction = new f.Database(PHOTO_MEDIA_NAMESPACES_V1.databaseName).transaction(stores, 'readwrite');
		new f.Store(transaction).put({ sourceId: assetId }); transaction.dispatchEvent(new Event('abort'));
		assert.equal(await new f.Locks().request(catalogLease), catalogLease);
		assert.deepEqual(originalRecoveryRetryStateV1(), { publicationCompleted: false, entered: false, released: false });
	} finally { f.restore(); }
});

test('retired captured observers cannot gate a later preparation, and arming requires early preparation', async () => {
	const f = protocol();
	try {
		const nativeRequest = f.Locks.prototype.request, locks = new f.Locks();
		assert.throws(() => holdOriginalRecoveryRetryV1(assetId), /prepared before Session/u);
		assert.equal(f.Locks.prototype.request, nativeRequest);
		prepareOriginalRecoveryRetryV1();
		const old = locks.request.bind(locks);
		assert.throws(() => prepareOriginalRecoveryRetryV1(), /already prepared/u);
		releaseOriginalRecoveryRetryV1(); assert.equal(f.Locks.prototype.request, nativeRequest);
		prepareOriginalRecoveryRetryV1();
		const current = locks.request.bind(locks);
		holdOriginalRecoveryRetryV1(assetId);
		const transaction = new f.Database(PHOTO_MEDIA_NAMESPACES_V1.databaseName).transaction(stores, 'readwrite');
		new f.Store(transaction).put({ sourceId: assetId }); transaction.dispatchEvent(new Event('complete'));
		assert.equal(await old(catalogLease), catalogLease);
		assert.equal(originalRecoveryRetryStateV1()?.entered, false);
		const held = current(catalogLease); assert.equal(await remainsPending(held), true);
		releaseOriginalRecoveryRetryV1(); assert.equal(await held, catalogLease);
		assert.equal(await current(catalogLease), catalogLease);
	} finally { f.restore(); }
});
