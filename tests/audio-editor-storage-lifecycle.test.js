import test from 'node:test';
import assert from 'node:assert/strict';

import { createProjectStore } from '../src/common/editor/storage.js';

test('memory storage reports that it is ephemeral and close is terminal', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: 'storage-status-memory',
	});

	await store.ready();
	assert.deepEqual(store.getStatus(), {
		state: 'memory-ephemeral',
		backend: 'memory',
		persistent: false,
		ephemeral: true,
		degradedReason: 'indexeddb-unavailable',
	});

	await store.close();
	await store.close();
	assert.equal(store.getStatus().state, 'closed');
	await assert.rejects(() => store.loadSetting('after-close'), { code: 'STORE_CLOSED' });
});

test('only known IndexedDB availability errors enable memory fallback', async () => {
	const restricted = createProjectStore({
		indexedDB: { open() { throw new DOMException('restricted', 'SecurityError'); } },
		preferOpfs: false,
		databaseName: 'storage-status-restricted',
	});
	await restricted.ready();
	assert.deepEqual(restricted.getStatus(), {
		state: 'memory-ephemeral',
		backend: 'memory',
		persistent: false,
		ephemeral: true,
		degradedReason: 'SecurityError',
	});
	await restricted.close();

	const corrupted = createProjectStore({
		indexedDB: { open() { throw new Error('corrupt database'); } },
		preferOpfs: false,
		databaseName: 'storage-status-corrupt',
	});
	await assert.rejects(() => corrupted.ready(), /corrupt database/);
	assert.equal(corrupted.getStatus().state, 'error');
	assert.equal(corrupted.getStatus().backend, 'indexeddb');
	await corrupted.close();
});

test('close preserves memory fallback for a clear admitted before the terminal fence', async () => {
	const store = createProjectStore({
		indexedDB: { open() { throw new DOMException('restricted', 'SecurityError'); } },
		preferOpfs: false,
		databaseName: `storage-clear-close-fallback-${Date.now()}-${Math.random()}`,
	});
	store.memory.settings.set('seed', { key: 'seed', value: true });
	const settlementOrder = [];

	const clearing = store.clear();
	const observedClear = clearing.then(
		() => { settlementOrder.push('clear'); },
		() => { settlementOrder.push('clear-rejected'); },
	);
	const closing = store.close();
	const observedClose = closing.then(
		() => { settlementOrder.push('close'); },
		() => { settlementOrder.push('close-rejected'); },
	);
	const [clearResult, closeResult] = await Promise.allSettled([clearing, closing]);
	await Promise.all([observedClear, observedClose]);

	assert.equal(
		clearResult.status,
		'fulfilled',
		'an admitted clear must retain the fallback decision it captured before close',
	);
	assert.equal(closeResult.status, 'fulfilled');
	assert.deepEqual(settlementOrder, ['clear', 'close']);
	assert.equal(store.memory.settings.size, 0, 'the admitted clear must empty fallback memory');
	assert.equal(store.getStatus().backend, 'memory');
	assert.equal(store.getStatus().state, 'closed');
});

test('close does not enable memory fallback for an unrelated pending database admission', async () => {
	const store = createProjectStore({
		indexedDB: { open() { throw new DOMException('restricted', 'SecurityError'); } },
		preferOpfs: false,
		databaseName: `storage-close-no-fallback-${Date.now()}-${Math.random()}`,
	});

	const saving = store.saveSetting('must-not-publish', true);
	const closing = store.close();
	const [saveResult, closeResult] = await Promise.allSettled([saving, closing]);

	assert.equal(saveResult.status, 'rejected');
	assert.equal(closeResult.status, 'fulfilled');
	assert.equal(store.memory.settings.has('must-not-publish'), false);
	assert.equal(store.getStatus().state, 'closed');
});

test('a blocked open rejects and closes a late successful connection', async () => {
	let request;
	let closeCalls = 0;
	const database = { close() { closeCalls += 1; } };
	const store = createProjectStore({
		indexedDB: {
			open() {
				request = {};
				queueMicrotask(() => request.onblocked());
				return request;
			},
		},
		preferOpfs: false,
		databaseName: 'storage-status-blocked',
	});

	await assert.rejects(() => store.ready(), { code: 'STORE_BLOCKED' });
	assert.equal(store.getStatus().state, 'version-stale');
	request.result = database;
	request.onsuccess();
	assert.equal(closeCalls, 1);
	await store.close();
});

test('versionchange closes the connection and prevents implicit reopening', async () => {
	let openCalls = 0;
	let database;
	const indexedDB = {
		open() {
			openCalls += 1;
			const request = {};
			database = {
				objectStoreNames: { contains() { return true; } },
				closeCalls: 0,
				close() { this.closeCalls += 1; },
			};
			queueMicrotask(() => {
				request.result = database;
				request.onsuccess();
			});
			return request;
		},
	};
	const store = createProjectStore({ indexedDB, preferOpfs: false, databaseName: 'storage-status-versionchange' });

	await store.ready();
	assert.equal(store.getStatus().state, 'indexeddb');
	database.onversionchange();
	assert.equal(database.closeCalls, 1);
	assert.equal(store.getStatus().state, 'version-stale');
	await assert.rejects(() => store.loadSetting('no-reopen'), { code: 'STORE_VERSION_STALE' });
	assert.equal(openCalls, 1);
	await store.close();
});
