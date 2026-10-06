/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createAiffBlobPcmChunkReader, inspectAiffBlobPcm } from '../src/common/editor/aiff-pcm-chunk-reader.ts';

test('unchanged libsndfile float32 AIFF-C bytes preserve their sample clock and tone', async () => {
	const encoded = await readFile(new URL('./fixtures/libsndfile-float32.aifc.base64', import.meta.url), 'ascii');
	const bytes = Uint8Array.from(Buffer.from(encoded, 'base64'));
	const blob = new Blob([bytes.buffer]);
	const descriptor = await inspectAiffBlobPcm(blob);
	assert.equal(descriptor.container, 'aifc');
	assert.equal(descriptor.sampleFormat, 'float32');
	assert.equal(descriptor.encoding, 'ieee-float');
	assert.equal(descriptor.sampleRate, 48_000);
	assert.equal(descriptor.frameCount, 4_800);
	assert.equal(descriptor.channelCount, 1);
	const reader = createAiffBlobPcmChunkReader(blob, { descriptor, chunkFrames: 4_800 });
	const chunk = await reader.readChunk(0);
	assert.equal(chunk.frames, 4_800);
	for (const [index, sample] of chunk.channels[0]!.entries()) {
		assert.ok(Math.abs(sample - 0.25 * Math.sin(2 * Math.PI * 440 * index / 48_000)) < 1e-7);
	}
});
