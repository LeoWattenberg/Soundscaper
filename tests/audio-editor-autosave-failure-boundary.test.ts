/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createProjectSaveService,
	ProjectSaveConflictError,
	type ProjectSaveServiceDependencies,
	type ProjectSaveState,
} from '../src/common/editor/controller/document/project-save-service.ts';

interface Project { readonly id: string; readonly revision: number }

function fixture(overrides: Partial<ProjectSaveServiceDependencies<Project>> = {}) {
	let project: Project = { id: 'project', revision: 0 };
	let nextTimer = 0;
	let clones = 0;
	const timers = new Map<number, () => void>();
	const writes: Project[] = [];
	const errors: unknown[] = [];
	const publications: string[] = [];
	const state: ProjectSaveState<Project> = {
		autosaveTimer: 0, saveGeneration: 0, pendingSaveSnapshots: new Set(),
		saveQueue: Promise.resolve(),
	};
	const service = createProjectSaveService({
		state, getProject: () => project, hasHistory: () => true, isReadOnly: () => false,
		cloneProject: (value) => { clones += 1; return { ...value }; },
		admitProjectPublication: async () => undefined,
		saveProject: async (value) => { writes.push(value); },
		persistActiveProjectId: async () => undefined,
		isCurrentProject: (id) => project.id === id, hasSessionTab: () => true,
		markProjectSaved: () => undefined,
		publish: (saveState) => { publications.push(saveState); },
		garbageCollect: async () => undefined, refreshStorageUsage: async () => undefined,
		handleError: (error) => { errors.push(error); },
		scheduleTimer: (callback) => { timers.set(++nextTimer, callback); return nextTimer; },
		clearTimer: (handle) => { timers.delete(handle); },
		...overrides,
	});
	return {
		service, state, writes, errors, publications,
		get clones() { return clones; },
		setProject(value: Project) { project = value; },
		fire() {
			const callbacks = [...timers.values()];
			timers.clear();
			for (const callback of callbacks) callback();
		},
	};
}

for (const failure of ['clone', 'prepare', 'identity'] as const) {
	test(`autosave reports ${failure} failure, remains dirty, and a subsequent save recovers`, async () => {
		let fail = true;
		const error = new Error(`${failure} failed`);
		const runtime = fixture({
			cloneProject: (value) => {
				if (fail && failure === 'clone') throw error;
				return { ...value };
			},
			prepareSnapshot: async (value) => {
				if (fail && failure === 'prepare') throw error;
				return fail && failure === 'identity' ? { ...value, id: 'wrong-project' } : value;
			},
		});
		assert.doesNotThrow(() => runtime.service.scheduleAutosave());
		assert.doesNotThrow(() => runtime.fire());
		await assert.rejects(runtime.service.drain());
		assert.equal(runtime.errors.length, 1);
		assert.equal(runtime.publications.at(-1), 'dirty');
		assert.deepEqual(runtime.writes, []);
		assert.equal(runtime.service.pendingSnapshots.size, 0);
		fail = false;
		runtime.service.scheduleAutosave();
		runtime.fire();
		await runtime.service.drain();
		assert.deepEqual(runtime.writes, [{ id: 'project', revision: 0 }]);
		assert.equal(runtime.publications.at(-1), 'saved');
	});
}

for (const maintenance of ['garbageCollect', 'refreshStorageUsage'] as const) {
	test(`a successful save stays saved when ${maintenance} fails`, async () => {
		const error = new Error(`${maintenance} failed`);
		const runtime = fixture({
			garbageCollect: async () => {
				if (maintenance === 'garbageCollect') throw error;
			},
			refreshStorageUsage: async () => {
				if (maintenance === 'refreshStorageUsage') throw error;
			},
		});

		await runtime.service.flushProject();

		assert.deepEqual(runtime.writes, [{ id: 'project', revision: 0 }]);
		assert.deepEqual(runtime.publications, ['saved']);
		assert.deepEqual(runtime.errors, [error]);
	});
}

test('autosave defers cloning until the debounce settles and writes only the latest edit', async () => {
	const runtime = fixture();
	for (let revision = 1; revision <= 100; revision += 1) {
		runtime.setProject({ id: 'project', revision });
		runtime.service.scheduleAutosave();
	}
	assert.equal(runtime.clones, 0);
	runtime.fire();
	await runtime.service.drain();
	assert.equal(runtime.clones, 1);
	assert.deepEqual(runtime.writes, [{ id: 'project', revision: 100 }]);
});

