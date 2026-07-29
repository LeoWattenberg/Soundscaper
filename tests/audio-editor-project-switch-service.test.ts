/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	EditorControllerLifetime,
	EditorProjectGeneration,
	isEditorDisposedError,
} from '../src/common/editor/controller/lifecycle.ts';
import type {
	ProjectLifecycleHistory,
	ProjectLifecycleLock,
	ProjectLifecycleProject,
	ProjectLifecycleTab,
} from '../src/common/editor/controller/project-lifecycle-types.ts';
import {
	createProjectSwitchService,
	type ProjectSwitchServiceRuntime,
	type ProjectSwitchState,
} from '../src/common/editor/controller/project-switch-service.ts';
import {
	SCAPE_INSPECTION_TASK,
	createScapeInspectionService,
} from '../src/common/editor/controller/scape-inspection-service.ts';
import { createScapeInspectionQuiescence } from '../src/common/editor/controller/scape-inspection-quiescence.ts';
import { SCAPE_OPEN_REQUEST_TASK } from '../src/common/editor/controller/scape-open-request-service.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}

interface TestTrack {
	readonly id: string;
	readonly type: string;
	readonly name?: string;
}

interface TestProject extends ProjectLifecycleProject {
	readonly title: string;
	readonly sampleRate: number;
	readonly tracks: readonly TestTrack[];
	readonly clips: readonly Readonly<{ id: string }>[];
	readonly schemaVersion?: number;
	readonly featureRequirements?: unknown;
}

interface TestHistory extends ProjectLifecycleHistory<TestProject> {
	readonly present: TestProject;
}

type TestTab = ProjectLifecycleTab<TestProject, TestHistory>;

interface TestLock extends ProjectLifecycleLock {
	releases: number;
}

function project(
	id: string,
	tracks: readonly TestTrack[] = [{ id: `${id}-track`, type: 'audio' }],
): TestProject {
	return {
		id, title: id, sampleRate: 48_000, tracks, clips: [], schemaVersion: 9,
		featureRequirements: { schemaVersion: 1, requirements: [] },
	};
}

function lock(projectId: string, readOnly = false): TestLock {
	return {
		projectId,
		readOnly,
		method: 'test',
		releases: 0,
		release() { this.releases += 1; },
	};
}

