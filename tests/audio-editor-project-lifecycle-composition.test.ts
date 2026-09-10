/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectLifecycleComposition } from '../src/common/editor/controller/document/project-lifecycle-composition.ts';
import { createFixture, lock, project } from './helpers/audio-editor-project-switch-fixture.ts';

test('project activation releases its previous lease through the composed lock owner', async () => {
	const fixture = createFixture();
	const state = Object.assign(fixture.state, { disposed: false, projectLockRetryTimer: 0 });
	const acquired = lock('next');
	const composition = createProjectLifecycleComposition({
		projects: fixture.runtime,
		locking: {
			state,
			cancelTask: name => fixture.lifetime.cancelTask(name),
			getProjectId: () => fixture.getProject()?.id ?? null,
			getProjectMetadata: id => fixture.getTabMetadata(id) ?? {},
			acquireProjectLock: async () => acquired,
			setProjectReadOnly: fixture.runtime.session.setProjectReadOnly,
			publishProjectState: fixture.runtime.publishProjectState,
			setStatus: fixture.runtime.setStatus,
			handleError: error => { throw error; },
			copy: fixture.runtime.copy,
		},
	});
	await composition.projects.switchProject(project('next'));
	assert.equal(fixture.initialLock.releases, 1);
	assert.equal(state.projectLock, acquired);
	await composition.locking.releaseProjectLock();
	assert.equal(acquired.releases, 1);
	assert.equal(state.projectLock, null);
});
