/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import {
	EditorControllerLifetime,
	EditorProjectGeneration,
	isEditorDisposedError,
} from '../src/common/editor/controller/lifecycle.ts';
import {
	createPlaybackProjectApplyService,
} from '../src/common/editor/controller/playback-project-service.ts';
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
import { createScapeInspectionQuiescence } from '../src/common/editor/controller/scape-inspection-quiescence.ts';
import {
	createSourceLifecycleService,
	type SourceLifecycleServiceRuntime,
} from '../src/common/editor/controller/source-lifecycle-service.ts';

interface TestSource {
	readonly id: string;
	readonly kind: 'audio';
	readonly storageKey: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
}

interface TestClip {
	readonly id: string;
	readonly kind: 'audio';
	readonly sourceId: string;
}

interface TestProject extends ProjectLifecycleProject {
	readonly clips: readonly TestClip[];
	readonly sources: readonly TestSource[];
}

interface TestHistory extends ProjectLifecycleHistory<TestProject> {
	readonly present: TestProject;
}

class TestSourceBufferCache extends Map<string, unknown> {
	setIfFits(sourceId: string, buffer: unknown): boolean {
		this.set(sourceId, buffer);
		return true;
	}
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return Object.freeze({ promise, resolve });
}

function project(id: string, withSource = false): TestProject {
	const source = Object.freeze({
		id: 'playback-source',
		kind: 'audio' as const,
		storageKey: 'playback-source',
		frameCount: 4,
		channelCount: 2,
		sampleRate: 48_000,
	});
	return Object.freeze({
		id,
		tracks: Object.freeze([{ id: `${id}-track`, type: 'audio' }]),
		clips: withSource
			? Object.freeze([{ id: 'playback-clip', kind: 'audio' as const, sourceId: source.id }])
			: Object.freeze([]),
		sources: withSource ? Object.freeze([source]) : Object.freeze([]),
	});
}

function lock(projectId: string): ProjectLifecycleLock {
	return { projectId, readOnly: false, method: 'test', release() {} };
}