function createFixture() {
	const lifetime = new EditorControllerLifetime();
	const projectGeneration = new EditorProjectGeneration();
	const scapeInspectionQuiescence = createScapeInspectionQuiescence();
	const oldProject = project('old-project');
	let currentProject: TestProject | null = oldProject;
	let createdSequence = 0;
	let migrationReadOnly = false;
	let acquire: (projectId: string) => Promise<ProjectLifecycleLock> = async (projectId) => lock(projectId);
	let loadSources: (value: TestProject) => Promise<unknown> = async () => undefined;
	const events: string[] = [];
	const statuses: Array<readonly [string, string]> = [];
	const assignedTracks: string[] = [];
	const revokedUrls: string[] = [];
	const readOnlyUpdates: Array<Readonly<Record<string, unknown>>> = [];
	const tabs = new Map<string, TestTab>([[oldProject.id, {
		projectId: oldProject.id,
		history: { present: oldProject },
		metadata: {},
		dirty: false,
	}]]);
	const initialLock = lock(oldProject.id);
	const state: ProjectSwitchState<TestProject, TestHistory> = {
		projectQueue: Promise.resolve(),
		projectLock: initialLock,
		readOnly: false,
		history: { present: oldProject },
		selectedTrackId: oldProject.tracks[0]?.id ?? null,
		selectedClipId: null,
		clipboard: null,
		rackEffectGestures: new Map([['old', {}]]),
		parametricEqGestures: new Map([['old', {}]]),
		videoEffectGestures: new Map([['old', {}]]),
		exportAbort: new AbortController(),
		sampleEditAbort: new AbortController(),
		sampleEditMode: 'pencil',
		sampleEditAvailable: true,
		audacityNoiseProfile: {},
		audacityControlTrackId: 'control',
		analysisResult: {},
		analysisVisuals: {},
		analysisReport: {},
		analysisProcessing: true,
		contrastSelections: { foreground: {}, background: {} },
		outputUrl: 'blob:old-output',
		outputCleanup: () => { events.push('output-cleanup'); },
		exportOutput: {},
		missingSourceIds: new Set(['missing']),
		saveState: 'dirty',
		projects: [],
	};
	const session = {
		captureProjectHistory(projectId: string) { const history = tabs.get(projectId)?.history; if (!history) throw new Error(`Missing history for ${projectId}.`); return { history, token: history }; },
		beginProjectActivation() { return { token: Object.freeze({}), release: () => true }; },
		switchProject(projectId: string) {
			events.push(`session-switch:${projectId}`);
		},
		openProject(value: TestProject, options: Parameters<ProjectSwitchServiceRuntime<TestProject, TestHistory>['session']['openProject']>[1]) {
			events.push(`session-open:${value.id}`);
			tabs.set(value.id, {
				projectId: value.id,
				history: options.history ?? { present: value },
				metadata: options.metadata,
				dirty: false,
			});
		},
		updateProjectMetadata(projectId: string, metadata: Readonly<Record<string, unknown>>) {
			const tab = tabs.get(projectId);
			if (!tab) return;
			tabs.set(projectId, { ...tab, metadata: { ...tab.metadata, ...metadata } });
		},
		setProjectReadOnly(projectId: string, update: Parameters<ProjectSwitchServiceRuntime<TestProject, TestHistory>['session']['setProjectReadOnly']>[1]) { readOnlyUpdates.push({ projectId, ...update }); },
		getProjectHistory(projectId: string) { const history = tabs.get(projectId)?.history; if (!history) throw new Error(`Missing session history for ${projectId}.`); return history; },
		clipboardForProject() { return { descriptor: { type: 'clip' } }; },
		markProjectSaved(projectId: string) { events.push(`marked-saved:${projectId}`); },
	};
	const runtime = {
		state,
		lifetime,
		projectGeneration,
		scapeInspectionQuiescence,
		productCapabilities: { audioEffects: true, videoEffects: false },
		copy: {
			ready: 'Ready',
			projectOpenOtherTab: 'Open elsewhere',
			projectReadOnly: 'Read-only',
			futureProjectReadOnly: 'Future project',
			untitledProject: 'Untitled',
			track: 'Track',
		},
		getProject: () => currentProject,
		setProject: (value: TestProject | null) => { currentProject = value; },
		createProject: ({ title, sampleRate }: Readonly<{ title: string; sampleRate: number }>) => ({
			id: `created-${++createdSequence}`, title, sampleRate, tracks: [], clips: [],
		}),
		normalizeProjectSampleRate: (value: unknown) => Number(value) || 48_000,
		createInitialAudioTrackCommand: (options: Readonly<Record<string, unknown>>) => ({
			...options, id: 'prepared-track',
		}),
		createHistory: (value: TestProject): TestHistory => ({ present: value }),
		executeCommand: (history: TestHistory, command: unknown): TestHistory => {
			const prepared = command as Readonly<{ id: string; type: string; name?: string }>;
			return { present: { ...history.present, tracks: [...history.present.tracks, prepared] } };
		},
		migrateProject: (value: unknown) => ({ project: value as TestProject, readOnly: migrationReadOnly }),
		verifyProjectFallbackIntegrity: () => ({ assertCurrent() {} }),
		assignPreferredInputToTrack: (trackId: string) => { assignedTracks.push(trackId); },
		cancelTimedRecording: () => { events.push('cancel-timed'); },
		cancelRecordingStart: () => { events.push('cancel-recording-start'); },
		cancelPlaybackCachePreparation: () => { events.push('cancel-cache'); },
		cancelPlayAtSpeedPreparation: () => { events.push('cancel-speed'); },
		stopRecording: async () => { events.push('stop-recording'); },
		persistActiveSessionUiState: () => { events.push('persist-session'); },
		saveNow: async () => { events.push('save-now'); },
		cancelScheduledSave: () => { events.push('cancel-save'); },
		stopEngine: () => { events.push('stop-engine'); },
		cancelEffectPreview: () => { events.push('cancel-preview'); },
		releaseProjectLock: async (value: ProjectLifecycleLock | null = state.projectLock) => {
			events.push('release-lock');
			if (!value) return;
			if (state.projectLock === value) state.projectLock = null;
			value.release();
			await Promise.resolve(value.finished);
		},
		acquireProjectLock: async (projectId: string) => {
			events.push(`acquire-lock:${projectId}`);
			return acquire(projectId);
		},
		watchProjectLockLoss: (projectId: string) => { events.push(`watch-lock:${projectId}`); },
		scheduleProjectLockRecovery: (projectId: string) => { events.push(`schedule-lock:${projectId}`); },
		sessionTab: (projectId: string) => tabs.get(projectId) ?? null,
		session,
		loadRecordingRouting: async (value: TestProject) => { events.push(`load-routing:${value.id}`); },
		findTrack: (value: TestProject, trackId: string | null | undefined) => (
			value.tracks.find((candidate) => candidate.id === trackId) ?? null
		),
		findClip: (value: TestProject, clipId: string | null | undefined) => (
			value.clips.find((candidate) => candidate.id === clipId) ?? null
		),
		revokeOutputUrl: (url: string) => { revokedUrls.push(url); },
		revokeVideoVisuals: () => { events.push('revoke-video'); },
		clearWaveformPcmWindows: () => { events.push('clear-waveform'); },
		loadProjectSources: async (value: TestProject) => {
			events.push(`load-sources:${value.id}`);
			await loadSources(value);
		},
		retainLiveClipIds: () => { events.push('retain-clips'); },
		evictUnreferencedSourceCaches: () => { events.push('evict-sources'); },
		loadEngineProject: (value: TestProject) => { events.push(`engine-load:${value.id}`); },
		recordOpenedProject: async (projectId: string, guard: <Value>(value: Value | PromiseLike<Value>) => Promise<Value>) => {
			await guard(Promise.resolve());
			events.push(`record-opened:${projectId}`);
		},
		saveProject: async (value: TestProject) => { events.push(`save-project:${value.id}`); },
		listProjects: async () => currentProject ? [currentProject] : [],
		synchronizeMicrophoneMeterTarget: () => { events.push('sync-meter'); },
		publishProjectState: () => { events.push('publish'); },
		garbageCollectSources: async () => { events.push('gc'); },
		setStatus: (message: string, status: 'error' | 'success') => { statuses.push([message, status]); },
		isDisposedError: (error: unknown) => isEditorDisposedError(error),
		clearSourceCaches: () => { events.push('clear-source-caches'); },
	} satisfies ProjectSwitchServiceRuntime<TestProject, TestHistory>;
	return {
		assignedTracks,
		events,
		initialLock,
		lifetime,
		projectGeneration,
		scapeInspectionQuiescence,
		readOnlyUpdates,
		revokedUrls,
		service: createProjectSwitchService(runtime),
		state,
		statuses,
		getProject: () => currentProject,
		getTabMetadata: (projectId: string) => tabs.get(projectId)?.metadata,
		setAcquire(value: typeof acquire) { acquire = value; },
		setLoadSources(value: typeof loadSources) { loadSources = value; },
		setMigrationReadOnly(value: boolean) { migrationReadOnly = value; },
	};
}

