/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import type { ProjectRepositoryPort } from '../src/common/editor/storage/project-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const NOW = '2026-08-12T12:00:00.000Z';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} project publication compare-and-swap requires the exact current document`, async () => {
		const store = createProjectStore({
			indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() : null,
			preferOpfs: false,
			databaseName: uniqueName(`project-cas-${backend}`),
		});
		const projects = store.projectRepository as ProjectRepositoryPort;
		assert.equal(typeof projects.saveIfCurrent, 'function');
		const base = createAudioEditorProjectV17({ id: 'project-cas', title: 'Base', now: NOW });
		await projects.save(base);
		const target = applyEditorCommand(base, { type: 'project/rename', title: 'Target' }, { now: NOW });
		const forgedBase = { ...base, title: 'Same revision, different document' };

		assert.equal(await projects.saveIfCurrent?.(forgedBase, target), null);
		assert.deepEqual(await projects.load(base.id), base);

		const saved = await projects.saveIfCurrent?.(base, target);
		assert.deepEqual(saved, target);
		assert.deepEqual(await projects.load(base.id), target);
		assert.deepEqual((await projects.listRevisions(base.id)).map(({ revision }) => revision), [1, 0]);

		const competing = applyEditorCommand(base, { type: 'project/rename', title: 'Competing' }, { now: NOW });
		assert.equal(await projects.saveIfCurrent?.(base, competing), null);
		assert.deepEqual(await projects.load(base.id), target);
	});
}

function uniqueName(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
