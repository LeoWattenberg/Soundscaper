/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { StorageRecord } from '../src/common/editor/storage/media-records.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';
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
