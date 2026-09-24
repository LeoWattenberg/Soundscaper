/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { StorageRecord } from '../src/common/editor/storage/media-records.ts';
import { MediaAssetStagingRepository } from '../src/common/editor/storage/media-asset-staging-repository.ts';
import { SourceDeletionRepository } from '../src/common/editor/storage/source-deletion-repository.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';
import { SourceRepository } from '../src/common/editor/storage/source-repository.ts';
import { SourceWriteRepository } from '../src/common/editor/storage/source-write-repository.ts';
import { ProjectRepository } from '../src/common/editor/storage/project-repository.ts';
import { RetentionSessionGuard } from '../src/common/editor/storage/retention-session-guard.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('source metadata put-if-absent and delete-if-current are atomic in every backend', async (context) => {
	for (const backend of ['memory', 'indexeddb'] as const) {
		await context.test(backend, async (nested) => {
			const databaseName = `source-record-ownership-${backend}-${Date.now()}-${Math.random()}`;
			const database = backend === 'indexeddb'
				? await openDatabase(createInstrumentedIndexedDB() as unknown as IDBFactory, databaseName)
				: null;
			nested.after(() => { database?.close(); });
			const records = new SourceRecordRepository({
				memory: getMemoryDatabase(databaseName),
				database: async () => database,
			});
			const candidates: readonly StorageRecord[] = [
				{ id: 'owned-source', storage: 'indexeddb-chunks', sourceToken: 'candidate-a' },
				{ id: 'owned-source', storage: 'indexeddb-chunks', sourceToken: 'candidate-b' },
			];

			assert.equal(await records.putMetadataIfAbsent(candidates[0] as StorageRecord), true);
			assert.equal(await records.putMetadataIfAbsent(candidates[1] as StorageRecord), false);
			const winner = candidates[0] as StorageRecord;
			const loser = candidates[1] as StorageRecord;
			assert.deepEqual(await records.getMetadata('owned-source'), winner);
			assert.equal(await records.deleteMetadataIfCurrent(loser), false);
			assert.deepEqual(await records.getMetadata('owned-source'), winner);
			assert.equal(await records.deleteMetadataIfCurrent(winner), true);
			assert.equal(await records.getMetadata('owned-source'), null);
		});
	}
});

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} metadata cleanup and generation rollback preserve retained sources`, async () => {
		const databaseName = `source-metadata-retention-${backend}-${crypto.randomUUID()}`;
		const database = backend === 'indexeddb'
			? await openDatabase(createInstrumentedIndexedDB() as unknown as IDBFactory, databaseName)
			: null;
		const rawPort = { memory: getMemoryDatabase(databaseName), database: async () => database };
		const owner = new RetentionSessionGuard(rawPort, null);
		const peer = new RetentionSessionGuard(rawPort, null);
		const port = owner.port();
		const records = new SourceRecordRepository(port, owner);
		const projects = new ProjectRepository(port, 20, owner);
		const source: StorageRecord = {
			id: 'retained-source', storage: 'indexeddb-chunks', sourceToken: 'retained-token',
		};
		const prior: StorageRecord = { ...source, sourceToken: 'prior-token' };
		try {
			await records.putMetadata(source);
			await projects.save({
				id: 'project-1', schemaFamily: 'soundscaper', schemaVersion: 1,
				revision: 1, sources: [{ id: source.id }],
				clips: [{ id: 'clip-1', sourceId: source.id }],
			});
			await assert.rejects(records.deleteMetadataIfCurrent(source), /saved project or revision/iu);
			await assert.rejects(records.compareAndSwapMetadata(source, prior), /saved project or revision/iu);
			assert.deepEqual(await records.getMetadata(source.id as string), source);

			await projects.delete('project-1');
			await records.putMetadata({
				id: 'dependent', storage: 'copy-on-write', sourceToken: 'dependent-token',
				baseSourceId: source.id,
			});
			await assert.rejects(records.deleteMetadataIfCurrent(source), /derived source dependent/iu);
			await assert.rejects(records.compareAndSwapMetadata(source, prior), /derived source dependent/iu);
			assert.equal(await records.deleteMetadataIfCurrent({
				id: 'dependent', storage: 'copy-on-write', sourceToken: 'dependent-token',
				baseSourceId: source.id,
			}), true);

			await peer.database();
			await assert.rejects(records.deleteMetadataIfCurrent(source), /another open editor session/iu);
			await assert.rejects(records.compareAndSwapMetadata(source, prior), /another open editor session/iu);
			assert.deepEqual(await records.getMetadata(source.id as string), source);
			await peer.release(database);
			assert.equal(await records.deleteMetadataIfCurrent(source), true);
		} finally {
			await peer.release(database);
			await owner.release(database);
			database?.close();
		}
	});
}

for (const backend of ['memory', 'indexeddb'] as const) {
	for (const replacing of [false, true]) {
		test(`${backend} ambiguous ${replacing ? 'replacement' : 'creation'} retains an adopted PCM generation`, async () => {
			const databaseName = `source-ambiguous-publication-${backend}-${crypto.randomUUID()}`;
			const database = backend === 'indexeddb'
				? await openDatabase(createInstrumentedIndexedDB() as unknown as IDBFactory, databaseName)
				: null;
			const rawPort = { memory: getMemoryDatabase(databaseName), database: async () => database };
			const owner = new RetentionSessionGuard(rawPort, null);
			const port = owner.port();
			const projects = new ProjectRepository(port, 20, owner);
			const publicationError = new Error('The publication response was lost.');
			let publishedToken = '';
			const records = new class extends SourceRecordRepository {
				override async publishStagedMetadata(
					...args: Parameters<SourceRecordRepository['publishStagedMetadata']>
				): Promise<boolean> {
					const succeeded = await super.publishStagedMetadata(...args);
					if (!succeeded) return false;
					publishedToken = String(args[0].sourceToken);
					await projects.save({
						id: 'adopted-project', schemaFamily: 'soundscaper', schemaVersion: 1,
						revision: 1, sources: [{ id: 'source-a' }],
						clips: [{ id: 'clip-1', sourceId: 'source-a' }],
					});
					throw publicationError;
				}
			}(port, owner);
			try {
				if (replacing) await records.putMetadata({
					id: 'source-a', storage: 'indexeddb-chunks', sourceToken: 'prior-token',
				});
				const writes = new SourceWriteRepository({
					records,
					staging: new MediaAssetStagingRepository(port),
					pcm: { encode: async () => ({
						encoding: 'raw-f32', payload: new ArrayBuffer(8), pcmCrc32: 0,
						uncompressedBytes: 8, storedBytes: 8,
					}) } as never,
					opfs: { createPcmWriter: async () => null } as never,
					database: port.database,
					deleteStoredSource: async (source) => { await records.deleteChunks(source.sourceToken); },
				});
				const writer = await writes.begin('source-a', { sampleRate: 48_000 });
				await writer.write([Float32Array.of(0.25, 0.5)]);
				await assert.rejects(
					writer.commit({}, replacing
						? { ifAbsent: false, expectedSourceToken: 'prior-token' }
						: undefined),
					(error: unknown) => error instanceof AggregateError
						&& error.errors[0] === publicationError
						&& /retained by a saved project/iu.test(String(error.errors[1])),
				);
				assert.ok(publishedToken);
				assert.equal((await records.getMetadata('source-a'))?.sourceToken, publishedToken);
				assert.ok(await records.chunk(publishedToken, 0));
			} finally {
				await owner.release(database);
				database?.close();
			}
		});
	}
}

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} public metadata updates cannot redirect immutable source PCM`, async () => {
		const store = createProjectStore({
			indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() : null,
			memoryFallback: backend === 'memory', preferOpfs: false,
			databaseName: `source-metadata-identity-${backend}-${crypto.randomUUID()}`,
		});
		try {
			const writer = await store.beginSourceWrite('source-a', { sampleRate: 48_000 });
			await writer.write([Float32Array.of(0.25, 0.5)]);
			const original = await writer.commit();
			const otherWriter = await store.beginSourceWrite('source-b', { sampleRate: 48_000 });
			await otherWriter.write([Float32Array.of(0.75, 1)]);
			const other = await otherWriter.commit();
			for (const changed of [
				{ ...original, id: 'source-b' },
				{ ...original, sourceToken: 'source-b-token' },
				{ ...original, path: 'foreign-source.pcm' },
				{ ...original, frameCount: 3 },
			]) {
				assert.equal(await store.sourceRepository.replaceMetadataIfCurrent(original, changed), false);
				assert.deepEqual(await store.getSourceMetadata('source-a'), original);
				assert.deepEqual(await store.getSourceMetadata('source-b'), other);
			}
			assert.equal(await store.sourceRepository.replaceMetadataIfCurrent(original, {
				...original, takeCycleCaptureDraftVersion: 1,
			}), true);
			assert.equal((await store.readSourceChunk('source-a', 0))?.channels[0]?.[0], 0.25);
		} finally {
			await store.close();
		}
	});
}

