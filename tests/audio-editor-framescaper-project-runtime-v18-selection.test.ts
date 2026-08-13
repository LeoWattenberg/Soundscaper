/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorProjectRuntimeV18Selection } from '../src/framescaper/editor-project-runtime-v18-selection.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import { createFramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;

test('selection authenticates exact V18 before observing any options', () => {
	let reads = 0;
	const options = new Proxy({}, {
		get() { reads += 1; throw new Error('option get'); },
		ownKeys() { reads += 1; throw new Error('option keys'); },
		getOwnPropertyDescriptor() { reads += 1; throw new Error('option descriptor'); },
	});
	assert.throws(() => createEditorProjectRuntimeV18Selection({}, options), /exact Framescaper V18/iu);
	assert.equal(reads, 0);
});

test('selected runtime creates, migrates, projects, commands, and histories exact V18', () => {
	const runtime = createEditorProjectRuntimeV18Selection(PROFILE);
	const project = runtime.createProject({ title: 'Selected V18', now: '2026-08-13T12:00:00.000Z' });
	assert.equal(project.schemaVersion, 18);
	assert.equal(runtime.validateProject(project), true);
	assert.deepEqual(runtime.cloneProject(project), project);
	assert.equal(runtime.migrateProject(project).project.schemaVersion, 18);
	assert.equal(runtime.projectForCommandConsumers(project).schemaVersion, 18);
	assert.equal(runtime.projectForRuntimeConsumers(project).schemaVersion, 18);

	const history = runtime.createHistory(project);
	const commanded = runtime.executeCommand(history, {
		type: 'project/rename',
		title: 'Commanded V18',
	}, { now: '2026-08-13T12:01:00.000Z' });
	assert.equal(commanded.present.schemaVersion, 18);
	assert.equal(commanded.present.title, 'Commanded V18');
	assert.equal(runtime.canUndo(commanded), true);
	assert.equal(runtime.canRedo(commanded), false);
	assert.equal(runtime.undo(commanded, { now: '2026-08-13T12:02:00.000Z' }).present.title, 'Selected V18');
});

test('selected session accepts writable all-null V18 and installs attached V18 intrinsically read-only', () => {
	const runtime = createEditorProjectRuntimeV18Selection(PROFILE);
	const session = runtime.createSessionController();
	const project = runtime.createProject({ title: 'Session V18', now: '2026-08-13T12:00:00.000Z' });
	assert.deepEqual(session.openProject(project), {
		projectId: project.id,
		opened: true,
		activated: true,
		releasedSourceIds: [],
	});
	assert.equal(session.getSnapshot().tabs[0]?.readOnly, false);
	assert.equal(session.getProject().schemaVersion, 18);

	const other = createFramescaperProjectV18(PROFILE, {
		id: 'other-v18', title: 'Other', now: '2026-08-13T12:00:00.000Z',
	});
	session.openProject(other, { readOnly: true, readOnlyReason: 'proxy-attached' });
	assert.equal(session.getSnapshot().tabs.find((tab: { projectId: string }) => (
		tab.projectId === 'other-v18'
	))?.readOnly, true);
});

test('selected runtime threads exact storage and lock profiles while legacy selection stays absent', async () => {
	const calls: unknown[] = [];
	const runtime = createEditorProjectRuntimeV18Selection(PROFILE, {
		createStore: (profile, options) => { calls.push(['store', profile, options]); return { store: true }; },
		acquireLock: async (projectId, options) => { calls.push(['lock', projectId, options]); return { projectId }; },
	});
	assert.deepEqual(runtime.createProjectStore({ memoryFallback: false }), { store: true });
	assert.deepEqual(await runtime.acquireProjectLock('project-v18'), { projectId: 'project-v18' });
	assert.equal(calls.length, 2);
	assert.equal((calls[0] as unknown[])[1], PROFILE);
	assert.equal(typeof ((calls[1] as unknown[])[2] as Record<string, unknown>).projectStorageProfile, 'object');
});
