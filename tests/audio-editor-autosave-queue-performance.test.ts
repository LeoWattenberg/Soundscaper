/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectSaveService, type ProjectSaveState } from '../src/common/editor/controller/document/project-save-service.ts';
import { deferred, waitFor } from './helpers/async-test-control.ts';

interface Project { readonly id: string; readonly revision: number }

function fixture({ failOnceAtRevision }: { readonly failOnceAtRevision?: number } = {}) {
	let project: Project = { id: 'project', revision: 0 };
	let callback: (() => void) | null = null;
	let clones = 0;
	let maintenance = 0;
	let failureReported = false;
	let beforeUnload: ((event: BeforeUnloadEvent) => void) | undefined;
	const firstWrite = deferred<void>();
	const writes: Project[] = [];
	const errors: unknown[] = [];
	const publications: string[] = [];
	const storageFailure = new Error('Planned newest autosave storage failure');
	const state: ProjectSaveState<Project> = { autosaveTimer: 0, saveGeneration: 0,
		pendingSaveSnapshots: new Set(), saveQueue: Promise.resolve() };
	const service = createProjectSaveService({
		state, getProject: () => project, hasHistory: () => true, isReadOnly: () => false,
		cloneProject: (value) => { clones += 1; return { ...value }; },
		admitProjectPublication: async () => undefined,
		saveProject: async (value) => {
			writes.push(value);
			if (writes.length === 1) await firstWrite.promise;
			if (value.revision === failOnceAtRevision && !failureReported) {
				failureReported = true;
				throw storageFailure;
			}
		},
		persistActiveProjectId: async () => undefined,
		isCurrentProject: (id) => id === project.id, hasSessionTab: () => true,
		markProjectSaved: () => undefined, publish: (status) => { publications.push(status); },
		garbageCollect: async () => { maintenance += 1; }, refreshStorageUsage: async () => undefined,
		handleError: (error) => { errors.push(error); },
		scheduleTimer: (value) => { callback = value; return 1; }, clearTimer: () => { callback = null; },
		beforeUnloadTarget: { addEventListener: (_type, listener) => { beforeUnload = listener; } },
	});
	return {
		service, state, writes, firstWrite, errors, publications, storageFailure,
		get clones() { return clones; }, get maintenance() { return maintenance; },
		setProject(value: Project) { project = value; },
		autosave(value: Project) { project = value; service.scheduleAutosave(); callback!(); callback = null; },
		hasQueuedSaveWarning() {
			let prevented = false;
			beforeUnload?.({ preventDefault: () => { prevented = true; }, returnValue: '' } as unknown as BeforeUnloadEvent);
			return prevented;
		},
	};
}

test('slow storage persists the in-flight autosave and newest queued edit without cloning the backlog', async () => {
	const runtime = fixture();
	runtime.autosave({ id: 'project', revision: 0 });
	await waitFor(() => runtime.writes.length === 1, 'first save to enter storage');
	for (let revision = 1; revision <= 100; revision += 1) runtime.autosave({ id: 'project', revision });
	runtime.firstWrite.resolve();
	await runtime.service.drain();
	assert.deepEqual(runtime.writes, [{ id: 'project', revision: 0 }, { id: 'project', revision: 100 }]);
	assert.equal(runtime.clones, 2);
	assert.equal(runtime.maintenance, 2);
	assert.equal(runtime.state.pendingSaveSnapshots.size, 0);
});

test('autosave coalescing preserves explicit flushes and the newest save for every project', async () => {
	const runtime = fixture();
	runtime.autosave({ id: 'project', revision: 0 });
	await waitFor(() => runtime.writes.length === 1, 'first save to enter storage');
	runtime.autosave({ id: 'project', revision: 1 });
	runtime.setProject({ id: 'project', revision: 2 });
	const explicit = runtime.service.flushProject();
	runtime.autosave({ id: 'project', revision: 3 });
	runtime.autosave({ id: 'other-project', revision: 1 });
	runtime.firstWrite.resolve();
	await Promise.all([explicit, runtime.service.drain()]);
	assert.deepEqual(runtime.writes, [{ id: 'project', revision: 0 }, { id: 'project', revision: 2 },
		{ id: 'project', revision: 3 }, { id: 'other-project', revision: 1 }]);
});

test('a newer cancelled timer does not discard an already queued autosave', async () => {
	const runtime = fixture();
	runtime.autosave({ id: 'project', revision: 0 });
	await waitFor(() => runtime.writes.length === 1, 'first save to enter storage');
	runtime.autosave({ id: 'project', revision: 1 });
	runtime.setProject({ id: 'project', revision: 2 });
	runtime.service.scheduleAutosave();
	runtime.service.cancelScheduled();
	runtime.firstWrite.resolve();
	await runtime.service.drain();
	assert.deepEqual(runtime.writes, [{ id: 'project', revision: 0 }, { id: 'project', revision: 1 }]);
});

test('failed newest coalesced autosave stays dirty, releases queue ownership and retries successfully', async () => {
	const runtime = fixture({ failOnceAtRevision: 2 });
	runtime.autosave({ id: 'project', revision: 0 });
	await waitFor(() => runtime.writes.length === 1, 'first save to enter storage');
	runtime.autosave({ id: 'project', revision: 1 });
	runtime.autosave({ id: 'project', revision: 2 });
	assert.equal(runtime.hasQueuedSaveWarning(), true);
	runtime.firstWrite.resolve();
	await assert.rejects(runtime.service.drain(), runtime.storageFailure);
	assert.deepEqual(runtime.writes, [{ id: 'project', revision: 0 }, { id: 'project', revision: 2 }]);
	assert.equal(runtime.publications.at(-1), 'dirty');
	assert.deepEqual(runtime.errors, [runtime.storageFailure]);
	assert.equal(runtime.clones, 2);
	assert.equal(runtime.maintenance, 1);
	assert.equal(runtime.state.pendingSaveSnapshots.size, 0);
	assert.equal(runtime.state.autosaveTimer, 0);
	// This fixture supplies no separate dirty-state warning: only queue ownership is measured here.
	assert.equal(runtime.hasQueuedSaveWarning(), false);
	runtime.autosave({ id: 'project', revision: 2 });
	await runtime.service.drain();
	assert.deepEqual(runtime.writes, [{ id: 'project', revision: 0 }, { id: 'project', revision: 2 },
		{ id: 'project', revision: 2 }]);
	assert.equal(runtime.publications.at(-1), 'saved');
	assert.deepEqual(runtime.errors, [runtime.storageFailure]);
	assert.equal(runtime.state.pendingSaveSnapshots.size, 0);
	assert.equal(runtime.hasQueuedSaveWarning(), false);
	assert.equal(runtime.maintenance, 2);
});
