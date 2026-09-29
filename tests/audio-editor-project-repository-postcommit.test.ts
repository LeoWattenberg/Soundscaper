/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { ProjectCommittedMaintenanceError } from '../src/common/editor/storage/project-committed-maintenance-error.ts';
import type { ProjectRepositoryPort } from '../src/common/editor/storage/project-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} ordinary save reports a committed project when maintenance fails`, async () => {
		const store = createProjectStore({
			indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() : null,
			preferOpfs: false,
			databaseName: `project-postcommit-${backend}-${crypto.randomUUID()}`,
		});
		const projects = store.projectRepository as ProjectRepositoryPort;
		const project = createAudioEditorProjectV17({
			id: 'project-postcommit', title: 'Committed', now: '2026-09-29T00:00:00.000Z',
		});
		const maintenanceFailure = new Error('Planned post-commit failure');

		await assert.rejects(
			projects.save(project, async () => { throw maintenanceFailure; }),
			(error: unknown) => {
				assert.ok(error instanceof ProjectCommittedMaintenanceError);
				assert.equal(error.cause, maintenanceFailure);
				assert.deepEqual(error.committedProject, project);
				return true;
			},
		);
		assert.deepEqual(await projects.load(project.id), project);
	});
}
