/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { capturePhotoSmartCollectionArchiveV1 } from '../src/lightscaper/catalog/photo-smart-collection-archive-capture-v1.ts';
import { AUDIT_DATABASE, smartCollectionAuditFixtureV1 as fixture } from './helpers/lightscaper-smart-collection-audit-fixture.ts';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(complete => { resolve = complete; });
	return { promise, resolve };
}
/** Hold the actual transport completion ACK, after every request has settled.
 * The native-style transaction and its request semantics remain unchanged. */
function holdCompletion(database: IDBDatabase) {
	const entered = deferred(), release = deferred(), transaction = database.transaction.bind(database);
	let armed = true;
	database.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
		const current = transaction(names, mode);
		if (armed) {
			armed = false;
			let handler: IDBTransaction['oncomplete'] = null;
			Object.defineProperty(current, 'oncomplete', {
				configurable: true, set(value: IDBTransaction['oncomplete']) { handler = value; },
				get() { return (event: Event) => {
					entered.resolve();
					void release.promise.then(() => { handler?.call(current, event); });
				}; },
			});
		}
		return current;
	}) as IDBDatabase['transaction'];
	return { entered: entered.promise, release: () => release.resolve(), restore: () => { database.transaction = transaction; } };
}

test('repository capture closes admission before lazy open and never evaluates hostile option getters', async () => {
	const f = await fixture(); let getterCalls = 0, opens = 0;
	const nativeOpen = f.factory.open.bind(f.factory), factory = { open: ((name: string, version?: number) => {
		opens++; return nativeOpen(name, version);
	}) } as unknown as IDBFactory;
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: factory, databaseName: AUDIT_DATABASE, verifyOriginal: async () => undefined });
	try {
		for (const options of [{ unexpected: true }, { signal: {} }, { get signal() { getterCalls++; throw new Error('getter'); } }]) {
			await assert.rejects(repository.captureSmartCollectionArchiveV1('catalog', options as unknown as
				NonNullable<Parameters<typeof repository.captureSmartCollectionArchiveV1>[1]>));
		}
		await assert.rejects(repository.captureSmartCollectionArchiveV1('bad catalog'));
		const stop = new AbortController(), reason = Object.freeze({ exact: 'native reason' }); stop.abort(reason);
		Object.defineProperty(stop.signal, 'throwIfAborted', { get() { getterCalls++; throw new Error('override'); } });
		await assert.rejects(repository.captureSmartCollectionArchiveV1('catalog', { signal: stop.signal }), error => error === reason);
		assert.equal(getterCalls, 0); assert.equal(opens, 0);
		const source = await repository.captureSmartCollectionArchiveV1('catalog');
		await source.verify(); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.close(); await repository.close(); }
});

test('serial source is one-shot, refuses queued demands and joins an early return with held readonly completion', async () => {
	const f = await fixture(2);
	try {
		const source = await capturePhotoSmartCollectionArchiveV1(f.database, 'catalog'), iterator = source.definitions[Symbol.asyncIterator]();
		assert.throws(() => source.definitions[Symbol.asyncIterator](), /once/iu);
		const gate = holdCompletion(f.database);
		try {
			let nextSettled = false, returnSettled = false;
			const next = iterator.next().finally(() => { nextSettled = true; });
			await gate.entered;
			await assert.rejects(iterator.next(), /pending/iu); await assert.rejects(source.verify(), /pending/iu);
			const returned = iterator.return!().finally(() => { returnSettled = true; });
			await Promise.resolve(); assert.equal(nextSettled, false); assert.equal(returnSettled, false);
			gate.release(); assert.equal((await next).done, true); assert.equal((await returned).done, true);
			await assert.rejects(source.verify(), /incomplete/iu); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { gate.release(); gate.restore(); }
	} finally { f.close(); }
});

test('serial demand is latched before invoking the borrowed transaction port', async () => {
	const f = await fixture(1);
	try {
		const source = await capturePhotoSmartCollectionArchiveV1(f.database, 'catalog'), iterator = source.definitions[Symbol.asyncIterator]();
		const native = f.database.transaction.bind(f.database);
		let reentered = false, refused: Promise<void> | null = null, transactions = 0;
		f.database.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
			transactions++;
			if (!reentered) {
				reentered = true;
				refused = assert.rejects(iterator.next(), /pending/iu);
			}
			return native(names, mode);
		}) as IDBDatabase['transaction'];
		const first = await iterator.next(); await refused;
		assert.equal(first.done, false); assert.equal(transactions, 1);
		f.database.transaction = native;
		await iterator.next(); await source.verify(); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.close(); }
});

