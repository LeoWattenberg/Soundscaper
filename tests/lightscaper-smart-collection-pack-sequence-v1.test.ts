/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoSmartCollectionPackSequence } from '../src/lightscaper/archive/smart-collection-pack-sequence-v1.ts';
import { encodePhotoSmartCollectionPackV1, readPhotoSmartCollectionPackV1, preparePhotoSmartCollectionPackRecordV1,
	PHOTO_SMART_COLLECTION_PACK_LIMITS_V1 as LIMITS } from '../src/lightscaper/archive/smart-collection-pack-v1.ts';
import { normalizePhotoSmartCollectionV1, type PhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';

function recipe(id = 'saved-0', large = false): PhotoSmartCollectionV1 {
	return normalizePhotoSmartCollectionV1({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: 'catalog', id,
		revision: 7, name: 'Saved filter', query: { schemaVersion: 2, kind: 'photo-catalog-query', text: 'keyword name',
			filter: null, sort: { field: 'capture-time', direction: 'descending' }, predicate: large ? { kind: 'all',
				terms: Array.from({ length: 255 }, () => ({ kind: 'text', column: 'caption', operator: 'equals', value: '\ud800'.repeat(256) })) } : null } });
}
function deferred<T>() {
	let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve };
}
async function bytes(source: AsyncIterable<Uint8Array>) {
	const parts: Uint8Array<ArrayBuffer>[] = []; for await (const part of source) parts.push(new Uint8Array(part));
	return new Uint8Array(await new Blob(parts).arrayBuffer());
}
async function* sourceBytes(bytes: Uint8Array) {
	for (let offset = 0; offset < bytes.byteLength; offset += LIMITS.maximumChunkBytes) yield bytes.subarray(offset, offset + LIMITS.maximumChunkBytes);
}

test('sixty-five small recipes split64+1 while only one boundary lookahead is borrowed', async () => {
	const records = Array.from({ length: 65 }, (_, index) => recipe(`saved-${String(index)}`)); let pulled = 0;
	async function* source() { for (const record of records) { pulled += 1; yield record; } }
	const admitted: string[] = [], restored: PhotoSmartCollectionV1[] = [], counts: number[] = [];
	const sequence = new PhotoSmartCollectionPackSequence(source(), value => { admitted.push(value.id); });
	let pack = await sequence.nextPack(); assert.equal(pulled, 1);
	while (pack) {
		const encoded = await bytes(encodePhotoSmartCollectionPackV1(pack)); assert.ok(encoded.byteLength <= LIMITS.maximumPackBytes);
		counts.push(await readPhotoSmartCollectionPackV1(sourceBytes(encoded), async value => { restored.push(value); }));
		if (counts.length === 1) assert.equal(pulled, 65);
		pack = await sequence.nextPack();
	}
	await sequence.close(); assert.deepEqual(counts, [64, 1]); assert.deepEqual(restored, records);
	assert.deepEqual(admitted, records.map(record => record.id));
});

test('actual maximal legal escaped recipes split by measured8MiB bytes rather than a fixed15-record cap', async () => {
	const records = Array.from({ length: 24 }, (_, index) => recipe(`saved-${String(index).padStart(2, '0')}`, true));
	const recordBytes = preparePhotoSmartCollectionPackRecordV1(records[0]).byteLength;
	const expectedFirst = Math.floor((LIMITS.maximumPackBytes - 8) / recordBytes);
	assert.ok(expectedFirst > 15); assert.equal(Math.floor((LIMITS.maximumPackBytes - 8) / (LIMITS.maximumRecordBytes + 4)), 15);
	const sequence = new PhotoSmartCollectionPackSequence(records, () => {}), counts: number[] = [];
	let pack = await sequence.nextPack();
	while (pack) {
		const encoded = await bytes(encodePhotoSmartCollectionPackV1(pack)); assert.ok(encoded.byteLength <= LIMITS.maximumPackBytes);
		counts.push(await readPhotoSmartCollectionPackV1(sourceBytes(encoded), async () => {})); pack = await sequence.nextPack();
	}
	await sequence.close(); assert.deepEqual(counts, [expectedFirst, records.length - expectedFirst]);
});

