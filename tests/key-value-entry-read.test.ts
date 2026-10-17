/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

for (const native of [false, true]) test(`${native ? 'native' : 'memory'} entry read preserves physical malformed presence and detaches valid values`, async () => {
	const name = `entry-read-${crypto.randomUUID()}`, raw = createInstrumentedIndexedDB(), memory = getMemoryDatabase(name);
	const database = native ? await openDatabase(raw as unknown as IDBFactory, name) : null;
	const values = new KeyValueRepository({ memory, database: async () => database }, 'settings');
	try {
		assert.deepEqual(await values.readEntry('missing'), { present: false });
		for (const wrapper of [{ key: 'key', value: undefined }, { key: 'key' }]) {
			if (native) raw.seedRecord(name, 'settings', wrapper); else memory.settings.set('key', wrapper);
			assert.deepEqual(await values.readEntry('key'), { present: true, value: undefined });
			assert.equal(await values.get('key'), undefined);
		}
		if (!native) for (const wrapper of [undefined, null, 7]) {
			memory.settings.set('key', wrapper);
			assert.deepEqual(await values.readEntry('key'), { present: true, value: undefined });
		}
		if (!native) {
			let invoked = 0;
			memory.settings.set('key', Object.defineProperty({ key: 'key' }, 'value', { get() { invoked++; return {}; } }));
			await assert.rejects(values.readEntry('key'), TypeError); assert.equal(invoked, 0);
		}
		await values.put('key', { nested: { value: 1 } });
		const first = await values.readEntry('key'); assert.equal(Object.isFrozen(first), true);
		assert.equal(first.present, true); if (!first.present) assert.fail('Expected present entry');
		Reflect.set((first.value as { nested: object }).nested, 'value', 9);
		assert.deepEqual(await values.readEntry('key'), { present: true, value: { nested: { value: 1 } } });
	} finally { database?.close(); }
});

test('native entry read uses one readonly point request without split presence or inventory scans', async () => {
	const raw = createInstrumentedIndexedDB(), name = `entry-point-${crypto.randomUUID()}`;
	const database = await openDatabase(raw as unknown as IDBFactory, name), transaction = database.transaction.bind(database);
	let transactions = 0, gets = 0;
	database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
		transactions++; assert.equal(args[1], 'readonly'); const tx = transaction(...args), objectStore = tx.objectStore.bind(tx);
		tx.objectStore = key => {
			const store = objectStore(key), get = store.get.bind(store);
			store.get = input => { gets++; return get(input); };
			for (const method of ['getKey', 'getAll', 'getAllKeys', 'count', 'openCursor', 'openKeyCursor']) {
				Reflect.set(store, method, () => assert.fail(`Unexpected ${method}`));
			} return store;
		}; return tx;
	}) as IDBDatabase['transaction'];
	try {
		raw.seedRecord(name, 'settings', { key: 'key' });
		const values = new KeyValueRepository({ memory: getMemoryDatabase(name), database: async () => database }, 'settings');
		assert.deepEqual(await values.readEntry('key'), { present: true, value: undefined });
		assert.equal(transactions, 1); assert.equal(gets, 1); assert.equal(raw.stats.activeTransactions, 0);
	} finally { database.close(); }
});

test('entry read joins held lazy acquisition and the media settings facade closes its admitted read', async () => {
	const memory = getMemoryDatabase(`entry-held-${crypto.randomUUID()}`), gate = deferred<IDBDatabase | null>();
	const values = new KeyValueRepository({ memory, database: () => gate.promise }, 'settings');
	const reading = values.readEntry('key'); assert.equal(await remainsPending(reading), true);
	memory.settings.set('key', { key: 'key' }); gate.resolve(null);
	assert.deepEqual(await reading, { present: true, value: undefined });
	const raw = createInstrumentedIndexedDB(), name = `lightscaper-entry-media-${crypto.randomUUID()}`;
	const store = new PhotoMediaStoreV1({ indexedDB: raw as unknown as IDBFactory, databaseName: name, locks: null, preferOpfs: false });
	try {
		await store.ready(); raw.seedRecord(name, 'settings', { key: 'key' }); let closing: Promise<void> | undefined;
		raw.onNextGetForStore('settings', () => { closing = store.close(); });
		assert.deepEqual(await store.settingsRepository.readEntry('key'), { present: true, value: undefined });
		assert.ok(closing); await closing; assert.equal(raw.stats.activeTransactions, 0);
		await assert.rejects(store.settingsRepository.readEntry('key'), { code: 'STORE_CLOSED' });
	} finally { await store.close(); }
});