test('project activation resets scoped state and publishes only after sources are loaded', async () => {
	const fixture = createFixture();
	const nativeSave = fixture.lifetime.startTask('native-project-save');
	const next = project('next-project', [
		{ id: 'labels', type: 'label' },
		{ id: 'audio', type: 'audio' },
	]);

	await fixture.service.switchProject(next, { save: true });

	assert.equal(fixture.getProject(), next);
	assert.equal(fixture.state.selectedTrackId, 'audio');
	assert.equal(fixture.state.analysisResult, null);
	assert.equal(fixture.state.sampleEditMode, null);
	assert.equal(fixture.state.missingSourceIds.size, 0);
	assert.equal(fixture.state.outputUrl, null);
	assert.deepEqual(fixture.revokedUrls, ['blob:old-output']);
	assert.equal(fixture.initialLock.releases, 1);
	assert.ok(fixture.events.indexOf('load-sources:next-project') < fixture.events.indexOf('engine-load:next-project'));
	assert.ok(fixture.events.indexOf('engine-load:next-project') < fixture.events.indexOf('publish'));
	assert.ok(fixture.events.includes('save-now'));
	assert.ok(fixture.events.includes('save-project:next-project'));
	assert.equal(fixture.state.readOnly, false);
	assert.equal(fixture.getTabMetadata(next.id)?.featureRequirementsReport != null, true);
	assert.equal(nativeSave.signal.aborted, true);
	fixture.projectGeneration.assertCurrent(fixture.projectGeneration.capture('next-project'));
});