test('pack preparation privately reuses only exact complete immutable outputs and keeps only scalar size', async () => {
	const raw = structuredClone(recipe()), prepared = preparePhotoSmartCollectionPackRecordV1(raw);
	assert.deepEqual(Object.keys(prepared), ['definition', 'byteLength']); assert.ok(Object.isFrozen(prepared));
	assert.notEqual(prepared.definition, raw); assert.ok(Object.isFrozen(prepared.definition.query.sort));
	assert.equal(preparePhotoSmartCollectionPackRecordV1(prepared.definition).definition, prepared.definition);
	for (const copy of [structuredClone(prepared.definition), { ...prepared.definition }, normalizePhotoSmartCollectionV1(prepared.definition),
		new Proxy(prepared.definition, {})]) assert.notEqual(preparePhotoSmartCollectionPackRecordV1(copy).definition, copy);
	const query = raw.query as { text: string }; query.text = 'mutated'; assert.equal(prepared.definition.query.text, 'keyword name');
	const encoded = await bytes(encodePhotoSmartCollectionPackV1([prepared.definition]));
	assert.equal(encoded.byteLength, 8 + prepared.byteLength);
});

test('opening ownership registers before native next or admission reentry and refuses queued packs', async () => {
	const entered = deferred<void>(), release = deferred<IteratorResult<PhotoSmartCollectionV1>>(); let calls = 0;
	const source = { [Symbol.asyncIterator]() { return { async next() { calls += 1; entered.resolve(); return await release.promise; },
		async return() { return { done: true as const, value: undefined }; } }; } };
	let nested: Promise<AsyncIterable<PhotoSmartCollectionV1> | null> | undefined;
	const sequence = new PhotoSmartCollectionPackSequence(source, () => { nested = sequence.nextPack(); void nested.catch(() => {}); });
	const first = sequence.nextPack(); await entered.promise;
	await assert.rejects(sequence.nextPack(), /previous|active|pending/iu); assert.equal(calls, 1);
	release.resolve({ done: false, value: recipe() }); const pack = await first; assert.ok(pack);
	assert.ok(nested); await assert.rejects(nested, /previous|active|pending/iu);
	await assert.rejects(sequence.nextPack(), /previous|active|pending/iu); await sequence.close(); assert.equal(calls, 1);
});

test('Close joins held next before invoking return and joins held return exactly once', async () => {
	const entered = deferred<void>(), release = deferred<IteratorResult<PhotoSmartCollectionV1>>();
	const returning = deferred<void>(), cleanup = deferred<IteratorResult<PhotoSmartCollectionV1>>(); let returns = 0, closed = false;
	const source = { [Symbol.asyncIterator]() { return { async next() { entered.resolve(); return await release.promise; },
		async return() { returns += 1; returning.resolve(); return await cleanup.promise; } }; } };
	const sequence = new PhotoSmartCollectionPackSequence(source, () => {}), opening = sequence.nextPack(); void opening.catch(() => {});
	await entered.promise; const close = sequence.close(); assert.equal(sequence.close(), close);
	void close.then(() => { closed = true; }); await Promise.resolve(); assert.equal(returns, 0); assert.equal(closed, false);
	release.resolve({ done: false, value: recipe() }); await returning.promise; assert.equal(closed, false);
	cleanup.resolve({ done: true, value: undefined }); await close;
	await assert.rejects(opening, { name: 'AbortError' }); assert.equal(returns, 1);
	await assert.rejects(sequence.nextPack(), /closed|retired/iu);
});

test('partial pack return retires the sequence and releases native enumeration without pulling ahead', async () => {
	let pulled = 0, closed = false;
	async function* source() { try { pulled += 1; yield recipe(); pulled += 1; yield recipe('later'); } finally { closed = true; } }
	const sequence = new PhotoSmartCollectionPackSequence(source(), () => {}), pack = await sequence.nextPack(); assert.ok(pack);
	const iterator = pack[Symbol.asyncIterator](); assert.deepEqual((await iterator.next()).value, recipe());
	await iterator.return?.(); assert.equal(closed, true); assert.equal(pulled, 1);
	await assert.rejects(sequence.nextPack(), /closed|retired/iu); await sequence.close();
});

test('Close while an active pack borrows its next joins that read before one held native return', async () => {
	const entered = deferred<void>(), release = deferred<IteratorResult<PhotoSmartCollectionV1>>();
	const returning = deferred<void>(), cleanup = deferred<IteratorResult<PhotoSmartCollectionV1>>(); let reads = 0, returns = 0, closed = false;
	const source = { [Symbol.asyncIterator]() { return { async next() {
		reads += 1; if (reads === 1) return { done: false as const, value: recipe() }; entered.resolve(); return await release.promise;
	}, async return() { returns += 1; returning.resolve(); return await cleanup.promise; } }; } };
	const sequence = new PhotoSmartCollectionPackSequence(source, () => {}), pack = await sequence.nextPack(); assert.ok(pack);
	const iterator = pack[Symbol.asyncIterator](); await iterator.next();
	const next = iterator.next(); void next.catch(() => {}); await entered.promise;
	const close = sequence.close(); void close.then(() => { closed = true; }); await Promise.resolve(); assert.equal(returns, 0);
	release.resolve({ done: false, value: recipe('late') }); await returning.promise; assert.equal(closed, false);
	cleanup.resolve({ done: true, value: undefined }); await close;
	await assert.rejects(next, { name: 'AbortError' }); assert.equal(returns, 1); assert.equal(reads, 2);
});

