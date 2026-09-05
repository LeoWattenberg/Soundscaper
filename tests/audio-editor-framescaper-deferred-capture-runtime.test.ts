/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperCaptureAdminInterlock } from
	'../src/common/editor/controller/framescaper-capture-admin-interlock.ts';
import {
	createFramescaperCaptureAppBinding,
	type FramescaperCaptureAppBindingOptions,
	type FramescaperCaptureAppHistory,
	type FramescaperCaptureAppProject,
} from '../src/common/editor/controller/framescaper-capture-app-binding.ts';
import {
	createDeferredFramescaperCaptureAppBinding,
	FRAMESCAPER_CAPTURE_IDLE_SNAPSHOT,
	type FramescaperCaptureBinding,
	type FramescaperCaptureImplementationLoader,
} from '../src/framescaper/editor-capture-deferred-binding.ts';
import { createDeferredFramescaperCaptureRuntime } from '../src/framescaper/editor-capture-runtime.ts';
import { FRAMESCAPER_EDITOR_CAPTURE_IMPLEMENTATION } from
	'../src/framescaper/editor-capture-runtime-implementation.ts';

interface Harness {
	readonly loads: number;
	readonly calls: string[];
	readonly binding: NonNullable<ReturnType<typeof createDeferredFramescaperCaptureAppBinding>>;
	readonly warnings: unknown[];
	readonly changes: number;
	release(): void;
}

function fakeBinding(calls: string[]): FramescaperCaptureBinding {
	const actions = Object.fromEntries([
		'openSetup', 'selectDisplaySource', 'configure', 'setSetupDefaults', 'arm', 'resetFailure',
		'requestPreview', 'listDisplaySources', 'selectDevice', 'configureSource', 'release', 'start',
		'pause', 'resume', 'stop', 'recover', 'importAsIs', 'discard', 'sealForShutdown',
	].map((name) => [name, (...args: unknown[]) => { calls.push(`${name}:${JSON.stringify(args)}`); return Promise.resolve(); }]));
	const webVcrActions = Object.fromEntries([
		'activate', 'close', 'navigate', 'back', 'forward', 'reload', 'setResolution', 'setAutoCrop',
		'setAspect', 'setCrop', 'setMonitorMuted', 'setAutoStop', 'sendPointerInput', 'sendKeyInput',
		'record', 'stopAndImport', 'clearBrowserData',
	].map((name) => [name, (...args: unknown[]) => { calls.push(`vcr.${name}:${JSON.stringify(args)}`); return Promise.resolve(); }]));
	const snapshot = { phase: 'previewing', marker: 'loaded' };
	return {
		service: {
			get snapshot() { return snapshot; },
			actions,
			setRuntimeAvailability: (value: unknown) => { calls.push(`availability:${JSON.stringify(value)}`); },
			initialize: async () => { calls.push('service.initialize'); },
			settled: async () => { calls.push('settled'); },
			dispose: async () => { calls.push('service.dispose'); },
		},
		get snapshot() { return snapshot; },
		actions,
		get webVcrSnapshot() { return { capability: { status: 'available', reason: null }, marker: 'loaded' }; },
		get webVcrActions() { return webVcrActions; },
		initialize: async () => { calls.push('initialize'); },
		dispose: async () => { calls.push('dispose'); },
		originSnapshot: (projectId?: string | null) => ({ marker: 'loaded', activeProjectId: projectId ?? null }),
		assertOriginEditAllowed: (projectId: string) => { calls.push(`edit:${projectId}`); },
		assertOriginCloseAllowed: (projectId: string) => { calls.push(`close:${projectId}`); },
		assertOriginDeleteAllowed: (projectId: string) => { calls.push(`delete:${projectId}`); },
		assertOriginHandoffAllowed: (projectId: string) => { calls.push(`handoff:${projectId}`); },
	} as unknown as FramescaperCaptureBinding;
}