test('project activation aborts in-flight Scape ownership before a queued switch can start', async () => {
	const fixture = createFixture();
	const queueGate = deferred<void>();
	fixture.state.projectQueue = queueGate.promise;
	const inspection = fixture.lifetime.startTask(SCAPE_INSPECTION_TASK);
	const openRequest = fixture.lifetime.startTask(SCAPE_OPEN_REQUEST_TASK);
	inspection.signal.addEventListener('abort', () => { fixture.events.push('abort-inspection'); }, { once: true });
	openRequest.signal.addEventListener('abort', () => { fixture.events.push('abort-open-request'); }, { once: true });

	const switching = fixture.service.switchProject(project('next-project'));

	assert.equal(inspection.signal.aborted, true);
	assert.ok(inspection.signal.reason instanceof DOMException);
	assert.equal(inspection.signal.reason.name, 'AbortError');
	assert.equal(openRequest.signal.aborted, true);
	assert.ok(openRequest.signal.reason instanceof DOMException);
	assert.equal(openRequest.signal.reason.name, 'AbortError');
	assert.equal(fixture.events.includes('stop-recording'), false);
	queueGate.resolve();
	await switching;
	assert.ok(fixture.events.indexOf('abort-inspection') < fixture.events.indexOf('stop-recording'));
	assert.ok(fixture.events.indexOf('abort-open-request') < fixture.events.indexOf('stop-recording'));
});

test('project activation joins every superseded Scape inspection before project work', async () => {
	const fixture = createFixture();
	const firstStarted = deferred<void>();
	const secondStarted = deferred<void>();
	const firstCleanup = deferred<string>();
	const secondCleanup = deferred<string>();
	const signals: AbortSignal[] = [];
	let calls = 0;
	const inspection = createScapeInspectionService<string>({
		lifetime: fixture.lifetime,
		scapeInspectionQuiescence: fixture.scapeInspectionQuiescence,
		store: null,
		inspectScapeProject: async (_file, _store, options) => {
			const index = calls++;
			signals[index] = options.signal;
			if (index === 0) {
				firstStarted.resolve();
				return firstCleanup.promise;
			}
			secondStarted.resolve();
			return secondCleanup.promise;
		},
	});

	const first = inspection.inspect(new Blob(['first']));
	await firstStarted.promise;
	const firstRejected = assert.rejects(first, (error) => error === signals[0]?.reason);
	const second = inspection.inspect(new Blob(['second']));
	await secondStarted.promise;
	const secondRejected = assert.rejects(second, (error) => error === signals[1]?.reason);
	assert.equal(signals[0]?.aborted, true, 'replacement must synchronously cancel the older generation');

	const switching = fixture.service.switchProject(project('next-project'));
	assert.equal(signals[1]?.aborted, true, 'switch admission must synchronously cancel the current generation');
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(fixture.events.includes('stop-recording'), false);

	secondCleanup.resolve('late second result');
	await secondRejected;
	await Promise.resolve();
	assert.equal(
		fixture.events.includes('stop-recording'),
		false,
		'a superseded predecessor must remain joined after the current generation cleans up',
	);

	firstCleanup.resolve('late first result');
	await firstRejected;
	await switching;
	assert.ok(fixture.events.includes('stop-recording'));
});

test('direct project activation fences and joins Scape inspection cleanup', async () => {
	const fixture = createFixture();
	const started = deferred<void>();
	const cleanup = deferred<string>();
	const capture: { signal: AbortSignal | null } = { signal: null };
	const inspection = createScapeInspectionService<string>({
		lifetime: fixture.lifetime,
		scapeInspectionQuiescence: fixture.scapeInspectionQuiescence,
		store: null,
		inspectScapeProject: (_file, _store, options) => {
			capture.signal = options.signal;
			started.resolve();
			return cleanup.promise;
		},
	});
	const pending = inspection.inspect(new Blob(['direct']));
	await started.promise;
	const rejected = assert.rejects(pending, (error) => error === capture.signal?.reason);

	const switching = fixture.service.performProjectSwitch(project('direct-project'));
	assert.equal(capture.signal?.aborted, true);
	assert.ok(capture.signal?.reason instanceof DOMException);
	await Promise.resolve();
	assert.equal(fixture.events.includes('stop-recording'), false);

	cleanup.resolve('late result');
	await rejected;
	await switching;
	assert.ok(fixture.events.includes('stop-recording'));
	assert.equal(await inspection.inspect(new Blob(['after direct switch'])), 'late result');
});

