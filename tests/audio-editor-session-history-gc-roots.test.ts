/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectAdminService } from '../src/common/editor/controller/document/project-admin-service.ts';
import { createFixture } from './audio-editor-project-admin-service-fixture.ts';

test('garbage collection protects session storage keys without detaching history projects', async () => {
	const fixture = createFixture();
	Object.assign(fixture.runtime.sessionController, {
		getHistoryStorageKeys: () => new Set(['history-storage-key']),
		getSnapshot: () => { throw new Error('detached session history was read'); },
	});
	const service = createProjectAdminService(fixture.runtime);
	await service.garbageCollectSources();
	const options = fixture.pruneOptions() as Readonly<{
		protectedSourceIds: ReadonlySet<string>;
		protectedProjects: readonly unknown[];
	}> | null;
	assert.ok(options);
	assert.equal(options.protectedSourceIds.has('history-storage-key'), true);
	assert.deepEqual(options.protectedProjects, fixture.runtime.projectSaveService.pendingSnapshots);
});
