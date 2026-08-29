/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectAdminService,
	type ProjectAdminServiceRuntime,
} from '../src/common/editor/controller/project-admin-service.ts';
import { createProjectSaveService } from '../src/common/editor/controller/project-save-service.ts';
import {
	createFixture as createAdminFixture,
	type Project,
} from './audio-editor-project-admin-service-fixture.ts';

function deferred() {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

function createFixture() {
	let project: { id: string; title: string; revision: number } | null = {
		id: 'project-a', title: 'Project A', revision: 3,
	};
	const save = deferred();
	let duplicateCalls = 0;
	let openCalls = 0;
	let releaseCalls = 0;
	const handoffCalls: string[] = [];
	let flush: () => Promise<void> = async () => undefined;
	let prepareHandoff: () => Promise<void> = async () => undefined;
	const sourceBuffers = new Map<string, unknown>();
	const sourceChunkProviders = new Map<string, unknown>();
	const sourcePeaks = new Map<string, unknown>();
	let maintenanceCalls = 0;
	let prunedProtectedSourceIds: Set<string> | null = null;
	const state = {
		readOnly: false,
		recordingRouting: {},
		missingSourceIds: new Set<string>(),
		disposed: false,
		sourceGcTimer: 0,
		history: {},
		projects: [],
	};
	const noop = () => undefined;
	const runtime: ProjectAdminServiceRuntime = {
		cancelPlaybackCachePreparation: noop,
		clearScheduledTimer: noop,
		clearWaveformPcmWindows: noop,
		clipTimePitchCache: {},
		commit: noop,
		copy: {
			projectNotFound: 'Project not found.',
			projectReadOnly: 'Project is read-only.',
			projectTitleRequired: 'A title is required.',
			projectCopySuffix: 'copy',
		},
		currentTimeMs: () => 1_000,
		disposeRenderEngines: async () => undefined,
		editorHistoryProjects: () => [],
		engine: { stop: noop },
		evictUnreferencedSourceCaches: noop,
		flushProject: () => flush(),
		getProject: () => project,
		handleError: noop,
		liveSessionClipIds: () => new Set<string>(),
		liveSessionLinkedOriginalSourceReferences: () => [],
		liveSessionSourceIds: () => new Set<string>(),
		newProject: async () => undefined,
		openProject: async () => { openCalls += 1; },
		persistSetting: async () => undefined,
		projectSaveService: { cancelScheduled: noop, pendingSnapshots: [] },
		projectGeneration: { activate: noop, invalidate: noop },
		projectMaintenanceRuntime: {
			async reconcileAndCollectStorageRoots(request: unknown) {
				maintenanceCalls += 1;
				assert.deepEqual(request, {
					currentProject: project,
					pendingSaveSnapshots: [],
				});
				return { storageRoots: ['v18-proxy', 'v18-timing'] };
			},
		},
		projectSessionService: { clearRecentProjects: async () => [] },
		publishDocumentSnapshot: noop,
		recordingRoutingSettingKey: (id) => `routing:${id}`,
		releaseProjectLock: async () => {
			handoffCalls.push('release');
			releaseCalls += 1;
		},
		revokeVideoVisuals: noop,
		saveNow: () => save.promise,
		scheduleTimer: () => 1,
		sessionController: {
			getSnapshot: () => ({ tabs: [] }),
			closeProject: () => ({ closed: false }),
			clearClipboard: noop,
			markProjectSaved: noop,
		},
		sessionTab: () => null,
		setProject: (value) => { project = value; },
		sourceBuffers,
		sourceChunkProviders,
		sourcePeaks,
		state,
		stopProjectBinPreview: async () => undefined,
		stopRecording: async () => undefined,
		store: {
			async duplicateProject() {
				duplicateCalls += 1;
				return { id: 'copy', title: 'Copy', revision: 1 };
			},
			async listProjects() { return []; },
			async pruneUnreferencedSources(options: { protectedSourceIds: Set<string> }) {
				prunedProtectedSourceIds = new Set(options.protectedSourceIds);
				return { deletedSourceIds: [] };
			},
			async prepareProjectHandoff() {
				handoffCalls.push('prepare');
				await prepareHandoff();
			},
		},
		switchProject: async () => undefined,
	};
	return {
		service: createProjectAdminService(runtime),
		save,
		duplicateCalls: () => duplicateCalls,
		openCalls: () => openCalls,
		releaseCalls: () => releaseCalls,
		handoffCalls,
		maintenanceCalls: () => maintenanceCalls,
		prunedProtectedSourceIds: () => prunedProtectedSourceIds,
		replaceProject() { project = { id: 'project-b', title: 'Project B', revision: 1 }; },
		setFlush(value: () => Promise<void>) { flush = value; },
		setPrepareHandoff(value: () => Promise<void>) { prepareHandoff = value; },
	};
}

test('duplicate completion cannot act on a project replaced while saving', async () => {
	const fixture = createFixture();
	const pending = fixture.service.duplicateProject('Copy');
	fixture.replaceProject();
	fixture.save.resolve();
	assert.equal(await pending, null);
	assert.equal(fixture.duplicateCalls(), 0);
	assert.equal(fixture.openCalls(), 0);
});

test('garbage collection settles product maintenance before pruning V18 roots', async () => {
	const fixture = createFixture();
	await fixture.service.garbageCollectSources();
	assert.equal(fixture.maintenanceCalls(), 1);
	assert.deepEqual(fixture.prunedProtectedSourceIds(), new Set(['v18-proxy', 'v18-timing']));
});

test('handoff checks project ownership again after its flush', async () => {
	const fixture = createFixture();
	fixture.setFlush(async () => { fixture.replaceProject(); });
	await assert.rejects(() => fixture.service.prepareProjectHandoff(), /not found/u);
	assert.equal(fixture.releaseCalls(), 0);
});

test('handoff prepares durable media before lock release and returns a frozen identity', async () => {
	const fixture = createFixture();
	const handoff = await fixture.service.prepareProjectHandoff();
	assert.deepEqual(handoff, { projectId: 'project-a', revision: 3 });
	assert.equal(Object.isFrozen(handoff), true);
	assert.equal(fixture.releaseCalls(), 1);
	assert.deepEqual(fixture.handoffCalls, ['prepare', 'release']);
});

test('handoff preparation failure retains the shared project lock', async () => {
	const fixture = createFixture();
	const failure = new Error('managed media publication failed');
	fixture.setPrepareHandoff(async () => { throw failure; });

	await assert.rejects(() => fixture.service.prepareProjectHandoff(), (error) => error === failure);
	assert.equal(fixture.releaseCalls(), 0);
	assert.deepEqual(fixture.handoffCalls, ['prepare']);
});

test('discarding an active tab retires an admitted autosave before activating its successor', async () => {
	const fixture = createAdminFixture();
	const origin = fixture.project();
	assert.ok(origin);
	const successor: Project = { id: 'project-b', title: 'Project B', revision: 1 };
	fixture.tabs.get(origin.id)!.dirty = true;
	fixture.tabs.set(successor.id, {
		projectId: successor.id,
		dirty: false,
		readOnly: false,
		history: { present: successor },
	});
	const timers = new Map<number, () => void>();
	const admissionStarted = deferred();
	const admissionGate = deferred();
	const staleFailure = new Error('stale project post-publication failure');
	const publications: Project[] = [];
	const errors: unknown[] = [];
	const events: string[] = [];
	let nextTimer = 1;
	let project: Project | null = origin;
	const saveState = {
		autosaveTimer: 0,
		saveGeneration: 0,
		pendingSaveSnapshots: new Set<Project>(),
		saveQueue: Promise.resolve<unknown>(undefined),
		saveState: 'saved',
	};
	const projectSaveService = createProjectSaveService<Project>({
		state: saveState,
		getProject: () => project,
		hasHistory: () => project !== null,
		hasUnsavedProjectChanges: () => Boolean(project && fixture.tabs.get(project.id)?.dirty),
		isReadOnly: () => false,
		cloneProject: structuredClone,
		async admitProjectPublication() {
			events.push('admission:start');
			admissionStarted.resolve();
			await admissionGate.promise;
			events.push('admission:released');
		},
		async saveProject(snapshot, options) {
			await options.admitProjectPublication(1);
			publications.push(snapshot);
			events.push(`publication:${snapshot.id}`);
			throw staleFailure;
		},
		persistActiveProjectId: async () => undefined,
		isCurrentProject: (projectId) => project?.id === projectId,
		hasSessionTab: (projectId) => fixture.tabs.has(projectId),
		markProjectSaved: (projectId) => { fixture.tabs.get(projectId)!.dirty = false; },
		publish: () => undefined,
		garbageCollect: async () => undefined,
		refreshStorageUsage: async () => undefined,
		handleError: (error) => { errors.push(error); },
		scheduleTimer(callback) {
			const handle = nextTimer++;
			timers.set(handle, callback);
			return handle;
		},
		clearTimer: (handle) => { timers.delete(handle); },
	});
	const runtime: ProjectAdminServiceRuntime = {
		...fixture.runtime,
		getProject: () => project,
		setProject: (value: Project | null) => { project = value; },
		projectSaveService,
		async switchProject(value: Project, options: Readonly<{ skipFlush?: boolean }> = {}) {
			assert.equal(options.skipFlush, true);
			events.push(`switch:${value.id}`);
			project = value;
			saveState.saveState = 'saved';
		},
	};

	assert.equal(projectSaveService.scheduleAutosave(), true);
	const callback = timers.get(saveState.autosaveTimer);
	assert.ok(callback);
	timers.delete(saveState.autosaveTimer);
	callback();
	await admissionStarted.promise;
	const closing = createProjectAdminService(runtime).closeProjectTab(origin.id, { discard: true });
	try {
		admissionGate.resolve();
		await closing;
		await projectSaveService.drain();
		assert.deepEqual(publications, []);
		assert.deepEqual(errors, []);
		assert.equal(saveState.saveState, 'saved');
		assert.ok(events.indexOf('admission:released') < events.indexOf(`switch:${successor.id}`));
		assert.equal(project?.id, successor.id);
	} finally {
		admissionGate.resolve();
		await Promise.allSettled([closing, projectSaveService.drain()]);
	}
});

test('local reset closes save admission synchronously and drains an admitted autosave before clearing storage', async () => {
	const fixture = createAdminFixture();
	const origin = fixture.project();
	assert.ok(origin);
	let project: Project | null = origin;
	const replacement: Project = { id: 'replacement', title: 'Replacement', revision: 0 };
	const catalog = new Map<string, Project>([[origin.id, origin]]);
	const timers = new Map<number, () => void>();
	const saveStarted = deferred();
	const saveGate = deferred();
	let nextTimer = 1;
	let dirty = true;
	let saveCompleted = false;
	let clearCalls = 0;
	const saveState = {
		autosaveTimer: 0,
		saveGeneration: 0,
		pendingSaveSnapshots: new Set<Project>(),
		saveQueue: Promise.resolve<unknown>(undefined),
		saveState: 'dirty',
	};
	const projectSaveService = createProjectSaveService<Project>({
		state: saveState,
		getProject: () => project,
		hasHistory: () => project !== null,
		hasUnsavedProjectChanges: () => dirty,
		isReadOnly: () => false,
		cloneProject: structuredClone,
		admitProjectPublication: async () => undefined,
		async saveProject(snapshot) {
			saveStarted.resolve();
			await saveGate.promise;
			catalog.set(snapshot.id, snapshot);
			saveCompleted = true;
		},
		persistActiveProjectId: async () => undefined,
		isCurrentProject: (projectId) => project?.id === projectId,
		hasSessionTab: () => true,
		markProjectSaved: () => { dirty = false; },
		publish: () => undefined,
		garbageCollect: async () => undefined,
		refreshStorageUsage: async () => undefined,
		handleError: () => undefined,
		scheduleTimer(callback) {
			const handle = nextTimer++;
			timers.set(handle, callback);
			return handle;
		},
		clearTimer: (handle) => { timers.delete(handle); },
	});

	assert.equal(projectSaveService.scheduleAutosave(), true);
	const admittedTimer = saveState.autosaveTimer;
	const admittedCallback = timers.get(admittedTimer);
	assert.ok(admittedCallback);
	timers.delete(admittedTimer);
	admittedCallback();
	await saveStarted.promise;
	dirty = true;
	assert.equal(projectSaveService.scheduleAutosave(), true);
	assert.equal(timers.size, 1);

	const runtime: ProjectAdminServiceRuntime = {
		...fixture.runtime,
		getProject: () => project,
		setProject: (value: Project | null) => { project = value; },
		projectSaveService,
		store: {
			...fixture.runtime.store,
			async clear() {
				clearCalls += 1;
				assert.equal(saveCompleted, true);
				catalog.clear();
			},
		},
		async newProject() {
			project = replacement;
			fixture.state.history = {};
			catalog.set(replacement.id, replacement);
		},
	};
	const clearing = createProjectAdminService(runtime).clearLocalData();
	try {
		assert.equal(project, null, 'the old project must reject mutation before reset yields');
		assert.equal(timers.size, 0, 'the pending autosave must be cancelled before reset yields');
		assert.equal(projectSaveService.scheduleAutosave(), false);
		assert.equal(clearCalls, 0, 'storage clear must wait for the admitted save');

		saveGate.resolve();
		await clearing;
		assert.deepEqual([...catalog.keys()], [replacement.id]);
		dirty = true;
		assert.equal(projectSaveService.scheduleAutosave(), true, 'save admission resumes for the replacement');
	} finally {
		saveGate.resolve();
		await clearing.catch(() => undefined);
	}
});

test('concurrent local resets share one clear and one replacement project', async () => {
	const fixture = createAdminFixture();
	const clearStarted = deferred();
	const clearGate = deferred();
	let clearCalls = 0;
	let replacementCalls = 0;
	const runtime: ProjectAdminServiceRuntime = {
		...fixture.runtime,
		store: {
			...fixture.runtime.store,
			async clear() {
				clearCalls += 1;
				clearStarted.resolve();
				await clearGate.promise;
			},
		},
		async newProject() {
			replacementCalls += 1;
			fixture.setProject({ id: 'replacement', title: 'Replacement', revision: 0 });
			fixture.state.history = {};
		},
	};
	const service = createProjectAdminService(runtime);
	const first = service.clearLocalData();
	await clearStarted.promise;
	const second = service.clearLocalData();
	try {
		assert.strictEqual(second, first);
		clearGate.resolve();
		await Promise.all([first, second]);
		assert.equal(clearCalls, 1);
		assert.equal(replacementCalls, 1);
	} finally {
		clearGate.resolve();
		await Promise.allSettled([first, second]);
	}
});

test('only the newest overlapping garbage collection owns the follow-up timer', async () => {
	const fixture = createAdminFixture();
	const firstStarted = deferred();
	const secondStarted = deferred();
	const firstGate = deferred();
	const secondGate = deferred();
	const timers = new Map<number, Readonly<{ callback: () => void; delay: number }>>();
	let pruneCalls = 0;
	let nextTimer = 10;
	const runtime: ProjectAdminServiceRuntime = {
		...fixture.runtime,
		clearScheduledTimer: (handle: number) => { timers.delete(handle); },
		scheduleTimer(callback: () => void, delay: number) {
			const handle = nextTimer++;
			timers.set(handle, { callback, delay });
			return handle;
		},
		store: {
			...fixture.runtime.store,
			async pruneUnreferencedSources() {
				pruneCalls += 1;
				if (pruneCalls === 1) {
					firstStarted.resolve();
					await firstGate.promise;
					return { nextEligibleAt: 9_000 };
				}
				secondStarted.resolve();
				await secondGate.promise;
				return { nextEligibleAt: 2_000 };
			},
		},
	};
	const service = createProjectAdminService(runtime);
	const first = service.garbageCollectSources();
	await firstStarted.promise;
	const second = service.garbageCollectSources();
	await secondStarted.promise;
	try {
		secondGate.resolve();
		await second;
		const newestTimer = fixture.state.sourceGcTimer;
		assert.equal(timers.get(newestTimer)?.delay, 1_050);

		firstGate.resolve();
		await first;
		assert.equal(fixture.state.sourceGcTimer, newestTimer);
		assert.deepEqual([...timers.keys()], [newestTimer]);
	} finally {
		firstGate.resolve();
		secondGate.resolve();
		await Promise.allSettled([first, second]);
	}
});

test('a failed pre-clear save drain restores project mutation and save admission', async () => {
	const fixture = createAdminFixture();
	const origin = fixture.project();
	const originHistory = fixture.state.history;
	const drainStarted = deferred();
	const drainGate = deferred();
	const failure = new Error('queued save failed');
	fixture.runtime.projectSaveService.drain = async () => {
		fixture.calls.push('drain-save:pending');
		drainStarted.resolve();
		await drainGate.promise;
		throw failure;
	};
	const service = createProjectAdminService(fixture.runtime);
	const clearing = service.clearLocalData();
	await drainStarted.promise;
	assert.equal(fixture.project(), null);
	assert.equal(fixture.saveSuspended(), true);

	drainGate.resolve();
	await assert.rejects(clearing, (error: unknown) => error === failure);
	assert.strictEqual(fixture.project(), origin);
	assert.strictEqual(fixture.state.history, originHistory);
	assert.equal(fixture.captureProjectGeneration().projectId, origin?.id);
	assert.equal(fixture.saveSuspended(), false);
	assert.equal(fixture.runtime.projectSaveService.scheduleAutosave(), true);
	assert.equal(fixture.calls.includes('clear-store'), false);
	await service.renameProject('Recovered project');
	assert.equal(fixture.calls.includes('rename:Recovered project'), true);
});