test('Scape cleanup failure rejects activation before project work and releases its fence', async () => {
	const fixture = createFixture();
	const cleanupStarted = deferred<void>();
	const cleanupRelease = deferred<void>();
	const cleanupFailure = new AggregateError(
		[new Error('archive close failed')],
		'The .scape operation and archive-reader cleanup both failed.',
	);
	let calls = 0;
	const capture: { signal: AbortSignal | null } = { signal: null };
	const inspection = createScapeInspectionService<string>({
		lifetime: fixture.lifetime,
		scapeInspectionQuiescence: fixture.scapeInspectionQuiescence,
		store: null,
		inspectScapeProject: async (_file, _store, options) => {
			calls += 1;
			if (calls > 1) return 'inspection after failed switch';
			capture.signal = options.signal;
			await new Promise<void>((resolve) => {
				options.signal.addEventListener('abort', () => resolve(), { once: true });
			});
			cleanupStarted.resolve();
			await cleanupRelease.promise;
			throw cleanupFailure;
		},
	});
	const pending = inspection.inspect(new Blob(['cleanup failure']));
	const inspectionRejected = assert.rejects(pending, (error) => error === cleanupFailure);

	const switching = fixture.service.switchProject(project('blocked-project'));
	assert.equal(capture.signal?.aborted, true);
	await cleanupStarted.promise;
	await Promise.resolve();
	assert.equal(fixture.events.includes('stop-recording'), false);

	cleanupRelease.resolve();
	await inspectionRejected;
	await assert.rejects(switching, (error) => error === cleanupFailure);
	assert.equal(fixture.events.includes('stop-recording'), false);
	assert.equal(fixture.getProject()?.id, 'old-project');
	assert.equal(
		await inspection.inspect(new Blob(['after failed switch'])),
		'inspection after failed switch',
		'a failed quiescence drain must still release its temporary admission fence',
	);
});

test('queued project switches keep Scape inspection fenced until the last switch exits', async () => {
	const fixture = createFixture();
	const firstStarted = deferred<void>();
	const firstRelease = deferred<void>();
	const secondStarted = deferred<void>();
	const secondRelease = deferred<void>();
	fixture.setLoadSources(async (value) => {
		if (value.id === 'first') {
			firstStarted.resolve();
			await firstRelease.promise;
		}
		if (value.id === 'second') {
			secondStarted.resolve();
			await secondRelease.promise;
		}
	});
	let inspectionCalls = 0;
	const inspection = createScapeInspectionService<string>({
		lifetime: fixture.lifetime,
		scapeInspectionQuiescence: fixture.scapeInspectionQuiescence,
		store: null,
		inspectScapeProject: () => {
			inspectionCalls += 1;
			return 'accepted';
		},
	});
	const assertInspectionFenced = async () => {
		await assert.rejects(
			inspection.inspect(new Blob(['blocked'])),
			(error) => error instanceof DOMException && error.name === 'AbortError',
		);
		assert.equal(inspectionCalls, 0);
	};

	const first = fixture.service.switchProject(project('first'));
	await firstStarted.promise;
	const second = fixture.service.switchProject(project('second'));
	await assertInspectionFenced();

	firstRelease.resolve();
	await first;
	await assertInspectionFenced();
	await secondStarted.promise;
	await assertInspectionFenced();

	secondRelease.resolve();
	await second;
	assert.equal(await inspection.inspect(new Blob(['accepted'])), 'accepted');
	assert.equal(inspectionCalls, 1);
});

test('the project queue prevents a second activation from overlapping source loading', async () => {
	const fixture = createFixture();
	const firstGate = deferred<void>();
	const firstStarted = deferred<void>();
	fixture.setLoadSources(async (value) => {
		if (value.id !== 'first') return;
		firstStarted.resolve();
		await firstGate.promise;
	});

	const first = fixture.service.switchProject(project('first'));
	await firstStarted.promise;
	const second = fixture.service.switchProject(project('second'));
	await Promise.resolve();
	assert.equal(fixture.events.includes('acquire-lock:second'), false);

	firstGate.resolve();
	await Promise.all([first, second]);
	assert.deepEqual(
		fixture.events.filter((event) => event.startsWith('engine-load:')),
		['engine-load:first', 'engine-load:second'],
	);
	assert.equal(fixture.getProject()?.id, 'second');
});

