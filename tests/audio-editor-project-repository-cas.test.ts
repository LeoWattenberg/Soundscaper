/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createProjectSaveService } from '../src/common/editor/controller/document/project-save-service.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { ProjectCommittedMaintenanceError } from '../src/common/editor/storage/project-committed-maintenance-error.ts';
import type { ProjectDocument, ProjectRepositoryPort } from '../src/common/editor/storage/project-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const NOW = '2026-08-12T12:00:00.000Z';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} a newly claimed write fence rejects an older writer before the successor saves`, async () => {
		const databaseName = uniqueName(`project-write-fence-${backend}`);
		const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
		const firstStore = createProjectStore({ indexedDB, preferOpfs: false, databaseName });
		const secondStore = createProjectStore({ indexedDB, preferOpfs: false, databaseName });
		const base = createAudioEditorProjectV17({ id: 'project-fenced', title: 'Base', now: NOW });
		await firstStore.saveProject(base);
		const firstFence = await firstStore.claimProjectWriteFence(base.id);
		const firstEdit = applyEditorCommand(base, { type: 'project/rename', title: 'First edit' }, { now: NOW });
		const secondFence = await secondStore.claimProjectWriteFence(base.id);

		assert.equal(await firstStore.saveProjectIfCurrentWithWriteFence(base, firstEdit, firstFence), null);
		assert.deepEqual(await secondStore.loadProject(base.id), base);
		const secondEdit = applyEditorCommand(base, { type: 'project/rename', title: 'Second edit' }, { now: NOW });
		assert.deepEqual(
			await secondStore.saveProjectIfCurrentWithWriteFence(base, secondEdit, secondFence),
			secondEdit,
		);
		assert.deepEqual(await firstStore.loadProject(base.id), secondEdit);
	});

	test(`${backend} project publication compare-and-swap requires the exact current document`, async () => {
		const store = createProjectStore({
			indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() : null,
			preferOpfs: false,
			databaseName: uniqueName(`project-cas-${backend}`),
		});
		const projects = store.projectRepository as ProjectRepositoryPort;
		assert.equal(typeof projects.saveIfCurrent, 'function');
		const base = createAudioEditorProjectV17({ id: 'project-cas', title: 'Base', now: NOW });
		await projects.save(base);
		const target = applyEditorCommand(base, { type: 'project/rename', title: 'Target' }, { now: NOW });
		const forgedBase = { ...base, title: 'Same revision, different document' };

		assert.equal(await projects.saveIfCurrent?.(forgedBase, target), null);
		assert.deepEqual(await projects.load(base.id), base);

		const saved = await projects.saveIfCurrent?.(base, target);
		assert.deepEqual(saved, target);
		assert.deepEqual(await projects.load(base.id), target);
		assert.deepEqual((await projects.listRevisions(base.id)).map(({ revision }) => revision), [1, 0]);

		const competing = applyEditorCommand(base, { type: 'project/rename', title: 'Competing' }, { now: NOW });
		assert.equal(await projects.saveIfCurrent?.(base, competing), null);
		assert.deepEqual(await projects.load(base.id), target);
	});

	test(`${backend} ordinary and compare-and-swap publication share revision pruning`, async () => {
		const store = createProjectStore({
			indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() : null,
			preferOpfs: false,
			databaseName: uniqueName(`project-cas-pruning-${backend}`),
			revisionLimit: 2,
		});
		const projects = store.projectRepository as ProjectRepositoryPort;
		const base = createAudioEditorProjectV17({ id: 'project-cas-pruning', title: 'Base', now: NOW });
		await projects.save(base);
		const first = applyEditorCommand(base, { type: 'project/rename', title: 'First' }, { now: NOW });
		assert.deepEqual(await projects.saveIfCurrent?.(base, first), first);
		const second = applyEditorCommand(first, { type: 'project/rename', title: 'Second' }, { now: NOW });
		assert.deepEqual(await projects.saveIfCurrent?.(first, second), second);
		assert.deepEqual((await projects.listRevisions(base.id)).map(({ revision }) => revision), [2, 1]);
	});

	test(`${backend} a post-commit maintenance failure identifies the committed project`, async () => {
		const store = createProjectStore({
			indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() : null,
			preferOpfs: false,
			databaseName: uniqueName(`project-cas-maintenance-${backend}`),
		});
		const projects = store.projectRepository as ProjectRepositoryPort;
		const base = createAudioEditorProjectV17({ id: 'project-cas-maintenance', title: 'Base', now: NOW });
		await projects.save(base);
		const target = applyEditorCommand(base, { type: 'project/rename', title: 'Target' }, { now: NOW });
		const maintenanceFailure = new Error('Planned post-commit maintenance failure');

		await assert.rejects(
			() => projects.saveIfCurrent!(base, target, async () => { throw maintenanceFailure; }),
			(error: unknown) => {
				assert.ok(error instanceof ProjectCommittedMaintenanceError);
				assert.equal(error.cause, maintenanceFailure);
				assert.deepEqual(error.committedProject, target);
				return true;
			},
		);
		assert.deepEqual(await projects.load(base.id), target);
		const successor = applyEditorCommand(target, { type: 'project/rename', title: 'Successor' }, { now: NOW });
		assert.deepEqual(await projects.saveIfCurrent?.(target, successor), successor);
	});
}

