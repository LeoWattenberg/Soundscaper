/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readStoredAudioBuffer } from '../src/common/editor/controller/source-audio.ts';
import type { createSourceRuntimeComposition } from '../src/common/editor/controller/source-runtime-composition.ts';
import type { PreparedRequiredProjectSources } from '../src/common/editor/controller/prepared-project-sources.ts';
import { createPreparedProjectSources, type PreparedProjectSourceEntry } from '../src/common/editor/controller/prepared-project-sources.ts';

void test('prepared source handoff retains distinct buffer and provider types without replacing live caches early', async () => {
	const buffer = { channels: [new Float32Array([1, 2])], sampleRate: 48000 };
	const provider = { async read() { return new Float32Array([3]); }, dispose() {} };
	const prepared = new Map<string, PreparedProjectSourceEntry<typeof buffer, typeof provider>>([
		['buffer', { kind: 'buffer', value: buffer }], ['provider', { kind: 'provider', value: provider }],
	]);
	const buffers = new Map<string, typeof buffer>();
	const providers = new Map<string, typeof provider>();
	const handoff = createPreparedProjectSources({
		prepared, sourceBuffers: buffers, sourceChunkProviders: providers,
		cacheSourceBuffer: (id, value) => buffers.set(id, value), throwIfAborted() {},
	});
	await handoff.commit(async inputs => {
		const rate: number | undefined = inputs.sourceBuffers.get('buffer')?.sampleRate;
		const read: Float32Array | undefined = await inputs.chunkSources.get('provider')?.read();
		assert.equal(rate, 48000);
		assert.deepEqual(read, new Float32Array([3]));
		assert.equal(buffers.size, 0);
		assert.equal(providers.size, 0);
	});
	assert.equal(buffers.get('buffer'), buffer);
	assert.equal(providers.get('provider'), provider);
});

void test('stored source reads retain the context buffer model through the wrapper', async () => {
	const buffer = { sampleRate: 48000, owner: 'test-context' as const };
	const context = { createBuffer: () => buffer };
	const store = { async loadSourceAudioBuffer(_id: string, input: typeof context) { return input.createBuffer(); } };
	const loaded = await readStoredAudioBuffer(store, { id: 'source' }, context);
	const owner: 'test-context' | undefined = loaded?.owner;
	assert.equal(owner, 'test-context');
	assert.equal(loaded, buffer);
});

// A production source composition must hand the engine native AudioBuffers.
function nativeBufferContract(sources: ReturnType<typeof createSourceRuntimeComposition>) {
	const prepare: (...args: Parameters<typeof sources.sourceLifecycle.prepareRequiredProjectSources>) =>
		Promise<PreparedRequiredProjectSources<AudioBuffer>> = sources.sourceLifecycle.prepareRequiredProjectSources;
	return prepare;
}
void nativeBufferContract;
