/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';
import {
	assertFramescaperEditorProjectEnvironmentV30,
	createFramescaperEditorProjectEnvironmentV30,
} from '../src/framescaper/editor-project-environment-v30.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v30.ts';
import { FRAMESCAPER_V30_PROJECT_STORAGE_PROFILE } from '../src/framescaper/editor-project-storage-profile-v30.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('selected environment composes one exact writable V30 browser and image authority', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV30({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());

	assert.equal(environment.runtime.profile, FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE);
	assert.equal(environment.controllerStore, environment.store);
	assert.equal(typeof environment.timelineImages.publishIfCurrent, 'function');
	assert.equal(environment.initialCleanup.status, 'settled');
	assert.equal(typeof environment.claimCleanup.reconcile, 'function');
	assert.equal(typeof environment.videoProxyCleanup.recover, 'function');
	assert.equal(assertFramescaperEditorProjectEnvironmentV30(environment), environment);
	assert.throws(
		() => assertFramescaperEditorProjectEnvironmentV30({ ...environment }),
		/exact.*environment/iu,
	);
	assert.equal(
		environment.store.databaseName,
		editorProjectStorageProfileNames(FRAMESCAPER_V30_PROJECT_STORAGE_PROFILE).databaseName,
	);
	const project = environment.runtime.createProject({
		id: 'environment-v30',
		title: 'Environment V30',
		now: '2026-08-25T12:00:00.000Z',
	});
	assert.equal(environment.playback.projectForPlayback(project).project.schemaVersion, 30);
	assert.deepEqual(await environment.createProjectIfAbsent(project), project);
	await environment.store.saveProject({ ...project, title: 'Saved environment V30' });
	assert.equal((await environment.store.loadProject(project.id))?.schemaVersion, 30);
});

test('selected V30 environment exposes no caller-owned storage authority seam', async () => {
	for (const field of ['profile', 'store', 'repositoryFactory', 'desktopProjectBridge']) {
		let reads = 0;
		const options = Object.defineProperty({}, field, {
			enumerable: true,
			get() { reads += 1; throw new Error('authority getter'); },
		});
		await assert.rejects(
			createFramescaperEditorProjectEnvironmentV30(options),
			/unsupported|authority|options/iu,
		);
		assert.equal(reads, 0);
	}
});

test('selected V30 environment fails closed when durable storage is unavailable', async () => {
	await assert.rejects(createFramescaperEditorProjectEnvironmentV30({
		storeOptions: { indexedDB: null, preferOpfs: false },
	}), /durable.*required|memory.*unsupported/iu);
});
