/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodePhotoSmartCollectionPackV1, measurePhotoSmartCollectionPackRecordV1,
	PHOTO_SMART_COLLECTION_PACK_LIMITS_V1, readPhotoSmartCollectionPackV1 } from '../src/lightscaper/archive/smart-collection-pack-v1.ts';
import { normalizePhotoSmartCollectionV1, type PhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';

const encoder = new TextEncoder();
function definition(id = 'saved-1', predicate: unknown = null): PhotoSmartCollectionV1 {
	return normalizePhotoSmartCollectionV1({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: 'catalog-1', id,
		revision: 17, name: 'Camera selection 界', query: { schemaVersion: 2, kind: 'photo-catalog-query', text: 'Keyword Name',
			filter: { kind: 'collection', id: 'root-only' }, sort: { field: 'capture-time', direction: 'descending' }, predicate } });
}
function frame(text: string | Uint8Array): Uint8Array {
	const body = typeof text === 'string' ? encoder.encode(text) : text;
	const bytes = new Uint8Array(12 + body.byteLength); bytes.set(encoder.encode('LSSMART1'));
	new DataView(bytes.buffer).setUint32(8, body.byteLength, true); bytes.set(body, 12); return bytes;
}
async function bytes(source: AsyncIterable<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
	const parts: Uint8Array<ArrayBuffer>[] = [];
	for await (const part of source) parts.push(new Uint8Array(part));
	return new Uint8Array(await new Blob(parts).arrayBuffer());
}
async function* split(value: Uint8Array, span = 3) {
	for (let offset = 0; offset < value.byteLength; offset += span) yield value.subarray(offset, offset + span);
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve };
}
const ignore = async (): Promise<void> => {};

test('canonical LSSMART1 roundtrip preserves all six FullQuery2 fields and nested rule semantics', async () => {
	const recipe = definition('saved-1', { kind: 'all', terms: [
		{ kind: 'not', term: { kind: 'any', terms: [{ kind: 'keyword', id: 'kw' }, { kind: 'folder', id: 'folder' }] } },
		{ kind: 'text', column: 'camera-make', operator: 'equals', value: 'Canon' },
		{ kind: 'number', column: 'iso', minimum: 100, maximum: 400 },
		{ kind: 'presence', column: 'lens', value: 'unknown' },
		{ kind: 'time', column: 'capture-time', from: '2026-10-08T12:00:00.000', to: null },
	] });
	const expected = JSON.stringify(recipe), encoded = await bytes(encodePhotoSmartCollectionPackV1([recipe]));
	assert.deepEqual(encoded, frame(expected));
	assert.equal(measurePhotoSmartCollectionPackRecordV1(recipe), 4 + encoder.encode(expected).byteLength);
	const restored: PhotoSmartCollectionV1[] = [];
	assert.equal(await readPhotoSmartCollectionPackV1(split(encoded), async value => { restored.push(value); }), 1);
	assert.deepEqual(restored, [recipe]); assert.notEqual(restored[0], recipe);
	assert.deepEqual(Object.keys(restored[0]!.query), ['schemaVersion', 'kind', 'text', 'filter', 'sort', 'predicate']);
	assert.ok(Object.isFrozen(restored[0]!.query.predicate));
	assert.equal('referenceKeys' in restored[0]!, false); assert.equal('document' in restored[0]!, false);
});

test('explicit null fields and the fully specified default query remain lossless', async () => {
	const recipe = { ...definition(), query: { schemaVersion: 2 as const, kind: 'photo-catalog-query' as const,
		text: '', filter: null, sort: { field: 'photo-id' as const, direction: 'ascending' as const }, predicate: null } };
	const encoded = await bytes(encodePhotoSmartCollectionPackV1([recipe]));
	await readPhotoSmartCollectionPackV1(split(encoded), async value => { assert.deepEqual(value, recipe); });
	assert.deepEqual(await bytes(encodePhotoSmartCollectionPackV1([])), encoder.encode('LSSMART1'));
	assert.equal(await readPhotoSmartCollectionPackV1(split(encoder.encode('LSSMART1')), ignore), 0);
});

test('emitted magic is privately owned and cannot corrupt future encoding or format admission', async () => {
	const output = encodePhotoSmartCollectionPackV1([]), prefix = (await output.next()).value;
	assert.ok(prefix); prefix.fill(0); await output.return(undefined);
	assert.deepEqual(await bytes(encodePhotoSmartCollectionPackV1([])), encoder.encode('LSSMART1'));
	assert.equal(await readPhotoSmartCollectionPackV1(split(encoder.encode('LSSMART1')), ignore), 0);
	await assert.rejects(readPhotoSmartCollectionPackV1(split(new Uint8Array(8)), ignore), /format/iu);
});

