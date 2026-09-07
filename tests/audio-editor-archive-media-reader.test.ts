/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createArchiveMediaReader } from '../src/common/editor/archive-media-reader.ts';
import { readDawprojectArchive, writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import type { BlobLike } from '../src/common/editor/storage/media-records.ts';

function storedMedia(bytes: Uint8Array<ArrayBuffer>, reads: number[] = []): BlobLike {
	return {
		size: bytes.length, type: 'video/webm',
		slice(start = 0, end = bytes.length) { return storedMedia(bytes.slice(start, end), reads); },
		async arrayBuffer() { reads.push(bytes.length); return bytes.slice().buffer; },
	};
}

void test('DAWproject embeds storage media without requiring a native Blob or a whole-source read', async () => {
	const bytes = new Uint8Array(2_000_000).fill(37);
	const reads: number[] = [];
	const blob = await writeDawprojectArchive({
		projectXml: '<Project/>', metadataXml: '',
		files: [{ path: 'video/original.webm', blob: storedMedia(bytes, reads) }],
	});
	const archive = await readDawprojectArchive(blob);
	try {
		const media = await archive.readEntry('video/original.webm');
		assert.ok(media);
		assert.deepEqual(new Uint8Array(await media.arrayBuffer()), bytes);
		assert.ok(reads.length > 1);
		assert.ok(reads.every(length => length < bytes.length));
	} finally { await archive.close(); }
});

void test('media reader rejects truncated storage reads and invalid ranges', async () => {
	const broken = { ...storedMedia(new Uint8Array([1, 2])), slice: () => storedMedia(new Uint8Array([1])) };
	await assert.rejects(createArchiveMediaReader(broken).readUint8Array(0, 2), /incomplete/);
	await assert.rejects(createArchiveMediaReader(broken).readUint8Array(-1, 1), /range/);
});

void test('media reader observes cancellation after an in-flight read and before another read', async () => {
	const controller = new AbortController();
	const reason = new Error('cancelled');
	let reads = 0;
	const source = storedMedia(new Uint8Array([1]));
	const reader = createArchiveMediaReader({ ...source, slice: () => ({ ...source, async arrayBuffer() {
		reads += 1;
		controller.abort(reason);
		return new ArrayBuffer(1);
	} }) }, controller.signal);
	await assert.rejects(reader.readUint8Array(0, 1), error => error === reason);
	await assert.rejects(reader.readUint8Array(0, 1), error => error === reason);
	assert.equal(reads, 1);
});
