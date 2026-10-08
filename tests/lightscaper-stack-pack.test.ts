/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodePhotoStackPackV1, readPhotoStackPackV1, PHOTO_STACK_PACK_LIMITS_V1 } from '../src/lightscaper/archive/stack-pack.ts';
import { normalizePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { PhotoStackPackSequence } from '../src/lightscaper/archive/stack-pack-sequence.ts';

const stack = (id = 'stack-1', photoIds = ['photo-2', 'photo-1']) => normalizePhotoStackV1({
	schemaVersion: 1, kind: 'photo-stack', catalogId: 'catalog-1', id, revision: 3,
	photoIds, coverPhotoId: photoIds[1],
});
async function bytes(source: AsyncIterable<Uint8Array>) {
	const parts: Uint8Array[] = []; for await (const part of source) parts.push(part);
	return new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer());
}
async function* split(value: Uint8Array, span = 3) {
	for (let offset = 0; offset < value.length; offset += span) yield value.subarray(offset, offset + span);
}

test('stack packs preserve ordered membership and cover through genuine arbitrarily split bytes', async () => {
	const records = [stack(), stack('stack-2', ['photo-3', 'photo-4'])], encoded = await bytes(encodePhotoStackPackV1(records));
	assert.equal(new TextDecoder().decode(encoded.subarray(0, 8)), 'LSSTACK1');
	const restored: unknown[] = [];
	assert.equal(await readPhotoStackPackV1(split(encoded), async value => { restored.push(value); }), 2);
	assert.deepEqual(restored, records); assert.equal(PHOTO_STACK_PACK_LIMITS_V1.maximumRecordBytes, 256 * 1024);
	assert.equal(PHOTO_STACK_PACK_LIMITS_V1.maximumPackBytes, 8 * 1024 * 1024);
});

test('record/count/pack/chunk bounds tighten without relaxing their hard maxima', async () => {
	await assert.rejects(bytes(encodePhotoStackPackV1([stack(), stack('stack-2')], { maximumRecords: 1 })), /record limit/iu);
	const two = await bytes(encodePhotoStackPackV1([stack(), stack('stack-2')])); let consumed = 0;
	await assert.rejects(readPhotoStackPackV1(split(two), async () => { consumed += 1; }, { maximumRecords: 1 }), /record limit/iu);
	assert.equal(consumed, 1);
	await assert.rejects(bytes(encodePhotoStackPackV1([stack()], { maximumRecordBytes: 8 })), /record.*byte/iu);
	await assert.rejects(bytes(encodePhotoStackPackV1([stack()], { maximumPackBytes: 9 })), /pack.*byte/iu);
	await assert.rejects(bytes(encodePhotoStackPackV1([], { maximumRecords: 1_025 })), /tighten/iu);
	const chunks: Uint8Array[] = []; for await (const chunk of encodePhotoStackPackV1([stack()], { maximumChunkBytes: 3 })) chunks.push(chunk);
	assert.ok(chunks.every(chunk => chunk.length <= 3));
	await assert.rejects(readPhotoStackPackV1(split(await bytes(encodePhotoStackPackV1([stack()])), 4), async () => {}, { maximumChunkBytes: 3 }), /chunk/iu);
});

test('truncation, duplicate identities, mixed catalogs and malformed metadata refuse and close their iterator', async () => {
	const encoded = await bytes(encodePhotoStackPackV1([stack()]));
	for (const bad of [encoded.subarray(0, 7), encoded.subarray(0, encoded.length - 1), new Uint8Array([0, ...encoded.subarray(1)])]) {
		let closed = false;
		async function* source() { try { yield bad; } finally { closed = true; } }
		await assert.rejects(readPhotoStackPackV1(source(), async () => {}), /truncat|format/iu); assert.equal(closed, true);
	}
	await assert.rejects(bytes(encodePhotoStackPackV1([stack(), stack()])), /duplicate/iu);
	await assert.rejects(bytes(encodePhotoStackPackV1([stack(), { ...stack('other'), catalogId: 'catalog-2' }])), /catalog/iu);
	const invalid = encoded.slice(); new DataView(invalid.buffer).setUint32(8, 256 * 1024 + 1, true);
	await assert.rejects(readPhotoStackPackV1(split(invalid), async () => {}), /record.*byte/iu);
});

test('consumer cancellation closes input and cleanup faults retain both failures', async () => {
	const stop = new AbortController(), encoded = await bytes(encodePhotoStackPackV1([stack(), stack('other')]));
	let closed = false;
	async function* source() { try { yield encoded; } finally { closed = true; } }
	await assert.rejects(readPhotoStackPackV1(source(), async () => { stop.abort(); }, { signal: stop.signal }), { name: 'AbortError' });
	assert.equal(closed, true);
	const primary = new Error('staging failed'), cleanup = new Error('iterator cleanup failed');
	const broken = { [Symbol.asyncIterator]() { return {
		async next() { return { done: false as const, value: encoded }; }, async return() { throw cleanup; },
	}; } };
	await assert.rejects(readPhotoStackPackV1(broken, async () => { throw primary; }), error => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]); return true;
	});
});

test('real maximum-width1024-member records split at the actual8MiB ceiling', async () => {
	const members = Array.from({ length: 1_024 }, (_, index) => `photo-${String(index).padStart(4, '0')}${'x'.repeat(118)}`);
	assert.equal(members[0].length, 128);
	const records = Array.from({ length: 64 }, (_, index) => stack(`stack-${index}`, members));
	const sequence = new PhotoStackPackSequence(records, () => {}); let pack = await sequence.nextPack(), count = 0;
	const lengths: number[] = [];
	while (pack) {
		const body = await bytes(encodePhotoStackPackV1(pack)); lengths.push(body.length);
		count += await readPhotoStackPackV1(split(body, 4 * 1024 * 1024), async () => {}); pack = await sequence.nextPack();
	}
	await sequence.close(); assert.equal(count, 64); assert.equal(lengths.length, 2);
	assert.ok(lengths.every(length => length <= 8 * 1024 * 1024));
	await assert.rejects(bytes(encodePhotoStackPackV1(records)), /pack.*byte/iu);
});