test('derived publication and base deletion are atomic in every backend', async (context) => {
	for (const backend of ['memory', 'indexeddb'] as const) {
		await context.test(backend, async (nested) => {
			const databaseName = `source-dependency-ownership-${backend}-${Date.now()}-${Math.random()}`;
			const database = backend === 'indexeddb'
				? await openDatabase(createInstrumentedIndexedDB() as unknown as IDBFactory, databaseName)
				: null;
			nested.after(() => { database?.close(); });
			const records = new SourceRecordRepository({
				memory: getMemoryDatabase(databaseName),
				database: async () => database,
			});
			const base: StorageRecord = {
				id: 'base-first', storage: 'indexeddb-chunks', sourceToken: 'base-first-token',
			};
			const derived: StorageRecord = {
				id: 'derived-first', storage: 'copy-on-write', sourceToken: 'derived-first-token',
				baseSourceId: 'base-first',
			};

			await records.putMetadata(base);
			assert.equal(await records.putDerivedMetadataIfBaseCurrent(derived, base), 'published');
			assert.deepEqual(await records.deleteMetadataIfUnreferenced('base-first'), {
				status: 'retained',
				dependentSourceId: 'derived-first',
			});
			assert.deepEqual(await records.getMetadata('base-first'), base);

			const deletedDerived = await records.deleteMetadataIfUnreferenced('derived-first');
			assert.equal(deletedDerived.status, 'deleted');
			const deletedBase = await records.deleteMetadataIfUnreferenced('base-first');
			assert.equal(deletedBase.status, 'deleted');

			const deletedBeforePublication: StorageRecord = {
				id: 'deleted-first', storage: 'indexeddb-chunks', sourceToken: 'deleted-first-token',
			};
			await records.putMetadata(deletedBeforePublication);
			assert.equal(
				(await records.deleteMetadataIfUnreferenced('deleted-first')).status,
				'deleted',
			);
			assert.equal(await records.putDerivedMetadataIfBaseCurrent({
				id: 'orphan-refused', storage: 'copy-on-write', sourceToken: 'orphan-token',
				baseSourceId: 'deleted-first',
			}, deletedBeforePublication), 'base-changed');
			assert.equal(await records.getMetadata('orphan-refused'), null);
		});
	}
});

