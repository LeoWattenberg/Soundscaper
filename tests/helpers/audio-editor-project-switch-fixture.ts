/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EditorControllerLifetime, EditorProjectGeneration, isEditorDisposedError } from '../../src/common/editor/controller/lifecycle.ts';
import type { ProjectLifecycleHistory, ProjectLifecycleLock, ProjectLifecycleProject, ProjectLifecycleTab } from '../../src/common/editor/controller/project-lifecycle-types.ts';
import { createProjectSwitchService, type ProjectSwitchServiceRuntime, type ProjectSwitchState } from '../../src/common/editor/controller/project-switch-service.ts';
import { createScapeInspectionQuiescence } from '../../src/common/editor/controller/scape-inspection-quiescence.ts';
import { SourceChunkProviderRegistry } from '../../src/common/editor/controller/source-chunk-provider-registry.ts';
import { PROJECT_SCHEMA_VERSION } from '../../src/common/editor/project-schema-identity.ts';

export function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined; const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}
interface TestTrack {
	readonly id: string; readonly type: string; readonly name?: string;
	readonly effectsActive?: boolean; readonly effects?: readonly Readonly<Record<string, unknown>>[];
}
interface TestProject extends ProjectLifecycleProject {
	readonly title: string; readonly sampleRate: number;
	readonly revision: number;
	readonly tracks: readonly TestTrack[]; readonly clips: readonly Readonly<{ id: string }>[];
	readonly schemaFamily?: 'soundscaper' | 'framescaper';
	readonly schemaVersion?: number; readonly featureRequirements?: unknown;
	readonly trackFolders?: readonly unknown[];
}
interface TestHistory extends ProjectLifecycleHistory<TestProject> { readonly present: TestProject; }
type TestTab = ProjectLifecycleTab<TestProject, TestHistory> & Readonly<{
	readOnly?: boolean;
	readOnlyReason?: string | null;
}>;
interface TestLock extends ProjectLifecycleLock { releases: number; }

export function project(id: string, tracks: readonly TestTrack[] = [{ id: `${id}-track`, type: 'audio' }]): TestProject {
	return {
		id, title: id, sampleRate: 48_000, revision: 0, tracks, clips: [], trackFolders: [],
		schemaFamily: 'soundscaper', schemaVersion: PROJECT_SCHEMA_VERSION,
		featureRequirements: { schemaVersion: 1, requirements: [] },
	};
}

export function lock(projectId: string, readOnly = false): TestLock {
	return {
		projectId,
		readOnly,
		method: 'test',
		releases: 0,
		release() { this.releases += 1; },
	};
}

