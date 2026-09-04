/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectAdminService,
	type ProjectAdminServiceRuntime,
} from '../src/common/editor/controller/project-admin-service.ts';
import {
	createFixture,
	deferred,
} from './audio-editor-project-admin-service-fixture.ts';

test('project administration lists, renames, duplicates, and clears recents', async () => {
	const fixture = createFixture();
	const service = createProjectAdminService(fixture.runtime);

	assert.equal(Object.isFrozen(await service.listProjects()), true);
	await service.renameProject('  Renamed  ');
	await service.renameProject('   ');
	await assert.rejects(() => service.renameProject(null), /title is required/iu);
	fixture.state.readOnly = true;
	await service.renameProject('Ignored');
	fixture.state.readOnly = false;

	const duplicated = await service.duplicateProject(null);
	assert.equal(duplicated.title, 'Project A copy');
	assert.equal(fixture.calls.includes('persist:routing:copy:[object Object]'), true);
	assert.deepEqual(await service.clearRecentProjects(), []);

	fixture.setProject(null);
	assert.equal(await service.duplicateProject('Unused'), undefined);
});

test('duplicate completion preserves initiating routing without replacing a later activation', async () => {
	const fixture = createFixture();
	const duplicateStarted = deferred();
	const duplicateGate = deferred();
	const duplicated = { id: 'project-copy', title: 'Project A copy', revision: 1 };
	const later = { id: 'project-c', title: 'Project C', revision: 1 };
	const catalog = Object.freeze([later, duplicated]);
	const persisted: Array<Readonly<{ key: string; value: unknown; policy: unknown }>> = [];
	const opened: string[] = [];
	fixture.state.recordingRouting = { input: 'device-a' };
	const runtime = {
		...fixture.runtime,
		store: {
			...fixture.runtime.store,
			async duplicateProject() {
				duplicateStarted.resolve();
				await duplicateGate.promise;
				return duplicated;
			},
			async listProjects() { return catalog; },
		},
		async persistSetting(key: string, value: unknown, options: Readonly<{ policy?: unknown }> = {}) {
			persisted.push(Object.freeze({ key, value: structuredClone(value), policy: options.policy }));
		},
		async openProject(value: Readonly<{ id: string }>) { opened.push(value.id); },
	} satisfies ProjectAdminServiceRuntime;
	const pending = createProjectAdminService(runtime).duplicateProject('Project A copy');
	await duplicateStarted.promise;
	fixture.setProject(later);
	fixture.state.recordingRouting = { input: 'device-c' };
	duplicateGate.resolve();

	assert.equal(await pending, duplicated);
	assert.deepEqual(persisted, [{
		key: 'routing:project-copy', value: { input: 'device-a' }, policy: 'required',
	}]);
	assert.deepEqual(opened, []);
	assert.deepEqual(fixture.state.projects, catalog);
	assert.equal(Object.isFrozen(fixture.state.projects), true);
});

test('closing inactive tabs persists dirty history and prunes session-only sources', async () => {
	const fixture = createFixture();
	const other = { id: 'project-b', title: 'Project B', revision: 2 };
	fixture.tabs.set('project-b', {
		projectId: 'project-b', dirty: true, readOnly: false, history: { present: other },
	});
	fixture.pruneResult({ deletedSourceIds: ['deleted'] });
	const service = createProjectAdminService(fixture.runtime);

	const result = await service.closeProjectTab('project-b');
	assert.equal(result.closed, true);
	assert.deepEqual(fixture.savedProjects, [other]);
	assert.deepEqual(fixture.savedProjectOptions[0]?.protectedLinkedOriginalSourceReferences, [
		{ kind: 'audio', sourceId: 'live' },
		{ kind: 'video', sourceId: 'live' },
	]);
	assert.equal(Object.isFrozen(
		fixture.savedProjectOptions[0]?.protectedLinkedOriginalSourceReferences,
	), true);
	assert.equal(fixture.calls.includes('marked:project-b'), true);
	assert.equal(fixture.calls.includes('release'), false);
	assert.equal(fixture.sourceBuffers.has('deleted'), false);
	assert.equal(fixture.sourceChunkProviders.has('deleted'), false);
	assert.equal(fixture.sourcePeaks.has('deleted'), false);
	assert.equal(fixture.state.missingSourceIds.has('deleted'), false);
});

test('closing the active tab saves it and selects the next session project', async () => {
	const fixture = createFixture();
	const activeTab = fixture.tabs.get('project-a');
	assert.ok(activeTab);
	activeTab.dirty = true;
	const next = { id: 'project-b', title: 'Project B', revision: 1 };
	fixture.tabs.set('project-b', {
		projectId: 'project-b', dirty: false, readOnly: false, history: { present: next },
	});
	fixture.closeResult({ closed: true, activeProjectId: 'project-b' });
	const result = await createProjectAdminService(fixture.runtime).closeProjectTab();

	assert.equal(result.closed, true);
	assert.equal(fixture.calls.includes('save'), true);
	assert.equal(fixture.calls.includes('cancel-save'), true);
	assert.equal(fixture.calls.includes('switch:project-b'), true);
	assert.equal(fixture.project()?.id, next.id);
	assert.equal(fixture.state.selectedAnnotationId, null);
});

