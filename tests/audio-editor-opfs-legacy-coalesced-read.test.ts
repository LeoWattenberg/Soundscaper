/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import type { BlobLike } from '../src/common/editor/storage/media-records.ts';

test('legacy OPFS random reads materialize one bounded planar payload for every channel', async () => {
	const fixture = legacyFixture();
	const chunk = await fixture.repository.readLegacyChunk(fixture.source, 1);
	assert.deepEqual(chunk.channels.map((channel) => [...channel]), [[0.75], [-0.75], [0.125]]);
	assert.deepEqual(fixture.reads, [[32, 40], [40, 52]]);
	chunk.channels[0][0] = 1;
	assert.deepEqual((await fixture.repository.readLegacyChunk(fixture.source, 1)).channels.map((channel) => [...channel]), [[0.75], [-0.75], [0.125]]);
});

test('legacy OPFS sequential reads coalesce each planar payload independently', async () => {
	const fixture = legacyFixture();
	const chunks = [];
	for await (const chunk of fixture.repository.readLegacyChunks(fixture.source)) chunks.push(chunk);
	assert.deepEqual(chunks.map((chunk) => chunk.frames), [2, 1]);
	assert.deepEqual(chunks[0].channels.map((channel) => [...channel]), [[0.25, 0.5], [-0.25, -0.5], [0, 1]]);
	assert.deepEqual(fixture.reads, [[0, 8], [8, 32], [32, 40], [40, 52]]);
});

test('legacy OPFS coalesced payloads reject truncation and cancellation before publication', async () => {
	const abort = new AbortController();
	const reason = new Error('cancel pending payload');
	const cancelled = legacyFixture((start) => { if (start === 40) abort.abort(reason); });
	await assert.rejects(cancelled.repository.readLegacyChunk(cancelled.source, 1, abort.signal), (error) => error === reason);
	const truncated = legacyFixture(undefined, true);
	await assert.rejects(truncated.repository.readLegacyChunk(truncated.source, 1), /truncated/iu);
});

function legacyFixture(afterRead?: (start: number) => void, truncatePayload = false) {
	const chunks = [
		[Float32Array.of(0.25, 0.5), Float32Array.of(-0.25, -0.5), Float32Array.of(0, 1)],
		[Float32Array.of(0.75), Float32Array.of(-0.75), Float32Array.of(0.125)],
	];
	const bytes = new Uint8Array(52);
	let offset = 0;
	for (const channels of chunks) {
		const header = new DataView(bytes.buffer, offset, 8);
		header.setUint32(0, channels[0].length, true);
		header.setUint16(4, channels.length, true);
		offset += 8;
		for (const channel of channels) {
			bytes.set(new Uint8Array(channel.buffer), offset);
			offset += channel.byteLength;
		}
	}
	const blob = new Blob([bytes]);
	const reads: number[][] = [];
	const file: BlobLike = {
		size: blob.size,
		type: '',
		slice(start = 0, end = blob.size) {
			return {
				size: end - start,
				type: '',
				async arrayBuffer() {
					reads.push([start, end]);
					const payload = await blob.slice(start, end).arrayBuffer();
					afterRead?.(start);
					return truncatePayload && start === 40 ? payload.slice(0, -1) : payload;
				},
			} as BlobLike;
		},
		async arrayBuffer() { throw new Error('Whole legacy files must remain streaming.'); },
	};
	const repository = new OpfsRepository({
		preferOpfs: true,
		opfsRoot: {
			async getDirectoryHandle() {
				return { async getFileHandle() { return { async getFile() { return file; } }; } };
			},
		} as unknown as FileSystemDirectoryHandle,
	});
	return { repository, reads, source: { path: 'legacy.pcm', storage: 'opfs', chunkFrames: 2, channelCount: 3 } };
}