function harness(options: Readonly<{
	readonly creations?: number;
	readonly manifests?: Readonly<Record<string, number>>;
	readonly repository?: boolean;
	readonly desktopBridge?: unknown;
	readonly webVcrBridge?: unknown;
	readonly webVcrEnabled?: boolean;
	readonly probeFailure?: Error;
}> = {}): Harness {
	const calls: string[] = [];
	const warnings: unknown[] = [];
	let loads = 0;
	let changes = 0;
	let release = () => {};
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const load: FramescaperCaptureImplementationLoader = async () => {
		loads += 1;
		await gate;
		return {
			createAppBinding: () => fakeBinding(calls),
			createDerivativeScheduler: () => async () => { calls.push('scheduled'); },
		} as unknown as typeof FRAMESCAPER_EDITOR_CAPTURE_IMPLEMENTATION;
	};
	const repository = options.repository === false ? undefined : {
		async listCreations() {
			if (options.probeFailure) throw options.probeFailure;
			return Array.from({ length: options.creations ?? 0 }, () => ({}));
		},
		async listProject(projectId: string) { return Array.from({ length: options.manifests?.[projectId] ?? 0 }, () => ({})); },
	};
	const binding = createDeferredFramescaperCaptureAppBinding({
		productId: 'framescaper', schemaFamily: 'framescaper', schemaVersion: 1, isDesktop: false, embedded: false,
		store: {
			framescaperCaptureManifestRepository: repository,
			async listProjects() { return [{ id: 'p1' }, { id: 'p2' }]; },
		},
		getActiveProject: () => ({ id: 'p1' }),
		desktopBridge: options.desktopBridge ?? null,
		webVcrBridge: options.webVcrBridge ?? null,
		webVcrEnabled: options.webVcrEnabled ?? false,
		onWarning: (error: unknown) => { warnings.push(error); },
		onChange: () => { changes += 1; },
	} as unknown as FramescaperCaptureAppBindingOptions, load);
	assert.ok(binding);
	return {
		get loads() { return loads; },
		calls,
		binding,
		warnings,
		get changes() { return changes; },
		release,
	};
}

test('a cold boot with no bridge and no durable capture state never loads the runtime', async () => {
	const fixture = harness();
	assert.equal(fixture.loads, 0);
	await fixture.binding.initialize();
	assert.equal(fixture.loads, 0, 'initialize must not fetch the capture stack');
	assert.deepEqual(fixture.binding.snapshot, FRAMESCAPER_CAPTURE_IDLE_SNAPSHOT);
	assert.equal(fixture.binding.webVcrSnapshot.capability.status, 'unavailable');
	assert.equal(fixture.binding.webVcrSnapshot.capability.reason, 'roadmap-gate');
	assert.deepEqual(fixture.binding.originSnapshot(), {
		active: false, generation: null, origin: null, activeProjectId: null, activeProjectIsOrigin: false,
		editBlocked: false, closeBlocked: false, deleteBlocked: false, handoffBlocked: false,
	});
	assert.equal(fixture.binding.originSnapshot('p9').activeProjectId, 'p9');
	assert.doesNotThrow(() => {
		fixture.binding.assertOriginEditAllowed('p1');
		fixture.binding.assertOriginCloseAllowed('p1');
		fixture.binding.assertOriginDeleteAllowed('p1');
		fixture.binding.assertOriginHandoffAllowed('p1');
	});
	await fixture.binding.dispose();
	assert.equal(fixture.loads, 0, 'disposing an unloaded runtime must not load it');
	assert.deepEqual(fixture.calls, []);
});

test('durable capture state, a desktop bridge or a failing probe load the runtime at startup', async () => {
	for (const [label, fixture] of [
		['creation journal', harness({ creations: 1 })],
		['project manifest', harness({ manifests: { p2: 1 } })],
		['desktop bridge', harness({ desktopBridge: {} })],
		['web vcr bridge', harness({ webVcrBridge: {}, webVcrEnabled: true })],
		['probe failure', harness({ probeFailure: new Error('storage unreadable') })],
	] as const) {
		fixture.release();
		await fixture.binding.initialize();
		assert.equal(fixture.loads, 1, `${label} must load the runtime`);
		assert.deepEqual(fixture.calls, ['initialize'], `${label} must initialize the real binding`);
		assert.equal(fixture.binding.snapshot.phase, 'previewing', `${label} exposes the loaded snapshot`);
		assert.equal(fixture.changes, 1, `${label} announces the loaded snapshot`);
	}
	const failing = harness({ probeFailure: new Error('storage unreadable') });
	failing.release();
	await failing.binding.initialize();
	assert.equal(failing.warnings.length, 1, 'a probe failure is reported, not swallowed');
});

