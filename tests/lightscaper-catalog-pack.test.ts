/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import { encodePhotoCatalogPackV1, readPhotoCatalogPackV1, PHOTO_CATALOG_PACK_LIMITS_V1 } from '../src/lightscaper/archive/catalog-pack.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

async function collect(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
	const parts: Uint8Array[] = [];
	for await (const part of chunks) parts.push(part);
	const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
	return bytes;
}

async function* split(bytes: Uint8Array, span = 7): AsyncGenerator<Uint8Array> {
	for (let start = 0; start < bytes.byteLength; start += span) yield bytes.subarray(start, start + span);
}

function recordBytes(metadata: Uint8Array, original: Uint8Array): Uint8Array {
	const bytes = new Uint8Array(20 + metadata.byteLength + original.byteLength);
	bytes.set(new TextEncoder().encode('LSCPACK1'));
	const header = new DataView(bytes.buffer);
	header.setUint32(8, metadata.byteLength, true);
	header.setBigUint64(12, BigInt(original.byteLength), true);
	bytes.set(metadata, 20); bytes.set(original, 20 + metadata.byteLength);
	return bytes;
}

test('empty packs contain only their version header and still obey the byte budget', async () => {
	const encoded = await collect(encodePhotoCatalogPackV1([]));
	assert.equal(new TextDecoder().decode(encoded), 'LSCPACK1');
	assert.equal(await readPhotoCatalogPackV1(split(encoded), async () => { assert.fail('Empty packs have no records.'); }), 0);
	await assert.rejects(collect(encodePhotoCatalogPackV1([], { maximumPackBytes: 7 })), /pack.*limit/iu);
});

test('photo packs deterministically round-trip develop state and byte-identical originals across arbitrary chunk boundaries', async () => {
	const fixtures = [photoArchiveFixture(1), photoArchiveFixture(2, new Uint8Array([7, 9, 12, 13]))];
	const encoded = await collect(encodePhotoCatalogPackV1(fixtures));
	assert.deepEqual(await collect(encodePhotoCatalogPackV1(fixtures)), encoded);
	assert.equal(new TextDecoder().decode(encoded.subarray(0, 8)), 'LSCPACK1');
	for (const span of [1, 7, 13, 65_536]) {
		const recovered: unknown[] = [];
		assert.equal(await readPhotoCatalogPackV1(split(encoded, span), async (photo, original) => {
			recovered.push({ photo, bytes: await collect(original) });
		}), 2);
		assert.deepEqual(recovered, await Promise.all(fixtures.map(async ({ photo, original }) => ({
			photo, bytes: new Uint8Array(await original.arrayBuffer()),
		}))));
	}
});

test('original digest and length are authenticated before a consumer can finish a record', async () => {
	const fixture = photoArchiveFixture();
	await assert.rejects(collect(encodePhotoCatalogPackV1([{ ...fixture, original: new Blob(['wrong']) }])), /length/iu);
	const encoded = await collect(encodePhotoCatalogPackV1([fixture]));
	encoded[encoded.length - 1] ^= 1;
	await assert.rejects(readPhotoCatalogPackV1(split(encoded), async (_photo, original) => { await collect(original); }), /digest/iu);
	await assert.rejects(collect(encodePhotoCatalogPackV1([{ ...fixture,
		photo: { ...fixture.photo, original: { ...fixture.photo.original, contentSha256: '0'.repeat(64) } },
	}])), /digest/iu);
});

test('truncation, unsupported pack revisions, malformed lengths, and unconsumed bodies fail closed', async () => {
	const encoded = await collect(encodePhotoCatalogPackV1([photoArchiveFixture()]));
	for (const length of [0, 1, 7, 9, 19, encoded.length - 1]) {
		await assert.rejects(readPhotoCatalogPackV1(split(encoded.subarray(0, length)), async (_photo, original) => { await collect(original); }), /truncated|header|format/iu);
	}
	const future = encoded.slice(); future[7] = 50;
	await assert.rejects(readPhotoCatalogPackV1(split(future), async () => undefined), /format/iu);
	const oversized = encoded.slice(); new DataView(oversized.buffer).setUint32(8, 0xffff_ffff, true);
	await assert.rejects(readPhotoCatalogPackV1(split(oversized), async () => undefined), /metadata/iu);
	await assert.rejects(readPhotoCatalogPackV1(split(encoded), async () => undefined), /consume/iu);
});

test('pack limits only tighten, bound records and source chunks, and stop before consuming excess original bytes', async () => {
	const encoded = await collect(encodePhotoCatalogPackV1([photoArchiveFixture(1), photoArchiveFixture(2)]));
	await assert.rejects(readPhotoCatalogPackV1(split(encoded), async (_photo, original) => { await collect(original); }, { maximumRecords: 1 }), /record/iu);
	await assert.rejects(collect(encodePhotoCatalogPackV1([photoArchiveFixture()], { maximumPackBytes: 20 })), /pack.*limit/iu);
	await assert.rejects(readPhotoCatalogPackV1(split(encoded), async () => undefined, { maximumRecords: PHOTO_CATALOG_PACK_LIMITS_V1.maximumRecords + 1 }), /hard/iu);
	await assert.rejects(readPhotoCatalogPackV1(split(encoded, encoded.length), async () => undefined, { maximumChunkBytes: 4 }), /chunk/iu);
});

