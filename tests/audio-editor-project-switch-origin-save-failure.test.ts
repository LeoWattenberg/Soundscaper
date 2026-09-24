/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture, project } from './helpers/audio-editor-project-switch-fixture.ts';

test('a failed origin save restores project ownership for later actions and same-project selection', async () => {
	const fixture = createFixture();
	const activeProject = fixture.getProject();
	assert.ok(activeProject);
	fixture.projectGeneration.activate(activeProject.id);
	const priorToken = fixture.projectGeneration.capture(activeProject.id);
	const saveFailure = new Error('Local storage is full.');
	fixture.setSaveNow(async () => { throw saveFailure; });

	await assert.rejects(fixture.service.switchProject(project('next-project')), (error) => error === saveFailure);
	assert.strictEqual(fixture.getProject(), activeProject);
	assert.equal(fixture.state.projectLock, fixture.initialLock);
	assert.throws(() => fixture.projectGeneration.assertCurrent(priorToken), { code: 'PROJECT_CHANGED' });
	const recoveredToken = fixture.projectGeneration.capture(activeProject.id);
	fixture.projectGeneration.assertCurrent(recoveredToken);

	await fixture.service.switchProject(activeProject);
	fixture.projectGeneration.assertCurrent(recoveredToken);
	assert.equal(fixture.events.includes('stop-engine'), false);
});
