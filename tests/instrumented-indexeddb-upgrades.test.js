/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('instrumented IndexedDB runs version upgrades transactionally before open succeeds', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = 'versioned-upgrade';
	const initial = await openVersion(indexedDB, databaseName, 1, ({ database }) => {
		database.createObjectStore('legacy', { keyPath: 'key' });
	});
	assert.equal(initial.version, 1);
	initial.close();
	indexedDB.seedRecord(databaseName, 'legacy', {
		key: 'spoofed-payload-key',
		label: 'legacy row',
	}, 'authoritative-primary-key');

	const order = [];
	let upgradeEvent;
	let upgradeTransaction;
	const upgraded = await openVersion(indexedDB, databaseName, 2, ({ database, event, request, transaction }) => {
		order.push('upgrade');
		upgradeEvent = event;
		upgradeTransaction = transaction;
		assert.equal(request.transaction, transaction);
		transaction.oncomplete = () => order.push('complete');
		const entries = database.createObjectStore('entries', { keyPath: 'key' });
		entries.createIndex('label', 'label', { unique: false });
		const cursorRequest = transaction.objectStore('legacy').openCursor();
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) return;
			entries.put({ key: cursor.primaryKey, label: cursor.value.label });
			cursor.continue();
		};
	}, () => order.push('success'));

	assert.equal(upgraded.version, 2);
	assert.equal(upgradeEvent.oldVersion, 1);
	assert.equal(upgradeEvent.newVersion, 2);
	assert.equal(upgradeEvent.target.result, upgraded);
	assert.equal(upgradeTransaction.mode, 'versionchange');
	assert.equal(upgradeTransaction.finished, true);
	assert.equal(order.at(-2), 'complete');
	assert.equal(order.at(-1), 'success');
	assert.deepEqual(indexedDB.records(databaseName, 'entries'), [{
		key: 'authoritative-primary-key',
		label: 'legacy row',
	}]);

	let repeatedUpgrade = false;
	const reopened = await openVersion(indexedDB, databaseName, 2, () => { repeatedUpgrade = true; });
	assert.equal(reopened.version, 2);
	assert.equal(repeatedUpgrade, false);
});

test('a failed upgrade request restores the prior schema, records, and version', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = 'failed-upgrade';
	const initial = await openVersion(indexedDB, databaseName, 1, ({ database }) => {
		database.createObjectStore('legacy', { keyPath: 'id' });
	});
	initial.close();
	indexedDB.seedRecord(databaseName, 'legacy', { id: 'keep', label: 'original' });
	const plannedFailure = new Error('planned migration put failure');
	indexedDB.failNextPutForStore('entries', plannedFailure);

	await assert.rejects(
		openVersion(indexedDB, databaseName, 2, ({ database, transaction }) => {
			const entries = database.createObjectStore('entries', { keyPath: 'key' });
			transaction.objectStore('legacy').put({ id: 'keep', label: 'mutated' });
			entries.put({ key: 'new-entry', label: 'should roll back' });
		}),
		(error) => error === plannedFailure,
	);

	assert.equal(indexedDB.stats.activeTransactions, 0);
	const restored = await openVersion(indexedDB, databaseName, 1);
	assert.equal(restored.version, 1);
	assert.equal(restored.objectStoreNames.contains('entries'), false);
	assert.deepEqual(indexedDB.records(databaseName, 'legacy'), [{ id: 'keep', label: 'original' }]);

	const retried = await openVersion(indexedDB, databaseName, 2, ({ database }) => {
		database.createObjectStore('entries', { keyPath: 'key' }).put({ key: 'retry', label: 'persisted' });
	});
	assert.equal(retried.version, 2);
	assert.deepEqual(indexedDB.records(databaseName, 'entries'), [{ key: 'retry', label: 'persisted' }]);
});

test('an explicitly aborted upgrade restores the prior database snapshot', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = 'aborted-upgrade';
	const initial = await openVersion(indexedDB, databaseName, 1, ({ database }) => {
		database.createObjectStore('records', { keyPath: 'id' });
	});
	initial.close();
	indexedDB.seedRecord(databaseName, 'records', { id: 'keep', label: 'original' });

	await assert.rejects(
		openVersion(indexedDB, databaseName, 2, ({ database, transaction }) => {
			database.createObjectStore('transient', { keyPath: 'id' });
			const mutation = transaction.objectStore('records').put({ id: 'keep', label: 'mutated' });
			mutation.onsuccess = () => transaction.abort();
		}),
		(error) => error?.name === 'AbortError',
	);

	const restored = await openVersion(indexedDB, databaseName, 1);
	assert.equal(restored.version, 1);
	assert.equal(restored.objectStoreNames.contains('transient'), false);
	assert.deepEqual(indexedDB.records(databaseName, 'records'), [{ id: 'keep', label: 'original' }]);
});

