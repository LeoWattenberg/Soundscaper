/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { PcmRepository } from '../src/common/editor/storage/pcm-repository.ts';
import { crc32, PCM_ENCODING_RAW_F32LE, PCM_ENCODING_WAVPACK_F32_V1 } from '../src/common/editor/wavpack/index.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('Speed PCM writes keep durable raw checksums and leave migration compression available', async () => {
	let encoded = 0;
	const pcm = new PcmRepository({ codec: {
		async encode(payload: ArrayBuffer) {
			encoded += 1;
			return { encoding: PCM_ENCODING_WAVPACK_F32_V1, payload: new ArrayBuffer(8), pcmCrc32: crc32(payload) };
		},
		async decode() { throw new Error('No compressed read is needed.'); },
	} });
	pcm.setOptimizationMode('speed');
	const payload = new ArrayBuffer(32_768);
	const options = { frames: 8_192, channelCount: 1, sampleRate: 48_000, priority: 'foreground', allowRawOnFailure: true };
	const result = await pcm.encode(payload, options);
	assert.equal(result.encoding, PCM_ENCODING_RAW_F32LE);
	assert.equal(result.payload, payload);
	assert.equal(result.storedBytes, payload.byteLength);
	assert.equal(result.pcmCrc32, crc32(payload));
	assert.equal(encoded, 0);
	assert.equal((await pcm.encode(payload, { ...options, priority: 'migration' })).encoding, PCM_ENCODING_WAVPACK_F32_V1);
	assert.equal(encoded, 1);
	pcm.setOptimizationMode('memory');
	assert.equal((await pcm.encode(payload, options)).encoding, PCM_ENCODING_WAVPACK_F32_V1);
	assert.equal(encoded, 2);
	assert.throws(() => pcm.setOptimizationMode('fast' as 'speed'), /memory or speed/iu);
});

test('project stores publish Speed PCM through the existing stage and restore independent samples', async (context) => {
	const store = createProjectStore({
		indexedDB: createInstrumentedIndexedDB(), memoryFallback: false, preferOpfs: false,
		databaseName: `speed-pcm-${crypto.randomUUID()}`,
		pcmCodec: {
			async encode() { throw new Error('Foreground Speed publication must not invoke compression.'); },
			async decode() { throw new Error('Raw Speed reads must not invoke the codec.'); },
		},
	});
	context.after(async () => { await store.close(); });
	store.setPcmOptimizationMode('speed');
	const input = new Float32Array(8_192).fill(0.25);
	const writer = await store.beginSourceWrite('speed-source', { sampleRate: 48_000 });
	await writer.write([input]);
	input.fill(-1);
	const metadata = await writer.commit();
	assert.equal(metadata.rawChunkCount, 1);
	assert.equal(metadata.wavpackChunkCount, 0);
	assert.equal(metadata.storedBytes, 32_768);
	assert.equal(metadata.uncompressedBytes, 32_768);
	const chunk = await store.readSourceChunk('speed-source', 0);
	assert.ok(chunk?.channels[0].every((sample) => sample === 0.25));
	if (chunk) chunk.channels[0].fill(1);
	assert.ok((await store.readSourceChunk('speed-source', 0))?.channels[0].every((sample) => sample === 0.25));
});
