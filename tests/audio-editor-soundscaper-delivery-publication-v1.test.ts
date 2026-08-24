/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createSoundscaperDeliveryPublicationGuardV1 } from '../src/common/editor/controller/soundscaper-delivery-publication-v1.ts';
import { createBoundedByteChunk } from '../src/common/editor/platform/bounded-transfer.ts';
import type { MediaByteWriterPort } from '../src/common/editor/platform/media-stream-port.ts';

test('staging owns Buffer bytes before an asynchronous destination can observe caller mutation', async () => {
	let bytesWritten = 0;
	let releaseWrite!: () => void;
	const writeMayFinish = new Promise<void>((resolve) => { releaseWrite = resolve; });
	let received: number[] = [];
	const destination: MediaByteWriterPort = {
		maximumChunkBytes: 16,
		get bytesWritten() { return bytesWritten; },
		write: async ({ chunk }) => {
			await writeMayFinish;
			received = [...chunk.bytes];
			bytesWritten += chunk.byteLength;
		},
		commit: async () => ({ bytesWritten }),
		abort: async () => undefined,
	};
	const guard = createSoundscaperDeliveryPublicationGuardV1(destination);
	const source = Buffer.from([1, 2, 3, 4]);
	const write = guard.writer.write({
		signal: new AbortController().signal,
		chunk: createBoundedByteChunk(source, {
			sequence: 0, maximumByteLength: 4, final: true,
		}),
	});
	source.fill(9);
	releaseWrite();
	await write;

	assert.deepEqual(received, [1, 2, 3, 4]);
	guard.claimPublication({
		fileName: 'master.wav', byteLength: 4,
		sha256: createHash('sha256').update(new Uint8Array([1, 2, 3, 4])).digest('hex'),
	});
	assert.doesNotThrow(() => guard.assertPublicationReady());
});

test('a retried write after a transient destination failure stays publishable', async () => {
	// The guard admits a retry at the same sequence, so the digest must cover
	// only settled writes — hashing before settlement counts the bytes twice
	// and misreports a transient I/O error as staged-byte corruption.
	let bytesWritten = 0;
	let failNext = true;
	const destination: MediaByteWriterPort = {
		maximumChunkBytes: 16,
		get bytesWritten() { return bytesWritten; },
		write: async ({ chunk }) => {
			if (failNext) {
				failNext = false;
				throw new Error('transient destination failure');
			}
			bytesWritten += chunk.byteLength;
		},
		commit: async () => ({ bytesWritten }),
		abort: async () => undefined,
	};
	const guard = createSoundscaperDeliveryPublicationGuardV1(destination);
	const signal = new AbortController().signal;
	const chunk = () => createBoundedByteChunk(new Uint8Array([1, 2, 3, 4]), {
		sequence: 0, maximumByteLength: 4, final: false,
	});
	await assert.rejects(guard.writer.write({ signal, chunk: chunk() }), /transient/u);
	await guard.writer.write({ signal, chunk: chunk() });
	await guard.writer.write({
		signal,
		chunk: createBoundedByteChunk(new Uint8Array([5, 6]), {
			sequence: 1, maximumByteLength: 4, final: true,
		}),
	});

	guard.claimPublication({
		fileName: 'master.wav', byteLength: 6,
		sha256: createHash('sha256').update(new Uint8Array([1, 2, 3, 4, 5, 6])).digest('hex'),
	});
	assert.doesNotThrow(() => guard.assertPublicationReady());
});
