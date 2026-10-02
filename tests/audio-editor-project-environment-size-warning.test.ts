/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperEditorProjectEnvironment } from '../src/soundscaper/editor-project-environment.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const product of ['soundscaper', 'framescaper'] as const) {
	test(`${product} project creation forwards a current-operation size decision before persistence`, async () => {
		const createEnvironment = product === 'soundscaper' ? createSoundscaperEditorProjectEnvironment : createFramescaperEditorProjectEnvironment;
		const environment = await createEnvironment({ storeOptions: {
			indexedDB: createInstrumentedIndexedDB(), preferOpfs: false, maximumProjectDocumentBytes: 100,
			storageManager: {
				estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
				persisted: async () => true, persist: async () => true,
			} as unknown as StorageManager,
		} });
		try {
			const options = { id: `${product}-size-warning`, title: 'Large project' };
			const project = product === 'soundscaper' ? createSoundscaperProject(options)
				: createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, options);
			let requests = 0;
			await assert.rejects(environment.createProjectIfAbsent(project, {
				confirmFileSizeWarning: async () => { requests += 1; return false; },
			}), { name: 'AbortError' });
			assert.equal(await environment.store.loadProject(project.id), null);
			assert.equal(requests, 1);
			assert.deepEqual(await environment.createProjectIfAbsent(project, {
				confirmFileSizeWarning: async () => { requests += 1; return true; },
			}), project);
			assert.equal(requests, 2);
		} finally { await environment.close(); }
	});
}
