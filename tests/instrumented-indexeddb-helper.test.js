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

function consumeCursor(cursorRequest) {
	return new Promise((resolve, reject) => {
		cursorRequest.onsuccess = () => {
			if (!cursorRequest.result) {
				resolve();
				return;
			}
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
