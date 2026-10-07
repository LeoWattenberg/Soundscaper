/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ScapeExpandedByteBudget } from '../src/common/editor/scape-expanded-byte-budget.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../src/common/editor/scape-archive-envelope.ts';
import { encodePhotoCatalogPackV1, PHOTO_CATALOG_PACK_LIMITS_V1 } from '../src/lightscaper/archive/catalog-pack.ts';
import { readPhotoCatalogPackEntryV1 } from '../src/lightscaper/archive/catalog-pack-entry.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

async function encoded(): Promise<Uint8Array<ArrayBuffer>> {
	const parts: Uint8Array[] = [];
	for await (const part of encodePhotoCatalogPackV1([photoArchiveFixture()])) parts.push(part);
	return new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer());
}

function descriptor(bytes: Uint8Array): ScapeAssetDescriptor {
	return { sourceId: 'pack', entry: 'assets/photo-pack-000001.bin', kind: 'photo-catalog-pack',
		encoding: 'lightscaper-photo-pack-v1', size: bytes.byteLength, sha256: digestScapeBytes(bytes) };
}

function entry(bytes: Uint8Array, emit?: (writer: WritableStreamDefaultWriter<Uint8Array>) => Promise<void>): ScapeArchiveEntry {
	return { filename: 'assets/photo-pack-000001.bin', directory: false, encrypted: false,
		compressionMethod: 0, compressedSize: bytes.byteLength, uncompressedSize: bytes.byteLength,
		async getData(writable) {
			const writer = writable.getWriter();
			try {
				if (emit) await emit(writer); else { await writer.write(bytes); await writer.close(); }
			} finally { writer.releaseLock(); }
		} };
}

async function drain(_photo: unknown, original: AsyncIterable<Uint8Array>): Promise<void> {
	for await (const bytes of original) assert.ok(bytes.byteLength > 0);
}

test('archive extraction failure before any bytes unblocks the pack decoder', { timeout: 2_000 }, async () => {
	const bytes = await encoded();
	const failure = new Error('archive extraction failed');
	await assert.rejects(readPhotoCatalogPackEntryV1(entry(bytes, async () => { throw failure; }),
		descriptor(bytes), new ScapeExpandedByteBudget(bytes.byteLength), drain), (error: unknown) => error === failure);
});

test('archive extraction failure after staging an original cannot be mistaken for EOF', { timeout: 2_000 }, async () => {
	const bytes = await encoded();
	const failure = new Error('archive trailer verification failed');
	let staged = 0;
	await assert.rejects(readPhotoCatalogPackEntryV1(entry(bytes, async (writer) => { await writer.write(bytes); throw failure; }),
		descriptor(bytes), new ScapeExpandedByteBudget(bytes.byteLength), async (photo, original) => { await drain(photo, original); staged += 1; }),
	(error: unknown) => error === failure);
	assert.equal(staged, 1);
});

test('a stage refusal unblocks the archive producer and retains the stage error', { timeout: 2_000 }, async () => {
	const bytes = await encoded();
	const failure = new Error('original storage quota exceeded');
	await assert.rejects(readPhotoCatalogPackEntryV1(entry(bytes), descriptor(bytes), new ScapeExpandedByteBudget(bytes.byteLength),
		async () => { throw failure; }), (error: unknown) => error === failure);
});

test('outer pack SHA verification is mandatory even when every original digest is valid', async () => {
	const bytes = await encoded();
	const altered = { ...descriptor(bytes), sha256: '0'.repeat(64) };
	await assert.rejects(readPhotoCatalogPackEntryV1(entry(bytes), altered, new ScapeExpandedByteBudget(bytes.byteLength), drain), /SHA-256/iu);
});

test('actual emitted bytes share the archive expansion budget', async () => {
	const bytes = await encoded();
	await assert.rejects(readPhotoCatalogPackEntryV1(entry(bytes), descriptor(bytes), new ScapeExpandedByteBudget(bytes.byteLength - 1), drain), /expanded-byte limit/iu);
});

test('oversized native emissions refuse before retaining a pack chunk', async () => {
	const bytes = new Uint8Array(PHOTO_CATALOG_PACK_LIMITS_V1.maximumChunkBytes + 1);
	await assert.rejects(readPhotoCatalogPackEntryV1(entry(bytes), descriptor(bytes), new ScapeExpandedByteBudget(bytes.byteLength), drain), /chunk bound/iu);
});

test('byte geometry accessors are refused without invoking them at the archive boundary', async () => {
	const bytes = await encoded();
	const asset = descriptor(bytes);
	const source = entry(bytes);
	Object.defineProperty(bytes, 'byteLength', { get() { assert.fail('Byte geometry accessor must not execute.'); } });
	await assert.rejects(readPhotoCatalogPackEntryV1(source, asset, new ScapeExpandedByteBudget(asset.size), drain), /intrinsic byte chunks/iu);
});

test('shared and resizable buffers are refused before hashing or staging', async () => {
	const bytes = await encoded();
	const asset = descriptor(bytes);
	const resizable = Reflect.construct(ArrayBuffer, [bytes.byteLength, { maxByteLength: bytes.byteLength + 1 }]) as ArrayBuffer;
	const variants = [new Uint8Array(new SharedArrayBuffer(bytes.byteLength)), new Uint8Array(resizable)];
	for (const variant of variants) {
		variant.set(bytes);
		await assert.rejects(readPhotoCatalogPackEntryV1(entry(variant), asset, new ScapeExpandedByteBudget(asset.size), drain), /fixed byte buffers/iu);
	}
});