test('source retention returns the first dependent primary identity in every repository and backend', async (context) => {
	for (const repository of ['metadata', 'storage'] as const) {
		for (const backend of ['memory', 'indexeddb'] as const) {
			await context.test(`${repository}-${backend}`, async (nested) => {
				const databaseName = `source-dependent-identity-${repository}-${backend}-${Date.now()}-${Math.random()}`;
				const indexedDB = createInstrumentedIndexedDB();
				const database = backend === 'indexeddb'
					? await openDatabase(indexedDB as unknown as IDBFactory, databaseName)
					: null;
				nested.after(() => { database?.close(); });
				const memory = getMemoryDatabase(databaseName);
				const port = { memory, database: async () => database };
				const seed = (primaryKey: string, value: Readonly<Record<string, unknown>>): void => {
					if (database) indexedDB.seedRecord(databaseName, 'sources', value, primaryKey);
					else memory.sources.set(primaryKey, value);
				};
				seed('base', { id: 'base', storage: 'indexeddb-chunks', sourceToken: 'base-token' });
				seed('00-unrelated', { id: '00-unrelated', storage: 'indexeddb-chunks' });
				seed('dependent-primary', { storage: 'copy-on-write', baseSourceId: 'base' });
				seed('dependent-second', {
					id: 'dependent-second', storage: 'copy-on-write', baseSourceId: 'base',
				});

				const result = repository === 'metadata'
					? await new SourceRecordRepository(port).deleteMetadataIfUnreferenced('base')
					: await new SourceDeletionRepository(port).detachIfUnreferenced('base');
				assert.deepEqual(result, { status: 'retained', dependentSourceId: 'dependent-primary' });
			});
		}
	}
});

