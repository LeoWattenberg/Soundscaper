/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProjectDocument } from '../src/common/editor/storage/project-repository.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { SoundscaperProjectRepository } from '../src/soundscaper/editor-project-repository.ts';

test('repository reads retain future Soundscaper documents as opaque custody', async () => {
	const current = createSoundscaperProject({
		id: 'current-project', title: 'Current project', now: '2026-08-31T12:00:00.000Z',
	});
	const future = {
		...structuredClone(current),
		id: 'future-project',
		schemaVersion: current.schemaVersion + 1,
		opaqueFutureState: { revision: 1 },
	} as unknown as ProjectDocument;
	const repository = new SoundscaperProjectRepository({
		createIfAbsent: () => Promise.resolve(null),
		createForScapeImportIfAbsent: () => Promise.resolve(null),
		save: (project: ProjectDocument) => Promise.resolve(project),
		saveIfCurrent: (_expected: ProjectDocument, project: ProjectDocument) => Promise.resolve(project),
		load: () => Promise.resolve(future),
		list: () => Promise.resolve([current, future]),
		listRevisions: () => Promise.resolve([
			{ revision: current.revision, project: current },
			{ revision: Number(future.revision), project: future },
		]),
		delete: () => Promise.resolve(),
		restore: () => Promise.resolve(),
		restoreIfCurrent: () => Promise.resolve(true),
	});

	assert.deepEqual(await repository.load('future-project'), future);
	assert.deepEqual(await repository.list(), [current, future]);
	assert.deepEqual(
		(await repository.listRevisions('future-project')).map(({ project }) => project),
		[current, future],
	);
});
