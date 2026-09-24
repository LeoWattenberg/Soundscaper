/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { saveFencedProjectSnapshot } from '../src/common/editor/controller/document/internal/project/project-fenced-save-adapter.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import type { ProjectDocument } from '../src/common/editor/storage/project-repository.ts';

test('fenced save returns the stored canonical project after unreachable source metadata is compacted', async () => {
	const store = createProjectStore({
		indexedDB: null, preferOpfs: false, databaseName: `fenced-save-${crypto.randomUUID()}`,
	});
	const base = createAudioEditorProjectV17({
		id: 'canonical-save', title: 'Base', now: '2026-08-14T10:00:00.000Z',
	});
	await store.saveProject(base);
	const writeFence = await store.claimProjectWriteFence(base.id);
	const edited = applyEditorCommand(base, { type: 'project/rename', title: 'Edited' });
	const snapshot: ProjectDocument = {
		...edited,
		sources: [{ id: 'unreachable-source', kind: 'audio' }],
	};
	const saved = await saveFencedProjectSnapshot(
		(expected, candidate, fence) => store.saveProjectIfCurrentWithWriteFence(expected, candidate, fence),
		base, snapshot, writeFence, undefined,
	);

	assert.deepEqual((snapshot.sources as readonly unknown[]).length, 1);
	assert.deepEqual(saved?.sources, []);
	assert.deepEqual(saved, await store.loadProject(base.id));
});
