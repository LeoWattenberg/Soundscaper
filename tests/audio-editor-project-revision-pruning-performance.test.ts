/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { pruneProjectRevisions } from '../src/common/editor/storage/project-revision-pruning.ts';
import { revisionKey } from '../src/common/editor/storage/project-repository-support.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('revision pruning reads scalar keys instead of deserializing retained project bodies', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const name = `revision-key-pruning-${globalThis.crypto.randomUUID()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, name);
	const projectId = 'project:with:colons';
	await transact(database, ['projects', 'revisions'], 'readwrite', ({ projects, revisions }) => {
		projects.put({ id: projectId, revision: 1 });
		for (const revision of [1, 2, 3, 4, 1_000_000_000_000]) {
			revisions.put({ key: revisionKey(projectId, revision), projectId, revision,
				project: { id: projectId, revision, body: 'large-project-body'.repeat(10_000) } });
		}
		revisions.put({ key: revisionKey('other-project', 0), projectId: 'other-project', revision: 0,
			project: { id: 'other-project', revision: 0 } });
	});
	await pruneProjectRevisions({ database: async () => database, memory: getMemoryDatabase(name) }, projectId, 2);
	assert.equal(indexedDB.stats.getAllRequests.filter((entry: { store: string }) => entry.store === 'revisions').length, 0);
	assert.equal(indexedDB.stats.cursorRequests.filter((entry: { store: string }) => entry.store === 'revisions').length, 0);
	assert.equal(indexedDB.stats.getRequests.filter((entry: { store: string }) => entry.store === 'revisions').length, 0);
	const keys = await transact(database, 'revisions', 'readonly', ({ revisions }) => request(revisions.getAll()));
	assert.deepEqual((keys as { revision: number; projectId: string }[]).filter((row) => row.projectId === projectId)
		.map((row) => row.revision).sort((left, right) => left - right), [1, 1_000_000_000_000]);
	assert.equal((keys as { projectId: string }[]).some((row) => row.projectId === 'other-project'), true);
	database.close();
});

test('revision pruning still accepts legacy noncanonical revision keys', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const name = `legacy-revision-pruning-${globalThis.crypto.randomUUID()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, name);
	await transact(database, ['projects', 'revisions'], 'readwrite', ({ projects, revisions }) => {
		projects.put({ id: 'legacy', revision: 1 });
		for (const revision of [1, 2, 3]) revisions.put({ key: `legacy:old-key-${String(revision)}`,
			projectId: 'legacy', revision, project: { id: 'legacy', revision } });
	});
	await pruneProjectRevisions({ database: async () => database, memory: getMemoryDatabase(name) }, 'legacy', 2);
	const rows = await transact(database, 'revisions', 'readonly', ({ revisions }) => request(revisions.getAll()));
	assert.deepEqual((rows as { revision: number }[]).map((row) => row.revision), [1, 3]);
	database.close();
});
