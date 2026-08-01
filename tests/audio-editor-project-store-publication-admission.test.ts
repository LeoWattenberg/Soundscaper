/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES,
} from '../src/common/editor/project-publication-admission.ts';
import { createProjectStore } from '../src/common/editor/storage.js';

test('the project store rejects an oversized snapshot before current or revision mutation', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('project-publication-limit'),
		maximumProjectDocumentBytes: 160,
	});
	const retained = {
		schemaVersion: 9,
		id: 'bounded-store-project',
		title: 'Retained',
		revision: 1,
		updatedAt: '2026-08-01T00:00:00.000Z',
	};
	await store.saveProject(retained);

	await assert.rejects(
		store.saveProject({
			...retained,
			title: 'x'.repeat(256),
			revision: 2,
		}),
		/exceeds its byte limit/u,
	);

	assert.deepEqual(await store.loadProject(retained.id), retained);
	assert.deepEqual(
		(await store.listProjectRevisions(retained.id)).map((entry) => entry.revision),
		[1],
	);
});

test('the project store document-limit seam cannot raise the production ceiling', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('project-publication-invalid-limit'),
		maximumProjectDocumentBytes: MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES + 1,
	});

	await assert.rejects(
		store.saveProject({ id: 'must-not-publish', revision: 1 }),
		/document byte limit is invalid/u,
	);
	assert.deepEqual(await store.listProjects(), []);
});

function uniqueDatabaseName(prefix: string): string {
	return `${prefix}-${String(Date.now())}-${String(Math.random())}`;
}