test('a store without the capture repositories is a cold boot, not a load', async () => {
	const fixture = harness({ repository: false });
	await fixture.binding.initialize();
	assert.equal(fixture.loads, 0);
});

test('asynchronous actions load once, initialize once and then delegate; guards delegate after load', async () => {
	const fixture = harness();
	await fixture.binding.initialize();
	const first = fixture.binding.actions.requestPreview(['camera']);
	const second = fixture.binding.webVcrActions.navigate('https://example.test/');
	await Promise.resolve();
	assert.equal(fixture.loads, 1, 'concurrent actions share one load');
	fixture.release();
	await Promise.all([first, second]);
	assert.deepEqual(fixture.calls, ['initialize', 'requestPreview:[["camera"]]', 'vcr.navigate:["https://example.test/"]']);
	fixture.binding.assertOriginDeleteAllowed('p1');
	assert.equal(fixture.calls.at(-1), 'delete:p1');
	assert.deepEqual(fixture.binding.originSnapshot('p1'), { marker: 'loaded', activeProjectId: 'p1' });
	assert.equal(fixture.binding.webVcrSnapshot.capability.status, 'available');
	await fixture.binding.service.settled();
	assert.equal(fixture.calls.at(-1), 'settled');
	await fixture.binding.dispose();
	assert.equal(fixture.calls.at(-1), 'dispose');
	await assert.rejects(fixture.binding.actions.start(), /disposed/u);
});

test('synchronous actions before the load are journaled and replayed in order after the runtime initializes', async () => {
	const fixture = harness();
	await fixture.binding.initialize();
	fixture.binding.actions.openSetup();
	fixture.binding.actions.setSetupDefaults({ countdownMs: 0 });
	fixture.binding.actions.configure({ destination: 'project' });
	fixture.binding.service.setRuntimeAvailability({ status: 'checking' });
	await Promise.resolve();
	assert.equal(fixture.loads, 1, 'the first synchronous gesture starts the load');
	assert.deepEqual(fixture.calls, [], 'nothing reaches the runtime before it is loaded');
	fixture.release();
	await fixture.binding.actions.release();
	assert.deepEqual(fixture.calls, [
		'initialize',
		'openSetup:[]',
		'setSetupDefaults:[{"countdownMs":0}]',
		'configure:[{"destination":"project"}]',
		'availability:{"status":"checking"}',
		'release:[]',
	]);
	fixture.binding.actions.arm({ destination: 'both' } as never);
	assert.equal(fixture.calls.at(-1), 'arm:[{"destination":"both"}]', 'after the load a synchronous action is direct');
});

test('the deferred runtime keeps the synchronous ports real and defers only the capture stack', async () => {
	let loads = 0;
	const runtime = createDeferredFramescaperCaptureRuntime(async () => {
		loads += 1;
		return {
			createAppBinding: () => null,
			createDerivativeScheduler: () => async () => undefined,
		} as unknown as typeof FRAMESCAPER_EDITOR_CAPTURE_IMPLEMENTATION;
	});
	assert.equal(typeof runtime.createAdminInterlock().beginAdminOperation, 'function');
	assert.equal(typeof runtime.createProjectWriteAuthority({
		getProjectAdmission: () => null, getActiveProjectId: () => null, getActiveReadOnly: () => false,
		getActiveLock: () => null, acquireProjectLock: async () => ({ projectId: 'p1', readOnly: false, release: async () => undefined }),
	} as never).assertProjectWritable, 'function');
	assert.equal(typeof runtime.createProxySaveQuiescence({
		getActiveProjectId: () => null, hasUnsavedProjectChanges: () => false,
		saves: { suspendProject() {}, resumeProject: () => true, scheduleAutosave: () => true, drain() {} },
	}), 'function');
	const scheduler = runtime.createDerivativeScheduler({} as never);
	assert.equal(loads, 0, 'constructing the scheduler must not load the implementation');
	await scheduler({} as never);
	await scheduler({} as never);
	assert.equal(loads, 1, 'the implementation loads once, on the first derivative');
	assert.equal(runtime.createAppBinding({ productId: 'soundscaper' } as never), null);
});

