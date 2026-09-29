/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} project restore refuses another project's current document and revision`, async (context) => {
		const store = createProjectStore({
			indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() : null,
			memoryFallback: backend === 'memory',
			preferOpfs: false,
			databaseName: `restore-snapshot-identity-${backend}-${crypto.randomUUID()}`,
		});
		context.after(async () => { await store.close(); });
		await store.ready();
		const target = await store.saveProject({ id: 'restore-target', revision: 1, title: 'Target' });
		const other = await store.saveProject({ id: 'restore-other', revision: 1, title: 'Other' });
		const targetRevisions = await store.listProjectRevisions(target.id);
		const otherRevisions = await store.listProjectRevisions(other.id);

		for (const snapshot of [
			{ current: other, revisions: targetRevisions },
			{ current: target, revisions: [{ revision: 0, project: other }] },
		]) {
			await assert.rejects(
				store.restoreProjectSnapshot(target.id, snapshot),
				/snapshot.*project identity/iu,
			);
			assert.deepEqual(await store.loadProject(target.id), target);
			assert.deepEqual(await store.loadProject(other.id), other);
			assert.deepEqual(await store.listProjectRevisions(target.id), targetRevisions);
			assert.deepEqual(await store.listProjectRevisions(other.id), otherRevisions);
		}
	});
}
