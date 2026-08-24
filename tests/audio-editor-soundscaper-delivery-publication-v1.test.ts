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
