/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorHistory } from '../src/common/editor/history.js';
import { createAudioEditorSessionController } from '../src/common/editor/session.js';
import { createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import {
	createTakeCycleCurrentProjectPublicationService,
	type TakeCyclePublicationHistory,
	type TakeCyclePublicationSession,
} from '../src/common/editor/controller/take-cycle-current-project-publication-service.ts';
import type { TakeCyclePublishedProject } from '../src/common/editor/controller/take-cycle-recording-repository-composition.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';

const NOW = '2026-08-12T12:00:00.000Z';

test('live CAS publication becomes one exact undo step and is already saved', async () => {
	const fixture = publicationFixture();
	await fixture.publish(livePublication(fixture.base));

	const tab = fixture.session.getSnapshot().tabs[0]!;
	assert.deepEqual(fixture.project, tab.history.present);
	assert.equal(tab.dirty, false);
	assert.equal(tab.history.undoStack.length, 1);
	assert.deepEqual(tab.history.undoStack[0], {
		project: fixture.base,
		command: livePublication(fixture.base).command,
	});
	assert.deepEqual(tab.history.redoStack, []);
	assert.deepEqual(fixture.synchronized, [fixture.project]);
});

test('restart recovery replaces an exact base without inventing undo history', async () => {
	const fixture = publicationFixture();
	const publication = livePublication(fixture.base);
	await fixture.publish({ ...publication, reason: 'recovery', command: null });

	const tab = fixture.session.getSnapshot().tabs[0]!;
	assert.equal(tab.dirty, false);
	assert.deepEqual(tab.history.undoStack, []);
	assert.deepEqual(tab.history.redoStack, []);
	assert.deepEqual(tab.history.present, publication.target);
});

test('restart recovery accepts an already exact target but refuses stale base authority', async () => {
	const exact = publicationFixture();
	const publication = livePublication(exact.base);
	const targetHistory = createEditorHistory(publication.target);
	exact.session.updateProjectHistory(exact.base.id, targetHistory, { dirty: true });
	exact.project = publication.target;
	exact.history = targetHistory;
	await exact.publish({ ...publication, reason: 'recovery', command: null });
	assert.equal(exact.session.getSnapshot().tabs[0]!.dirty, false);

	const stale = publicationFixture();
	stale.project = { ...stale.base, title: 'Competing in-memory edit' };
	stale.session.updateProject(stale.base.id, stale.project);
	stale.history = stale.session.getProjectHistory(stale.base.id);
	await assert.rejects(
		stale.publish({ ...publication, reason: 'recovery', command: null }),
		/exact take cycle base or target/u,
	);
	assert.equal(stale.synchronized.length, 0);
});

function publicationFixture() {
	const base = createAudioEditorProjectV17({
		id: 'project-cycle', title: 'Cycle', now: NOW,
		tracks: [createAudioTrackV10({ id: 'track-a', name: 'Vocal', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['track-a'] }],
		primarySequenceId: 'main-sequence',
	});
	const session = createAudioEditorSessionController();
	session.openProject(base, { history: createEditorHistory(base), dirty: true });
	let project = base;
	let history = session.getProjectHistory(base.id) as TakeCyclePublicationHistory;
	const synchronized: typeof base[] = [];
	const service = createTakeCycleCurrentProjectPublicationService({
		getActiveProject: () => project,
		getActiveHistory: () => history,
		setActiveProject: (value) => { project = value; },
		setActiveHistory: (value) => { history = value; },
		isActiveProject: (projectId) => project.id === projectId,
		session: session as unknown as TakeCyclePublicationSession,
		synchronizeProject: (value) => { synchronized.push(value); },
	});
	return {
		base, session, synchronized,
		get project() { return project; },
		set project(value) { project = value; },
		set history(value: TakeCyclePublicationHistory) { history = value; },
		publish: service.publish,
	};
}

function livePublication(base: ReturnType<typeof createAudioEditorProjectV17>): TakeCyclePublishedProject {
	const command = { type: 'project/rename' as const, title: 'Cycle captured' };
	return Object.freeze({
		reason: 'finalize' as const,
		base,
		target: applyEditorCommand(base, command, { now: NOW }),
		command,
	});
}