test('missing or undefined complete-query fields refuse instead of defaulting during encode or read', async () => {
	for (const field of ['schemaVersion', 'kind', 'text', 'filter', 'sort', 'predicate'] as const) {
		const query: Record<string, unknown> = { ...definition().query }; delete query[field];
		const bad = { ...definition(), query };
		await assert.rejects(bytes(encodePhotoSmartCollectionPackV1([bad as unknown as PhotoSmartCollectionV1])));
		assert.throws(() => measurePhotoSmartCollectionPackRecordV1(bad));
		let consumed = 0;
		await assert.rejects(readPhotoSmartCollectionPackV1(split(frame(JSON.stringify(bad))), async () => { consumed += 1; }));
		assert.equal(consumed, 0);
		await assert.rejects(bytes(encodePhotoSmartCollectionPackV1([{ ...definition(), query: { ...definition().query,
			[field]: undefined } } as unknown as PhotoSmartCollectionV1])));
	}
});

test('future, foreign, malformed nested and defaulted query forms refuse before staging', async () => {
	const recipe = definition();
	const bad = [{ ...recipe, schemaVersion: 2 }, { ...recipe, query: { ...recipe.query, schemaVersion: 3 } },
		{ ...recipe, query: { ...recipe.query, kind: 'photo-smart-query' } },
		{ ...recipe, query: { ...recipe.query, sort: { field: 'photo-id' } } },
		{ ...recipe, query: { ...recipe.query, predicate: { kind: 'number', column: 'iso', minimum: 2 } } },
		{ ...recipe, query: { ...recipe.query, predicate: { kind: 'not' } } },
		{ ...recipe, query: { ...recipe.query, filter: { kind: 'keyword' } } },
		{ ...recipe, original: { bytes: 'forbidden' } }, { ...recipe, query: null }, { ...recipe, query: undefined }];
	for (const value of bad) {
		let staged = 0;
		await assert.rejects(readPhotoSmartCollectionPackV1(split(frame(JSON.stringify(value))), async () => { staged += 1; }));
		assert.equal(staged, 0);
	}
});

test('future definition admission refuses before touching an unsupported nested query', async () => {
	let visits = 0;
	const query = new Proxy({}, { getPrototypeOf() { visits += 1; throw new Error('nested query traversed'); } });
	const future = { ...definition(), schemaVersion: 2, query };
	assert.throws(() => measurePhotoSmartCollectionPackRecordV1(future), /version/iu);
	await assert.rejects(bytes(encodePhotoSmartCollectionPackV1([future as unknown as PhotoSmartCollectionV1])), /version/iu);
	assert.equal(visits, 0);
});

test('reader authenticates exact canonical JSON bytes rather than repairing persisted spelling or ordering', async () => {
	const recipe = definition(), canonical = JSON.stringify(recipe), { name, ...rest } = recipe;
	const noncanonical = [JSON.stringify(recipe, null, 2), ` ${canonical}`, canonical.replace('keyword name', 'Keyword Name'),
		JSON.stringify({ name, ...rest }), canonical.replace('"revision":17', '"revision":17.0'),
		canonical.replace('界', '\\u754c')];
	for (const value of noncanonical) await assert.rejects(readPhotoSmartCollectionPackV1(split(frame(value)), ignore), /canonical/iu);
});

test('UTF8 BOM bytes cannot disappear during canonical record authentication', async () => {
	const canonical = encoder.encode(JSON.stringify(definition())), withBom = new Uint8Array(canonical.byteLength + 3);
	withBom.set([0xef, 0xbb, 0xbf]); withBom.set(canonical, 3); let staged = 0;
	await assert.rejects(readPhotoSmartCollectionPackV1(split(frame(withBom)), async () => { staged += 1; }));
	assert.equal(staged, 0);
});

