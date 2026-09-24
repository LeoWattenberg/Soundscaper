/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const NOW = '2026-08-31T12:00:00.000Z';

for (const product of ['soundscaper', 'framescaper'] as const) {
	test(`${product} project store refuses an old write fence through its product repository`, async () => {
		const indexedDB = createInstrumentedIndexedDB();
		const options = { indexedDB, preferOpfs: false };
		const firstStore = product === 'soundscaper'
			? createSoundscaperProjectStore(options)
			: createFramescaperProjectStore(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, options);
		const secondStore = product === 'soundscaper'
			? createSoundscaperProjectStore(options)
			: createFramescaperProjectStore(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, options);
		const base = product === 'soundscaper'
			? createSoundscaperProject({ id: `${product}-fenced`, title: 'Base', now: NOW })
			: createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
				id: `${product}-fenced`, title: 'Base', now: NOW,
			});
		const firstEdit = { ...base, revision: 1, title: 'First edit', updatedAt: NOW };
		const secondEdit = { ...base, revision: 1, title: 'Second edit', updatedAt: NOW };

		try {
			assert.deepEqual(await firstStore.createProjectIfAbsent(base), base);
			const firstFence = await firstStore.claimProjectWriteFence(base.id);
			const secondFence = await secondStore.claimProjectWriteFence(base.id);
			assert.equal(await firstStore.saveProjectIfCurrentWithWriteFence(base, firstEdit, firstFence), null);
			assert.deepEqual(await secondStore.loadProject(base.id), base);
			assert.deepEqual(
				await secondStore.saveProjectIfCurrentWithWriteFence(base, secondEdit, secondFence),
				secondEdit,
			);
			assert.deepEqual(await firstStore.loadProject(base.id), secondEdit);
		} finally {
			await firstStore.close();
			await secondStore.close();
		}
	});
}
