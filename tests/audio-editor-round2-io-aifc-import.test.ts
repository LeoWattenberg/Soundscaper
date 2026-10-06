/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createAiffBlobPcmChunkReader } from '../src/common/editor/aiff-pcm-chunk-reader.ts';
import { inspectDesktopStandalonePcm } from '../src/common/editor/controller/import/internal/desktop-standalone-pcm-import.ts';

test('ordinary uncompressed AIFF-C from Python enters the bounded PCM import without losing its native samples', async () => {
	const encoded = await readFile(new URL('./fixtures/python-uncompressed.aif.base64', import.meta.url), 'ascii');
	const bytes = Buffer.from(encoded, 'base64');
	for (const extension of ['aif', 'aifc']) {
		const file = new File([bytes], `ordinary-tone.${extension}`, { type: 'audio/x-aiff' });
		const descriptor = await inspectDesktopStandalonePcm(file, {}, null);
		assert.ok(descriptor, 'both ordinary AIFF-C suffixes use the bounded reader');
		const reader = createAiffBlobPcmChunkReader(file, { descriptor, chunkFrames: 97 });
		assert.equal(reader.descriptor.container, 'aifc');
		assert.equal(reader.descriptor.encoding, 'pcm-integer');
		assert.equal(reader.descriptor.sampleRate, 8_000);
		assert.equal(reader.descriptor.frameCount, 8_000);
		assert.equal(reader.descriptor.channelCount, 1);
		const first = await reader.readChunk(0);
		for (let frame = 0; frame < first.frames; frame += 1) {
			const expected = Math.round(8192 * Math.sin(2 * Math.PI * 440 * frame / 8000)) / 32768;
			assert.equal(first.channels[0]?.[frame], expected);
		}
		const last = await reader.readChunk(reader.chunkCount - 1);
		assert.equal(last.final, true);
		assert.equal(last.frameOffset + last.frames, 8_000);
	}
});
