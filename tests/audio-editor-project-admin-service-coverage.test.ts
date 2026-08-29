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
	TestSourceChunkProviders,
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

test('project deletion validates ownership and then clears project-specific state', async () => {
	const fixture = createFixture();
	const service = createProjectAdminService(fixture.runtime);
	await service.deleteProject();
	assert.equal(fixture.calls.includes('delete:project-a'), true);
	assert.equal(fixture.calls.includes('persist:routing:project-a:null'), true);
	assert.equal(fixture.project(), null);
	assert.equal(fixture.state.selectedAnnotationId, null);

	const readOnly = createFixture();
	readOnly.state.readOnly = true;
	await createProjectAdminService(readOnly.runtime).deleteProject();
	assert.equal(readOnly.calls.includes('stop-recording'), false);

	const replaced = createFixture();
	replaced.setStopRecording(async () => { replaced.setProject({ id: 'replacement', title: 'Other', revision: 1 }); });
	assert.equal(await createProjectAdminService(replaced.runtime).deleteProject(), null);
});

test('project deletion fences mutation, save, and activation admission before draining queued saves', async () => {
	const fixture = createFixture();
	const drainStarted = deferred();
	const drainGate = deferred();
	const oldGeneration = fixture.captureProjectGeneration();
	fixture.setCloseObserver(() => {
		queueMicrotask(() => { fixture.calls.push('competing-after-close'); });
	});
	fixture.runtime.projectSaveService.drain = async () => {
		fixture.calls.push('drain-save:start');
		drainStarted.resolve();
		await drainGate.promise;
		fixture.calls.push('drain-save:done');
	};
	const service = createProjectAdminService(fixture.runtime);
	const pending = service.deleteProject();
	await drainStarted.promise;
	try {
		assert.equal(fixture.calls.includes('cancel-save'), true);
		assert.equal(fixture.calls.includes('drain-save:start'), true);
		assert.equal(fixture.saveSuspended(), true);
		assert.equal(fixture.reservationActive(), true);
		assert.equal(fixture.project(), null);
		assert.equal(fixture.state.history, null);
		assert.equal(fixture.isProjectGenerationCurrent(oldGeneration), false);
		assert.equal(fixture.runtime.projectSaveService.scheduleAutosave(), false);
		assert.equal(fixture.runtime.projectSaveService.flushProject(), undefined);
		assert.equal(fixture.saveAdmissions(), 0);
		await assert.rejects(
			() => service.renameProject('Zombie mutation'),
			/active project history/iu,
		);
		assert.equal(await service.duplicateProject('Zombie copy'), undefined);
		assert.throws(
			() => fixture.runtime.sessionController.switchProject('project-b'),
			/reserved for activation/iu,
		);
		assert.equal(fixture.calls.includes('release'), false);
		assert.equal(fixture.calls.includes('delete:project-a'), false);
	} finally {
		drainGate.resolve();
		await pending;
	}
	assert.ok(fixture.calls.indexOf('cancel-save') < fixture.calls.indexOf('drain-save:start'));
	assert.ok(fixture.calls.indexOf('drain-save:done') < fixture.calls.indexOf('release'));
	assert.ok(fixture.calls.indexOf('release') < fixture.calls.indexOf('delete:project-a'));
	assert.equal(fixture.reservationActive(), false);
	assert.equal(fixture.saveSuspended(), false);
	assert.ok(fixture.calls.indexOf('release-history:project-a') < fixture.calls.indexOf('close:project-a'));
	assert.ok(fixture.calls.indexOf('close:project-a') < fixture.calls.indexOf('new-project'));
	assert.ok(fixture.calls.indexOf('new-project') < fixture.calls.indexOf('competing-after-close'));
	assert.equal(fixture.runtime.projectSaveService.scheduleAutosave(), true);
});

test('project deletion failures still retire the torn-down session without a zombie tab', async () => {
	for (const committed of [false, true]) {
		const fixture = createFixture();
		const failure = Object.assign(new Error(committed ? 'committed cleanup failed' : 'catalog CAS failed'), {
			committed,
		});
		fixture.runtime.store.deleteProject = async (projectId: string) => {
			fixture.calls.push(`delete:${projectId}`);
			throw failure;
		};

		await assert.rejects(
			() => createProjectAdminService(fixture.runtime).deleteProject(),
			(error: unknown) => error === failure,
		);
		assert.equal(fixture.calls.includes('close:project-a'), true);
		assert.equal(fixture.calls.includes('new-project'), true);
		assert.equal(fixture.calls.includes('list'), true);
		assert.equal(fixture.calls.includes('persist:routing:project-a:null'), false);
		assert.equal(fixture.reservationActive(), false);
		assert.equal(fixture.saveSuspended(), false);
		assert.equal(fixture.project(), null);
		assert.equal(fixture.state.history, null);
		assert.equal(fixture.state.selectedAnnotationId, null);
		assert.equal(fixture.state.missingSourceIds.size, 0);
		assert.deepEqual(fixture.state.projects, [{ id: 'listed', title: 'Listed', revision: 1 }]);
	}
});

