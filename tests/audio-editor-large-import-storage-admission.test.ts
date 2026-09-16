/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { SourceWriteRepository } from '../src/common/editor/storage/source-write-repository.ts';
import { createIncrementalPcmImporter, type IncrementalPcmImportRuntime } from '../src/common/editor/controller/import/internal/incremental-wav-import-service.ts';
import { deferred } from './helpers/async-test-control.ts';

test('large imports refuse the actual RAM writer before decoding, including unavailable OPFS writers', async () => {
	for (const container of ['compressed-audio', 'wav', 'aiff']) {
		const repository = sourceRepository(false, false);
		const fixture = importerFixture(repository);
		await assert.rejects(fixture.importAudio(64 * 1024 * 1024 + 4, undefined, container), /IndexedDB or OPFS/u);
		assert.equal(fixture.decodedChunks(), 0);
		assert.deepEqual(fixture.preflightBytes, [64 * 1024 * 1024 + 4]);
	}
});

test('large import writer admission accepts IndexedDB and OPFS-only PCM storage', async () => {
	for (const [database, opfs] of [[true, false], [false, true]]) {
		const writer = await sourceRepository(database!, opfs!).begin('source', { requirePersistentPcm: true });
		await writer.abort();
	}
});

test('short memory imports preserve their existing bounded admission tier', async () => {
	const fixture = importerFixture(sourceRepository(false, false));
	await fixture.importAudio(64 * 1024 * 1024);
	assert.equal(fixture.decodedChunks(), 1);
});

test('import progress stays below completion until activation and project publication finish', async () => {
	const fixture = importerFixture(sourceRepository(false, false));
	const started = deferred<void>();
	const gate = deferred<void>();
	const progress: number[] = [];
	let published = false;
	Object.assign(fixture.runtime, {
		reportProgress(value: number) { if (value === 1) assert.equal(published, true); progress.push(value); },
		commit() { published = true; },
		async activateStoredSource(_source: unknown, _metadata: unknown, options: { onProgress(value: number): void }) {
			options.onProgress(0.5); started.resolve(); await gate.promise; options.onProgress(1);
		},
	});
	const pending = fixture.importAudio(4);
	await started.promise;
	assert.deepEqual(progress, [0.8, 0.895]);
	assert.equal(published, false);
	gate.resolve();
	await pending;
	assert.deepEqual(progress, [0.8, 0.895, 0.99, 1]);
});

test('cancellation during source activation retires the source before returning and never publishes', async () => {
	const fixture = importerFixture(sourceRepository(false, false));
	const controller = new AbortController();
	const events: string[] = [];
	Object.assign(fixture.runtime, {
		async activateStoredSource(_source: unknown, _metadata: unknown, options: { signal: AbortSignal; onProgress(value: number): void }) {
			assert.strictEqual(options.signal, controller.signal);
			controller.abort(); options.onProgress(0.5);
		},
		commit() { events.push('published'); },
		retireSourceChunkProvider() { events.push('retired'); },
		store: { beginSourceWrite: (id: string, metadata: Record<string, unknown>) => fixture.repository.begin(id, metadata),
			async deleteSource() { events.push('deleted'); } },
	});
	await assert.rejects(fixture.importAudio(4, controller.signal), { name: 'AbortError' });
	assert.deepEqual(events, ['retired', 'deleted']);
});

function sourceRepository(database: boolean, opfs: boolean) {
	return new SourceWriteRepository({
		database: async () => database ? {} as IDBDatabase : null,
		opfs: { createPcmWriter: async (_token: string, metadata: Record<string, unknown>) => {
			assert.equal('requirePersistentPcm' in metadata, false);
			return opfs ? { abort: async () => undefined } : null;
		} } as never,
		pcm: {} as never,
		records: {
			writeChunk: async () => undefined,
			deleteChunks: async () => undefined,
			getMetadata: async () => null,
			putMetadata: async (metadata: Record<string, unknown>) => { assert.equal('requirePersistentPcm' in metadata, false); },
		} as never,
		deleteStoredSource: async () => undefined,
	});
}

function importerFixture(repository: SourceWriteRepository) {
	let chunks = 0;
	const stream = async ({ onChunk }: { onChunk(channels: Float32Array[]): Promise<void> }) => {
		chunks++; await onChunk([Float32Array.of(0)]);
	};
	const preflightBytes: number[] = [];
	const runtime: IncrementalPcmImportRuntime = {
		SOURCE_CHUNK_FRAMES: 1,
		activateStoredSource: async () => undefined,
		commit: () => undefined,
		copy: { track: 'Track' },
		createStableId: (prefix) => prefix,
		getProject: () => ({ tracks: [] }),
		importResultWithWarnings: (result: unknown) => result,
		preflightStorage: async (bytes: number) => { preflightBytes.push(bytes); },
		prepareImportedMediaCommand: () => ({ result: {}, command: {}, selection: {} }),
		projectSampleRate: () => 48_000,
		reportProgress: () => undefined,
		retireSourceChunkProvider: () => undefined,
		sourceBuffers: new Map(), sourcePeaks: new Map(),
		sourcePcmBytes: (source) => source && 'byteLength' in source ? Number(source.byteLength) : 0,
		store: { beginSourceWrite: (id, metadata) => repository.begin(id, metadata), deleteSource: async () => undefined },
		streamWavBlobPcm: (_file: unknown, options: { onChunk(channels: Float32Array[]): Promise<void> }) => stream(options),
		streamAiffBlobPcm: (_file: unknown, options: { onChunk(channels: Float32Array[]): Promise<void> }) => stream(options),
		stripExtension: (value) => value,
		warnEnvelope: () => undefined,
	};
	return {
		runtime, repository,
		preflightBytes,
		decodedChunks: () => chunks,
		importAudio: (byteLength: number, signal?: AbortSignal, container = 'compressed-audio') => createIncrementalPcmImporter(runtime)(
			new File(['mp3'], 'sample.mp3'),
			{ container, mimeType: 'audio/mpeg', byteLength, sampleRate: 48_000,
				channelCount: 1, frameCount: 1,
				stream }, signal ? { signal } : {}, {}, { requireChunkStream: true },
		),
	};
}
