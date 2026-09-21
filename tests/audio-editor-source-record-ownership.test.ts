/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { StorageRecord } from '../src/common/editor/storage/media-records.ts';
import { SourceDeletionRepository } from '../src/common/editor/storage/source-deletion-repository.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';
import { SourceRepository } from '../src/common/editor/storage/source-repository.ts';
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
