/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { normalizePhotoDocumentV2, serializePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { encodePhotoCatalogPackV2, readPhotoCatalogPackV2, measurePhotoCatalogPackRecordV2 } from '../src/lightscaper/archive/catalog-pack-v2.ts';
import { encodePhotoCatalogPackV3, readPhotoCatalogPackV3, measurePhotoCatalogPackRecordV3 } from '../src/lightscaper/archive/catalog-pack-v3.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const BODY = new Uint8Array([83, 67, 77, 65, 83, 75, 48, 49, 2, 0, 0, 0, 1, 0, 0, 0, 0, 255]);
const SHA = createHash('sha256').update(BODY).digest('hex'), KEY = `brush-mask-v1:2:1:${SHA}`;
function fixture() {
	const record = photoArchiveFixture(), version = record.photo.versions[0]!;
	const photo = normalizePhotoDocumentV2({ ...record.photo, schemaVersion: 2, versions: [{ ...version, develop: {
		...version.develop, processVersion: 2, masks: [{ schemaVersion: 1, id: 'brush', kind: 'matte',
			inputs: [{ name: 'Body', kind: 'raster', sourceRef: KEY }], nodes: [{ id: 'alpha', kind: 'raster', inputName: 'Body', channel: 'alpha' }], outputNodeId: 'alpha' }],
		effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled: false, params: { exposure: 1 } }],
		maskBindings: [{ effectId: 'tone', maskId: 'brush' }],
	} }] });
	return { photo, original: record.original };
}
async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
	const parts: Uint8Array[] = []; for await (const bytes of source) parts.push(new Uint8Array(bytes));
	const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0)); let offset = 0;
	for (const part of parts) { result.set(part, offset); offset += part.byteLength; } return result;
}
async function* split(bytes: Uint8Array, span = 7) { for (let offset = 0; offset < bytes.byteLength; offset += span) yield bytes.subarray(offset, offset + span); }
function literalPack(photo: unknown, original = new Uint8Array([1, 2, 3])) {
	const metadata = new TextEncoder().encode(JSON.stringify(photo)), result = new Uint8Array(20 + metadata.length + original.length);
	result.set(new TextEncoder().encode('LSCPACK3')); const header = new DataView(result.buffer, 8, 12);
	header.setUint32(0, metadata.length, true); header.setBigUint64(4, BigInt(original.length), true);
	result.set(metadata, 20); result.set(original, 20 + metadata.length); return result;
}

test('LSCPACK3 reads independently framed brush Photo2 and preserves exact originals across byte boundaries', async () => {
	const record = fixture(), bytes = literalPack(record.photo);
	for (const span of [1, 7, 65_536]) {
		const delivered: unknown[] = []; assert.equal(await readPhotoCatalogPackV3(split(bytes, span), async (photo, body) => {
			delivered.push({ photo, original: await collect(body) });
		}), 1); assert.deepEqual(delivered, [{ photo: record.photo, original: new Uint8Array([1, 2, 3]) }]);
	}
	const encoded = await collect(encodePhotoCatalogPackV3([record]));
	assert.equal(new TextDecoder().decode(encoded.subarray(0, 8)), 'LSCPACK3');
	assert.equal(measurePhotoCatalogPackRecordV3(record.photo), 12 + new TextEncoder().encode(serializePhotoDocumentV1OrV2(record.photo)).length + 3);
});

test('direct LSCPACK2 remains brush-refusing before original authority and never accepts pack3 magic', async () => {
	const record = fixture(); let reads = 0;
	const hostileOriginal = new Proxy({}, { get() { reads++; throw new Error('Original read'); }, getPrototypeOf() { reads++; throw new Error('Original prototype'); } });
	assert.throws(() => measurePhotoCatalogPackRecordV2(record.photo), /portable body transport/u);
	await assert.rejects(collect(Reflect.apply(encodePhotoCatalogPackV2, undefined, [[{ photo: record.photo, original: hostileOriginal }]]) as AsyncIterable<Uint8Array>));
	assert.equal(reads, 0);
	await assert.rejects(readPhotoCatalogPackV2(split(literalPack(record.photo)), async () => undefined), /format/u);
	const old = await collect(encodePhotoCatalogPackV2([photoArchiveFixture()]));
	assert.equal(new TextDecoder().decode(old.subarray(0, 8)), 'LSCPACK2');
	await assert.rejects(readPhotoCatalogPackV3(split(old), async () => undefined), /format/u);
});

test('pack3 keeps original digest, complete-drain, identity and hard capacity fences', async () => {
	const record = fixture(), bytes = literalPack(record.photo), bad = new Uint8Array(bytes); bad[bad.length - 1]! ^= 1;
	await assert.rejects(readPhotoCatalogPackV3(split(bad), async (_photo, body) => { await collect(body); }), /digest/u);
	await assert.rejects(readPhotoCatalogPackV3(split(bytes), async () => undefined), /consume/u);
	await assert.rejects(collect(encodePhotoCatalogPackV3([record, record])), /duplicate/u);
	for (const options of [{ maximumRecords: 4097 }, { maximumPackBytes: 536_870_913 }, { maximumChunkBytes: 4_194_305 }]) {
		await assert.rejects(collect(encodePhotoCatalogPackV3([record], options)), /limit/u);
	}
	const metadata = structuredClone(record.photo); Reflect.set(metadata, 'schemaVersion', 3);
	await assert.rejects(readPhotoCatalogPackV3(split(literalPack(metadata)), async () => undefined));
});

test('pack3 cancellation after held demand joins actual source return and keeps opaque primary with distinct cleanup', async t => {
	const entered = deferred<void>(), release = deferred<void>(), leave = deferred<void>(), stop = new AbortController();
	const reason = Object.freeze({ opaque: true }), cleanup = Object.freeze({ cleanup: true }); let returned = 0;
	const source = { [Symbol.asyncIterator]() { return { async next() { entered.resolve(); await release.promise;
		return { done: false as const, value: literalPack(fixture().photo) }; }, async return() { returned++; await leave.promise; throw cleanup; } }; } };
	const outcome = readPhotoCatalogPackV3(source, async () => undefined, { signal: stop.signal }).then(
		() => ({ failed: false as const }), (error: unknown) => ({ failed: true as const, error }));
	t.after(async () => { release.resolve(); leave.resolve(); await outcome; });
	await entered.promise; stop.abort(reason); release.resolve(); assert.equal(await remainsPending(outcome), true);
	leave.resolve(); const result = await outcome; assert.ok(result.failed); assert.ok(result.error instanceof AggregateError);
	assert.equal(result.error.errors[0], reason); assert.equal(result.error.errors[1], cleanup); assert.equal(returned, 1);
});