test('legal maximal escaped/lone-surrogate recipes retain every term within the versioned record bound', async () => {
	assert.deepEqual(PHOTO_SMART_COLLECTION_PACK_LIMITS_V1, { maximumRecordBytes: 528_384,
		maximumRecords: 64, maximumPackBytes: 8_388_608, maximumChunkBytes: 4_194_304 });
	for (const sample of ['\ud800', '\udfff', '界', '"', '\\']) {
		const terms = Array.from({ length: 255 }, () => ({ kind: 'text', column: 'caption', operator: 'equals', value: sample.repeat(256) }));
		const recipe = normalizePhotoSmartCollectionV1({ ...definition('i'.repeat(128), { kind: 'all', terms }),
			catalogId: 'c'.repeat(128), name: sample.repeat(256), revision: Number.MAX_SAFE_INTEGER });
		const encoded = await bytes(encodePhotoSmartCollectionPackV1([recipe]));
		assert.ok(encoded.byteLength - 12 <= PHOTO_SMART_COLLECTION_PACK_LIMITS_V1.maximumRecordBytes);
		await readPhotoSmartCollectionPackV1(split(encoded, 7_777), async value => { assert.deepEqual(value, recipe); });
	}
});

test('record, record-count, pack and emitted-span limits can only tighten hard maxima', async () => {
	const two = [definition(), definition('saved-2')], encoded = await bytes(encodePhotoSmartCollectionPackV1(two));
	await assert.rejects(bytes(encodePhotoSmartCollectionPackV1(two, { maximumRecords: 1 })), /record limit/iu);
	let staged = 0;
	await assert.rejects(readPhotoSmartCollectionPackV1(split(encoded), async () => { staged += 1; }, { maximumRecords: 1 }), /record limit/iu);
	assert.equal(staged, 1);
	for (const options of [{ maximumRecordBytes: 4 }, { maximumPackBytes: 9 }]) {
		await assert.rejects(bytes(encodePhotoSmartCollectionPackV1([definition()], options)), /byte limit/iu);
		await assert.rejects(readPhotoSmartCollectionPackV1(split(encoded), ignore, options), /byte limit/iu);
	}
	for (const options of [{ maximumRecords: 65 }, { maximumRecordBytes: 528_385 }, { maximumPackBytes: 8_388_609 },
		{ maximumChunkBytes: 4_194_305 }, { maximumRecords: 0 }, { maximumRecords: NaN }]) {
		await assert.rejects(bytes(encodePhotoSmartCollectionPackV1([], options)), /tighten/iu);
		await assert.rejects(readPhotoSmartCollectionPackV1(split(encoded), ignore, options), /tighten/iu);
	}
	const spans: number[] = [];
	for await (const chunk of encodePhotoSmartCollectionPackV1(two, { maximumChunkBytes: 3 })) spans.push(chunk.byteLength);
	assert.ok(spans.every(length => length <= 3));
	await assert.rejects(readPhotoSmartCollectionPackV1(split(encoded, 4), ignore, { maximumChunkBytes: 3 }), /chunk/iu);
});

test('actual sixty-four records admit and large legal records hit8MiB before the record-count limit', async () => {
	const records = Array.from({ length: 64 }, (_, index) => definition(`saved-${String(index)}`));
	assert.equal(await readPhotoSmartCollectionPackV1(split(await bytes(encodePhotoSmartCollectionPackV1(records)), 1_024), ignore), 64);
	await assert.rejects(bytes(encodePhotoSmartCollectionPackV1([...records, definition('saved-64')])), /record limit/iu);
	const large = definition('large', { kind: 'all', terms: Array.from({ length: 255 }, () =>
		({ kind: 'text', column: 'caption', operator: 'equals', value: '\ud800'.repeat(256) })) });
	const largeRecords = Array.from({ length: 24 }, (_, index) => ({ ...large, id: `large-${String(index)}` }));
	let emitted = 0;
	await assert.rejects(async () => { for await (const chunk of encodePhotoSmartCollectionPackV1(largeRecords)) emitted += chunk.byteLength; }, /pack.*byte limit/iu);
	assert.ok(emitted <= PHOTO_SMART_COLLECTION_PACK_LIMITS_V1.maximumPackBytes);
});

test('duplicate identities and mixed catalogs refuse without staging the conflicting record', async () => {
	for (const values of [[definition(), definition()], [definition(), { ...definition('other'), catalogId: 'other' }]]) {
		await assert.rejects(bytes(encodePhotoSmartCollectionPackV1(values)), /duplicate|catalog/iu);
		const first = frame(JSON.stringify(values[0])), second = frame(JSON.stringify(values[1])).subarray(8);
		const encoded = new Uint8Array(first.byteLength + second.byteLength); encoded.set(first); encoded.set(second, first.byteLength);
		let staged = 0;
		await assert.rejects(readPhotoSmartCollectionPackV1(split(encoded), async () => { staged += 1; }), /duplicate|catalog/iu);
		assert.equal(staged, 1);
	}
});

