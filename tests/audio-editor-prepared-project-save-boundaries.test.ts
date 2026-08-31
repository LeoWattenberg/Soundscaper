/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeProjectService } from '../src/common/editor/controller/native-project-service.ts';
import { createProjectSaveService } from '../src/common/editor/controller/project-save-service.ts';
import { createFixture as createNativeProjectFixture } from './helpers/native-project-service-fixture.ts';

interface TestProject {
	readonly id: string;
	readonly revision: number;
}

test('a clean prepared save boundary captures and writes the current external state', async () => {
	type PreparedProject = TestProject & Readonly<{ vendorState: string }>;
	let project: PreparedProject = { id: 'prepared-project', revision: 0, vendorState: 'stale' };
	const saved: PreparedProject[] = [];
	const purposes: string[] = [];
	const state = {
		autosaveTimer: 0,
		saveGeneration: 0,
		pendingSaveSnapshots: new Set<PreparedProject>(),
		saveQueue: Promise.resolve<unknown>(undefined),
		saveState: 'saved',
	};
	const service = createProjectSaveService({
		state,
		getProject: () => project,
		hasHistory: () => true,
		hasUnsavedProjectChanges: () => false,
		isReadOnly: () => false,
		cloneProject: (value) => ({ ...value }),
		prepareSnapshot: (_snapshot, purpose) => {
			purposes.push(purpose);
			project = { ...project, revision: 1, vendorState: 'captured' };
			return { ...project };
		},
		admitProjectPublication: async () => undefined,
		saveProject: async (snapshot) => { saved.push(snapshot); },
		persistActiveProjectId: async () => undefined,
		isCurrentProject: (projectId) => project.id === projectId,
		hasSessionTab: () => true,
		markProjectSaved: () => undefined,
		publish: () => undefined,
		garbageCollect: async () => undefined,
		refreshStorageUsage: async () => undefined,
		handleError: () => undefined,
	});

	const boundary = service.flushProject({
		prepareCurrentSnapshot: true,
		preparationPurpose: 'scape-save',
	});
	assert.ok(boundary);
	await boundary;
	assert.deepEqual(purposes, ['scape-save']);
	assert.deepEqual(saved, [{ id: 'prepared-project', revision: 1, vendorState: 'captured' }]);
});

test('terminal flush prepares a clean project when it owns a snapshot preparer', async () => {
	const project: TestProject = { id: 'terminal-prepared-project', revision: 0 };
	let preparations = 0;
	let saves = 0;
	const state = {
		autosaveTimer: 0,
		saveGeneration: 0,
		pendingSaveSnapshots: new Set<TestProject>(),
		saveQueue: Promise.resolve<unknown>(undefined),
		saveState: 'saved',
	};
	const service = createProjectSaveService({
		state,
		getProject: () => project,
		hasHistory: () => true,
		hasUnsavedProjectChanges: () => false,
		isReadOnly: () => false,
		cloneProject: (value) => ({ ...value }),
		prepareSnapshot: (snapshot, purpose) => {
			preparations += 1;
			assert.equal(purpose, 'project-save');
			return snapshot;
		},
		admitProjectPublication: async () => undefined,
		saveProject: async () => { saves += 1; },
		persistActiveProjectId: async () => undefined,
		isCurrentProject: () => true,
		hasSessionTab: () => true,
		markProjectSaved: () => undefined,
		publish: () => undefined,
		garbageCollect: async () => undefined,
		refreshStorageUsage: async () => undefined,
		handleError: () => undefined,
	});

	await service.terminalFlush();
	assert.equal(preparations, 1);
	assert.equal(saves, 1);
});

test('Scape save requests an exact prepared snapshot before archive export', async () => {
	const flushes: unknown[] = [];
	const fixture = createNativeProjectFixture({
		flushProject: async (options) => { flushes.push(options); },
	});
	const service = createNativeProjectService(fixture.runtime);

	await service.saveScape({ useFileSystemAccess: false });

	assert.deepEqual(flushes, [{
		prepareCurrentSnapshot: true,
		preparationPurpose: 'scape-save',
	}]);
});
