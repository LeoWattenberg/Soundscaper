/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const pointer = { kind: 'photo-library', catalogId: 'old', schemaVersion: 1 };
const replacement = { schemaVersion: 2, kind: 'photo-library', catalogId: 'new', namespaceToken: 'a'.repeat(32) };
const commit = { committed: true };
async function fixture() {
	const raw = createInstrumentedIndexedDB(), name = `publication-${crypto.randomUUID()}`;
	const database = await openDatabase(raw as unknown as IDBFactory, name), memory = getMemoryDatabase(name);
	raw.seedRecord(name, 'settings', { key: 'pointer', value: pointer });
	const transaction = database.transaction.bind(database); let puts = 0, transactions = 0;
	database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
		transactions++; const current = transaction(...args), objectStore = current.objectStore.bind(current);
		current.objectStore = key => {
			const store = objectStore(key), put = store.put.bind(store);
			store.put = ((...values: Parameters<IDBObjectStore['put']>) => { if (key === 'settings') puts++; return put(...values); }) as IDBObjectStore['put'];
			return store;
		}; return current;
	}) as IDBDatabase['transaction'];
	return { raw, name, database, memory, puts: () => puts, transactions: () => transactions,
		values: new KeyValueRepository({ memory, database: async () => database }, 'settings') };
}

test('write admission runs after held lazy acquisition and refuses cancellation before any transaction', async () => {
	const f = await fixture(), gate = deferred<IDBDatabase | null>(), stop = new AbortController(), reason = Object.freeze({ cancel: 'acquire' });
	const values = new KeyValueRepository({ memory: f.memory, database: () => gate.promise }, 'settings');
	let failure: unknown, guarded = 0;
	const work = values.replaceIfCurrentAndPutIfAbsent('pointer', pointer, replacement, 'commit', commit, durable => {
		assert.equal(durable, true); guarded++; stop.signal.throwIfAborted();
	}).catch((error: unknown) => { failure = error; });
	try {
		stop.abort(reason); assert.equal(await remainsPending(work), true); assert.equal(guarded, 0);
		gate.resolve(f.database); await work; assert.equal(failure, reason); assert.equal(guarded, 1);
		assert.equal(f.puts(), 0); assert.equal(f.transactions(), 0);
		assert.deepEqual(f.raw.records(f.name, 'settings'), [{ key: 'pointer', value: pointer }]);
	} finally { gate.resolve(f.database); await work; f.database.close(); }
});

test('late lease loss after conditional reads refuses both puts and joins native settlement', async () => {
	const f = await fixture(), stop = new AbortController(), reason = new Proxy({}, {
		get() { throw new Error('Opaque reason inspected.'); }, getPrototypeOf() { throw new Error('Opaque prototype inspected.'); },
	}); let failure: unknown, guards = 0;
	f.raw.onNextGetForStore('settings', () => { stop.abort(reason); });
	try {
		await f.values.replaceIfCurrentAndPutIfAbsent('pointer', pointer, replacement, 'commit', commit, durable => {
			assert.equal(durable, true); guards++; stop.signal.throwIfAborted();
		}).catch((error: unknown) => { failure = error; });
		assert.equal(failure, reason); assert.equal(guards, 2); assert.equal(f.raw.stats.activeTransactions, 0);
		assert.equal(f.puts(), 0);
		assert.deepEqual(f.raw.records(f.name, 'settings'), [{ key: 'pointer', value: pointer }]);
	} finally { f.database.close(); }
});

test('guarded native pair commits atomically and completion failure leaves neither new row', async () => {
	for (const refuse of [false, true]) {
		const f = await fixture(); let guards = 0;
		if (refuse) f.raw.failNextPutForStore('settings', new Error('Native write refused.'));
		try {
			const operation = f.values.replaceIfCurrentAndPutIfAbsent('pointer', pointer, replacement, 'commit', commit,
				durable => { assert.equal(durable, true); guards++; });
			if (refuse) await assert.rejects(operation); else assert.equal(await operation, true);
			assert.equal(guards, 2); assert.equal(f.raw.stats.activeTransactions, 0);
			assert.deepEqual(f.raw.records(f.name, 'settings'), refuse ? [{ key: 'pointer', value: pointer }]
				: [{ key: 'commit', value: commit }, { key: 'pointer', value: replacement }]);
		} finally { f.database.close(); }
	}
});

test('memory admission receives false, refuses durability and preserves backward-compatible unguarded CAS', async () => {
	const memory = getMemoryDatabase(`publication-memory-${crypto.randomUUID()}`), values = new KeyValueRepository({ memory, database: async () => null }, 'settings');
	await values.put('pointer', pointer); const observed: boolean[] = [];
	await assert.rejects(values.replaceIfCurrentAndPutIfAbsent('pointer', pointer, replacement, 'commit', commit, durable => {
		observed.push(durable); if (!durable) throw new Error('Durable settings required.');
	}), /Durable settings/u);
	assert.deepEqual(observed, [false]); assert.deepEqual(await values.get('pointer'), pointer); assert.equal(await values.get('commit'), undefined);
	assert.equal(await values.replaceIfCurrentAndPutIfAbsent('pointer', pointer, replacement, 'commit', commit), true);
	assert.equal(await values.replaceIfCurrentAndPutIfAbsent('pointer', replacement, pointer, 'commit', commit), false);
});

test('guard is captured and validated before lazy acquisition, and memory checks it immediately before mutation', async () => {
	const memory = getMemoryDatabase(`publication-memory-guard-${crypto.randomUUID()}`); let acquisitions = 0;
	const values = new KeyValueRepository({ memory, database: async () => { acquisitions++; return null; } }, 'settings');
	await assert.rejects(values.replaceIfCurrentAndPutIfAbsent('pointer', pointer, replacement, 'commit', commit, {} as (durable: boolean) => void));
	assert.equal(acquisitions, 0); await values.put('pointer', pointer); let guards = 0;
	await assert.rejects(values.replaceIfCurrentAndPutIfAbsent('pointer', pointer, replacement, 'commit', commit, durable => {
		assert.equal(durable, false); if (++guards === 2) throw new Error('Lease lost before memory writes.');
	}), /Lease lost/u);
	assert.equal(guards, 2); assert.deepEqual(await values.get('pointer'), pointer); assert.equal(await values.get('commit'), undefined);
});
