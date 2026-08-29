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
		projectGeneration: { invalidate: noop },
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