test('signal lifetime extends beyond initial capture and preserves opaque late reasons during held source completion', async () => {
	const f = await fixture(2), stop = new AbortController(); let inspections = 0;
	const reason = new Proxy({}, { get() { inspections++; throw new Error('reason get'); },
		getPrototypeOf() { inspections++; throw new Error('reason prototype'); } });
	try {
		const source = await capturePhotoSmartCollectionArchiveV1(f.database, 'catalog', { signal: stop.signal });
		const iterator = source.definitions[Symbol.asyncIterator](), gate = holdCompletion(f.database);
		try {
			const next = iterator.next(), refused = next.then(() => assert.fail('Expected opaque cancellation'), error => { assert.ok(error === reason); });
			await gate.entered; stop.abort(reason);
			let settled = false; void next.then(() => { settled = true; }, () => { settled = true; });
			const returned = iterator.return!(), joined = returned.then(() => assert.fail('Expected joined opaque cancellation'), error => { assert.ok(error === reason); });
			await Promise.resolve(); assert.equal(settled, false);
			gate.release(); await Promise.all([refused, joined]); assert.equal(inspections, 0);
			assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { gate.release(); gate.restore(); }
	} finally { f.close(); }
});

test('original native signal is checked again after capture and after held next without evaluating new overrides', async () => {
	for (const change of ['abort-before-next', 'getter-after-next'] as const) {
		const f = await fixture(1), stop = new AbortController(); let getterCalls = 0;
		try {
			const source = await capturePhotoSmartCollectionArchiveV1(f.database, 'catalog', { signal: stop.signal });
			const iterator = source.definitions[Symbol.asyncIterator]();
			if (change === 'abort-before-next') {
				const gets = f.indexedDB.stats.getRequests.length; stop.abort(17);
				await assert.rejects(iterator.next(), error => error === 17); assert.equal(f.indexedDB.stats.getRequests.length, gets);
			} else {
				const gate = holdCompletion(f.database);
				try {
					const next = iterator.next(), refused = assert.rejects(next, /override|native/iu);
					await gate.entered;
					Object.defineProperty(stop.signal, 'throwIfAborted', { get() { getterCalls++; throw new Error('getter'); } });
					gate.release(); await refused;
				} finally { gate.release(); gate.restore(); }
			}
			assert.equal(getterCalls, 0); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { f.close(); }
	}
});

test('final complete audit joins cancellation while its readonly completion is held', async () => {
	const f = await fixture(1), stop = new AbortController();
	try {
		const source = await capturePhotoSmartCollectionArchiveV1(f.database, 'catalog', { signal: stop.signal });
		for await (const _recipe of source.definitions) { /* Consume without an inventory. */ }
		const gate = holdCompletion(f.database);
		try {
			const reason = 'final opaque reason', verified = source.verify(), refused = assert.rejects(verified, error => error === reason);
			await gate.entered; stop.abort(reason);
			let settled = false; void verified.then(() => { settled = true; }, () => { settled = true; });
			await assert.rejects(source.verify(), /pending/iu); await Promise.resolve(); assert.equal(settled, false);
			gate.release(); await refused; assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { gate.release(); gate.restore(); }
	} finally { f.close(); }
});