export function createFixture(
	productCapabilities: Readonly<Record<string, unknown>> = { audioEffects: true, videoEffects: false },
	options: Readonly<{ createOnly?: boolean }> = {},
) {
	const lifetime = new EditorControllerLifetime();
	const projectGeneration = new EditorProjectGeneration();
	const scapeInspectionQuiescence = createScapeInspectionQuiescence();
	const oldProject = project('old-project');
	let currentProject: TestProject | null = oldProject;
	let createdSequence = 0;
	let loadReadOnly = false;
	let loadedEngineProject: TestProject | null = null;
	let acquire: (projectId: string) => Promise<ProjectLifecycleLock> = async (projectId) => lock(projectId);
	let loadSources: (value: TestProject) => Promise<unknown> = async () => undefined;
	let stopPreview = async (options: Readonly<{ dispose: true }>) => { assert.equal(options.dispose, true); await Promise.resolve(); events.push('stop-preview'); };
	let disposeRenderEngines = async () => { await Promise.resolve(); events.push('dispose-render-engines'); };
	let saveNow = async () => { events.push('save-now'); };
	let recoveryBlocked = false;
	const recoveryProjects = new Set<string>();
	const recoveryDeferred = new Map<string, Array<() => PromiseLike<unknown> | unknown>>();
	const events: string[] = [];
	const statuses: Array<readonly [string, string]> = [];
	const assignedTracks: string[] = [];
	const createdProjects: TestProject[] = [];
	const revokedUrls: string[] = [];
	const publishedProjectIds: Array<string | null> = [];
	const readOnlyUpdates: Array<Readonly<Record<string, unknown>>> = [];
	const sourceChunkProviders = new SourceChunkProviderRegistry<string, unknown>();
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
		setProjectReadOnly(projectId: string, update: Parameters<ProjectSwitchServiceRuntime<TestProject, TestHistory>['session']['setProjectReadOnly']>[1]) {
			readOnlyUpdates.push({ projectId, ...update });
			const tab = tabs.get(projectId);
			if (tab) tabs.set(projectId, { ...tab, readOnly: update.readOnly, readOnlyReason: update.reason });
		},
		getProjectHistory(projectId: string) { const history = tabs.get(projectId)?.history; if (!history) throw new Error(`Missing session history for ${projectId}.`); return history; },
		clipboardForProject() { return { descriptor: { type: 'clip' } }; },
		markProjectSaved(projectId: string) { events.push(`marked-saved:${projectId}`); },
	};
	const runtime = {
		state,
		lifetime,
		projectGeneration,
		scapeInspectionQuiescence,
		productCapabilities,
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
		createProject: ({ title, sampleRate, tracks = [] }: Readonly<{
			title: string; sampleRate: number; tracks?: readonly TestTrack[];
		}>) => ({
			id: `created-${++createdSequence}`, title, sampleRate, revision: 0, tracks, clips: [],
			trackFolders: [],
			schemaFamily: 'soundscaper' as const, schemaVersion: PROJECT_SCHEMA_VERSION,
			featureRequirements: { schemaVersion: 1, requirements: [] },
		}),
		normalizeProjectSampleRate: (value: unknown) => Number(value) || 48_000,
		createInitialAudioTrackCommand: (options: Readonly<Record<string, unknown>>) => ({
			type: 'track/add' as const,
			track: { ...options, id: 'prepared-track' } as TestTrack,
		}),
		createHistory: (value: TestProject): TestHistory => ({ present: value }),
		executeCommand: (history: TestHistory, command: unknown): TestHistory => {
			const prepared = (command as Readonly<{
				track: Readonly<{ id: string; type: string; name?: string }>;
			}>).track;
			return { present: {
				...history.present, revision: history.present.revision + 1,
				tracks: [...history.present.tracks, prepared],
			} };
		},
		loadProject: (value: unknown) => ({ project: value as TestProject, readOnly: loadReadOnly }),
		verifyProjectFallbackIntegrity: () => ({ assertCurrent() {} }),
		assignPreferredInputToTrack: (trackId: string) => { assignedTracks.push(trackId); },
		cancelTimedRecording: () => { events.push('cancel-timed'); },
		cancelRecordingStart: () => { events.push('cancel-recording-start'); },
		cancelPlaybackCachePreparation: () => { events.push('cancel-cache'); },
		cancelPlayAtSpeedPreparation: () => { events.push('cancel-speed'); },
		stopRecording: async () => { events.push('stop-recording'); },
		persistActiveSessionUiState: () => { events.push('persist-session'); },
		saveNow: () => saveNow(),
		cancelScheduledSave: () => { events.push('cancel-save'); },
		stopEngine: () => { events.push('stop-engine'); },
		stopProjectBinPreview: (options: Readonly<{ dispose: true }>) => stopPreview(options), disposeRenderEngines: () => disposeRenderEngines(),
		beginSourceChunkProviderReplacement: () => { events.push('begin-provider-replacement'); return sourceChunkProviders.beginReplacement(); },
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
		restoreProjectSelection: (value, metadata) => {
			state.selectedTrackId = value.tracks.find((candidate) => candidate.id === metadata.selectedTrackId)?.id
				?? value.tracks.find((candidate) => candidate.type !== 'label')?.id ?? value.tracks[0]?.id ?? null;
			state.selectedClipId = value.clips.find((candidate) => candidate.id === metadata.selectedClipId)?.id ?? null;
		},
		revokeOutputUrl: (url: string) => { revokedUrls.push(url); },
		revokeVideoVisuals: () => { events.push('revoke-video'); },
		clearWaveformPcmWindows: () => { events.push('clear-waveform'); },
		loadProjectSources: async (value: TestProject) => {
			events.push(`load-sources:${value.id}`);
			return loadSources(value).then(() => new Map());
		},
		prepareRequiredProjectSources: async () => assert.fail('fixture has no required fallback'), retainLiveClipIds: () => { events.push('retain-clips'); },
		evictUnreferencedSourceCaches: () => { events.push('evict-sources'); },
		loadEngineProject: (value: TestProject) => {
			loadedEngineProject = value;
			events.push(`engine-load:${value.id}`);
		},
		openRecovery: {
			get blocked() { return recoveryBlocked; },
			async inspectOpenedProject(projectId: string) {
				events.push(`inspect-recovery:${projectId}`);
				recoveryBlocked = recoveryProjects.has(projectId);
				return Object.freeze({ pending: recoveryBlocked });
			},
			deferRecordOpened: (operation: () => PromiseLike<unknown> | unknown) => deferRecovery('record', operation),
			deferInitialSave: (operation: () => PromiseLike<unknown> | unknown) => deferRecovery('save', operation),
			deferGarbageCollection: (operation: () => PromiseLike<unknown> | unknown) => deferRecovery('gc', operation),
			deferMaintenance: (operation: () => PromiseLike<unknown> | unknown) => deferRecovery('maintenance', operation),
		},
		recordOpenedProject: async (projectId: string, guard: <Value>(value: Value | PromiseLike<Value>) => Promise<Value>) => {
			await guard(Promise.resolve());
			events.push(`record-opened:${projectId}`);
		},
		maintainOpenedProject: async (projectId: string, isCurrentWritable: () => boolean) => {
			if (isCurrentWritable()) events.push(`maintain-opened:${projectId}`);
			throw new Error('planned report-only maintenance failure');
		},
		...(options.createOnly ? {
			createProjectIfAbsent: async (value: TestProject) => {
				events.push(`create-project:${value.id}`);
				createdProjects.push(structuredClone(value));
				return value;
			},
		} : {}),
		saveProject: async (value: TestProject) => { events.push(`save-project:${value.id}`); },
		listProjects: async () => currentProject ? [currentProject] : [],
		synchronizeMicrophoneMeterTarget: () => { events.push('sync-meter'); },
		publishProjectState: () => { events.push('publish'); publishedProjectIds.push(currentProject?.id ?? null); },
		garbageCollectSources: async () => { events.push('gc'); },
		setStatus: (message: string, status: 'error' | 'success') => { statuses.push([message, status]); },
		isDisposedError: (error: unknown) => isEditorDisposedError(error),
		clearSourceCaches: async () => { events.push('clear-source-caches'); sourceChunkProviders.clear(); await sourceChunkProviders.drain(); },
	} satisfies ProjectSwitchServiceRuntime<TestProject, TestHistory>;
	return {
		assignedTracks,
		createdProjects,
		events,
		initialLock,
		lifetime,
		projectGeneration,
		publishedProjectIds,
		scapeInspectionQuiescence,
		readOnlyUpdates,
		revokedUrls,
		service: createProjectSwitchService(runtime),
		state,
		statuses,
		getProject: () => currentProject,
		setProject(value: TestProject | null) { currentProject = value; },
		getLoadedEngineProject: () => loadedEngineProject,
		getTabMetadata: (projectId: string) => tabs.get(projectId)?.metadata,
		getTab: (projectId: string) => tabs.get(projectId) ?? null,
		getSourceChunkProvider: (sourceId: string) => sourceChunkProviders.get(sourceId),
		setSourceChunkProvider: (sourceId: string, provider: unknown) => { sourceChunkProviders.set(sourceId, provider); },
		setAcquire(value: typeof acquire) { acquire = value; },
		setLoadSources(value: typeof loadSources) { loadSources = value; },
		setStopPreview(value: typeof stopPreview) { stopPreview = value; }, setDisposeRenderEngines(value: typeof disposeRenderEngines) { disposeRenderEngines = value; },
		setSaveNow(value: typeof saveNow) { saveNow = value; },
		setLoadReadOnly(value: boolean) { loadReadOnly = value; },
		setRecoveryBlocked(value: boolean) { recoveryBlocked = value; },
		setPendingRecovery(projectId: string) { recoveryProjects.add(projectId); },
		async resolveRecovery() {
			recoveryBlocked = false;
			for (const kind of ['record', 'save', 'gc', 'maintenance']) {
				for (const operation of recoveryDeferred.get(kind) ?? []) await operation();
			}
			recoveryDeferred.clear();
		},
	};

	async function deferRecovery(
		kind: string,
		operation: () => PromiseLike<unknown> | unknown,
	): Promise<boolean> {
		if (!recoveryBlocked) { await operation(); return true; }
		const operations = recoveryDeferred.get(kind) ?? [];
		operations.push(operation);
		recoveryDeferred.set(kind, operations);
		events.push(`defer:${kind}`);
		return false;
	}
}
