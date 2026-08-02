/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import {
	LINKED_VIDEO_ORIGINAL_STORE_NAME,
	linkedVideoOriginalBindingKey,
} from '../src/common/editor/storage/linked-video-original-schema.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { ProjectRepository } from '../src/common/editor/storage/project-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`project deletion removes only its ${backend} linked video bindings`, async (context) => {
		const databaseName = uniqueDatabaseName(`linked-video-project-delete-${backend}`);
		const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
		const database = indexedDB
			? await openDatabase(indexedDB as unknown as IDBFactory, databaseName)
			: null;
		context.after(() => { database?.close(); });
		const memory = getMemoryDatabase(databaseName);
		const repository = new ProjectRepository({ memory, database: async () => database }, 20);
		const records = [
			bindingRecord('project-a', 'source-a'),
			bindingRecord('project-a', 'source-b'),
			bindingRecord('project-b', 'source-a'),
		];

		if (!indexedDB) {
			memory.projects.set('project-a', { id: 'project-a' });
			memory.projects.set('project-b', { id: 'project-b' });
			memory.revisions.set('project-a:revision', {
				key: 'project-a:revision', projectId: 'project-a', revision: 1, project: { id: 'project-a' },
			});
			for (const record of records) memory.linkedVideoOriginalBindings.set(record.key, record);
		} else {
			indexedDB.seedRecord(databaseName, 'projects', { id: 'project-a' });
			indexedDB.seedRecord(databaseName, 'projects', { id: 'project-b' });
			indexedDB.seedRecord(databaseName, 'revisions', {
				key: 'project-a:revision', projectId: 'project-a', revision: 1, project: { id: 'project-a' },
			});
			for (const record of records) {
				indexedDB.seedRecord(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME, record);
			}
		}

		await repository.delete('project-a');

		assert.deepEqual(bindingProjects(memory, indexedDB, databaseName), ['project-b']);
		if (!indexedDB) {
			assert.equal(memory.projects.has('project-a'), false);
			assert.equal(memory.projects.has('project-b'), true);
			assert.equal(memory.revisions.size, 0);
		} else {
			assert.deepEqual(indexedDB.records(databaseName, 'projects').map(({ id }) => id), ['project-b']);
			assert.equal(indexedDB.recordCount(databaseName, 'revisions'), 0);
		}
	});

	test(`whole-store clear removes ${backend} linked video bindings`, async (context) => {
		const databaseName = uniqueDatabaseName(`linked-video-clear-${backend}`);
		const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
		const store = new AudioEditorProjectStore({
			indexedDB: indexedDB as unknown as IDBFactory | null,
			databaseName,
			preferOpfs: false,
		});
		context.after(async () => { await store.close(); });
		await store.ready();
		const record = bindingRecord('project-clear', 'source-clear');
		if (!indexedDB) store.memory.linkedVideoOriginalBindings.set(record.key, record);
		else indexedDB.seedRecord(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME, record);

		await store.clear();

		assert.equal(
			indexedDB
				? indexedDB.recordCount(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME)
				: store.memory.linkedVideoOriginalBindings.size,
			0,
		);
	});
}

function bindingRecord(projectId: string, sourceId: string) {
	return {
		key: linkedVideoOriginalBindingKey(projectId, sourceId),
		projectId,
		binding: Object.freeze({ projectId, sourceId }),
	};
}

function bindingProjects(
	memory: ReturnType<typeof getMemoryDatabase>,
	indexedDB: ReturnType<typeof createInstrumentedIndexedDB> | null,
	databaseName: string,
): string[] {
	const values = indexedDB
		? indexedDB.records(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME)
		: [...memory.linkedVideoOriginalBindings.values()] as Record<string, unknown>[];
	return values.map(({ projectId }) => String(projectId)).sort();
}

function uniqueDatabaseName(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random()}`;
}
