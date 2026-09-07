/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceRuntimeCompositionStore } from '../src/common/editor/controller/source-runtime-composition-types.ts';
import { createProjectStore } from '../src/common/editor/storage.js';

void test('stored PCM retains the destination buffer type and context-owned identity', async () => {
	const store = createProjectStore({ indexedDB: null, databaseName: `buffer-contract-${crypto.randomUUID()}` }) satisfies SourceRuntimeCompositionStore;
	try {
		const writer = await store.beginSourceWrite('source', { sampleRate: 48000 });
		await writer.write([Float32Array.of(0.25, -0.5)]);
		await writer.commit({ name: 'source' });
		const data = new Float32Array(2);
		const destination = { sampleRate: 48000, length: 2, numberOfChannels: 1,
			owner: 'test-context' as const, getChannelData: () => data };
		const restored = await store.loadSourceAudioBuffer('source', { createBuffer: () => destination });
		const owner: 'test-context' = restored.owner;
		assert.equal(owner, 'test-context');
		assert.equal(restored, destination);
		assert.deepEqual([...restored.getChannelData()], [0.25, -0.5]);
		assert.equal(await store.loadSetting('absent', false), false);
	} finally { await store.close(); }
});