test('duplicate and mixed-catalog records are rejected by both writer and reader', async () => {
	const first = photoArchiveFixture(1);
	const second = photoArchiveFixture(2);
	for (const invalid of [first, { ...second, photo: { ...second.photo, catalogId: 'catalog-2' } }]) {
		await assert.rejects(collect(encodePhotoCatalogPackV1([first, invalid])), /duplicate|different catalogs/iu);
		const firstBytes = await collect(encodePhotoCatalogPackV1([first]));
		const otherBytes = await collect(encodePhotoCatalogPackV1([invalid]));
		const combined = new Uint8Array(firstBytes.length + otherBytes.length - 8);
		combined.set(firstBytes); combined.set(otherBytes.subarray(8), firstBytes.length);
		await assert.rejects(readPhotoCatalogPackV1(split(combined), async (_photo, original) => { await collect(original); }), /duplicate|different catalogs/iu);
	}
});

test('malformed and future metadata and unsafe original lengths never reach the destination', async () => {
	const fixture = photoArchiveFixture();
	const future = new TextEncoder().encode(JSON.stringify({ ...fixture.photo, schemaVersion: 2 }));
	for (const metadata of [future, new Uint8Array([0xff]), new TextEncoder().encode('{}')]) {
		await assert.rejects(readPhotoCatalogPackV1(split(recordBytes(metadata, new Uint8Array([1, 2, 3]))), async () => { assert.fail('Invalid records cannot reach custody.'); }));
	}
	const oversized = await collect(encodePhotoCatalogPackV1([fixture]));
	new DataView(oversized.buffer).setBigUint64(12, 0xffff_ffff_ffff_ffffn, true);
	await assert.rejects(readPhotoCatalogPackV1(split(oversized), async () => { assert.fail('Unsafe length cannot reach custody.'); }), /pack byte limit/iu);
});

test('empty, shared, resizable and shadowed byte views are refused without invoking their accessors', async () => {
	const resizable: unknown = Reflect.construct(ArrayBuffer, [8, { maxByteLength: 16 }]);
	assert.ok(resizable instanceof ArrayBuffer);
	const shadowed = new Uint8Array(8);
	Object.defineProperty(shadowed, 'length', { get() { assert.fail('Shadowed geometry must not be read.'); } });
	for (const bytes of [new Uint8Array(), new Uint8Array(new SharedArrayBuffer(8)), new Uint8Array(resizable), shadowed]) {
		async function* source() { yield bytes; }
		await assert.rejects(readPhotoCatalogPackV1(source(), async () => undefined), /chunk|buffer/iu);
	}
});

test('admitted bytes are sliced through private views without caller methods or constructor species', async () => {
	const encoded = await collect(encodePhotoCatalogPackV1([photoArchiveFixture()]));
	const backing = new Uint8Array(encoded.length + 2); backing.set(encoded, 1);
	const hostile = new Uint8Array(backing.buffer, 1, encoded.length);
	for (const field of ['subarray', 'constructor']) {
		Object.defineProperty(hostile, field, { get() { assert.fail(`Caller ${field} accessor must not run.`); } });
	}
	async function* source() { yield hostile; }
	let recovered: Uint8Array | undefined;
	assert.equal(await readPhotoCatalogPackV1(source(), async (_photo, original) => { recovered = await collect(original); }), 1);
	assert.deepEqual(recovered, new Uint8Array([1, 2, 3]));
});

test('cancellation and consumer failures close the source iterator and preserve the failure', async () => {
	const encoded = await collect(encodePhotoCatalogPackV1([photoArchiveFixture()]));
	let closed = false;
	async function* source() { try { yield* split(encoded); } finally { closed = true; } }
	const stop = new AbortController();
	await assert.rejects(readPhotoCatalogPackV1(source(), async (_photo, original) => {
		stop.abort(); await collect(original);
	}, { signal: stop.signal }), { name: 'AbortError' });
	assert.equal(closed, true);
	closed = false;
	const failure = new Error('destination failed');
	await assert.rejects(readPhotoCatalogPackV1(source(), async () => { throw failure; }), (error) => error === failure);
	assert.equal(closed, true);
});

test('simultaneous consumer and source-cleanup failures retain both causes', async () => {
	const encoded = await collect(encodePhotoCatalogPackV1([photoArchiveFixture()]));
	const failure = new Error('destination failed');
	const cleanup = new Error('source close failed');
	const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({
		next: async () => ({ done: false, value: encoded }),
		return: async () => { throw cleanup; },
	}) };
	await assert.rejects(readPhotoCatalogPackV1(source, async () => { throw failure; }), (error) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.cause, failure);
		assert.deepEqual(error.errors, [failure, cleanup]);
		return true;
	});
});

test('a seeded malformed pack corpus terminates without unbounded reads or metadata interpretation', async () => {
	await fc.assert(fc.asyncProperty(fc.uint8Array({ maxLength: 512 }), async (bytes) => {
		await assert.rejects(readPhotoCatalogPackV1(split(bytes), async (_photo, original) => { await collect(original); }));
	}), { seed: 174_807, numRuns: 300 });
});
