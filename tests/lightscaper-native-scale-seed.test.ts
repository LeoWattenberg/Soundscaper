/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { seedLightscaperNativeScaleV1, LIGHTSCAPER_NATIVE_SCALE_SEED_LIMITS_V1 } from './helpers/lightscaper-native-scale-seed.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

/** Scalar transaction protocol only; the browser specs qualify real native IndexedDB. */
function fixture(hold = false) {
	const entered = deferred<void>(), release = deferred<void>();
	const records = new Map<string, unknown[]>();
	const batchRows: number[] = [];
	let transactions = 0, lookups = 0, puts = 0, aborts = 0, commits = 0;
	const database = { transaction() {
		transactions++;
		const pending = new Map<string, unknown[]>(); let writes = 0, aborted = false;
		const transaction = {
			oncomplete: null as IDBTransaction['oncomplete'], onabort: null as IDBTransaction['onabort'],
			error: null as DOMException | null,
			objectStore(name: string) {
				lookups++;
				return { put(value: unknown) {
					puts++; writes++;
					const values = pending.get(name) ?? []; values.push(structuredClone(value)); pending.set(name, values);
				} } as unknown as IDBObjectStore;
			},
			commit() { commits++; entered.resolve(); void finish(); },
			abort() { aborts++; aborted = true; transaction.error = new DOMException('Fixture aborted.', 'AbortError'); entered.resolve(); void finish(); },
		};
		async function finish() {
			if (hold) await release.promise;
			else await Promise.resolve();
			if (aborted) transaction.onabort?.call(transaction as unknown as IDBTransaction, new Event('abort'));
			else {
				for (const [name, values] of pending) records.set(name, [...(records.get(name) ?? []), ...values]);
				batchRows.push(writes); transaction.oncomplete?.call(transaction as unknown as IDBTransaction, new Event('complete'));
			}
		}
		return transaction as unknown as IDBTransaction;
	} } as unknown as Pick<IDBDatabase, 'transaction'>;
	return { database, entered, release, records, batchRows, stats: () => ({ transactions, lookups, puts, aborts, commits }) };
}

test('serial native seed retains every row and uses one store handle per bounded transaction', async () => {
	const f = fixture(), totalRows = 8_037;
	const result = await seedLightscaperNativeScaleV1(f.database, { storeNames: ['photos', 'summaries'], totalRows,
		createRecords: index => [{ storeName: 'photos', value: { key: index, document: { name: `Photo ${index}`, rating: index % 6 } } },
			{ storeName: 'summaries', value: { key: index, rating: index % 6 } }] });
	assert.deepEqual(f.stats(), { transactions: 3, lookups: 6, puts: totalRows * 2, aborts: 0, commits: 3 });
	assert.deepEqual(f.batchRows, [8_000, 8_000, 74]);
	assert.equal(result.rows, totalRows); assert.equal(result.batches, 3); assert.equal(result.maximumBatchRows, 4_000);
	assert.ok(result.maximumBatchBytes <= LIGHTSCAPER_NATIVE_SCALE_SEED_LIMITS_V1.maximumTransactionBytes);
	assert.deepEqual(f.records.get('photos')?.[8_036], { key: 8_036, document: { name: 'Photo 8036', rating: 2 } });
});

test('seed accounting includes exact escaped UTF8 record bytes and inline Blob bodies', async () => {
	const f = fixture(), value = { key: 'one', text: '\ud800é', blob: new Blob([new Uint8Array([1, 2, 3])]) };
	const result = await seedLightscaperNativeScaleV1(f.database, { storeNames: ['mediaAssets'], totalRows: 1,
		createRecords: () => [{ storeName: 'mediaAssets', value }] });
	assert.equal(result.maximumBatchBytes, new TextEncoder().encode(JSON.stringify(value)).byteLength + 3);
	const stored = f.records.get('mediaAssets')?.[0] as typeof value;
	assert.deepEqual(new Uint8Array(await stored.blob.arrayBuffer()), new Uint8Array([1, 2, 3]));
});

test('oversized seed payload aborts and joins terminal native settlement before releasing admission', async () => {
	const f = fixture(true), blob = new Blob([new Uint8Array(LIGHTSCAPER_NATIVE_SCALE_SEED_LIMITS_V1.maximumTransactionBytes)]);
	const work = seedLightscaperNativeScaleV1(f.database, { storeNames: ['mediaAssets'], totalRows: 1,
		createRecords: () => [{ storeName: 'mediaAssets', value: { key: 'large', blob } }] });
	const refused = assert.rejects(work, /byte bound/u);
	await f.entered.promise; assert.equal(await remainsPending(work), true); assert.equal(f.stats().puts, 0);
	await assert.rejects(seedLightscaperNativeScaleV1(f.database, { storeNames: ['mediaAssets'], totalRows: 1,
		createRecords: () => [{ storeName: 'mediaAssets', value: { key: 'reentry' } }] }), /pending/u);
	f.release.resolve(); await refused; assert.equal(f.records.size, 0); assert.equal(f.stats().aborts, 1);
});

test('held completion blocks overlap and publication until actual settlement', async () => {
	const f = fixture(true);
	const work = seedLightscaperNativeScaleV1(f.database, { storeNames: ['photos'], totalRows: 1,
		createRecords: () => [{ storeName: 'photos', value: { key: 'held' } }] });
	await f.entered.promise; assert.equal(await remainsPending(work), true); assert.equal(f.records.size, 0);
	await assert.rejects(seedLightscaperNativeScaleV1(f.database, { storeNames: ['photos'], totalRows: 1,
		createRecords: () => [{ storeName: 'photos', value: { key: 'overlap' } }] }), /pending/u);
	f.release.resolve(); await work; assert.deepEqual(f.records.get('photos'), [{ key: 'held' }]);
	assert.equal(f.stats().transactions, 1);
});

test('opaque construction failure remains exact and joined through native abort', async () => {
	const f = fixture(true); let inspections = 0;
	const reason = new Proxy({}, { get() { inspections++; throw new Error('Reason inspected.'); },
		getPrototypeOf() { inspections++; throw new Error('Reason prototype inspected.'); } });
	let failure: unknown;
	const work = seedLightscaperNativeScaleV1(f.database, { storeNames: ['photos'], totalRows: 1,
		createRecords: () => { throw reason; } }).catch((error: unknown) => { failure = error; });
	await f.entered.promise; assert.equal(await remainsPending(work), true);
	f.release.resolve(); await work; assert.equal(failure, reason); assert.equal(inspections, 0);
});