test('bad magic, invalid UTF8/JSON, oversize lengths and truncated framing close source without staging', async () => {
	const encoded = frame(JSON.stringify(definition()));
	const oversized = encoded.slice(); new DataView(oversized.buffer).setUint32(8, 528_385, true);
	const empty = encoded.slice(); new DataView(empty.buffer).setUint32(8, 0, true);
	for (const bad of [encoded.subarray(0, 7), encoded.subarray(0, 10), encoded.subarray(0, encoded.byteLength - 1),
		new Uint8Array([0, ...encoded.subarray(1)]), frame(new Uint8Array([0xc3, 0x28])), frame('{'), oversized, empty]) {
		let closed = false, staged = 0;
		async function* source() { try { yield bad; } finally { closed = true; } }
		await assert.rejects(readPhotoSmartCollectionPackV1(source(), async () => { staged += 1; }));
		assert.equal(closed, true); assert.equal(staged, 0);
	}
});

test('descriptor-hostile definitions/options refuse before getter execution or source acquisition', async () => {
	let getters = 0, opened = 0;
	const get = (): never => { getters += 1; throw new Error('getter executed'); };
	const bad = Object.defineProperty({ ...definition() }, 'query', { enumerable: true, get });
	await assert.rejects(bytes(encodePhotoSmartCollectionPackV1([bad])));
	assert.throws(() => measurePhotoSmartCollectionPackRecordV1(bad));
	const options = Object.defineProperty({}, 'maximumRecords', { enumerable: true, get });
	const source = { [Symbol.asyncIterator]() { opened += 1; return split(frame(JSON.stringify(definition()))); } };
	await assert.rejects(readPhotoSmartCollectionPackV1(source, ignore, options));
	await assert.rejects(bytes(encodePhotoSmartCollectionPackV1([], options)));
	await assert.rejects(readPhotoSmartCollectionPackV1(source, ignore, { signal: {} as AbortSignal }));
	assert.equal(getters, 0); assert.equal(opened, 0);
});

test('streaming reader waits for one recipe consumer and never pulls a second record concurrently', async () => {
	const release = deferred<void>(), entered = deferred<void>(); let reads = 0, consumers = 0;
	async function* source() {
		reads += 1; yield frame(JSON.stringify(definition()));
		reads += 1; yield frame(JSON.stringify(definition('second'))).subarray(8);
	}
	const task = readPhotoSmartCollectionPackV1(source(), async () => {
		consumers += 1; if (consumers === 1) { entered.resolve(); await release.promise; }
	});
	await entered.promise; assert.equal(consumers, 1); assert.equal(reads, 1);
	release.resolve(); assert.equal(await task, 2); assert.equal(reads, 2);
});

test('encoder yields one canonical record completely before borrowing the next recipe and joins early close', async () => {
	let reads = 0, closed = false;
	async function* source() { try { reads += 1; yield definition(); reads += 1; yield definition('second'); } finally { closed = true; } }
	const output = encodePhotoSmartCollectionPackV1(source());
	assert.equal((await output.next()).value?.byteLength, 8); assert.equal(reads, 0);
	assert.equal((await output.next()).value?.byteLength, 4); assert.equal(reads, 1);
	assert.deepEqual((await output.next()).value, encoder.encode(JSON.stringify(definition()))); assert.equal(reads, 1);
	await output.return(undefined); assert.equal(closed, true); assert.equal(reads, 1);
});

test('encoder cancellation during held next joins settlement and refuses every remaining record byte', async () => {
	const stop = new AbortController(), started = deferred<void>(), release = deferred<IteratorResult<PhotoSmartCollectionV1>>();
	const cleanup = deferred<void>(); let settled = false, closed = 0;
	const records = { [Symbol.asyncIterator]() { return {
		async next() { started.resolve(); return await release.promise; },
		async return() { closed += 1; await cleanup.promise; return { done: true as const, value: undefined }; },
	}; } };
	const output = encodePhotoSmartCollectionPackV1(records, { signal: stop.signal });
	assert.deepEqual((await output.next()).value, encoder.encode('LSSMART1'));
	const task = output.next(); void task.then(() => { settled = true; }, () => { settled = true; });
	await started.promise; stop.abort('cancelled'); await Promise.resolve(); assert.equal(settled, false);
	release.resolve({ done: false, value: definition() });
	await Promise.resolve(); await Promise.resolve(); assert.equal(settled, false);
	cleanup.resolve(); await assert.rejects(task, error => error === 'cancelled'); assert.equal(closed, 1);
});

