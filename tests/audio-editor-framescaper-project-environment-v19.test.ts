/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';
import {
	assertFramescaperEditorProjectEnvironmentV19,
	createFramescaperEditorProjectEnvironmentV19,
} from '../src/framescaper/editor-project-environment-v19.ts';
import { FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v19.ts';
import { FRAMESCAPER_V19_PROJECT_STORAGE_PROFILE } from '../src/framescaper/editor-project-storage-profile-v19.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('lean product environment composes one exact writable V19 browser authority', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV19({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());

	assert.equal(environment.runtime.profile, FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE);
	assert.equal(assertFramescaperEditorProjectEnvironmentV19(environment), environment);
	assert.throws(
		() => assertFramescaperEditorProjectEnvironmentV19({ ...environment }),
		/exact.*environment/iu,
	);
	assert.equal(
		environment.store.databaseName,
		editorProjectStorageProfileNames(FRAMESCAPER_V19_PROJECT_STORAGE_PROFILE).databaseName,
	);
	const project = environment.runtime.createProject({
		id: 'environment-v19',
		title: 'Environment V19',
		now: '2026-08-13T12:00:00.000Z',
	});
	assert.equal(environment.playback.projectForPlayback(project).project.schemaVersion, 17);
	assert.deepEqual(await environment.createProjectIfAbsent(project), project);
	await environment.store.saveProject({ ...project, title: 'Saved environment V19' });
	assert.equal((await environment.store.loadProject(project.id))?.schemaVersion, 19);
});

test('lean V19 environment exposes no profile, store, or repository authority seam', async () => {
	for (const field of ['profile', 'store', 'repositoryFactory', 'desktopProjectBridge']) {
		let reads = 0;
		const options = Object.defineProperty({}, field, {
			enumerable: true,
			get() { reads += 1; throw new Error('authority getter'); },
		});
		await assert.rejects(
			createFramescaperEditorProjectEnvironmentV19(options),
			/unsupported|authority|options/iu,
		);
		assert.equal(reads, 0);
	}
});

test('lean V19 environment fails closed when durable storage is unavailable', async () => {
	await assert.rejects(createFramescaperEditorProjectEnvironmentV19({
		storeOptions: { indexedDB: null, preferOpfs: false },
	}), /durable.*required|memory.*unsupported/iu);
});
