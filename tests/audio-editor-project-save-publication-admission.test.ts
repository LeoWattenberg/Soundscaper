/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectSaveService } from '../src/common/editor/controller/project-save-service.ts';
import { estimateProjectRevisionPublication } from '../src/common/editor/project-publication-admission.ts';

interface TestProject {
	readonly schemaVersion: 9;
	readonly id: string;
	readonly revision: number;
	readonly title: string;
}

interface Deferred {
	readonly promise: Promise<void>;
	resolve(): void;
	reject(error: unknown): void;
}

interface Admission {
	readonly bytes: number;
	readonly gate: Deferred;
}

test('project saves serialize admission immediately before each queued write', async () => {
	let project = testProject(1, 'Grüße 🎛️');
	const state = saveState();
	const admissions: Admission[] = [];
	const events: string[] = [];
	const service = createProjectSaveService({
		state,
		getProject: () => project,
		hasHistory: () => true,
		isReadOnly: () => false,
		cloneProject: (value) => ({ ...value }),
		admitProjectPublication: (bytes) => {
			events.push(`admit:${String(project.revision)}`);
			const gate = deferred();
			admissions.push({ bytes, gate });
			return gate.promise;
		},
		saveProject: async (snapshot, options) => {
			await options.admitProjectPublication(projectPublicationBytes(snapshot));
			events.push(`save:${String(snapshot.revision)}`);
		},
		persistActiveProjectId: async () => undefined,
		isCurrentProject: (projectId) => project.id === projectId,
		hasSessionTab: () => true,
		markProjectSaved: () => undefined,
		publish: () => undefined,
		garbageCollect: async () => undefined,
		refreshStorageUsage: async () => undefined,
		handleError: () => undefined,
	});

	const firstProject = project;
	const first = service.flushProject();
	assert.ok(first);
	await waitFor(() => admissions.length === 1);
	assert.equal(admissions[0]?.bytes, projectPublicationBytes(firstProject));
	assert.deepEqual(events, ['admit:1']);

	project = testProject(2, 'Second revision');
	const secondProject = project;
	const second = service.flushProject();
	assert.ok(second);
	await Promise.resolve();
	assert.equal(admissions.length, 1);
	assert.deepEqual(events, ['admit:1']);

	admissions[0]?.gate.resolve();
	await waitFor(() => admissions.length === 2);
	assert.equal(admissions[1]?.bytes, projectPublicationBytes(secondProject));
	assert.deepEqual(events, ['admit:1', 'save:1', 'admit:2']);

	admissions[1]?.gate.resolve();
	await Promise.all([first, second]);
	assert.deepEqual(events, ['admit:1', 'save:1', 'admit:2', 'save:2']);
	assert.equal(state.pendingSaveSnapshots.size, 0);
});

test('a rejected publication admission leaves no save effects and the queued successor recovers', async () => {
	let project = testProject(1, 'Rejected revision');
	const state = saveState();
	const admissions: Admission[] = [];
	const snapshots: TestProject[] = [];
	const saved: number[] = [];
	const persisted: string[] = [];
	const marked: string[] = [];
	const errors: unknown[] = [];
	let garbageCollections = 0;
	let storageRefreshes = 0;
	let publications = 0;
	const service = createProjectSaveService({
		state,
		getProject: () => project,
		hasHistory: () => true,
		isReadOnly: () => false,
		cloneProject: (value) => {
			const snapshot = { ...value };
			snapshots.push(snapshot);
			return snapshot;
		},
		admitProjectPublication: (bytes) => {
			const gate = deferred();
			admissions.push({ bytes, gate });
			return gate.promise;
		},
		saveProject: async (snapshot, options) => {
			await options.admitProjectPublication(projectPublicationBytes(snapshot));
			saved.push(snapshot.revision);
		},
		persistActiveProjectId: async (projectId) => { persisted.push(projectId); },
		isCurrentProject: (projectId) => project.id === projectId,
		hasSessionTab: () => true,
		markProjectSaved: (projectId) => { marked.push(projectId); },
		publish: () => { publications += 1; },
		garbageCollect: async () => { garbageCollections += 1; },
		refreshStorageUsage: async () => { storageRefreshes += 1; },
		handleError: (error) => { errors.push(error); },
	});

	const first = service.flushProject();
	assert.ok(first);
	await waitFor(() => admissions.length === 1);
	project = testProject(2, 'Recovering revision');
	const second = service.flushProject();
	assert.ok(second);
	const denied = new Error('Project publication denied.');
	const rejected = assert.rejects(first, (error) => error === denied);
	admissions[0]?.gate.reject(denied);
	await rejected;
	await waitFor(() => admissions.length === 2);

	assert.deepEqual(saved, []);
	assert.deepEqual(persisted, []);
	assert.deepEqual(marked, []);
	assert.equal(garbageCollections, 0);
	assert.equal(storageRefreshes, 0);
	assert.equal(state.saveState, 'dirty');
	assert.equal(publications, 1);
	assert.deepEqual(errors, [denied]);
	assert.equal(service.pendingSnapshots.has(snapshots[0] as TestProject), false);
	assert.equal(service.pendingSnapshots.has(snapshots[1] as TestProject), true);

	admissions[1]?.gate.resolve();
	await second;
	assert.deepEqual(saved, [2]);
	assert.deepEqual(persisted, ['project']);
	assert.deepEqual(marked, ['project']);
	assert.equal(garbageCollections, 1);
	assert.equal(storageRefreshes, 1);
	assert.equal(state.saveState, 'saved');
	assert.equal(publications, 2);
	assert.deepEqual(errors, [denied]);
	assert.equal(service.pendingSnapshots.size, 0);
});

function testProject(revision: number, title: string): TestProject {
	return { schemaVersion: 9, id: 'project', revision, title };
}

function projectPublicationBytes(project: TestProject): number {
	return estimateProjectRevisionPublication(project).currentAndRevision.bytes;
}

function saveState() {
	return {
		autosaveTimer: 0,
		saveGeneration: 0,
		pendingSaveSnapshots: new Set<TestProject>(),
		saveQueue: Promise.resolve<unknown>(undefined),
		saveState: 'saved',
	};
}

function deferred(): Deferred {
	let resolve: (() => void) | undefined;
	let reject: ((error: unknown) => void) | undefined;
	const promise = new Promise<void>((settle, fail) => {
		resolve = settle;
		reject = fail;
	});
	return {
		promise,
		resolve: () => { resolve?.(); },
		reject: (error) => { reject?.(error); },
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		if (predicate()) return;
		await Promise.resolve();
	}
	assert.fail('Condition was not met before the microtask queue settled.');
}
