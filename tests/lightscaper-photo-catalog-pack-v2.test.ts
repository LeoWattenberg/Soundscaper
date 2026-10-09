/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoDocumentV2, serializePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { encodePhotoCatalogPackV1, readPhotoCatalogPackV1 } from '../src/lightscaper/archive/catalog-pack.ts';
import { encodePhotoCatalogPackV2, readPhotoCatalogPackV2, measurePhotoCatalogPackRecordV2 } from '../src/lightscaper/archive/catalog-pack-v2.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
	const parts: Uint8Array[] = []; for await (const bytes of source) parts.push(new Uint8Array(bytes));
	const result = new Uint8Array(parts.reduce((total, bytes) => total + bytes.byteLength, 0)); let offset = 0;
	for (const bytes of parts) { result.set(bytes, offset); offset += bytes.byteLength; } return result;
}
async function* split(bytes: Uint8Array, span = 7) { for (let offset = 0; offset < bytes.byteLength; offset += span) yield bytes.subarray(offset, offset + span); }
function current() {
	const original = photoArchiveFixture(2), first = original.photo.versions[0]!;
	const photo = normalizePhotoDocumentV2({ ...original.photo, schemaVersion: 2, versions: [{ ...first,
		develop: { ...first.develop, processVersion: 2, effects: [{ id: 'lut', type: 'cube-lut-profile-v1', enabled: false,
			params: { lut: { storageKey: `lut-sha256:${'4'.repeat(64)}`, sha256: '4'.repeat(64), byteLength: 88, size: 2,
				domainMin: [0, 0, 0], domainMax: [1, 1, 1] } } }] } }] });
	return { photo, original: original.original };
}
function malformed(encode: unknown, records: unknown): AsyncIterable<Uint8Array> {
	return Reflect.apply(encode as (...args: unknown[]) => unknown, undefined, [records]) as AsyncIterable<Uint8Array>;
}

test('LSCPACK2 roundtrips admitted Photo1/2 and exact originals without changing old pack bytes', async () => {
	const records = [photoArchiveFixture(), current()], bytes = await collect(encodePhotoCatalogPackV2(records));
	assert.equal(new TextDecoder().decode(bytes.subarray(0, 8)), 'LSCPACK2');
	for (const span of [1, 7, 65_536]) {
		const delivered: unknown[] = []; assert.equal(await readPhotoCatalogPackV2(split(bytes, span), async (photo, body) => {
			delivered.push({ photo, original: await collect(body) });
		}), 2);
		assert.deepEqual(delivered, await Promise.all(records.map(async record => ({ photo: record.photo, original: new Uint8Array(await record.original.arrayBuffer()) }))));
	}
	assert.equal(measurePhotoCatalogPackRecordV2(records[1]!.photo), 12 + new TextEncoder().encode(serializePhotoDocumentV1OrV2(records[1]!.photo)).byteLength + 3);
	const old = await collect(encodePhotoCatalogPackV1([photoArchiveFixture()]));
	assert.equal(new TextDecoder().decode(old.subarray(0, 8)), 'LSCPACK1');
	await assert.rejects(readPhotoCatalogPackV1(split(bytes), async () => undefined));
	await assert.rejects(readPhotoCatalogPackV2(split(old), async () => undefined));
	await assert.rejects(collect(malformed(encodePhotoCatalogPackV1, [current()])));
});

test('pack2 retains original digest/framing/drain requirements and refuses future records and raised caps', async () => {
	const record = current(), bytes = await collect(encodePhotoCatalogPackV2([record]));
	const corrupt = new Uint8Array(bytes); corrupt[corrupt.length - 1]! ^= 1;
	await assert.rejects(readPhotoCatalogPackV2(split(corrupt), async (_photo, body) => { await collect(body); }), /digest/iu);
	await assert.rejects(readPhotoCatalogPackV2(split(bytes), async () => undefined), /consume/iu);
	await assert.rejects(collect(malformed(encodePhotoCatalogPackV2, [{ ...record, photo: { ...record.photo, schemaVersion: 3 } }])));
	await assert.rejects(collect(encodePhotoCatalogPackV2([record, record])), /duplicate/iu);
	for (const options of [{ maximumChunkBytes: 4_194_305 }, { maximumPackBytes: 536_870_913 }, { maximumRecords: 4097 }]) {
		await assert.rejects(collect(encodePhotoCatalogPackV2([record], options)), /limit/iu);
	}
});

test('held decoder cancellation joins source retirement and preserves opaque primary plus distinct cleanup', async () => {
	const bytes = await collect(encodePhotoCatalogPackV2([current()])), entered = deferred<void>(), release = deferred<void>(), leave = deferred<void>();
	const stop = new AbortController(); let traps = 0, returned = 0;
	const primary = new Proxy({}, { get() { traps++; throw Error('Reason inspected'); }, getPrototypeOf() { traps++; throw Error('Reason prototype'); } });
	const cleanup = Object.freeze({ cleanup: true }); let offset = 0;
	const source = { [Symbol.asyncIterator]() { return { async next() { entered.resolve(); await release.promise;
		if (offset++) return { done: true as const, value: undefined }; return { done: false as const, value: bytes }; },
		async return() { returned++; await leave.promise; throw cleanup; } }; } };
	let failure: unknown; const work = readPhotoCatalogPackV2(source, async () => undefined, { signal: stop.signal }).catch((error: unknown) => { failure = error; });
	await entered.promise; stop.abort(primary); release.resolve(); assert.equal(await remainsPending(work), true);
	leave.resolve(); await work; assert.ok(failure instanceof AggregateError); assert.equal(failure.errors[0], primary); assert.equal(failure.errors[1], cleanup);
	assert.equal(returned, 1); assert.equal(traps, 0);
});
