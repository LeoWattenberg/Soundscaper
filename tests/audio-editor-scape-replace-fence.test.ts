/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { beginScapeImportTransaction, ScapeImportTransaction, type ScapeImportStore } from '../src/common/editor/scape-import-transaction.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createBaselineAudioEditorProject, importBaselineScapeProject } from './helpers/baseline-scape-runtime.ts';

test('Scape import holds replace authority until uncertain publication rollback completes', async () => {
	const source = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'scape-replace-held-source' });
	const target = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'scape-replace-held-target' });
	await Promise.all([source.ready(), target.ready()]);
	const imported = createBaselineAudioEditorProject({ id: 'project-a', title: 'Imported', sources: [], clips: [], tracks: [] });
	const previous = { ...imported, title: 'Original' };
	await target.saveProject(previous);
	const archive = (await exportScapeProject(imported, source)).blob as Blob;
	const token = await target.claimProjectWriteFence(imported.id);
	const primary = new Error('acknowledgement lost');
	let released = false, restoredWhileHeld = false;
	const importStore = new Proxy(target, {
		get(store, key) {
			if (key === 'saveProjectIfCurrentWithWriteFence') return async (...args: Parameters<typeof target.saveProjectIfCurrentWithWriteFence>) => {
				await target.saveProjectIfCurrentWithWriteFence(...args);
				throw primary;
			};
			if (key === 'restoreProjectSnapshotIfCurrentWithWriteFence') return async (...args: Parameters<typeof target.restoreProjectSnapshotIfCurrentWithWriteFence>) => {
				restoredWhileHeld = !released;
				return target.restoreProjectSnapshotIfCurrentWithWriteFence(...args);
			};
			const value = Reflect.get(store, key, store) as unknown;
			return typeof value === 'function' ? value.bind(store) : value;
		},
	});
	await assert.rejects(importBaselineScapeProject(archive, importStore, {
		collision: 'replace',
		acquireReplaceProjectWriteAuthority: async () => ({ writeFence: token, assertCurrent() {}, release() { released = true; } }),
	}), (error: unknown) => error === primary);
	assert.equal(restoredWhileHeld, true);
	assert.equal(released, true);
	await Promise.all([source.close(), target.close()]);
});

test('Scape replace releases the acquired lock if its initially inspected document changed', async () => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'scape-replace-inspection-race' });
	await store.ready();
	const inspected = { id: 'project-a', revision: 0, title: 'Inspected', sources: [] };
	await store.saveProject(inspected);
	await store.saveProject({ ...inspected, revision: 1, title: 'Newer' });
	const token = await store.claimProjectWriteFence(inspected.id);
	let released = false;
	await assert.rejects(beginScapeImportTransaction(store as ScapeImportStore, undefined, inspected.id, inspected,
		() => ({ writeFence: token, assertCurrent() {}, release() { released = true; } })), /changed before import acquired/iu);
	assert.equal(released, true);
	assert.equal((await store.loadProject(inspected.id))?.title, 'Newer');
	await store.close();
});

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`Scape replace refuses a stale write token over an unchanged project in ${backend}`, async () => {
		const store = createProjectStore({
			indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() as unknown as IDBFactory : null,
			preferOpfs: false, databaseName: `scape-replace-fence-${backend}-${Math.random()}`,
		});
		await store.ready();
		const base = { id: 'project-a', revision: 0, title: 'Original', sources: [] };
		await store.saveProject(base);
		const stale = await store.claimProjectWriteFence(base.id);
		const transaction = new ScapeImportTransaction(store as ScapeImportStore, undefined, {
			writeFence: stale, assertCurrent() {}, release() {},
		});
		await transaction.captureProject(base.id, base);
		await store.claimProjectWriteFence(base.id);
		await assert.rejects(transaction.publishProject({ ...base, revision: 1, title: 'Imported' }), /write authority|changed concurrently/iu);
		assert.equal((await store.loadProject(base.id))?.title, 'Original');
		await store.close();
	});

	test(`Scape replace rollback refuses to restore after the token changes in ${backend}`, async () => {
		const store = createProjectStore({
			indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() as unknown as IDBFactory : null,
			preferOpfs: false, databaseName: `scape-replace-rollback-fence-${backend}-${Math.random()}`,
		});
		await store.ready();
		const base = { id: 'project-a', revision: 0, title: 'Original', sources: [] };
		await store.saveProject(base);
		const token = await store.claimProjectWriteFence(base.id);
		const primary = new Error('acknowledgement lost');
		const importStore = new Proxy(store, {
			get(target, key) {
				if (key === 'saveProjectIfCurrentWithWriteFence') return async (...args: Parameters<typeof store.saveProjectIfCurrentWithWriteFence>) => {
					await store.saveProjectIfCurrentWithWriteFence(...args);
					await store.claimProjectWriteFence(base.id);
					throw primary;
				};
				const value = Reflect.get(target, key, target) as unknown;
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
		const transaction = new ScapeImportTransaction(importStore as ScapeImportStore, undefined, {
			writeFence: token, assertCurrent() {}, release() {},
		});
		await transaction.captureProject(base.id, base);
		await assert.rejects(transaction.publishProject({ ...base, revision: 1, title: 'Imported' }), (error: unknown) => error === primary);
		await assert.rejects(transaction.rollback(primary), (error: unknown) => error === primary);
		assert.equal((await store.loadProject(base.id))?.title, 'Imported');
		await store.close();
	});

	test(`Scape replace retains the committed document when fenced restore is unavailable in ${backend}`, async () => {
		const store = createProjectStore({
			indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() as unknown as IDBFactory : null,
			preferOpfs: false, databaseName: `scape-replace-no-restore-${backend}-${Math.random()}`,
		});
		await store.ready();
		const base = { id: 'project-a', revision: 0, title: 'Original', sources: [] };
		await store.saveProject(base);
		const token = await store.claimProjectWriteFence(base.id);
		const primary = new Error('acknowledgement lost');
		const importStore = new Proxy(store, {
			get(target, key) {
				if (key === 'restoreProjectSnapshotIfCurrentWithWriteFence') return undefined;
				if (key === 'saveProjectIfCurrentWithWriteFence') return async (...args: Parameters<typeof store.saveProjectIfCurrentWithWriteFence>) => {
					await store.saveProjectIfCurrentWithWriteFence(...args);
					throw primary;
				};
				const value = Reflect.get(target, key, target) as unknown;
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
		const transaction = new ScapeImportTransaction(importStore as ScapeImportStore, undefined, {
			writeFence: token, assertCurrent() {}, release() {},
		});
		await transaction.captureProject(base.id, base);
		await assert.rejects(transaction.publishProject({ ...base, revision: 1, title: 'Imported' }), (error: unknown) => error === primary);
		await assert.rejects(transaction.rollback(primary), (error: unknown) => error === primary);
		assert.equal((await store.loadProject(base.id))?.title, 'Imported');
		await store.close();
	});
}
