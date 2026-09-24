/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sameProjectSnapshot } from '../src/common/editor/storage/project-snapshot-equality.ts';
import { createFixture, project } from './helpers/audio-editor-project-switch-fixture.ts';

test('reopening an inactive tab stays read-only when its stored project changed', async () => {
	const fixture = createFixture();
	await fixture.service.switchProject(project('next-project'));
	Object.assign(fixture.runtime, {
		isPersistedSnapshotCurrent: async (projectId: string) => projectId !== 'old-project',
	});

	await fixture.service.switchProject(project('old-project'));

	assert.equal(fixture.state.readOnly, true);
	assert.equal(fixture.getTab('old-project')?.readOnly, true);
	assert.equal(fixture.getTab('old-project')?.readOnlyReason, 'project-lock');
	assert.equal(fixture.events.includes('maintain-opened:old-project'), false);
});

test('first activation stays read-only when its loaded document changed before lock acquisition', async () => {
	const fixture = createFixture();
	const stored = project('stale-project');
	const older = { ...stored, title: 'Older document at the same revision' };
	Object.assign(fixture.runtime, {
		isActivatedProjectCurrent: async (candidate: typeof stored) => {
			assert.equal(fixture.events.includes('acquire-lock:stale-project'), true);
			return sameProjectSnapshot(stored, candidate);
		},
	});

	await fixture.service.switchProject(older);

	assert.equal(fixture.state.readOnly, true);
	assert.equal(fixture.getTab('stale-project')?.readOnly, true);
	assert.equal(fixture.getTab('stale-project')?.readOnlyReason, 'project-lock');
	assert.equal(fixture.events.includes('maintain-opened:stale-project'), false);
});