test('early encoder close retains a cleanup-only rejection', async () => {
	const cleanup = new Error('record enumeration cleanup failed');
	const records = { [Symbol.asyncIterator]() { return {
		async next() { return { done: false as const, value: definition() }; },
		async return(): Promise<IteratorResult<PhotoSmartCollectionV1>> { throw cleanup; },
	}; } };
	const output = encodePhotoSmartCollectionPackV1(records); await output.next(); await output.next();
	await assert.rejects(output.return(undefined), error => error === cleanup);
});

test('already cancelled native signal refuses before source acquisition with exact opaque reason', async () => {
	const stop = new AbortController(); let traps = 0, opened = 0;
	const reason = new Proxy({}, { get() { traps += 1; throw new Error('reason read'); }, getPrototypeOf() { traps += 1; throw new Error('reason prototype'); } });
	stop.abort(reason);
	const source = { [Symbol.asyncIterator]() { opened += 1; return split(frame(JSON.stringify(definition()))); } };
	for (const task of [readPhotoSmartCollectionPackV1(source, ignore, { signal: stop.signal }),
		bytes(encodePhotoSmartCollectionPackV1([], { signal: stop.signal }))]) {
		let caught = false;
		try { await task; } catch (error) { caught = true; assert.equal(error, reason); }
		assert.equal(caught, true);
	}
	assert.equal(opened, 0); assert.equal(traps, 0);
});

test('cancel during held native-next joins it and iterator cleanup without executing late signal shadows', async () => {
	const stop = new AbortController(), started = deferred<void>(), release = deferred<IteratorResult<Uint8Array>>();
	const cleanup = deferred<void>(); let closed = 0, settled = false, getters = 0, consumed = 0;
	const reason = 17;
	const source = { [Symbol.asyncIterator]() { return {
		async next() { started.resolve(); return await release.promise; },
		async return() { closed += 1; await cleanup.promise; return { done: true as const, value: undefined }; },
	}; } };
	const task = readPhotoSmartCollectionPackV1(source, async () => { consumed += 1; }, { signal: stop.signal });
	void task.then(() => { settled = true; }, () => { settled = true; });
	await started.promise; Object.defineProperty(stop.signal, 'throwIfAborted', { get() { getters += 1; throw new Error('shadow'); } });
	stop.abort(reason); await Promise.resolve(); assert.equal(settled, false);
	release.resolve({ done: false, value: frame(JSON.stringify(definition())) });
	await Promise.resolve(); await Promise.resolve(); assert.equal(settled, false);
	cleanup.resolve(); await assert.rejects(task, error => error === reason);
	assert.equal(closed, 1); assert.equal(consumed, 0); assert.equal(getters, 0);
});

test('consumer cancellation joins consumer settlement and preserves abort plus cleanup failures', async () => {
	const stop = new AbortController(), entered = deferred<void>(), release = deferred<void>();
	const cleanupFailure = new Error('iterator discard failed'), reason = null; let settled = false, consumers = 0;
	const source = { [Symbol.asyncIterator]() { return {
		async next() { return { done: false as const, value: frame(JSON.stringify(definition())) }; },
		async return(): Promise<IteratorResult<Uint8Array>> { throw cleanupFailure; },
	}; } };
	const task = readPhotoSmartCollectionPackV1(source, async () => { consumers += 1; entered.resolve(); await release.promise; }, { signal: stop.signal });
	void task.then(() => { settled = true; }, () => { settled = true; });
	await entered.promise; stop.abort(reason); await Promise.resolve(); assert.equal(settled, false);
	release.resolve(); await assert.rejects(task, error => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [reason, cleanupFailure]); return true;
	}); assert.equal(consumers, 1);
});

test('primary decode/encode failures retain cleanup rejection rather than losing either error', async () => {
	const primary = new Error('provisional write failed'), cleanup = new Error('return failed');
	const source = { [Symbol.asyncIterator]() { return {
		async next() { return { done: false as const, value: frame(JSON.stringify(definition())) }; },
		async return(): Promise<IteratorResult<Uint8Array>> { throw cleanup; },
	}; } };
	await assert.rejects(readPhotoSmartCollectionPackV1(source, async () => { throw primary; }), error => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]); return true;
	});
	const records = { [Symbol.asyncIterator]() { return {
		async next(): Promise<IteratorResult<PhotoSmartCollectionV1>> { throw primary; },
		async return(): Promise<IteratorResult<PhotoSmartCollectionV1>> { throw cleanup; },
	}; } };
	await assert.rejects(bytes(encodePhotoSmartCollectionPackV1(records)), error => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]); return true;
	});
});
