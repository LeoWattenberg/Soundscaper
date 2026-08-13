/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';
import {
	assertFramescaperEditorProjectEnvironmentV20,
	createFramescaperEditorProjectEnvironmentV20,
} from '../src/framescaper/editor-project-environment-v20.ts';
import { FRAMESCAPER_V20_PROJECT_STORAGE_PROFILE } from '../src/framescaper/editor-project-storage-profile-v20.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('qualification environment composes one exact writable V20 browser authority', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV20({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());

	assert.equal(environment.runtime.profile, FRAMESCAPER_V20_PROJECT_MODEL_PROFILE);
	assert.equal(assertFramescaperEditorProjectEnvironmentV20(environment), environment);
	assert.throws(
		() => assertFramescaperEditorProjectEnvironmentV20({ ...environment }),
		/exact.*environment/iu,
	);
	assert.equal(
		environment.store.databaseName,
		editorProjectStorageProfileNames(FRAMESCAPER_V20_PROJECT_STORAGE_PROFILE).databaseName,
	);
	const project = environment.runtime.createProject({
		id: 'environment-v20',
		title: 'Environment V20',
		now: '2026-08-13T12:00:00.000Z',
	});
	assert.equal(environment.playback.projectForPlayback(project).project.schemaVersion, 17);
	assert.deepEqual(await environment.createProjectIfAbsent(project), project);
	await environment.store.saveProject({ ...project, title: 'Saved environment V20' });
	assert.equal((await environment.store.loadProject(project.id))?.schemaVersion, 20);
});

test('qualification V20 environment exposes no profile, store, or repository authority seam', async () => {
	for (const field of ['profile', 'store', 'repositoryFactory', 'desktopProjectBridge']) {
		let reads = 0;
		const options = Object.defineProperty({}, field, {
			enumerable: true,
			get() { reads += 1; throw new Error('authority getter'); },
		});
		await assert.rejects(
			createFramescaperEditorProjectEnvironmentV20(options),
			/unsupported|authority|options/iu,
		);
		assert.equal(reads, 0);
	}
});

test('qualification V20 environment fails closed when durable storage is unavailable', async () => {
	await assert.rejects(createFramescaperEditorProjectEnvironmentV20({
		storeOptions: { indexedDB: null, preferOpfs: false },
	}), /durable.*required|memory.*unsupported/iu);
});
