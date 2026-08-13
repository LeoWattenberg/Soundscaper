/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';
import {
	createFramescaperEditorProjectEnvironmentV18,
} from '../src/framescaper/editor-project-environment-v18.ts';
import { FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE } from '../src/framescaper/editor-project-storage-profile-v18.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('product environment composes one exact V18 authority after startup cleanup', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV18({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());

	assert.equal(environment.runtime.profile, FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE);
	assert.equal(
		environment.store.databaseName,
		editorProjectStorageProfileNames(FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE).databaseName,
	);
	assert.equal(environment.initialCleanup.status, 'settled');
	assert.deepEqual(environment.initialCleanup.issues, []);
	const project = environment.runtime.createProject({
		id: 'environment-v18',
		title: 'Environment V18',
		now: '2026-08-13T12:00:00.000Z',
	});
	assert.equal(environment.playback.projectForPlayback(project).project.schemaVersion, 18);
	assert.equal((await environment.archive.exportProject(project)).formatVersion, 1);
	assert.deepEqual(await environment.createProjectIfAbsent(project), project);
	await environment.store.saveProject({ ...project, title: 'Saved environment V18' });
	assert.equal((await environment.store.loadProject(project.id))?.schemaVersion, 18);
	assert.deepEqual(environment.collectStorageRoots({
		currentProject: project,
		retainedRevisions: [],
		histories: [],
		pendingSaveSnapshots: [],
		claims: [],
	}), []);
});

test('product environment exposes no profile, store, repository, or desktop injection seam', async () => {
	for (const field of ['profile', 'store', 'repositoryFactory', 'desktopProjectBridge']) {
		let reads = 0;
		const options = Object.defineProperty({}, field, {
			enumerable: true,
			get() { reads += 1; throw new Error('authority getter'); },
		});
		await assert.rejects(
			createFramescaperEditorProjectEnvironmentV18(options),
			/unsupported|authority|options/iu,
		);
		assert.equal(reads, 0);
	}
});

test('product environment fails closed before exposure when durable startup is unavailable', async () => {
	await assert.rejects(createFramescaperEditorProjectEnvironmentV18({
		storeOptions: { indexedDB: null, preferOpfs: false },
	}), /durable.*required|memory.*unsupported/iu);
});
