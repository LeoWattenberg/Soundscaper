/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ProjectCommittedMaintenanceError } from
	'../src/common/editor/storage/project-committed-maintenance-error.ts';
import type { ProjectDocument, ProjectRepositoryPort } from
	'../src/common/editor/storage/project-repository.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { SoundscaperProjectRepository } from '../src/soundscaper/editor-project-repository.ts';

const NOW = '2026-09-29T12:00:00.000Z';

function project(): ProjectDocument {
	return createSoundscaperProject({ id: 'repository-boundary', title: 'Boundary', now: NOW });
}

function delegate(overrides: Partial<ProjectRepositoryPort> = {}): ProjectRepositoryPort {
	return {
		createIfAbsent: (value) => Promise.resolve(value),
		createForScapeImportIfAbsent: (value) => Promise.resolve(value),
		save: (value) => Promise.resolve(value),
		saveIfCurrent: (_expected, value) => Promise.resolve(value),
		claimWriteFence: () => Promise.resolve('fence'),
		saveIfCurrentAndFenced: (_expected, value) => Promise.resolve(value),
		load: () => Promise.resolve(null),
		list: () => Promise.resolve([]),
		listRevisions: () => Promise.resolve([]),
		delete: () => Promise.resolve(),
		restore: () => Promise.resolve(),
		restoreIfCurrent: () => Promise.resolve(true),
		restoreIfCurrentAndFenced: () => Promise.resolve(true),
		...overrides,
	};
}

function assertDetachedCommittedError(
	error: unknown, original: ProjectCommittedMaintenanceError, cause: Error,
): boolean {
	assert.ok(error instanceof ProjectCommittedMaintenanceError);
	assert.notStrictEqual(error, original);
	assert.strictEqual(error.cause, cause);
	assert.deepEqual(error.committedProject, original.committedProject);
	assert.notStrictEqual(error.committedProject, original.committedProject);
	return true;
}

test('ordinary save detaches a committed project carried by a maintenance error', async () => {
	const value = project();
	const cause = new Error('maintenance');
	const error = new ProjectCommittedMaintenanceError(value, cause);
	const repository = new SoundscaperProjectRepository(delegate({
		save: () => Promise.reject(error),
	}));
	await assert.rejects(repository.save(value), (thrown) => assertDetachedCommittedError(thrown, error, cause));
});

test('compare-and-swap save detaches a committed project carried by a maintenance error', async () => {
	const value = project();
	const cause = new Error('maintenance');
	const error = new ProjectCommittedMaintenanceError(value, cause);
	const repository = new SoundscaperProjectRepository(delegate({
		saveIfCurrent: () => Promise.reject(error),
	}));
	await assert.rejects(
		repository.saveIfCurrent(value, value),
		(thrown) => assertDetachedCommittedError(thrown, error, cause),
	);
});

test('fenced save detaches a committed project carried by a maintenance error', async () => {
	const value = project();
	const cause = new Error('maintenance');
	const error = new ProjectCommittedMaintenanceError(value, cause);
	const repository = new SoundscaperProjectRepository(delegate({
		saveIfCurrentAndFenced: () => Promise.reject(error),
	}));
	await assert.rejects(
		repository.saveIfCurrentAndFenced(value, value, 'fence'),
		(thrown) => assertDetachedCommittedError(thrown, error, cause),
	);
});

test('create rejects a foreign project before the delegate can publish it', async () => {
	let called = false;
	const repository = new SoundscaperProjectRepository(delegate({
		createIfAbsent: () => { called = true; return Promise.resolve(null); },
	}));
	const foreign = { ...project(), schemaFamily: 'framescaper' } as unknown as ProjectDocument;
	await assert.rejects(repository.createIfAbsent(foreign), /schema identity/iu);
	assert.equal(called, false);
});

test('save rejects a delegate result from a foreign project family', async () => {
	const value = project();
	const foreign = { ...value, schemaFamily: 'framescaper' } as unknown as ProjectDocument;
	const repository = new SoundscaperProjectRepository(delegate({
		save: () => Promise.resolve(foreign),
	}));
	await assert.rejects(repository.save(value), /schema identity/iu);
});

test('load rejects a malformed current project returned by the delegate', async () => {
	const malformed = { ...project(), title: 42 } as unknown as ProjectDocument;
	const repository = new SoundscaperProjectRepository(delegate({
		load: () => Promise.resolve(malformed),
	}));
	await assert.rejects(repository.load('repository-boundary'), /title/iu);
});

test('revision listing rejects a malformed current project returned by the delegate', async () => {
	const malformed = { ...project(), title: 42 } as unknown as ProjectDocument;
	const repository = new SoundscaperProjectRepository(delegate({
		listRevisions: () => Promise.resolve([{ revision: 0, project: malformed }]),
	}));
	await assert.rejects(repository.listRevisions('repository-boundary'), /title/iu);
});

test('restore gives the delegate detached current and revision documents', async () => {
	const value = project();
	let captured: unknown = null;
	const repository = new SoundscaperProjectRepository(delegate({
		restore: (_id, snapshot) => { captured = snapshot; return Promise.resolve(); },
	}));
	await repository.restore(value.id, {
		current: value, revisions: [{ revision: value.revision ?? 0, project: value }],
	});
	assert.ok(captured);
	const snapshot = captured as Parameters<NonNullable<ProjectRepositoryPort['restore']>>[1];
	assert.deepEqual(snapshot.current, value);
	assert.deepEqual(snapshot.revisions[0]?.project, value);
	assert.notStrictEqual(snapshot.current, value);
	assert.notStrictEqual(snapshot.revisions[0]?.project, value);
	assert.notStrictEqual(snapshot.current, snapshot.revisions[0]?.project);
});

test('a compare-and-swap miss remains null without inventing a saved project', async () => {
	const value = project();
	const repository = new SoundscaperProjectRepository(delegate({
		saveIfCurrent: () => Promise.resolve(null),
	}));
	assert.equal(await repository.saveIfCurrent(value, value), null);
});