test('project deletion aggregates the original failure with every finalization failure', async () => {
	const fixture = createFixture();
	const deletionFailure = new Error('catalog CAS failed');
	const nextProjectFailure = new Error('next project failed');
	const listFailure = new Error('catalog list failed');
	const runtime = {
		...fixture.runtime,
		newProject: async () => {
			fixture.calls.push('new-project');
			throw nextProjectFailure;
		},
		store: {
			...fixture.runtime.store,
			deleteProject: async () => { throw deletionFailure; },
			listProjects: async () => {
				fixture.calls.push('list');
				throw listFailure;
			},
		},
	} satisfies ProjectAdminServiceRuntime;

	await assert.rejects(
		() => createProjectAdminService(runtime).deleteProject(),
		(error: unknown) => error instanceof AggregateError
			&& error.errors.length === 3
			&& error.errors[0] === deletionFailure
			&& error.errors[1] === nextProjectFailure
			&& error.errors[2] === listFailure,
	);
	assert.equal(fixture.calls.includes('close:project-a'), true);
	assert.equal(fixture.calls.includes('new-project'), true);
	assert.equal(fixture.calls.includes('list'), true);
	assert.equal(fixture.project(), null);
});

test('project deletion and local reset drain video visuals before storage mutation', async () => {
	for (const operation of ['delete', 'clear'] as const) {
		const fixture = createFixture();
		const started = deferred();
		const gate = deferred();
		const runtime = {
			...fixture.runtime,
			async revokeVideoVisuals() {
				fixture.calls.push('revoke-video:start');
				started.resolve();
				await gate.promise;
				fixture.calls.push('revoke-video:done');
			},
		} satisfies ProjectAdminServiceRuntime;
		const service = createProjectAdminService(runtime);
		const pending = operation === 'delete' ? service.deleteProject() : service.clearLocalData();
		await started.promise;
		assert.equal(fixture.calls.includes(operation === 'delete' ? 'delete:project-a' : 'clear-store'), false);
		gate.resolve();
		await pending;
		assert.ok(fixture.calls.indexOf('revoke-video:done') < fixture.calls.indexOf(
			operation === 'delete' ? 'delete:project-a' : 'clear-store',
		));
	}
});

test('project deletion and local reset fence and drain providers before storage mutation', async () => {
	for (const operation of ['delete', 'clear'] as const) {
		const fixture = createFixture();
		const started = deferred();
		const gate = deferred();
		const providers = new TestSourceChunkProviders(fixture.calls, async () => {
			started.resolve();
			await gate.promise;
		});
		const runtime = { ...fixture.runtime, sourceChunkProviders: providers } satisfies ProjectAdminServiceRuntime;
		const service = createProjectAdminService(runtime);
		const pending = operation === 'delete' ? service.deleteProject() : service.clearLocalData();

		await started.promise;
		const storageCall = operation === 'delete' ? 'delete:project-a' : 'clear-store';
		assert.ok(fixture.calls.indexOf('stop-engine') < fixture.calls.indexOf('clear-providers'));
		assert.ok(fixture.calls.indexOf('stop-bin-preview') < fixture.calls.indexOf('clear-providers'));
		assert.ok(fixture.calls.indexOf('dispose-render-engines') < fixture.calls.indexOf('clear-providers'));
		assert.ok(fixture.calls.indexOf('clear-providers') < fixture.calls.indexOf('drain-providers:start'));
		assert.equal(providers.size, 0);
		assert.equal(fixture.calls.includes(storageCall), false);

		gate.resolve();
		await pending;
		assert.ok(fixture.calls.indexOf('drain-providers:done') < fixture.calls.indexOf(storageCall));
	}
});

test('project deletion and local reset await Project Bin preview retirement before retiring providers', async () => {
	for (const operation of ['delete', 'clear'] as const) {
		const fixture = createFixture();
		const gate = deferred();
		const runtime = {
			...fixture.runtime,
			async stopProjectBinPreview() {
				fixture.calls.push('stop-bin-preview:start');
				await gate.promise;
				fixture.calls.push('stop-bin-preview:done');
			},
		} satisfies ProjectAdminServiceRuntime;
		const pending = operation === 'delete'
			? createProjectAdminService(runtime).deleteProject()
			: createProjectAdminService(runtime).clearLocalData();
		await new Promise<void>((resolve) => { setImmediate(resolve); });
		assert.equal(fixture.calls.includes('stop-bin-preview:start'), true);
		assert.equal(fixture.sourceChunkProviders.size, 1);
		assert.equal(fixture.calls.includes(operation === 'delete' ? 'delete:project-a' : 'clear-store'), false);
		gate.resolve();
		await pending;
		assert.equal(fixture.sourceChunkProviders.size, 0);
	}
});