test('a revision-pruning failure does not stale the autosave baseline after an IndexedDB commit', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const store = createProjectStore({
		indexedDB,
		preferOpfs: false,
		databaseName: uniqueName('project-cas-pruning-failure'),
		revisionLimit: 2,
	});
	const projects = store.projectRepository as ProjectRepositoryPort;
	const base = createAudioEditorProjectV17({ id: 'project-cas-pruning-failure', title: 'Base', now: NOW });
	await projects.save(base);
	const first = applyEditorCommand(base, { type: 'project/rename', title: 'First' }, { now: NOW });
	assert.deepEqual(await projects.saveIfCurrent?.(base, first), first);
	const second = applyEditorCommand(first, { type: 'project/rename', title: 'Second' }, { now: NOW });
	const third = applyEditorCommand(second, { type: 'project/rename', title: 'Third' }, { now: NOW });
	let current: ProjectDocument = second;
	const fence = await store.claimProjectWriteFence(base.id);
	const maintenanceFailure = new Error('Planned revision deletion failure');
	const reported: unknown[] = [];
	const publications: string[] = [];
	let conflicts = 0;
	const saves = createProjectSaveService<ProjectDocument>({
		getProject: () => current,
		hasHistory: () => true,
		isReadOnly: () => false,
		getWriteFence: () => fence,
		cloneProject: (project) => structuredClone(project),
		admitProjectPublication: async () => undefined,
		saveProject: async () => { throw new Error('The ordinary save path must not run.'); },
		saveProjectIfCurrentWithWriteFence: (expected, snapshot, writeFence) => (
			projects.saveIfCurrentAndFenced!(expected, snapshot, writeFence)
		),
		onPublicationConflict: () => { conflicts += 1; },
		persistActiveProjectId: async () => undefined,
		isCurrentProject: () => true,
		hasSessionTab: () => true,
		markProjectSaved: () => undefined,
		publish: (status) => { publications.push(status); },
		garbageCollect: async () => undefined,
		refreshStorageUsage: async () => undefined,
		handleError: (error) => { reported.push(error); },
	});
	saves.recordPersistedSnapshot(first);
	indexedDB.failNextDeleteForStore('revisions', maintenanceFailure);

	await saves.flushProject();
	assert.deepEqual(await projects.load(base.id), second);
	assert.deepEqual(saves.getPersistedSnapshot(base.id), second);
	assert.deepEqual(publications, ['saved']);
	assert.equal(conflicts, 0);
	assert.equal(reported.length, 1);
	assert.ok(reported[0] instanceof ProjectCommittedMaintenanceError);
	assert.match(String(reported[0].cause), /IndexedDB transaction failed/iu);

	current = third;
	await saves.flushProject();
	assert.deepEqual(await projects.load(base.id), third);
	assert.deepEqual(saves.getPersistedSnapshot(base.id), third);
	assert.deepEqual((await projects.listRevisions(base.id)).map(({ revision }) => revision), [3, 2]);
	assert.deepEqual(publications, ['saved', 'saved']);
	assert.equal(conflicts, 0);
});

test('exact project deletion refuses memory storage before mutation', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueName('project-exact-delete-memory'),
	});
	const projects = store.projectRepository as ProjectRepositoryPort;
	const project = createAudioEditorProjectV17({ id: 'project-exact-delete', title: 'Exact', now: NOW });
	await projects.save(project);
	assert.equal(typeof projects.deleteExact, 'function');
	await assert.rejects(() => projects.deleteExact!(project), /requires durable IndexedDB storage/iu);
	assert.deepEqual(await projects.load(project.id), project);
});

function uniqueName(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
