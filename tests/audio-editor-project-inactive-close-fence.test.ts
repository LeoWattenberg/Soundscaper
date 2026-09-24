/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectAdminService,
	type ProjectAdminServiceRuntime,
} from '../src/common/editor/controller/document/project-admin-service.ts';
import { createFixture, type Project } from './audio-editor-project-admin-service-fixture.ts';

test('closing a dirty inactive tab refuses a save after another writer changes its document', async () => {
	const fixture = createFixture();
	const inactive: Project = { id: 'project-b', title: 'Unsaved local edit', revision: 2 };
	const base: Project = { id: 'project-b', title: 'Last stored edit', revision: 1 };
	fixture.tabs.set(inactive.id, {
		projectId: inactive.id, dirty: true, readOnly: false, history: { present: inactive },
	});
	let released = false;
	let attempted = false;
	const runtime: ProjectAdminServiceRuntime<Project> = {
		...fixture.runtime,
		projectSaveService: {
			...fixture.runtime.projectSaveService,
			getPersistedSnapshot: () => base,
		},
		acquireInactiveProjectLock: async () => ({
			readOnly: false, writeFence: 'second-writer', release() { released = true; },
		}),
		store: {
			...fixture.runtime.store,
			async saveProject() { throw new Error('Unconditional save must not run.'); },
			async saveProjectIfCurrentWithWriteFence(expected, snapshot, writeFence) {
				attempted = true;
				assert.deepEqual(expected, base);
				assert.deepEqual(snapshot, inactive);
				assert.equal(writeFence, 'second-writer');
				return null;
			},
		},
	};

	await assert.rejects(() => createProjectAdminService(runtime).closeProjectTab(inactive.id), /read-only/iu);
	assert.equal(attempted, true);
	assert.equal(released, true);
	assert.equal(fixture.tabs.get(inactive.id)?.dirty, true);
	assert.equal(fixture.tabs.has(inactive.id), true);
	assert.equal(fixture.calls.includes(`close:${inactive.id}`), false);
});

test('closing an inactive tab releases its retained durable snapshot', async () => {
	const fixture = createFixture();
	const inactive: Project = { id: 'project-b', title: 'Saved', revision: 1 };
	fixture.tabs.set(inactive.id, {
		projectId: inactive.id, dirty: false, readOnly: false, history: { present: inactive },
	});
	const forgotten: string[] = [];
	const runtime: ProjectAdminServiceRuntime<Project> = {
		...fixture.runtime,
		projectSaveService: {
			...fixture.runtime.projectSaveService,
			forgetPersistedSnapshot: (projectId) => { forgotten.push(projectId); },
		},
	};

	const result = await createProjectAdminService(runtime).closeProjectTab(inactive.id);
	assert.equal(result.closed, true);
	assert.deepEqual(forgotten, [inactive.id]);
});