test('the idle snapshot is what the real binding reports before its first gesture', async () => {
	let activeProject = project(4);
	let activeHistory = history(activeProject);
	const options = {
		adminInterlock: createFramescaperCaptureAdminInterlock(),
		productId: 'framescaper', schemaFamily: 'framescaper', schemaVersion: 1,
		isDesktop: false, embedded: false,
		store: {
			projectRepository: {
				async load() { return activeProject; },
				async saveIfCurrent(value: FramescaperCaptureAppProject) { return value; },
			},
			async loadProject() { return activeProject; },
			async saveProject(value: FramescaperCaptureAppProject) { return value; },
			async listProjects() { return [activeProject]; },
		},
		sessionController: sessionController(() => activeHistory),
		projectRuntime: { createHistory: history, executeCommand() { throw new Error('publication is not reached'); } },
		getActiveProject: () => activeProject,
		getActiveHistory: () => activeHistory,
		getActivePlayheadFrame: () => 0,
		setActiveProject(value: FramescaperCaptureAppProject) { activeProject = value; },
		setActiveHistory(value: FramescaperCaptureAppHistory) { activeHistory = value; },
		synchronizeProject() {}, assertProjectWritable() {},
		async acquireProjectWriteAuthority() { return { assertCurrent() {}, async release() {} }; },
		prepareCaptureStart() {}, getAudioContext: () => ({ sampleRate: 48_000 }),
		desktopBridge: null, webVcrBridge: null, webVcrEnabled: false,
	} as unknown as FramescaperCaptureAppBindingOptions;
	const real = createFramescaperCaptureAppBinding(options);
	assert.ok(real);
	const deferred = createDeferredFramescaperCaptureAppBinding(options, async () => FRAMESCAPER_EDITOR_CAPTURE_IMPLEMENTATION);
	assert.ok(deferred);

	const { displaySelectionMode: realMode, ...realIdle } = real.snapshot;
	const { displaySelectionMode: deferredMode, ...deferredIdle } = deferred.snapshot;
	assert.deepEqual(deferredIdle, realIdle, 'every idle field but the adapter-chosen display mode must match');
	assert.ok(realMode === null || ['source-list', 'system-picker', 'owned-source'].includes(realMode));
	assert.equal(deferredMode, null);
	assert.deepEqual(Object.keys(deferred.actions).sort(), Object.keys(real.actions).sort());
	assert.deepEqual(Object.keys(deferred.webVcrActions).sort(), Object.keys(real.webVcrActions).sort());
	assert.deepEqual(Object.keys(deferred).sort(), Object.keys(real).sort());
	assert.deepEqual(Object.keys(deferred.service).sort(), Object.keys(real.service).sort());

	// The editor awaits initialize() before it renders, so the cold Web VCR
	// capability has to be the one the real controller settles on for this
	// environment, not the transient 'checking' it starts from.
	await real.initialize();
	assert.deepEqual(deferred.webVcrSnapshot, real.webVcrSnapshot);
	assert.deepEqual(deferred.originSnapshot(), real.originSnapshot());
	await real.dispose();
	await deferred.dispose();
});

function project(revision: number, id = 'project-a'): FramescaperCaptureAppProject {
	return Object.freeze({
		id, schemaFamily: 'framescaper', schemaVersion: 1, revision,
		updatedAt: '2026-08-20T10:00:00.000Z',
		title: 'Capture origin', sampleRate: 48_000,
		primarySequenceId: 'sequence-a',
		sequences: Object.freeze([Object.freeze({
			id: 'sequence-a', rate: Object.freeze({ num: 30, den: 1 }),
			trackIds: Object.freeze(['track-a', 'track-b']),
		})]),
		sources: Object.freeze([]), clips: Object.freeze([]), tracks: Object.freeze([]),
	});
}

function history(value: FramescaperCaptureAppProject): FramescaperCaptureAppHistory {
	return Object.freeze({ present: value, undoStack: Object.freeze([]), redoStack: Object.freeze([]), limit: 100 });
}

function sessionController(getHistory: () => FramescaperCaptureAppHistory) {
	const tabs = [{ projectId: getHistory().present.id }];
	return {
		getSnapshot() { return { tabs }; },
		openProject(value: FramescaperCaptureAppProject) { tabs.push({ projectId: value.id }); },
		captureProjectHistory() { return { history: getHistory(), token: 1 }; },
		beginProjectActivation() { return { token: 1, release: () => true }; },
		installCommittedProjectHistory() {},
		getProjectHistory() { return getHistory(); },
		markProjectSaved() {},
	};
}
