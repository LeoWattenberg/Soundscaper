/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../src/common/editor/scape-archive-envelope.ts';
import { ScapeExpandedByteBudget } from '../src/common/editor/scape-expanded-byte-budget.ts';
import { digestScapeBytes } from '../src/common/editor/scape-byte-stream.ts';
import { encodePhotoStackPackV1 } from '../src/lightscaper/archive/stack-pack.ts';
import { readPhotoStackPackEntryV1 } from '../src/lightscaper/archive/stack-pack-entry.ts';
import { stackArchiveRecord as stack } from './helpers/lightscaper-stack-archive-fixture.ts';

async function encoded() {
	const parts: Uint8Array[] = []; for await (const part of encodePhotoStackPackV1([stack()])) parts.push(part);
	return new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer());
}
function descriptor(bytes: Uint8Array): ScapeAssetDescriptor {
	return { sourceId: 'stack-pack', entry: 'assets/stack-pack-000001.bin', kind: 'photo-stack-pack', encoding: 'lightscaper-stack-pack-v1',
		size: bytes.byteLength, sha256: digestScapeBytes(bytes) };
}
function entry(bytes: Uint8Array, emit?: (writer: WritableStreamDefaultWriter<Uint8Array>) => Promise<void>): ScapeArchiveEntry {
	return { filename: 'assets/stack-pack-000001.bin', directory: false, encrypted: false, compressionMethod: 0,
		compressedSize: bytes.byteLength, uncompressedSize: bytes.byteLength, async getData(writable) {
			const writer = writable.getWriter(); try {
				if (emit) await emit(writer); else { await writer.write(bytes); await writer.close(); }
			} finally { writer.releaseLock(); }
		} };
}

test('stack extraction joins a trailer failure after a normalized record stages', { timeout: 2_000 }, async () => {
	const bytes = await encoded(), failure = new Error('stack trailer failed'); let staged = 0;
	await assert.rejects(readPhotoStackPackEntryV1(entry(bytes, async writer => { await writer.write(bytes); throw failure; }),
		descriptor(bytes), new ScapeExpandedByteBudget(bytes.length), async value => { assert.deepEqual(value, stack()); staged += 1; }), error => error === failure);
	assert.equal(staged, 1);
});

test('stack staging failure unblocks the native extraction promise', { timeout: 2_000 }, async () => {
	const bytes = await encoded(), failure = new Error('stack quota failed');
	await assert.rejects(readPhotoStackPackEntryV1(entry(bytes), descriptor(bytes), new ScapeExpandedByteBudget(bytes.length),
		async () => { throw failure; }), error => error === failure);
});

test('stack extraction enforces actual digest, expanded bytes and4MiB emitted spans', async () => {
	const bytes = await encoded(), asset = descriptor(bytes);
	await assert.rejects(readPhotoStackPackEntryV1(entry(bytes), { ...asset, sha256: '0'.repeat(64) }, new ScapeExpandedByteBudget(bytes.length), async () => {}), /SHA-256/iu);
	await assert.rejects(readPhotoStackPackEntryV1(entry(bytes), asset, new ScapeExpandedByteBudget(bytes.length - 1), async () => {}), /expanded-byte/iu);
	const oversized = new Uint8Array(4 * 1024 * 1024 + 1);
	await assert.rejects(readPhotoStackPackEntryV1(entry(oversized), descriptor(oversized), new ScapeExpandedByteBudget(oversized.length), async () => {}), /chunk bound/iu);
});
