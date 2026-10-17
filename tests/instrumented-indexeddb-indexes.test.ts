/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { request } from '../src/common/editor/storage/indexeddb-backend.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

async function database() {
	const factory = createInstrumentedIndexedDB() as unknown as IDBFactory;
	return new Promise<IDBDatabase>((resolve, reject) => {
		const opening = factory.open(crypto.randomUUID(), 1);
		opening.onupgradeneeded = () => {
			const store = opening.result.createObjectStore('rows', { keyPath: 'id' });
			store.createIndex('memberKey', 'members', { unique: true, multiEntry: true });
			store.createIndex('pair', ['catalog', 'name']);
		};
		opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
	});
}
async function transaction<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
	const native = db.transaction('rows', mode);
	const completed = new Promise<void>((resolve, reject) => {
		native.oncomplete = () => resolve(); native.onabort = () => reject(native.error);
	});
	try { const result = await run(native.objectStore('rows')); await completed; return result; }
	catch (error) { await completed.catch(() => undefined); throw error; }
}

test('multiEntry indexes expose native options and point lookups without breaking compound indexes', async () => {
	const db = await database();
	try {
		await transaction(db, 'readwrite', async store => {
			await request(store.put({ id: 'stack-1', catalog: 'catalog', name: 'first', members: ['catalog|a', 'catalog|b', 'catalog|a'] }));
		});
		await transaction(db, 'readonly', async store => {
			const index = store.index('memberKey');
			assert.equal(index.multiEntry, true); assert.equal(index.unique, true); assert.equal(index.keyPath, 'members');
			assert.equal(await request(index.getKey('catalog|b')), 'stack-1');
			assert.deepEqual(await request(index.get('catalog|a')), { id: 'stack-1', catalog: 'catalog', name: 'first', members: ['catalog|a', 'catalog|b', 'catalog|a'] });
			assert.equal(await request(index.count('catalog|a')), 1);
			assert.equal(await request(index.getKey('absent')), undefined);
			assert.equal(await request(store.index('pair').getKey(['catalog', 'first'])), 'stack-1');
		});
	} finally { db.close(); }
});

for (const operation of ['put', 'add'] as const) {
	test(`unique multiEntry ${operation} refuses shared members atomically and permits replacing its own row`, async () => {
		const db = await database();
		try {
			await transaction(db, 'readwrite', async store => { await request(store.put({ id: 'first', members: ['a', 'b'] })); });
			await assert.rejects(transaction(db, 'readwrite', async store => {
				await request(store.put({ id: 'unrelated', members: ['c'] }));
				await request(store[operation]({ id: 'second', members: ['b', 'd'] }));
			}), { name: 'ConstraintError' });
			await transaction(db, 'readonly', async store => {
				assert.equal(await request(store.get('second')), undefined); assert.equal(await request(store.get('unrelated')), undefined);
			});
			await transaction(db, 'readwrite', async store => { await request(store.put({ id: 'first', members: ['b', 'a'] })); });
			await transaction(db, 'readonly', async store => { assert.equal(await request(store.index('memberKey').getKey('a')), 'first'); });
		} finally { db.close(); }
	});
}
