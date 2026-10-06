/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { syncPcmWriter } from '../src/common/editor/storage/opfs-sync-writer-adapters.ts';
import { OpfsSyncRepositoryBridge } from '../src/common/editor/storage/opfs-sync-repository-bridge.ts';
import { MAXIMUM_OPFS_SYNC_CHUNK_BYTES } from '../src/common/editor/storage/opfs-sync-worker-protocol.ts';
import type { OpfsSyncStoragePort } from '../src/common/editor/storage/opfs-sync-worker-client.ts';
import { PCM_ENCODING_WAVPACK_F32_V1 } from '../src/common/editor/wavpack/pcm.js';

test('expanded PCM containers retain the 16 MiB OPFS worker message ceiling', async () => {
	const lengths: number[] = [];
	const writer = syncPcmWriter('expanded.scpcm', {
		async write(bytes) {
			if (bytes.byteLength > MAXIMUM_OPFS_SYNC_CHUNK_BYTES) throw new Error('The OPFS transfer budget was exceeded.');
			lengths.push(bytes.byteLength);
		},
		async close() {}, async abort() {},
	}, {}, () => {}, async () => {});
	await writer.write({ frames: 65_536, channelCount: 64, sampleRate: 48_000, chunkFrames: 65_536,
		encoding: PCM_ENCODING_WAVPACK_F32_V1, payload: new ArrayBuffer(MAXIMUM_OPFS_SYNC_CHUNK_BYTES + 1), pcmCrc32: 0 });
	const statistics = await writer.close();
	assert.deepEqual(lengths, [32, MAXIMUM_OPFS_SYNC_CHUNK_BYTES, 1, 24, 32]);
	assert.equal(statistics.storedBytes, MAXIMUM_OPFS_SYNC_CHUNK_BYTES + 1);
});

test('expanded PCM worker reads remain bounded and reject changed snapshots between segments', async () => {
	const size = MAXIMUM_OPFS_SYNC_CHUNK_BYTES + 1;
	const requests: { offset: number; length: number }[] = [];
	let changeLast = false;
	let truncate = false;
	const callbacks: { afterRead?: () => void } = {};
	const client: OpfsSyncStoragePort = {
		async initialize() { return true; },
		async read(_operation, _path, range) {
			if (range.length > MAXIMUM_OPFS_SYNC_CHUNK_BYTES) throw new Error('The OPFS transfer budget was exceeded.');
			requests.push(range);
			if (range.length) callbacks.afterRead?.();
			return { size: changeLast && range.offset > 0 ? size + 1 : size,
				bytes: new Uint8Array(range.length - (truncate && range.length ? 1 : 0)).fill(range.offset ? 2 : 1) };
		},
		async snapshot() { throw new Error('No full snapshot is needed.'); },
		async openWriter() { throw new Error('No writer is needed.'); },
		async remove() {}, close() {},
	};
	const directory = { async getFileHandle() { throw new Error('No fallback file should be read.'); } } as unknown as FileSystemDirectoryHandle;
	const bridge = new OpfsSyncRepositoryBridge({ client });
	const file = await bridge.readable(directory, 'canonical-pcm-chunk-read', 'expanded.scpcm');
	assert.ok(file);
	const bytes = new Uint8Array(await file.arrayBuffer());
	assert.deepEqual(requests, [{ offset: 0, length: 0 }, { offset: 0, length: MAXIMUM_OPFS_SYNC_CHUNK_BYTES },
		{ offset: MAXIMUM_OPFS_SYNC_CHUNK_BYTES, length: 1 }]);
	assert.equal(bytes.byteLength, size);
	assert.equal(bytes[MAXIMUM_OPFS_SYNC_CHUNK_BYTES - 1], 1);
	assert.equal(bytes[MAXIMUM_OPFS_SYNC_CHUNK_BYTES], 2);
	changeLast = true;
	await assert.rejects(file.arrayBuffer(), /changed/iu);
	changeLast = false;
	truncate = true;
	await assert.rejects(file.arrayBuffer(), /truncated/iu);
	truncate = false;
	const controller = new AbortController();
	const cancelled = await bridge.readable(directory, 'canonical-pcm-chunk-read', 'expanded.scpcm', controller.signal);
	assert.ok(cancelled);
	callbacks.afterRead = () => { controller.abort(); };
	const previousReads = requests.length;
	await assert.rejects(cancelled.arrayBuffer(), { name: 'AbortError' });
	assert.equal(requests.length, previousReads + 1, 'Cancellation stops before requesting the second transfer segment.');
});