test('missing bases and bases without dependents preserve repository semantics in every backend', async (context) => {
	for (const backend of ['memory', 'indexeddb'] as const) {
		await context.test(backend, async (nested) => {
			const databaseName = `source-retention-edges-${backend}-${Date.now()}-${Math.random()}`;
			const database = backend === 'indexeddb'
				? await openDatabase(createInstrumentedIndexedDB() as unknown as IDBFactory, databaseName)
				: null;
			nested.after(() => { database?.close(); });
			const port = {
				memory: getMemoryDatabase(databaseName),
				database: async () => database,
			};
			const records = new SourceRecordRepository(port);
			const deletion = new SourceDeletionRepository(port);
			await records.putMetadata({
				id: 'orphan', storage: 'copy-on-write', baseSourceId: 'missing-base',
			});
			assert.deepEqual(await records.deleteMetadataIfUnreferenced('missing-base'), { status: 'missing' });
			assert.deepEqual(await deletion.detachIfUnreferenced('missing-base'), {
				status: 'detached', source: null, mediaAsset: null, derivatives: [],
			});

			const metadataOnly: StorageRecord = {
				id: 'metadata-only', storage: 'indexeddb-chunks', sourceToken: 'metadata-token',
			};
			const storageOnly: StorageRecord = {
				id: 'storage-only', storage: 'indexeddb-chunks', sourceToken: 'storage-token',
			};
			await records.putMetadata(metadataOnly);
			await records.putMetadata(storageOnly);
			assert.deepEqual(await records.deleteMetadataIfUnreferenced('metadata-only'), {
				status: 'deleted', record: metadataOnly,
			});
			assert.deepEqual(await deletion.detachIfUnreferenced('storage-only'), {
				status: 'detached', source: storageOnly, mediaAsset: null, derivatives: [],
			});
		});
	}
});

test('discard-if-current deletes only the exact owned OPFS path payload', async () => {
	const databaseName = `source-path-ownership-${Date.now()}-${Math.random()}`;
	const records = new SourceRecordRepository({
		memory: getMemoryDatabase(databaseName),
		database: async () => null,
	});
	const deletedPaths: string[] = [];
	const sources = new SourceRepository({
		records,
		writer: {} as never,
		reader: {} as never,
		media: {} as never,
		analysis: {} as never,
		opfs: { deletePath: async (path: string) => { deletedPaths.push(path); } } as never,
		pcm: { closeOwnedCodec() {} } as never,
	});
	const acquired: StorageRecord = {
		id: 'owned-opfs-source',
		storage: 'opfs-pcm-v1',
		sourceToken: 'acquired-token',
		path: 'acquired-source.pcm',
		pcmEncodingVersion: 1,
	};
	const replacement: StorageRecord = {
		...acquired,
		sourceToken: 'replacement-token',
		path: 'replacement-source.pcm',
	};

	await records.putMetadata(replacement);
	assert.equal(await sources.discardIfCurrent(acquired), false);
	assert.deepEqual(await records.getMetadata('owned-opfs-source'), replacement);
	assert.deepEqual(deletedPaths, []);

	await records.putMetadata(acquired);
	assert.equal(await sources.discardIfCurrent(acquired), true);
	assert.equal(await records.getMetadata('owned-opfs-source'), null);
	assert.deepEqual(deletedPaths, ['acquired-source.pcm']);
});
