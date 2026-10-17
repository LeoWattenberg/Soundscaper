/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { fakeKeyCursorRequest } from './helpers/instrumented-indexeddb-requests.js';

interface Entry { key: string; primaryKey: string }
interface Transaction {
	finished: boolean;
	database: { stats: { supportsContinuePrimaryKey: boolean; keyCursorRequests: { delivered: number }[] } };
	beginRequest(): void;
	endRequest(): void;
}
const open = fakeKeyCursorRequest as unknown as (transaction: Transaction, data: { name: string; records: Map<string, unknown> },
	entries: readonly Entry[], options: { index: string | null; query?: string; direction: IDBCursorDirection }) => IDBRequest<IDBCursor | null>;
function fixture(index: string | null, direction: IDBCursorDirection = 'next', supported = true) {
	let pending = 0;
	const stats = { supportsContinuePrimaryKey: supported, keyCursorRequests: [] as { delivered: number }[] };
	const transaction: Transaction = { finished: false, database: { stats }, beginRequest() { pending++; }, endRequest() { pending--; } };
	const entries = Array.from({ length: 100 }, (_, i) => ({ key: index === null ? `k${String(i).padStart(2, '0')}` : 'group', primaryKey: `k${String(i).padStart(2, '0')}` }));
	if (direction === 'prev') entries.reverse();
	if (direction.endsWith('unique')) entries.splice(1);
	const request = open(transaction, { name: 'generic', records: new Map() }, entries, { index, direction });
	return { request, stats, transaction, pending: () => pending };
}
function walk(f: ReturnType<typeof fixture>, visit: (cursor: IDBCursor, step: number) => void): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const keys: string[] = [];
		f.request.onerror = () => reject(f.request.error);
		f.request.onsuccess = () => {
			try {
				const cursor = f.request.result;
				if (!cursor) { resolve(keys); return; }
				keys.push(String(cursor.primaryKey)); visit(cursor, keys.length);
				if (keys.length === 2) resolve(keys);
			} catch (error) { reject(error); }
		};
	});
}

test('generic primary key cursors seek forward/reverse targets in two actual deliveries', async () => {
	for (const direction of ['next', 'prev'] as const) {
		const f = fixture(null, direction), target = direction === 'next' ? 'k80' : 'k20';
		assert.deepEqual(await walk(f, (cursor, step) => { if (step === 1) cursor.continue(target); }), [direction === 'next' ? 'k00' : 'k99', target]);
		assert.equal(f.stats.keyCursorRequests[0]?.delivered, 2); assert.equal(f.pending(), 0);
	}
});

test('index key cursors seek exact duplicate primary keys without delivering skipped prefixes', async () => {
	for (const direction of ['next', 'prev'] as const) {
		const f = fixture('by-group', direction), target = direction === 'next' ? 'k80' : 'k20';
		assert.deepEqual(await walk(f, (cursor, step) => { if (step === 1) cursor.continuePrimaryKey('group', target); }), [direction === 'next' ? 'k00' : 'k99', target]);
		assert.equal(f.stats.keyCursorRequests[0]?.delivered, 2); assert.equal(f.pending(), 0);
	}
});

test('native key-cursor constraints reject stale/equal seeks, wrong source and double advance', async () => {
	const f = fixture('by-group');
	await walk(f, (cursor, step) => {
		if (step === 1) {
			assert.throws(() => cursor.continue('group'), { name: 'DataError' });
			assert.throws(() => cursor.continue(Number.NaN), { name: 'DataError' });
			assert.throws(() => cursor.continue(new Date(Number.NaN)), { name: 'DataError' });
			assert.throws(() => cursor.continuePrimaryKey('group', 'k00'), { name: 'DataError' });
			assert.throws(() => cursor.continuePrimaryKey('group', [undefined] as unknown as IDBValidKey), { name: 'DataError' });
			assert.throws(() => cursor.continuePrimaryKey('before', 'k80'), { name: 'DataError' });
			cursor.continuePrimaryKey('group', 'k80');
			assert.throws(() => cursor.continue(), { name: 'InvalidStateError' });
		}
	});
	const primary = fixture(null);
	await walk(primary, (cursor, step) => {
		if (step === 1) { assert.throws(() => cursor.continuePrimaryKey('k80', 'k80'), { name: 'InvalidAccessError' }); cursor.continue('k80'); }
	});
	const unique = fixture('by-group', 'nextunique');
	await walk(unique, (cursor, step) => {
		if (step === 1) { assert.throws(() => cursor.continuePrimaryKey('group', 'k80'), { name: 'InvalidAccessError' }); cursor.continue(); }
	});
});

test('unsupported primary seeking stays absent and completed transactions refuse advancement', async () => {
	const f = fixture('by-group', 'next', false);
	await walk(f, (cursor, step) => { assert.equal(typeof cursor.continuePrimaryKey, 'undefined'); if (step === 1) cursor.continue(); });
	const inactive = fixture('by-group');
	await new Promise<void>((resolve, reject) => {
		inactive.request.onsuccess = () => {
			try {
				inactive.transaction.finished = true;
				assert.throws(() => inactive.request.result!.continue(), { name: 'TransactionInactiveError' });
				assert.throws(() => inactive.request.result!.continuePrimaryKey('group', 'k80'), { name: 'TransactionInactiveError' });
				resolve();
			} catch (error) { reject(error); }
		};
	});
	assert.equal(inactive.pending(), 0);
});
