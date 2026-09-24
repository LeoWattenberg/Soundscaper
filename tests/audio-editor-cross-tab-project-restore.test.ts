/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const backend of ['memory', 'indexeddb'] as const) {
	for (const restoreKind of ['ordinary', 'current', 'fenced'] as const) {
		test(`${backend} ${restoreKind} project restore preserves another editor's unsaved history`, async () => {
			const options = {
				indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() : null,
				memoryFallback: backend === 'memory',
				preferOpfs: false,
				databaseName: `project-restore-retention-${backend}-${restoreKind}-${crypto.randomUUID()}`,
			};
			const first = createProjectStore(options);
			const second = createProjectStore(options);
			try {
				await first.ready();
				await second.ready();
				const saved = await first.saveProject({ id: 'restore-target', revision: 0 });
				const fence = restoreKind === 'fenced'
					? await second.claimProjectWriteFence(saved.id) : null;
				const restore = () => restoreKind === 'ordinary'
					? second.restoreProjectSnapshot(saved.id, { current: null, revisions: [] })
					: restoreKind === 'current'
						? second.restoreProjectSnapshotIfCurrent(saved.id, saved, { current: null, revisions: [] })
						: second.restoreProjectSnapshotIfCurrentWithWriteFence(
							saved.id, saved, { current: null, revisions: [] }, fence as string,
						);
				await assert.rejects(restore(), /another editor session still owns local project history/iu);
				assert.ok(await first.loadProject(saved.id));
				assert.ok((await first.listProjectRevisions(saved.id)).length > 0);

				await first.close();
				const result = await restore();
				if (restoreKind !== 'ordinary') assert.equal(result, true);
				assert.equal(await second.loadProject(saved.id), null);
				assert.deepEqual(await second.listProjectRevisions(saved.id), []);
			} finally {
				await first.close();
				await second.close();
			}
		});
	}
}
