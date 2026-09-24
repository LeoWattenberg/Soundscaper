/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFixture, project } from './helpers/audio-editor-project-switch-fixture.ts';

test('opening an unstored editable project publishes it with create-only authority', async () => {
	const fixture = createFixture(undefined, { createOnly: true });
	Object.assign(fixture.runtime, {
		isProjectAbsent: async (id: string) => id === 'fresh-project',
		isActivatedProjectCurrent: async () => false,
	});
	await fixture.service.openProject(project('fresh-project'));
	assert.equal(fixture.state.readOnly, false);
	assert.deepEqual(fixture.createdProjects.map(({ id }) => id), ['fresh-project']);
	assert.equal(fixture.events.includes('save-project:fresh-project'), false);
});

test('a project inserted after absence inspection cannot be overwritten by open', async () => {
	const fixture = createFixture(undefined, { createOnly: true });
	Object.assign(fixture.runtime, {
		isProjectAbsent: async () => true,
		createProjectIfAbsent: async () => null,
	});
	await assert.rejects(fixture.service.openProject(project('raced-project')), /already exists at create-only publication/iu);
	assert.equal(fixture.events.includes('save-project:raced-project'), false);
	assert.equal(fixture.state.readOnly, true);
	assert.equal(fixture.getTab('raced-project')?.readOnly, true);
	assert.equal(fixture.getTab('raced-project')?.readOnlyReason, 'project-activation-failed');
	assert.equal(fixture.state.projectLock, null);
});
