/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createStoredChunkProvider } from '../src/common/editor/controller/source/source-audio.ts';
import { SourceReadRepository } from '../src/common/editor/storage/source-read-repository.ts';
import { SOURCE_PCM_READ_SESSION_RELEASED_ERROR_NAME } from '../src/common/editor/storage/source-pcm-read-session.ts';
import { deferred } from './helpers/async-test-control.ts';

const source = { id: 'owned', storageKey: 'owned', frameCount: 1, channelCount: 1, sampleRate: 48_000, chunkFrames: 1 };
const metadata = { ...source, storage: 'opfs', sourceToken: 'generation', chunkCount: 1 };
const released = Object.assign(new Error('Source PCM read sessions are being released.'), { name: SOURCE_PCM_READ_SESSION_RELEASED_ERROR_NAME });

test('a real maintenance-aborted opening reopens once and later provider reads remain playable', async () => {
	const started = deferred<void>();
	const gate = deferred<typeof metadata>();
	let captures = 0;
	let openings = 0;
	const reader = new SourceReadRepository({
		records: { getMetadata() { captures++; started.resolve(); return captures === 1 ? gate.promise : Promise.resolve(metadata); } } as never,
		pcm: {} as never,
		opfs: { readLegacyChunk() { return Promise.resolve({ index: 0, frames: 1, channels: [Float32Array.of(0.25)] }); } } as never,
	});
	const provider = createStoredChunkProvider({
		readSourceChunk() { throw new Error('Unexpected fallback read'); },
		openSourceReadSession(id, options) {
			openings++; assert.equal(options?.expectedSource, metadata);
			return reader.openSession(id, { ...options, expectedSource: metadata });
		},
	}, source, metadata);
	const read = Promise.resolve(provider.readStorageChunk(0));
	const result = read.then((chunk) => chunk, (error: unknown) => { throw error; });
	await started.promise;
	const maintenance = reader.releaseSessions();
	gate.resolve(metadata);
	await maintenance;
	assert.deepEqual(await result, { index: 0, frames: 1, channels: [Float32Array.of(0.25)] });
	assert.deepEqual(await provider.readStorageChunk(0), await result);
	assert.equal(openings, 2);
	await provider.dispose();
});

test('a maintenance-aborted opening retries only once and retains real opening errors', async () => {
	for (const failure of [released, new Error('source generation changed')]) {
		let openings = 0;
		const provider = createStoredChunkProvider({
			readSourceChunk() { throw new Error('Unexpected fallback read'); },
			openSourceReadSession() { openings++; return Promise.reject(failure); },
		}, source, metadata);
		await assert.rejects(async () => provider.readStorageChunk(0), (error: unknown) => error === failure);
		assert.equal(openings, failure === released ? 2 : 1);
		await provider.dispose();
	}
});

test('reopening after maintenance revalidates the exact stored generation', async () => {
	const started = deferred<void>();
	const gate = deferred<typeof metadata>();
	let captures = 0;
	let openings = 0;
	const replacement = { ...metadata, sourceToken: 'replacement-generation' };
	const reader = new SourceReadRepository({
		records: { getMetadata() { captures++; started.resolve(); return captures === 1 ? gate.promise : Promise.resolve(replacement); } } as never,
		pcm: {} as never, opfs: {} as never,
	});
	const provider = createStoredChunkProvider({
		readSourceChunk() { throw new Error('Unexpected fallback read'); },
		openSourceReadSession(id, options) {
			openings++; assert.equal(options?.expectedSource, metadata);
			return reader.openSession(id, { ...options, expectedSource: metadata });
		},
	}, source, metadata);
	const rejection = assert.rejects(async () => provider.readStorageChunk(0), /generation changed/u);
	await started.promise;
	const maintenance = reader.releaseSessions();
	gate.resolve(metadata);
	await Promise.all([maintenance, rejection]);
	assert.equal(openings, 2);
	await provider.dispose();
});

test('caller cancellation during session opening never retries even with a release-shaped reason', async () => {
	const controller = new AbortController();
	const gate = deferred<null>();
	let openings = 0;
	const provider = createStoredChunkProvider({
		readSourceChunk() { throw new Error('Unexpected fallback read'); },
		openSourceReadSession() { openings++; return gate.promise; },
	}, source, metadata);
	const read = Promise.resolve(provider.readStorageChunk(0, { signal: controller.signal }));
	controller.abort(released);
	await assert.rejects(read, (error: unknown) => error === released);
	assert.equal(openings, 1);
	gate.resolve(null);
	await provider.dispose();
});

test('provider disposal during session opening never admits or retries a successor', async () => {
	const gate = deferred<null>();
	let openings = 0;
	const provider = createStoredChunkProvider({
		readSourceChunk() { throw new Error('Unexpected fallback read'); },
		openSourceReadSession() { openings++; return gate.promise; },
	}, source, metadata);
	const read = Promise.resolve(provider.readStorageChunk(0));
	const rejection = assert.rejects(read, /provider was disposed/u);
	const disposal = provider.dispose();
	gate.resolve(null);
	await Promise.all([rejection, disposal]);
	assert.equal(openings, 1);
});