test('a failed readwrite request aborts and rolls back earlier writes in the transaction', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = 'readwrite-rollback';
	const database = await openVersion(indexedDB, databaseName, 1, ({ database: upgrading }) => {
		upgrading.createObjectStore('metadata', { keyPath: 'id' });
		upgrading.createObjectStore('payloads', { keyPath: 'id' });
	});
	indexedDB.seedRecord(databaseName, 'metadata', { id: 'asset', state: 'original' });
	const plannedFailure = new Error('planned payload put failure');
	indexedDB.failNextPutForStore('payloads', plannedFailure);
	const transaction = database.transaction(['metadata', 'payloads'], 'readwrite');
	const completion = transactionCompletion(transaction);
	transaction.objectStore('metadata').put({ id: 'asset', state: 'mutated' });
	transaction.objectStore('payloads').put({ id: 'asset', bytes: 42 });

	await assert.rejects(completion, (error) => error === plannedFailure);
	assert.equal(indexedDB.stats.activeTransactions, 0);
	assert.deepEqual(indexedDB.records(databaseName, 'metadata'), [{ id: 'asset', state: 'original' }]);
	assert.deepEqual(indexedDB.records(databaseName, 'payloads'), []);

	const retry = database.transaction('payloads', 'readwrite');
	const retryCompletion = transactionCompletion(retry);
	retry.objectStore('payloads').put({ id: 'asset', bytes: 42 });
	await retryCompletion;
	assert.deepEqual(indexedDB.records(databaseName, 'payloads'), [{ id: 'asset', bytes: 42 }]);
});

test('deleting stores during an upgrade is enumerable, transactional, and upgrade-only', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = 'deleted-store-upgrade';
	const initial = await openVersion(indexedDB, databaseName, 1, ({ database }) => {
		database.createObjectStore('legacy', { keyPath: 'id' });
		database.createObjectStore('retired', { keyPath: 'id' });
	});
	initial.close();
	indexedDB.seedRecord(databaseName, 'legacy', { id: 'keep', label: 'original' });

	await assert.rejects(
		openVersion(indexedDB, databaseName, 2, ({ database, transaction }) => {
			for (const name of [...database.objectStoreNames]) database.deleteObjectStore(name);
			assert.deepEqual([...database.objectStoreNames], []);
			transaction.abort();
		}),
		(error) => error?.name === 'AbortError',
	);
	const restored = await openVersion(indexedDB, databaseName, 1);
	assert.deepEqual([...restored.objectStoreNames], ['legacy', 'retired']);
	assert.deepEqual(indexedDB.records(databaseName, 'legacy'), [{ id: 'keep', label: 'original' }]);
	restored.close();

	const upgraded = await openVersion(indexedDB, databaseName, 2, ({ database }) => {
		assert.throws(() => database.deleteObjectStore('missing'), { name: 'NotFoundError' });
		for (const name of [...database.objectStoreNames]) database.deleteObjectStore(name);
		database.createObjectStore('current', { keyPath: 'id' });
	});
	assert.deepEqual([...upgraded.objectStoreNames], ['current']);
	assert.equal(upgraded.objectStoreNames.contains('legacy'), false);
	assert.equal(indexedDB.recordCount(databaseName, 'legacy'), 0);
	assert.throws(() => upgraded.deleteObjectStore('current'), { name: 'InvalidStateError' });
	upgraded.close();
});

function openVersion(indexedDB, databaseName, version, onUpgrade, onSuccess) {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(databaseName, version);
		request.onupgradeneeded = (event) => onUpgrade?.({
			database: request.result,
			event,
			request,
			transaction: request.transaction,
		});
		request.onsuccess = () => {
			onSuccess?.();
			resolve(request.result);
		};
		request.onerror = () => reject(request.error);
	});
}

function transactionCompletion(transaction) {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () => reject(transaction.error || new DOMException('Aborted.', 'AbortError'));
		transaction.onerror = () => undefined;
	});
}
