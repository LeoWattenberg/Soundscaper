/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectAdminService } from '../src/common/editor/controller/project-admin-service.ts';
import {
	createFixture,
	deferred,
	TestSourceChunkProviders,
} from './audio-editor-project-admin-service-fixture.ts';

/**
 * The order in which a project is torn down, and what happens when a step fails.
 *
 * Destroying a project touches five owners — video visuals, Project Bin previews, chunk
 * providers, the render engine and storage — and the order is the contract: nothing may
 * mutate storage while something still holds a handle to what it is about to delete. So
 * each step is fenced and drained before the next, and a failure anywhere leaves the
 * project intact rather than half-deleted, with the original error carrying whatever the
 * finalization added to it.
 *
 * `tests/audio-editor-project-admin-service-coverage.test.ts` covers tabs, renames and
 * handoff.
 */

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
		if (operation === 'clear') {
			assert.equal(fixture.saveSuspended(), false);
		}
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