test('early pack return reports a genuine native cleanup failure and never retries the return', async () => {
	const failure = new Error('native return failed'); let returns = 0;
	const source = { [Symbol.asyncIterator]() { return { async next() { return { done: false as const, value: recipe() }; },
		async return(): Promise<IteratorResult<PhotoSmartCollectionV1>> { returns += 1; throw failure; } }; } };
	const sequence = new PhotoSmartCollectionPackSequence(source, () => {}), pack = await sequence.nextPack(); assert.ok(pack);
	const iterator = pack[Symbol.asyncIterator](); await iterator.next();
	await assert.rejects(async () => { await iterator.return?.(); }, error => error === failure);
	await assert.rejects(sequence.close(), error => error === failure); assert.equal(returns, 1);
});

test('native cancellation joins held next and preserves opaque reason without inspecting shadows', async () => {
	const stop = new AbortController(), entered = deferred<void>(), release = deferred<IteratorResult<PhotoSmartCollectionV1>>();
	let traps = 0, shadows = 0, returns = 0;
	const reason = new Proxy({}, { get() { traps += 1; throw new Error('opaque'); }, getPrototypeOf() { traps += 1; throw new Error('opaque'); } });
	const source = { [Symbol.asyncIterator]() { return { async next() { entered.resolve(); return await release.promise; },
		async return() { returns += 1; return { done: true as const, value: undefined }; } }; } };
	const sequence = new PhotoSmartCollectionPackSequence(source, () => {}, stop.signal), opening = sequence.nextPack();
	let settled = false; void opening.then(() => { settled = true; }, () => { settled = true; });
	await entered.promise; Object.defineProperty(stop.signal, 'throwIfAborted', { get() { shadows += 1; throw new Error('shadow'); } });
	stop.abort(reason); await Promise.resolve(); assert.equal(settled, false);
	release.resolve({ done: false, value: recipe() });
	let caught = false; try { await opening; } catch (error) { caught = true; assert.equal(error, reason); }
	assert.equal(caught, true); await sequence.close(); assert.equal(returns, 1); assert.equal(traps + shadows, 0);
});

test('admission/next failure and native cleanup failure remain joined and retain both identities', async () => {
	for (const location of ['admission', 'next'] as const) {
		const primary = new Error(`${location} refused`), cleanup = new Error('return failed'); let returns = 0;
		const source = { [Symbol.asyncIterator]() { return { async next() {
			if (location === 'next') throw primary; return { done: false as const, value: recipe() };
		}, async return(): Promise<IteratorResult<PhotoSmartCollectionV1>> { returns += 1; throw cleanup; } }; } };
		const sequence = new PhotoSmartCollectionPackSequence(source, () => { throw primary; });
		await assert.rejects(sequence.nextPack(), error => { assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]); return true; });
		await assert.rejects(sequence.close(), error => error === cleanup); assert.equal(returns, 1);
	}
});

test('cancelled/invalid native signal and malformed complete recipe refuse before port/guard traversal', async () => {
	const stop = new AbortController(); stop.abort('cancelled'); let opened = 0, admitted = 0;
	const source = { [Symbol.asyncIterator]() { opened += 1; return (async function* () { yield recipe(); })(); } };
	assert.throws(() => new PhotoSmartCollectionPackSequence(source, () => {}, stop.signal), error => error === 'cancelled');
	assert.throws(() => new PhotoSmartCollectionPackSequence(source, () => {}, {} as AbortSignal)); assert.equal(opened, 0);
	const bad = { ...recipe(), query: { schemaVersion: 2, kind: 'photo-catalog-query' } } as unknown as PhotoSmartCollectionV1;
	const sequence = new PhotoSmartCollectionPackSequence([bad], () => { admitted += 1; });
	await assert.rejects(sequence.nextPack(), /required/iu); assert.equal(admitted, 0); await sequence.close();
});
