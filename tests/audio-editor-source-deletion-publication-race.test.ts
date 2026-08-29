/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { SourceDeletionRepository } from '../src/common/editor/storage/source-deletion-repository.ts';
import { SourceRepository } from '../src/common/editor/storage/source-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`source deletion does not clean up a concurrent same-id publication in ${backend}`, async () => {
		const enteredOldPayloadDeletion = deferred<void>();
		const releaseOldPayloadDeletion = deferred<void>();
		const files = new Map<string, { blob: Blob }>();
		let blockedPath: string | null = null;
		const directory = opfsDirectory(files, async (path) => {
			if (path !== blockedPath) return;
			enteredOldPayloadDeletion.resolve();
			await releaseOldPayloadDeletion.promise;
		});
		const store = createProjectStore({
			indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() : null,
			memoryFallback: backend === 'memory',
			databaseName: `source-delete-publication-${backend}-${Date.now()}-${Math.random()}`,
			storageManager: {
				async getDirectory() {
					return { async getDirectoryHandle() { return directory; } };
				},
			},
		});
		const oldWriter = await store.beginSourceWrite('reused-source', { sampleRate: 48_000 });
		await oldWriter.write([Float32Array.of(0.1)]);
		const oldSource = await oldWriter.commit();
		await store.saveAnalysis('audio-editor-peaks-v2:reused-source', { levels: ['same'] });
		blockedPath = String(oldSource.path);

		const deleting = store.deleteSource('reused-source');
		await enteredOldPayloadDeletion.promise;

		const newWriter = await store.beginSourceWrite('reused-source', { sampleRate: 48_000 });
		await newWriter.write([Float32Array.of(0.9)]);
		const newSource = await newWriter.commit();
		await store.writeMediaAsset('reused-source', new Blob(['new-container']));
		await store.saveAnalysis('audio-editor-peaks-v2:reused-source', { levels: ['same'] });

		releaseOldPayloadDeletion.resolve();
		await deleting;

		assert.deepEqual(await store.getSourceMetadata('reused-source'), newSource);
		const media = await store.loadMediaAsset('reused-source');
		assert.ok(media);
		assert.equal(new TextDecoder().decode(await media.arrayBuffer()), 'new-container');
		assert.deepEqual(
			await store.loadAnalysis('audio-editor-peaks-v2:reused-source'),
			{ levels: ['same'] },
		);
	});
}

test('source deletion cannot compare-delete an identical cache published after detachment', async () => {
	const databaseName = `source-delete-identical-cache-${Date.now()}-${Math.random()}`;
	const memory = getMemoryDatabase(databaseName);
	const port = { memory, database: async () => null };
	const analysis = new KeyValueRepository(port, 'analysis');
	const purgeStarted = deferred<void>();
	const releasePurge = deferred<void>();
	memory.sources.set('reused-source', {
		id: 'reused-source', storage: 'indexeddb-chunks', sourceToken: 'old-token',
	});
	await analysis.put('audio-editor-peaks-v2:reused-source', { levels: ['same'] });
	const sources = new SourceRepository({
		records: {} as never,
		deletion: new SourceDeletionRepository(port),
		writer: {} as never,
		reader: {} as never,
		media: {} as never,
		analysis,
		transientAnalysisCache: {
			async purge() {
				purgeStarted.resolve();
				await releasePurge.promise;
			},
		},
		opfs: { deleteBinaryRecords: async () => undefined } as never,
		pcm: {} as never,
	});

	const deleting = sources.delete('reused-source');
	await purgeStarted.promise;
	memory.sources.set('reused-source', {
		id: 'reused-source', storage: 'indexeddb-chunks', sourceToken: 'new-token',
	});
	await analysis.put('audio-editor-peaks-v2:reused-source', { levels: ['same'] });
	releasePurge.resolve();
	await deleting;

	assert.deepEqual(
		await analysis.get('audio-editor-peaks-v2:reused-source'),
		{ levels: ['same'] },
	);
});

function opfsDirectory(
	files: Map<string, { blob: Blob }>,
	onDelete: (path: string) => Promise<void>,
) {
	return {
		async getFileHandle(path: string, options: { readonly create?: boolean } = {}) {
			if (!files.has(path) && !options.create) throw new Error('missing');
			if (!files.has(path)) files.set(path, { blob: new Blob() });
			const entry = files.get(path)!;
			return {
				async createWritable() {
					const parts: BlobPart[] = [];
					return {
						async write(part: BlobPart) { parts.push(part); },
						async close() { entry.blob = new Blob(parts); },
						async abort() { parts.length = 0; },
					};
				},
				async getFile() { return entry.blob; },
			};
		},
		async removeEntry(path: string) {
			await onDelete(path);
			if (!files.delete(path)) throw new Error('missing');
		},
	};
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}