test('project switching cancels signal-ignoring playback source readiness before teardown', async () => {
	const timeout = Symbol('timeout');
	const lifetime = new EditorControllerLifetime();
	const projectGeneration = new EditorProjectGeneration();
	const current = project('current-project', true);
	const next = project('next-project');
	let currentProject: TestProject | null = current;
	const events: string[] = [];
	const statuses: string[] = [];
	const appliedPlaybackProjects: string[] = [];
	const loadedSwitchProjects: string[] = [];
	const publishedProviderCounts: number[] = [];
	const sourceBuffers = new TestSourceBufferCache();
	const sourceChunkProviders = new Map<string, unknown>();
	const missingSourceIds = new Set<string>();
	const readinessStarted = deferred<void>();
	const metadataGate = deferred<Readonly<Record<string, unknown>>>();
	const decodedBuffer = Object.freeze({
		length: 4,
		numberOfChannels: 2,
		sampleRate: 48_000,
		getChannelData: () => new Float32Array(4),
	});
	let playbackApplied = false;
	const engine = {
		getAudioContext: async () => Object.freeze({ createBuffer() {} }),
		setChunkSources(providers: ReadonlyMap<string, unknown>) {
			publishedProviderCounts.push(providers.size);
		},
		getState: () => playbackApplied
			? { state: 'stopped', playbackMode: 'normal' }
			: { state: 'playing', playbackMode: 'staffpad' },
		applyProject(candidate: TestProject) {
			playbackApplied = true;
			appliedPlaybackProjects.push(candidate.id);
		},
	};
	const sourceLifecycle = createSourceLifecycleService({
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES: 2,
		MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES: 100,
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 16,
		activateVideoSource: async () => undefined,
		allProjectClips: (candidate: TestProject) => candidate.clips,
		audioBufferChannels: () => [],
		clipSourceWindowRange: (_clip: unknown, startFrame: number, endFrame: number) => ({ startFrame, endFrame }),
		clipWaveformPcmRequests: new Map(),
		clipWaveformPcmWindows: new Map(),
		copy: {},
		createStoredChunkProvider: () => Object.freeze({ id: 'late-provider' }),
		engine,
		findClip: () => null,
		findSource: () => null,
		generateStoredWaveformPeaks: async () => ({ levels: [] }),
		generateWaveformPeaks: async () => ({ levels: [] }),
		getProject: () => currentProject,
		isStreamableStoredSource: () => false,
		legacyPeakCacheKey: (sourceId: string) => `legacy:${sourceId}`,
		peakCacheKey: (sourceId: string) => `peak:${sourceId}`,
		publishDocumentSnapshot: () => undefined,
		readStoredAudioBuffer: async () => decodedBuffer,
		readWaveformPcmWindow: async () => [],
		setStatus: (message: unknown) => { statuses.push(String(message)); },
		sourceAudioBufferBytes: (buffer: typeof decodedBuffer) => buffer.length * buffer.numberOfChannels * 4,
		sourceBuffers,
		sourceChunkProviders,
		sourcePcmBytes: () => 8,
		sourcePeaks: new Map(),
		state: { missingSourceIds },
		store: {
			getSourceMetadata() {
				events.push('readiness:start');
				readinessStarted.resolve();
				return metadataGate.promise;
			},
			loadAnalysis: async () => null,
			saveAnalysis: async () => undefined,
			deleteAnalysis: async () => undefined,
		},
		waveformPcmWindowContains: () => false,
		waveformPeaksHaveRms: () => true,
	} satisfies SourceLifecycleServiceRuntime);

	let playbackSignal: AbortSignal | undefined;
	const playbackApply = createPlaybackProjectApplyService({
		lifetime,
		projectForPlayback: (candidate: TestProject) => Object.freeze({
			project: candidate,
			featureRequirementsReport: null,
			audioEffectPlaybackBypass: null,
			audioRenderedFallback: null,
			videoEffectPlaybackBypass: null,
			requiredAudioSourceIds: Object.freeze(['playback-source']),
		}),
		getCurrentProject: () => currentProject,
		ensureProjectSourcesAvailable: (candidate, options) => {
			playbackSignal = options.signal;
			playbackSignal?.addEventListener('abort', () => { events.push('playback:abort'); }, { once: true });
			return sourceLifecycle.ensureProjectSourcesAvailable(candidate, options);
		},
		sourceBuffers,
		sourceChunkProviders,
		engine,
		setReadyStatus: () => { statuses.push('Ready'); },
	});

	const tabs = new Map<string, ProjectLifecycleTab<TestProject, TestHistory>>([[
		current.id,
		{ projectId: current.id, history: { present: current }, metadata: {} },
	]]);
	const state: ProjectSwitchState<TestProject, TestHistory> = {
		projectQueue: Promise.resolve(),
		projectLock: lock(current.id),
		readOnly: false,
		history: { present: current },
		selectedTrackId: current.tracks[0]?.id ?? null,
		selectedClipId: null,
		clipboard: null,
		rackEffectGestures: new Map(),
		parametricEqGestures: new Map(),
		videoEffectGestures: new Map(),
		exportAbort: null,
		sampleEditAbort: null,
		sampleEditMode: null,
		sampleEditAvailable: false,
		audacityNoiseProfile: null,
		audacityControlTrackId: null,
		analysisResult: null,
		analysisVisuals: null,
		analysisReport: null,
		analysisProcessing: false,
		contrastSelections: { foreground: null, background: null },
		outputUrl: null,
		outputCleanup: null,
		exportOutput: null,
		missingSourceIds,
		saveState: 'saved',
		projects: [],
	};
	const switchRuntime: ProjectSwitchServiceRuntime<TestProject, TestHistory> = {
		state,
		productCapabilities: {},
		lifetime,
		scapeInspectionQuiescence: createScapeInspectionQuiescence(),
		projectGeneration,
		copy: {
			ready: 'Ready', projectOpenOtherTab: 'Open elsewhere', projectReadOnly: 'Read-only',
			futureProjectReadOnly: 'Future project', untitledProject: 'Untitled', track: 'Track',
		},
		getProject: () => currentProject,
		setProject: (candidate) => { currentProject = candidate; },
		createProject: () => project('created-project'),
		normalizeProjectSampleRate: (value) => Number(value) || 48_000,
		createInitialAudioTrackCommand: () => Object.freeze({}),
		createHistory: (candidate) => ({ present: candidate }),
		executeCommand: (history) => history,
		migrateProject: (value) => ({ project: value as TestProject, readOnly: false }),
		verifyProjectFallbackIntegrity: () => Object.freeze({ assertCurrent() {} }),
		assignPreferredInputToTrack: () => undefined,
		cancelTimedRecording: () => undefined,
		cancelRecordingStart: () => undefined,
		cancelPlaybackCachePreparation: () => undefined,
		cancelPlayAtSpeedPreparation: () => undefined,
		stopRecording: async () => { events.push('teardown:stop-recording'); },
		persistActiveSessionUiState: () => undefined,
		saveNow: async () => undefined,
		cancelScheduledSave: () => undefined,
		stopEngine: () => { events.push('teardown:stop-engine'); },
		cancelEffectPreview: () => undefined,
		releaseProjectLock: async (owned = state.projectLock) => {
			if (owned && state.projectLock === owned) state.projectLock = null;
			owned?.release();
		},
		acquireProjectLock: async (projectId) => lock(projectId),
		watchProjectLockLoss: () => undefined,
		scheduleProjectLockRecovery: () => undefined,
		sessionTab: (projectId) => tabs.get(projectId) ?? null,
		session: {
			captureProjectHistory(projectId) {
				const history = tabs.get(projectId)?.history;
				if (!history) throw new Error(`Missing project history for ${projectId}.`);
				return { history, token: history };
			},
			beginProjectActivation: () => ({ token: Object.freeze({}), release: () => true }),
			switchProject: () => undefined,
			openProject(candidate, options) {
				tabs.set(candidate.id, {
					projectId: candidate.id,
					history: options.history ?? { present: candidate },
					metadata: options.metadata,
				});
			},
			updateProjectMetadata(projectId, metadata) {
				const tab = tabs.get(projectId);
				if (tab) tabs.set(projectId, { ...tab, metadata: { ...tab.metadata, ...metadata } });
			},
			setProjectReadOnly: () => undefined,
			getProjectHistory(projectId) {
				const history = tabs.get(projectId)?.history;
				if (!history) throw new Error(`Missing project history for ${projectId}.`);
				return history;
			},
			clipboardForProject: () => null,
			markProjectSaved: () => undefined,
		},
		loadRecordingRouting: async () => undefined,
		findTrack: (candidate, trackId) => candidate.tracks.find((track) => track.id === trackId) ?? null,
		findClip: () => null,
		revokeOutputUrl: () => undefined,
		revokeVideoVisuals: () => undefined,
		clearWaveformPcmWindows: () => undefined,
		loadProjectSources: (candidate, options) => sourceLifecycle.loadProjectSources(candidate, options),
		retainLiveClipIds: () => undefined,
		evictUnreferencedSourceCaches: () => undefined,
		loadEngineProject: (candidate) => { loadedSwitchProjects.push(candidate.id); },
		recordOpenedProject: async () => undefined,
		saveProject: async () => undefined,
		listProjects: async () => currentProject ? [currentProject] : [],
		synchronizeMicrophoneMeterTarget: () => undefined,
		publishProjectState: () => undefined,
		garbageCollectSources: async () => undefined,
		setStatus: (message) => { statuses.push(message); },
		isDisposedError: (error) => isEditorDisposedError(error),
		clearSourceCaches: () => undefined,
	};
	const switchService = createProjectSwitchService(switchRuntime);

	const applying = playbackApply.apply(current);
	const terminal = applying.then(
		(value) => ({ kind: 'fulfilled' as const, value }),
		(error: unknown) => ({ kind: 'rejected' as const, error }),
	);
	await readinessStarted.promise;
	assert.ok(playbackSignal);
	const switching = switchService.switchProject(next, { skipFlush: true });
	const prompt = await Promise.race([
		terminal,
		delay(250, timeout, { ref: false }),
	]);
	const taskReason = playbackSignal.reason;
	metadataGate.resolve(Object.freeze({
		frameCount: 4,
		channelCount: 2,
		sampleRate: 48_000,
	}));
	const outcome = await terminal;
	await switching;
	await nextTurn();

	assert.notEqual(prompt, timeout, 'task cancellation must not await the signal-ignoring provider');
	assert.equal(outcome.kind, 'rejected');
	if (outcome.kind !== 'rejected') return;
	assert.strictEqual(outcome.error, taskReason);
	assert.ok(taskReason instanceof DOMException);
	assert.equal(taskReason.name, 'AbortError');
	assert.equal(taskReason.message, 'The editor task was superseded.');
	assert.ok(events.indexOf('playback:abort') < events.indexOf('teardown:stop-recording'));
	assert.deepEqual(loadedSwitchProjects, [next.id]);
	assert.deepEqual(appliedPlaybackProjects, []);
	assert.equal(sourceBuffers.size, 0);
	assert.equal(sourceChunkProviders.size, 0);
	assert.deepEqual(publishedProviderCounts, []);
	assert.equal(missingSourceIds.size, 0);
	assert.deepEqual(statuses, []);
});
