/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} metadata batches preserve order, missing identities, and caller isolation`, async (context) => {
		const name = `metadata-batch-${backend}-${crypto.randomUUID()}`;
		const database = backend === 'indexeddb'
			? await openDatabase(createInstrumentedIndexedDB() as unknown as IDBFactory, name)
			: null;
		context.after(() => { database?.close(); });
		const records = new SourceRecordRepository({ memory: getMemoryDatabase(name), database: async () => database });
		await records.putMetadata({ id: 'first', sourceToken: 'first-token' });
		await records.putMetadata({ id: 'second', sourceToken: 'second-token' });
		const transaction = database ? context.mock.method(database, 'transaction') : null;

		const batch = await records.getMetadataMany(['second', 'missing', 'first', 'second']);
		assert.deepEqual(batch.map((record) => record?.sourceToken ?? null), ['second-token', null, 'first-token', 'second-token']);
		assert.notEqual(batch[0], batch[3]);
		if (transaction) assert.equal(transaction.mock.callCount(), 1);
		Reflect.set(batch[0] as object, 'sourceToken', 'changed-by-caller');
		assert.equal((await records.getMetadata('second'))?.sourceToken, 'second-token');
	});
}
