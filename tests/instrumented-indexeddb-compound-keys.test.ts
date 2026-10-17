/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { compareInstrumentedKeys, InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';

test('instrumented compound keys use lexicographic components and respect open range endpoints', () => {
	assert.equal(compareInstrumentedKeys(['scope', 2, 'z'], ['scope', 10, 'a']), -1);
	assert.equal(compareInstrumentedKeys(['scope', 'a'], ['scope', 'a', '']), -1);
	const range = InstrumentedKeyRange.bound(['scope', 2], ['scope', 10], true, false);
	assert.equal(range.includes(['scope', 2]), false);
	assert.equal(range.includes(['scope', 3]), true);
	assert.equal(range.includes(['scope', 10]), true);
	assert.equal(range.includes(['other', 5]), false);
	assert.throws(() => InstrumentedKeyRange.bound(['scope', 10], ['scope', 2]), { name: 'DataError' });
});

test('instrumented indexes traverse compound ranges in both directions with primary-key ties', async () => {
	const factory = createInstrumentedIndexedDB();
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const opening = (factory as unknown as IDBFactory).open('compound', 1);
		opening.onupgradeneeded = () => { opening.result.createObjectStore('rows', { keyPath: 'id' }).createIndex('order', ['catalog', 'rank']); };
		opening.onsuccess = () => resolve(opening.result);
		opening.onerror = () => reject(opening.error);
	});
	await transact(database, ['rows'], 'readwrite', async (stores) => {
		for (const row of [{ id: 'a', catalog: 'c', rank: 10 }, { id: 'b', catalog: 'c', rank: 2 }, { id: 'd', catalog: 'c', rank: 2 }, { id: 'x', catalog: 'other', rank: 2 }]) await request(stores.rows.put(row));
	});
	for (const direction of ['next', 'prev'] as const) {
		const ids = await transact(database, ['rows'], 'readonly', (stores) => new Promise<string[]>((resolve, reject) => {
			const result: string[] = [];
			const cursor = stores.rows.index('order').openCursor(InstrumentedKeyRange.bound(['c', 2], ['c', 10]) as unknown as IDBKeyRange, direction);
			cursor.onerror = () => reject(cursor.error);
			cursor.onsuccess = () => { if (!cursor.result) { resolve(result); return; } result.push(String(cursor.result.primaryKey)); cursor.result.continue(); };
		}));
		assert.deepEqual(ids, direction === 'next' ? ['b', 'd', 'a'] : ['a', 'd', 'b']);
	}
	const jumped = await transact(database, ['rows'], 'readonly', (stores) => new Promise<string[]>((resolve, reject) => {
		const result: string[] = [];
		const cursor = stores.rows.index('order').openCursor(InstrumentedKeyRange.bound(['c', 2], ['c', 10]) as unknown as IDBKeyRange, 'prev');
		cursor.onerror = () => reject(cursor.error);
		cursor.onsuccess = () => {
			if (!cursor.result) { resolve(result); return; }
			result.push(String(cursor.result.primaryKey));
			if (result.length === 1) cursor.result.continuePrimaryKey(['c', 2], 'b'); else cursor.result.continue();
		};
	}));
	assert.deepEqual(jumped, ['a', 'b']);
	assert.equal(factory.stats.activeTransactions, 0); database.close();
});
