/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSourceChunkProviderRegistration } from '../src/common/editor/controller/source-chunk-provider-registration.ts';
import { SourceChunkProviderRegistry } from '../src/common/editor/controller/source-chunk-provider-registry.ts';
import {
	createStoredChunkProvider,
	isStreamableStoredSource,
} from '../src/common/editor/controller/source-audio.ts';

const source = Object.freeze({
	id: 'source',
	storageKey: 'stored',
	frameCount: 8,
	channelCount: 1,
	sampleRate: 48_000,
	chunkFrames: 4,
});
const metadata = Object.freeze({
	id: 'stored',
	frameLength: 8,
	channelCount: 1,
	sampleRate: 48_000,
	chunkFrames: 4,
	chunkCount: 2,
});

function createFixture() {
	const sourceChunkProviders = new SourceChunkProviderRegistry<string, unknown>();
	const published: unknown[] = [];
	const store = { readSourceChunk: () => 'chunk', openSourceReadSession: () => null };
	const registration = createSourceChunkProviderRegistration({
		createStoredChunkProvider,
		engine: { setChunkSources: (value: unknown) => { published.push(value); } },
		isStreamableStoredSource,
		sourceChunkProviders,
		store,
	});
	return { published, registration, sourceChunkProviders };
}

test('re-registering an unchanged stored source keeps its live provider and its read session', async () => {
	const { registration, sourceChunkProviders } = createFixture();
	const first = registration.registerStoredChunkProvider(source, metadata);
	assert.ok(first);
	const second = registration.registerStoredChunkProvider({ ...source }, { ...metadata });
	// Building a second provider would retire the first, releasing the read
	// session an in-flight export or playback render still streams through.
	assert.strictEqual(second, first);
	assert.strictEqual(sourceChunkProviders.get('source'), first);
	await sourceChunkProviders.drain();
	assert.equal(await first.readStorageChunk(0), 'chunk');
});

test('registering a changed stored source replaces and retires the stale provider', async () => {
	const { registration, sourceChunkProviders } = createFixture();
	const first = registration.registerStoredChunkProvider(source, metadata);
	const grown = { ...source, frameCount: 12 };
	const grownMetadata = { ...metadata, frameLength: 12, chunkCount: 3 };
	const second = registration.registerStoredChunkProvider(grown, grownMetadata);
	assert.notStrictEqual(second, first);
	assert.strictEqual(sourceChunkProviders.get('source'), second);
	await sourceChunkProviders.drain();
	assert.throws(() => first.readStorageChunk(0), /stored source chunk provider was disposed/u);
});

test('unstreamable sources register no provider and retirement drains the registry', async () => {
	const { published, registration, sourceChunkProviders } = createFixture();
	assert.equal(registration.registerStoredChunkProvider(source, { ...metadata, chunkCount: 5 }), null);
	assert.equal(sourceChunkProviders.size, 0);
	assert.equal(published.length, 0);
	const provider = registration.registerStoredChunkProvider(source, metadata);
	assert.ok(provider);
	assert.equal(published.length, 1);
	await registration.retireSourceChunkProvider('source');
	assert.equal(sourceChunkProviders.size, 0);
	assert.equal(published.length, 2);
	await registration.retireSourceChunkProvider('source');
	assert.equal(published.length, 2);
});
