/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('instrumented IndexedDB reports Blob-bearing cursor pages and getAll reads', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const database = await openDatabase(indexedDB, 'blob-read-instrumentation');
	indexedDB.seedRecord('blob-read-instrumentation', 'records', {
		id: 'a', group: 'selected', blob: new Blob(['payload']),
	});
	indexedDB.seedRecord('blob-read-instrumentation', 'records', {
		id: 'b', group: 'selected', label: 'metadata-only',
	});

	await consumeCursor(database.transaction('records', 'readonly')
		.objectStore('records').index('group').openCursor('selected'));
	await request(database.transaction('records', 'readonly')
		.objectStore('records').getAll());
	await request(database.transaction('records', 'readonly')
		.objectStore('records').get('a'));

	assert.deepEqual(indexedDB.stats.cursorRequests, [{
		store: 'records',
		index: 'group',
		query: 'selected',
		delivered: 2,
		blobValuesDelivered: 1,
		blobBytesDelivered: 7,
	}]);
	assert.deepEqual(indexedDB.stats.getAllRequests, [{
		store: 'records',
		index: null,
		query: undefined,
		returned: 2,
		blobValuesReturned: 1,
		blobBytesReturned: 7,
	}]);
	assert.deepEqual(indexedDB.stats.getRequests, [{
		store: 'records',
		key: 'a',
		returned: 1,
		blobValuesReturned: 1,
		blobBytesReturned: 7,
	}]);
});

test('rollback snapshots retain stored payloads without copying them or exposing mutable values', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const name = 'isolated-rollback-payloads';
	const database = await openDatabase(indexedDB, name);
	const input = { id: 'a', group: 'selected', bytes: Uint8Array.of(1, 2), nested: { label: 'original' } };
	indexedDB.seedRecord(name, 'records', input);
	indexedDB.seedRecord(name, 'records', { id: 'b', group: 'selected', bytes: Uint8Array.of(3, 4) });
	input.bytes[0] = 99;
	input.nested.label = 'changed outside the database';
	let copies = 0;
	const originalClone = globalThis.structuredClone;
	context.mock.method(globalThis, 'structuredClone', (value, options) => {
		copies += 1;
		return originalClone(value, options);
	});
	const transaction = database.transaction('records', 'readwrite');
	assert.equal(copies, 0, 'starting a transaction must not copy existing payloads');
	const aborted = new Promise((resolve) => { transaction.onabort = resolve; });
	const store = transaction.objectStore('records');
	const read = await request(store.get('a'));
	read.bytes[0] = 10;
	read.nested.label = 'uncommitted';
	await request(store.put(read));
	await request(store.delete('b'));
	await request(store.add({ id: 'c', bytes: Uint8Array.of(5, 6) }));
	const listed = await request(store.getAll());
	listed[0].bytes[0] = 11;
	await consumeCursor(store.openCursor(), (cursor) => {
		cursor.value.bytes[0] = 12;
		cursor.delete();
	});
	await request(store.clear());
	const beforeAbort = copies;
	transaction.abort();
	await aborted;
	assert.equal(copies, beforeAbort, 'rollback must not copy the retained payloads');
	assert.deepEqual(indexedDB.records(name, 'records'), [
		{ id: 'a', group: 'selected', bytes: Uint8Array.of(1, 2), nested: { label: 'original' } },
		{ id: 'b', group: 'selected', bytes: Uint8Array.of(3, 4) },
	]);
	const external = indexedDB.records(name, 'records');
	external[0].bytes[0] = 13;
	assert.equal(indexedDB.records(name, 'records')[0].bytes[0], 1);
	assert.equal(indexedDB.stats.activeTransactions, 0);
});

test('mutable cursor and write-result keys cannot change stored records or rollback snapshots', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const name = 'isolated-mutable-keys';
	const database = await openDatabase(indexedDB, name);
	indexedDB.seedRecord(name, 'records', { id: 'a', group: new Date(0) });
	const transaction = database.transaction('records', 'readwrite');
	const store = transaction.objectStore('records');
	await consumeCursor(store.index('group').openCursor(), (cursor) => { cursor.key.setTime(123); });
	await consumeCursor(store.index('group').openKeyCursor(), (cursor) => { cursor.key.setTime(456); });
	assert.equal(indexedDB.records(name, 'records')[0].group.getTime(), 0);
	const createdKey = await request(store.add({ id: new Date(1_000), group: 'created' }));
	createdKey.setTime(2_000);
	const updatedKey = await request(store.put({ id: new Date(3_000), group: 'updated' }));
	updatedKey.setTime(4_000);
	await consumeCursor(store.openCursor(), (cursor) => {
		if (cursor.primaryKey instanceof Date) {
			cursor.primaryKey.setTime(5_000);
			cursor.key.setTime(6_000);
		}
	});
	const records = indexedDB.records(name, 'records');
	assert.deepEqual(records.find(({ group }) => group === 'created').id, new Date(1_000));
	assert.deepEqual(records.find(({ group }) => group === 'updated').id, new Date(3_000));
	const aborted = new Promise((resolve) => { transaction.onabort = resolve; });
	transaction.abort();
	await aborted;
	assert.deepEqual(indexedDB.records(name, 'records'), [{ id: 'a', group: new Date(0) }]);
});

function openDatabase(indexedDB, databaseName) {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(databaseName);
		request.onupgradeneeded = () => {
			const records = request.result.createObjectStore('records', { keyPath: 'id' });
			records.createIndex('group', 'group');
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function consumeCursor(cursorRequest, visit = () => undefined) {
	return new Promise((resolve, reject) => {
		cursorRequest.onsuccess = () => {
			if (!cursorRequest.result) {
				resolve();
				return;
			}
			visit(cursorRequest.result);
			cursorRequest.result.continue();
		};
		cursorRequest.onerror = () => reject(cursorRequest.error);
	});
}

function request(indexedDBRequest) {
	return new Promise((resolve, reject) => {
		indexedDBRequest.onsuccess = () => resolve(indexedDBRequest.result);
		indexedDBRequest.onerror = () => reject(indexedDBRequest.error);
	});
}