test('a lock acquired after terminal disposal is released without activating the project', async () => {
	const fixture = createFixture();
	const acquired = deferred<ProjectLifecycleLock>();
	const acquisitionStarted = deferred<void>();
	const lateLock = lock('late-project');
	fixture.setAcquire(async () => {
		acquisitionStarted.resolve();
		return acquired.promise;
	});

	const activation = fixture.service.switchProject(project('late-project'));
	await acquisitionStarted.promise;
	fixture.lifetime.beginDisposal();
	acquired.resolve(lateLock);

	await assert.rejects(() => activation, { code: 'DISPOSED' });
	assert.equal(lateLock.releases, 1);
	assert.equal(fixture.getProject()?.id, 'old-project');
	assert.equal(fixture.events.includes('engine-load:late-project'), false);
	assert.ok(fixture.events.includes('clear-source-caches'));
});

test('new and migrated projects preserve preparation and read-only semantics', async () => {
	const fixture = createFixture();
	await fixture.service.newProject({ title: '   ', sampleRate: 44_100 });
	assert.deepEqual([fixture.getProject()?.title, fixture.getProject()?.sampleRate, fixture.getProject()?.tracks[0]?.name], ['Untitled', 44_100, 'Track 1']);
	assert.deepEqual(fixture.assignedTracks, ['prepared-track']);

	fixture.setMigrationReadOnly(true);
	const future = { ...project('future-project'), schemaVersion: 10,
		get featureRequirements(): never { throw new Error('future feature metadata was traversed'); } };
	await fixture.service.openProject(future);
	assert.equal(fixture.getProject(), future);
	assert.equal(fixture.state.readOnly, true);
	assert.equal(fixture.getTabMetadata(future.id)?.featureRequirementsReport, null);
	assert.deepEqual(fixture.statuses.at(-1), ['Future project', 'error']);
	await fixture.service.switchProject(project(future.id), { readOnly: false });
	assert.equal(fixture.getProject(), future);
	assert.equal(fixture.state.readOnly, true);
});

test('feature compatibility is reported and enforced before a project becomes editable', async () => {
	const fixture = createFixture();
	const next = { ...project('feature-project'), schemaVersion: 9, featureRequirements: { schemaVersion: 1, requirements: [{
			id: 'video-effects', featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects, displayName: 'Video effects', disposition: 'bypass', fallback: null,
		}],
	} };
	await fixture.service.switchProject(next, { save: true });
	const metadata = fixture.getTabMetadata(next.id);
	const report = metadata?.featureRequirementsReport as Readonly<Record<string, unknown>>;
	assert.equal(fixture.state.readOnly, true);
	assert.equal(report.compatible, false);
	assert.equal(metadata?.featureRequirementsReadOnly, true);
	assert.equal(fixture.events.includes('save-project:feature-project'), false);
	assert.deepEqual(fixture.statuses.at(-1), ['Read-only', 'error']);
	await fixture.service.switchProject(project(next.id));
	assert.equal(fixture.getProject(), next);
	assert.equal(fixture.state.readOnly, true);
	assert.equal((fixture.getTabMetadata(next.id)?.featureRequirementsReport as typeof report).compatible, false);
	const historyProject = { ...next, id: 'history-project', title: 'history-project' };
	await fixture.service.switchProject(project(historyProject.id), { history: { present: historyProject } });
	assert.deepEqual(fixture.getProject(), historyProject);
	assert.equal(fixture.state.readOnly, true);
});

test('malformed current feature metadata rejects before project activation side effects', async () => {
	const fixture = createFixture();
	const malformed = {
		...project('malformed-feature-project'), schemaVersion: 9,
		featureRequirements: { schemaVersion: 1, requirements: {} },
	};
	await assert.rejects(fixture.service.switchProject(malformed), /requirements must be an array/iu);
	assert.equal(fixture.getProject()?.id, 'old-project');
	assert.deepEqual(fixture.events, []);
});