test('closing the active tab admits its successor before a later project activation', async () => {
	const fixture = createFixture();
	const next = { id: 'project-b', title: 'Project B', revision: 1 };
	const later = { id: 'project-c', title: 'Project C', revision: 1 };
	fixture.tabs.set(next.id, {
		projectId: next.id, dirty: false, readOnly: false, history: { present: next },
	});
	fixture.closeResult({ closed: true, activeProjectId: next.id });
	const admissions: string[] = [];
	let activationQueue = Promise.resolve();
	const runtime = {
		...fixture.runtime,
		switchProject(value: typeof next) {
			admissions.push(value.id);
			const activation = activationQueue.then(() => { fixture.setProject(value); });
			activationQueue = activation.catch(() => undefined);
			return activation;
		},
	} satisfies ProjectAdminServiceRuntime;
	fixture.setCloseObserver(() => {
		queueMicrotask(() => { void runtime.switchProject(later); });
	});

	await createProjectAdminService(runtime).closeProjectTab('project-a', { discard: true });
	await activationQueue;

	assert.deepEqual(admissions, [next.id, later.id]);
	assert.equal(fixture.project()?.id, later.id);
});

test('close validation and refusal leave project state untouched', async () => {
	const missing = createFixture();
	await assert.rejects(() => createProjectAdminService(missing.runtime).closeProjectTab('missing'), /not found/iu);

	const refused = createFixture();
	refused.closeResult({ closed: false });
	const result = await createProjectAdminService(refused.runtime).closeProjectTab('project-a', { discard: true });
	assert.equal(result.closed, false);
	assert.equal(refused.project()?.id, 'project-a');

	const newProject = createFixture();
	await createProjectAdminService(newProject.runtime).closeProjectTab('project-a', { discard: true });
	assert.equal(newProject.calls.includes('new-project'), true);
});

test('handoff guards missing, declared read-only, and lock-contended projects', async () => {
	const missing = createFixture();
	missing.setProject(null);
	await assert.rejects(() => createProjectAdminService(missing.runtime).prepareProjectHandoff(), /not found/iu);

	const declaredReadOnly = createFixture();
	declaredReadOnly.state.readOnly = true;
	await assert.rejects(
		() => createProjectAdminService(declaredReadOnly.runtime).prepareProjectHandoff(),
		/read-only/iu,
	);

	const lockContended = createFixture();
	lockContended.state.readOnly = true;
	lockContended.state.projectLock.readOnly = true;
	lockContended.tabs.get('project-a')!.metadata = {
		declaredReadOnly: false,
		featureRequirementsReadOnly: true,
		intrinsicReadOnly: true,
	};
	await assert.rejects(
		() => createProjectAdminService(lockContended.runtime).prepareProjectHandoff(),
		/read-only/iu,
	);

	const declaredAndFeatureReadOnly = createFixture();
	declaredAndFeatureReadOnly.state.readOnly = true;
	declaredAndFeatureReadOnly.tabs.get('project-a')!.metadata = {
		declaredReadOnly: true,
		featureRequirementsReadOnly: true,
		intrinsicReadOnly: true,
	};
	await assert.rejects(
		() => createProjectAdminService(declaredAndFeatureReadOnly.runtime).prepareProjectHandoff(),
		/read-only/iu,
	);
});

test('feature-requirement read-only handoff publishes the exact project without flushing', async () => {
	const fixture = createFixture();
	fixture.state.readOnly = true;
	fixture.tabs.get('project-a')!.metadata = {
		declaredReadOnly: false,
		featureRequirementsReadOnly: true,
		intrinsicReadOnly: true,
	};

	assert.deepEqual(await createProjectAdminService(fixture.runtime).prepareProjectHandoff(), {
		projectId: 'project-a', revision: 3,
	});
	assert.equal(fixture.calls.includes('flush'), false);
	assert.ok(fixture.calls.indexOf('handoff:project-a') < fixture.calls.indexOf('release'));
});

test('local reset clears all runtime data', async () => {

	const fixture = createFixture();
	await createProjectAdminService(fixture.runtime).clearLocalData();
	assert.equal(fixture.sourceBuffers.size, 0);
	assert.equal(fixture.sourceChunkProviders.size, 0);
	assert.equal(fixture.sourcePeaks.size, 0);
	assert.equal(fixture.calls.includes('clear-store'), true);
	assert.equal(fixture.calls.includes('clear-clipboard'), true);
	assert.equal(fixture.state.selectedAnnotationId, null);
	assert.equal(Object.isFrozen(fixture.state.projects), true);
	assert.deepEqual(fixture.state.projects, []);
});

test('local reset refreshes projects that survive in the shared desktop catalog', async () => {
	const fixture = createFixture();
	fixture.runtime.store.preservesProjectsOnClear = () => true;

	await createProjectAdminService(fixture.runtime).clearLocalData();

	assert.deepEqual(fixture.state.projects, [{ id: 'listed', title: 'Listed', revision: 1 }]);
	assert.equal(Object.isFrozen(fixture.state.projects), true);
	assert.ok(fixture.calls.indexOf('list') > fixture.calls.indexOf('new-project'));
});
