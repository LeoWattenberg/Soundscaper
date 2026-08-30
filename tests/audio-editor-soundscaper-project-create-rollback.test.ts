/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertScapeImportStore,
	ScapeImportTransaction,
} from '../src/common/editor/scape-import-transaction.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`Soundscaper ${backend} Scape creation retains its exact rollback authority`, async (context) => {
		const store = createSoundscaperProjectStore({
			indexedDB: backend === 'indexeddb'
				? createInstrumentedIndexedDB() as unknown as IDBFactory
				: null,
			preferOpfs: false,
		});
		context.after(async () => { await store.close(); });
		await store.ready();
		const project = createSoundscaperProject({
			id: `soundscaper-${backend}-create-rollback`,
			title: 'Create-only rollback',
			now: '2026-08-30T12:00:00.000Z',
		});

		const created = await store.createScapeProjectIfAbsent(project);
		assert.ok(created);
		assert.notStrictEqual(created, project);
		assert.equal(await store.deleteProjectIfCurrent(structuredClone(created)), false);
		assert.ok(await store.loadProject(project.id));
		assert.equal(await store.deleteProjectIfCurrent(created), true);
		assert.equal(await store.loadProject(project.id), null);
	});

	test(`Soundscaper ${backend} existing-target Scape rollback restores its project snapshot`, async (context) => {
		const store = createSoundscaperProjectStore({
			indexedDB: backend === 'indexeddb'
				? createInstrumentedIndexedDB() as unknown as IDBFactory
				: null,
			preferOpfs: false,
		});
		context.after(async () => { await store.close(); });
		await store.ready();
		const projectId = `soundscaper-${backend}-replace-rollback`;
		const original = createSoundscaperProject({
			id: projectId,
			title: 'Original project',
			now: '2026-08-30T12:00:00.000Z',
		});
		await store.saveProject(original);
		const snapshot = {
			current: await store.loadProject(projectId),
			revisions: await store.listProjectRevisions(projectId),
		};
		const primary = new Error('project persistence failed after its local write');
		const importStore: unknown = new Proxy(store, {
			get(target, property, receiver) {
				if (property === 'saveProjectIfCurrent') return async (
					expected: Parameters<typeof target.saveProjectIfCurrent>[0],
					candidate: Parameters<typeof target.saveProjectIfCurrent>[1],
				) => {
					await target.saveProjectIfCurrent(expected, candidate);
					throw primary;
				};
				const value = Reflect.get(target, property, receiver) as unknown;
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
		assertScapeImportStore(importStore);
		const transaction = new ScapeImportTransaction(importStore);
		await transaction.captureProject(projectId);
		const replacement = createSoundscaperProject({
			id: projectId,
			title: 'Imported replacement',
			revision: 1,
			now: '2026-08-30T12:01:00.000Z',
		});
		await assert.rejects(
			transaction.publishProject(replacement),
			(error: unknown) => error === primary,
		);
		await assert.rejects(transaction.rollback(primary), (error: unknown) => error === primary);
		assert.deepEqual(await store.loadProject(projectId), snapshot.current);
		assert.deepEqual(await store.listProjectRevisions(projectId), snapshot.revisions);

		await store.saveProject(replacement);
		await store.restoreProjectSnapshot(projectId, snapshot);
		assert.deepEqual(await store.loadProject(projectId), snapshot.current);
		assert.deepEqual(await store.listProjectRevisions(projectId), snapshot.revisions);
	});
}
