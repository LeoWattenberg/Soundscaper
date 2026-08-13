/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectAdminService,
	type ProjectAdminServiceRuntime,
} from '../src/common/editor/controller/project-admin-service.ts';
import type { ProjectLinkedOriginalSourceReference } from '../src/common/editor/storage/project-publication-options.ts';

interface Project {
	readonly id: string;
	readonly title: string;
	readonly revision: number;
}

function deferred() {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((complete) => { resolve = complete; });
	return { promise, resolve };
}

class TestSourceChunkProviders extends Map<string, unknown> {
	readonly #calls: string[];
	readonly #drainOperation: () => Promise<void>;

	constructor(calls: string[], drainOperation: () => Promise<void>) {
		super([['provider-source', {}]]);
		this.#calls = calls;
		this.#drainOperation = drainOperation;
	}

	override clear(): void {
		this.#calls.push('clear-providers');
		super.clear();
	}

	async drain(): Promise<void> {
		this.#calls.push('drain-providers:start');
		await this.#drainOperation();
		this.#calls.push('drain-providers:done');
	}
}

function createFixture() {
	let project: Project | null = { id: 'project-a', title: 'Project A', revision: 3 };
	let closeResult: { closed: boolean; activeProjectId?: string } = { closed: true };
	let pruneResult: { deletedSourceIds?: string[]; nextEligibleAt?: number | null } = {};
	let pruneOptions: { readonly protectedSourceIds: Set<string> } | null = null;
	const calls: string[] = [];
	let stopRecording = async () => { calls.push('stop-recording'); };
	const savedProjects: Project[] = [];
	const savedProjectOptions: Array<Readonly<{
		protectedLinkedOriginalSourceReferences?: readonly ProjectLinkedOriginalSourceReference[];
	}>> = [];
	const scheduled: Array<{ callback: () => void; delay: number }> = [];
	const tabs = new Map<string, {
		projectId: string;
		dirty: boolean;
		readOnly: boolean;
		history: { present: Project };
		metadata?: Readonly<{
			declaredReadOnly?: boolean;
			featureRequirementsReadOnly?: boolean;
			intrinsicReadOnly?: boolean;
		}>;
	}>();
	tabs.set('project-a', {
		projectId: 'project-a', dirty: false, readOnly: false,
		history: { present: project },
	});
	const sourceBuffers = new Map<string, unknown>([['buffer', {}], ['deleted', {}]]);
	const sourceChunkProviders = new Map<string, unknown>([['deleted', {}]]);
	const sourcePeaks = new Map<string, unknown>([['peak', {}], ['deleted', {}]]);
	const state = {
		readOnly: false,
		projectLock: { projectId: 'project-a', readOnly: false },
		recordingRouting: { input: 'mic' },
		missingSourceIds: new Set(['deleted']),
		disposed: false,
		sourceGcTimer: 7,
		history: {},
		projects: [] as readonly Project[],
		selectedTrackId: 'track',
		selectedClipId: 'clip',
		selectedAnnotationId: 'annotation',
	};
	const projectSaveService = {
		cancelScheduled: () => { calls.push('cancel-save'); },
		drain: async () => { calls.push('drain-save'); },
		pendingSnapshots: [{ id: 'pending' }],
	};
	const sessionController = {
		getSnapshot: () => ({ tabs: [...tabs.values()] }),
		closeProject(projectId: string) {
			calls.push(`close:${projectId}`);
			return closeResult;
		},
		clearClipboard: () => { calls.push('clear-clipboard'); },
		markProjectSaved: (projectId: string) => { calls.push(`marked:${projectId}`); },
	};
	const store = {
		async duplicateProject(_projectId: string, options: { title: string }) {
			calls.push(`duplicate:${options.title}`);
			return { id: 'copy', title: options.title, revision: 1 };
		},
		async listProjects() {
			calls.push('list');
			return [{ id: 'listed', title: 'Listed', revision: 1 }];
		},
		async saveProject(value: Project, options: Readonly<{
			protectedLinkedOriginalSourceReferences?: readonly ProjectLinkedOriginalSourceReference[];
		}> = {}) {
			savedProjects.push(value);
			savedProjectOptions.push(options);
		},
		async deleteProject(projectId: string) { calls.push(`delete:${projectId}`); },
		async prepareProjectHandoff(project: Project) { calls.push(`handoff:${project.id}`); },
		async pruneUnreferencedSources(options: unknown) {
			calls.push('prune');
			assert.ok(options);
			pruneOptions = options as { readonly protectedSourceIds: Set<string> };
			return pruneResult;
		},
		async clear() { calls.push('clear-store'); },
	};
	const runtime: ProjectAdminServiceRuntime = {
		cancelPlaybackCachePreparation: () => { calls.push('cancel-cache'); },
		clearScheduledTimer: (timer: number) => { calls.push(`clear-timer:${timer}`); },
		clearWaveformPcmWindows: () => { calls.push('clear-windows'); },
		clipTimePitchCache: {
			retainClipIds: () => { calls.push('retain-clips'); },
			clear: () => { calls.push('clear-time-pitch'); },
		},
		commit: (command: { title: string }) => { calls.push(`rename:${command.title}`); },
		copy: {
			projectNotFound: 'Project not found.',
			projectReadOnly: 'Project is read-only.',
			projectTitleRequired: 'A title is required.',
			projectCopySuffix: 'copy',
		},
		currentTimeMs: () => 1_000,
		disposeRenderEngines: async () => { calls.push('dispose-render-engines'); },
		editorHistoryProjects: (history: { present: Project }) => [history.present],
		engine: { stop: () => { calls.push('stop-engine'); } },
		evictUnreferencedSourceCaches: () => { calls.push('evict'); },
		flushProject: async () => { calls.push('flush'); },
		getProject: () => project,
		handleError: (error: unknown) => { calls.push(`error:${String(error)}`); },
		liveSessionClipIds: () => new Set(['clip']),
		liveSessionLinkedOriginalSourceReferences: () => Object.freeze([
			Object.freeze({ kind: 'audio' as const, sourceId: 'live' }),
			Object.freeze({ kind: 'video' as const, sourceId: 'live' }),
		]),
		liveSessionSourceIds: () => new Set<string>(['live']),
		newProject: async () => { calls.push('new-project'); },
		openProject: async (value: Project) => { calls.push(`open:${value.id}`); },
		persistSetting: async (key: string, value: unknown) => { calls.push(`persist:${key}:${String(value)}`); },
		projectSaveService,
		projectSessionService: {
			clearRecentProjects: async () => {
				calls.push('clear-recents');
				return [];
			},
		},
		publishDocumentSnapshot: () => { calls.push('publish'); },
		recordingRoutingSettingKey: (id: string) => `routing:${id}`,
		releaseProjectLock: async () => { calls.push('release'); },
		revokeVideoVisuals: () => { calls.push('revoke-video'); },
		saveNow: async () => { calls.push('save'); },
		scheduleTimer: (callback: () => void, delay: number) => {
			scheduled.push({ callback, delay });
			return 9;
		},
		sessionController,
		sessionTab: (projectId: string) => tabs.get(projectId) || null,
		setProject: (value: Project | null) => { project = value; },
		sourceBuffers,
		sourceChunkProviders,
		sourcePeaks,
		state,
		stopProjectBinPreview: async (options) => { assert.equal(options.dispose, true); calls.push('stop-bin-preview'); },
		stopRecording: () => stopRecording(),
		store,
		switchProject: async (value: Project) => { calls.push(`switch:${value.id}`); },
	};
	return {
		calls,
		project: () => project,
		setProject: (value: Project | null) => { project = value; },
		setStopRecording: (value: () => Promise<void>) => { stopRecording = value; },
		closeResult: (value: typeof closeResult) => { closeResult = value; },
		pruneOptions: () => pruneOptions,
		pruneResult: (value: typeof pruneResult) => { pruneResult = value; },
		runtime,
		savedProjectOptions,
		savedProjects,
		scheduled,
		sourceBuffers,
		sourceChunkProviders,
		sourcePeaks,
		state,
		tabs,
	};
}

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
	assert.equal(fixture.project(), null);
	assert.equal(fixture.state.selectedAnnotationId, null);
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

test('project deletion cancels and drains queued saves before irreversible teardown', async () => {
	const fixture = createFixture();
	const drainStarted = deferred();
	const drainGate = deferred();
	fixture.runtime.projectSaveService.drain = async () => {
		fixture.calls.push('drain-save:start');
		drainStarted.resolve();
		await drainGate.promise;
		fixture.calls.push('drain-save:done');
	};
	const pending = createProjectAdminService(fixture.runtime).deleteProject();
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	try {
		assert.equal(fixture.calls.includes('cancel-save'), true);
		assert.equal(fixture.calls.includes('drain-save:start'), true);
		assert.equal(fixture.calls.includes('release'), false);
		assert.equal(fixture.calls.includes('delete:project-a'), false);
	} finally {
		drainGate.resolve();
		await pending;
	}
	await drainStarted.promise;
	assert.ok(fixture.calls.indexOf('cancel-save') < fixture.calls.indexOf('drain-save:start'));
	assert.ok(fixture.calls.indexOf('drain-save:done') < fixture.calls.indexOf('release'));
	assert.ok(fixture.calls.indexOf('release') < fixture.calls.indexOf('delete:project-a'));
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