test('Project Bin preview cleanup failure preserves providers and storage during project destruction', async () => {
	for (const operation of ['delete', 'clear'] as const) {
		const fixture = createFixture();
		const failure = new Error(`${operation} preview cleanup failed`);
		const runtime = {
			...fixture.runtime,
			stopProjectBinPreview: async () => { throw failure; },
		} satisfies ProjectAdminServiceRuntime;
		await assert.rejects(
			operation === 'delete'
				? createProjectAdminService(runtime).deleteProject()
				: createProjectAdminService(runtime).clearLocalData(),
			(error: unknown) => error === failure,
		);
		assert.equal(fixture.sourceChunkProviders.size, 1);
		assert.equal(fixture.calls.includes(operation === 'delete' ? 'delete:project-a' : 'clear-store'), false);
	}
});

test('project destruction awaits render-engine cleanup and fences providers and storage on failure', async () => {
	for (const operation of ['delete', 'clear'] as const) {
		const fixture = createFixture();
		const gate = deferred();
		const runtime = {
			...fixture.runtime,
			async disposeRenderEngines() { fixture.calls.push('dispose-render-engines:start'); await gate.promise; },
		} satisfies ProjectAdminServiceRuntime;
		const service = createProjectAdminService(runtime);
		const pending = operation === 'delete' ? service.deleteProject() : service.clearLocalData();
		await new Promise<void>((resolve) => { setImmediate(resolve); });
		assert.equal(fixture.calls.includes('dispose-render-engines:start'), true);
		assert.equal(fixture.sourceChunkProviders.size, 1);
		assert.equal(fixture.calls.includes(operation === 'delete' ? 'delete:project-a' : 'clear-store'), false);
		gate.resolve();
		await pending;

		const failed = createFixture();
		const failure = new Error(`${operation} render cleanup failed`);
		const failedRuntime = {
			...failed.runtime, disposeRenderEngines: async () => { throw failure; },
		} satisfies ProjectAdminServiceRuntime;
		await assert.rejects(
			operation === 'delete'
				? createProjectAdminService(failedRuntime).deleteProject()
				: createProjectAdminService(failedRuntime).clearLocalData(),
			(error: unknown) => error === failure,
		);
		assert.equal(failed.sourceChunkProviders.size, 1);
		assert.equal(failed.calls.includes(operation === 'delete' ? 'delete:project-a' : 'clear-store'), false);
	}
});

test('provider cleanup failure prevents project deletion and local storage reset', async () => {
	for (const operation of ['delete', 'clear'] as const) {
		const fixture = createFixture();
		const failure = new Error(`${operation} provider cleanup failed`);
		const providers = new TestSourceChunkProviders(fixture.calls, async () => { throw failure; });
		const runtime = { ...fixture.runtime, sourceChunkProviders: providers } satisfies ProjectAdminServiceRuntime;
		const service = createProjectAdminService(runtime);

		await assert.rejects(
			operation === 'delete' ? service.deleteProject() : service.clearLocalData(),
			(error: unknown) => error === failure,
		);
		assert.equal(providers.size, 0);
		assert.equal(fixture.calls.includes(operation === 'delete' ? 'delete:project-a' : 'clear-store'), false);
	}
});

test('source garbage collection retires unreferenced providers before pruning storage', async () => {
	const fixture = createFixture();
	const started = deferred();
	const gate = deferred();
	const providers = new TestSourceChunkProviders(fixture.calls, async () => {
		started.resolve();
		await gate.promise;
	});
	const runtime = { ...fixture.runtime, sourceChunkProviders: providers } satisfies ProjectAdminServiceRuntime;
	const pending = createProjectAdminService(runtime).garbageCollectSources();

	await started.promise;
	assert.equal(providers.size, 0);
	assert.equal(fixture.calls.includes('prune'), false);
	gate.resolve();
	await pending;
	assert.ok(fixture.calls.indexOf('drain-providers:done') < fixture.calls.indexOf('prune'));
});

test('source garbage collection protects live state and schedules the next pass', async () => {
	const fixture = createFixture();
	fixture.sourceChunkProviders.set('provider-only', {});
	fixture.pruneResult({ deletedSourceIds: ['deleted'], nextEligibleAt: 2_000 });
	const service = createProjectAdminService(fixture.runtime);
	await service.garbageCollectSources();
	assert.equal(fixture.sourceChunkProviders.has('provider-only'), false);
	assert.equal(fixture.pruneOptions()?.protectedSourceIds.has('provider-only'), false);
	assert.equal(fixture.scheduled[0]?.delay, 1_050);
	assert.equal(fixture.state.sourceGcTimer, 9);
	fixture.scheduled[0]?.callback();
	assert.equal(fixture.state.sourceGcTimer, 0);
	await Promise.resolve();
	assert.equal(service.sessionHistoryProjects().length, 1);

	const noPrune = createFixture();
	noPrune.runtime.store.pruneUnreferencedSources = undefined;
	await createProjectAdminService(noPrune.runtime).garbageCollectSources();
	assert.equal(noPrune.calls.includes('prune'), false);
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
