/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeWav } from '../src/common/editor/wav.js';
import { createStorageRepositories } from '../src/common/editor/storage/repositories.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';

const LOCATOR_ID = 'locator_audio_000000000001';
const LOCATOR_REVISION = 'snapshot_audio_0000000001';

test('storage composition exposes verified linked WAV PCM through canonical source reads', async () => {
	const body = wavBlob(Float32Array.of(-1, -0.25, 0.25, 1));
	let loads = 0;
	const repositories = createStorageRepositories({
		memory: getMemoryDatabase(`linked-audio-composition-${Date.now()}-${Math.random()}`),
		database: async () => null,
	}, {
		revisionLimit: 20,
		preferOpfs: false,
		storageManager: null,
		opfsRoot: null,
		migrateLegacyPcmOnAccess: false,
		linkedOriginalPort: {
			load(kind, locatorId, { expectedRevision }) {
				loads += 1;
				assert.equal(kind, 'audio');
				assert.equal(locatorId, LOCATOR_ID);
				return { blob: body, locatorRevision: expectedRevision ?? LOCATOR_REVISION };
			},
		},
		estimateStorage: async () => ({ usage: null, quota: null }),
		isMemoryBackend: () => true,
	});
	assert.ok(repositories.linkedOriginals);
	const source = Object.freeze({
		kind: 'audio' as const,
		id: 'source-audio',
		storageKey: 'physical-audio',
		mimeType: 'audio/wav',
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32' as const,
		chunkFrames: 2,
	});
	await repositories.linkedOriginals.bind('project-audio', source, LOCATOR_ID, {
		expectedLocatorRevision: LOCATOR_REVISION,
		expectedSnapshot: body,
	});

	const metadata = await repositories.sources.getMetadata(source.storageKey);
	assert.equal(metadata?.storage, 'linked-audio-original-v1');
	assert.equal(metadata?.frameCount, 4);
	assert.equal(loads, 1, 'metadata synthesis must not reload the selected body');
	assert.deepEqual(await repositories.sources.list(), []);
	const chunk = await repositories.sources.chunk(source.storageKey, 1);
	assert.deepEqual([...chunk.channels[0]], [0.25, 1]);
	assert.equal(loads, 2);
});

function wavBlob(channel: Float32Array): Blob {
	const encoded = encodeWav([channel], { float: true, dither: false, sampleRate: 48_000 });
	const bytes = new Uint8Array(encoded.byteLength);
	bytes.set(encoded);
	return new Blob([bytes], { type: 'audio/wav' });
}