test('a cancelled autosave never materializes a snapshot', async () => {
	const runtime = fixture();
	runtime.service.scheduleAutosave();
	runtime.service.cancelScheduled();
	runtime.fire();
	await runtime.service.drain();
	assert.equal(runtime.clones, 0);
	assert.deepEqual(runtime.writes, []);
});

test('explicit flush captures its document before subsequent edits and cancels the debounce', async () => {
	const runtime = fixture();
	runtime.service.scheduleAutosave();
	const saving = runtime.service.flushProject();
	runtime.setProject({ id: 'project', revision: 1 });
	runtime.fire();
	await saving;
	assert.deepEqual(runtime.writes, [{ id: 'project', revision: 0 }]);
});

test('production save services own independent queues and report status without shared state', async () => {
	const first = fixture({ state: undefined });
	const second = fixture({ state: undefined });
	assert.notEqual(first.service.drain(), second.service.drain());
	first.service.scheduleAutosave();
	assert.deepEqual(first.publications, ['saving']);
	assert.deepEqual(second.publications, []);
	first.fire();
	await first.service.drain();
	assert.deepEqual(first.publications, ['saving', 'saved']);
	assert.equal(first.state.saveGeneration, 0, 'the old controller state is not the queue owner');
});

test('fenced saves compare against the last durable snapshot and drop a queued save after takeover', async () => {
	let project: Project = { id: 'project', revision: 1 };
	let persisted: Project = { id: 'project', revision: 0 };
	let writeFence = 'first-lock';
	const expectedRevisions: number[] = [];
	const publications: string[] = [];
	const service = createProjectSaveService<Project>({
		getProject: () => project,
		hasHistory: () => true,
		isReadOnly: () => false,
		getWriteFence: () => writeFence,
		cloneProject: (value) => ({ ...value }),
		admitProjectPublication: async () => undefined,
		saveProject: async () => { throw new Error('The ordinary save path must not run.'); },
		saveProjectIfCurrentWithWriteFence: async (expected, snapshot, fence) => {
			expectedRevisions.push(expected.revision);
			if (fence !== writeFence || expected.revision !== persisted.revision) return null;
			persisted = snapshot;
			return snapshot;
		},
		persistActiveProjectId: async () => undefined,
		isCurrentProject: () => true,
		hasSessionTab: () => true,
		markProjectSaved: () => undefined,
		publish: (state) => { publications.push(state); },
		garbageCollect: async () => undefined,
		refreshStorageUsage: async () => undefined,
		handleError: () => undefined,
	});
	service.recordPersistedSnapshot(persisted);
	await service.flushProject();
	project = { id: 'project', revision: 2 };
	await service.flushProject();
	assert.deepEqual(expectedRevisions, [0, 1]);
	assert.equal(persisted.revision, 2);

	project = { id: 'project', revision: 3 };
	const stale = service.flushProject();
	writeFence = 'second-lock';
	await stale;
	assert.deepEqual(expectedRevisions, [0, 1]);
	assert.equal(persisted.revision, 2);
	assert.equal(publications.at(-1), 'saved');
});

test('a durable publication conflict leaves the project dirty and fails an explicit flush', async () => {
	let readOnly = false;
	const publications: string[] = [];
	const errors: unknown[] = [];
	const base: Project = { id: 'project', revision: 0 };
	const edited: Project = { id: 'project', revision: 1 };
	const service = createProjectSaveService<Project>({
		getProject: () => edited,
		hasHistory: () => true,
		isReadOnly: () => readOnly,
		getWriteFence: () => 'claimed-lock',
		cloneProject: (project) => ({ ...project }),
		admitProjectPublication: async () => undefined,
		saveProject: async () => { throw new Error('Unconditional save must not run.'); },
		saveProjectIfCurrentWithWriteFence: async () => null,
		onPublicationConflict: () => { readOnly = true; },
		persistActiveProjectId: async () => undefined,
		isCurrentProject: () => true,
		hasSessionTab: () => true,
		markProjectSaved: () => undefined,
		publish: (state) => { publications.push(state); },
		garbageCollect: async () => undefined,
		refreshStorageUsage: async () => undefined,
		handleError: (error) => { errors.push(error); },
	});
	service.recordPersistedSnapshot(base);

	await assert.rejects(service.flushProject()!, ProjectSaveConflictError);
	assert.equal(readOnly, true);
	assert.deepEqual(publications, ['dirty']);
	assert.equal(errors.length, 1);
});
