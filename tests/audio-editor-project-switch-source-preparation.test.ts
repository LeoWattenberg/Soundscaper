/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
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
import { SourceChunkProviderRegistry } from '../src/common/editor/controller/source-chunk-provider-registry.ts';
import {
	createSourceLifecycleService,
	type SourceLifecycleServiceRuntime,
} from '../src/common/editor/controller/source-lifecycle-service.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-audio-rendered-fallback.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-video-rendered-fallback.ts';
import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
	createVideoClipV9,
	createVideoSourceV9,
	createVideoTrackV9,
	type AudioEditorProjectV9,
} from '../src/common/editor/project-v9.ts';

const FALLBACK_SOURCE_ID = 'fallback-source';

interface TestProject extends ProjectLifecycleProject {
	readonly clips: AudioEditorProjectV9['clips'];
	readonly sources: AudioEditorProjectV9['sources'];
	readonly featureRequirements: AudioEditorProjectV9['featureRequirements'];
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

test('a collision after long-fallback preparation leaves prior playback source state untouched', async () => {
	const fixture = createFixture({ collideDuringPreparation: true });

	const failure = await captureFailure(fixture.service.switchProject(fixture.incoming, { skipFlush: true }));

	assert.strictEqual(failure, fixture.reservationFailure);
	assert.ok(fixture.events.indexOf('source:provider:prepared') < fixture.events.indexOf('activation:begin'));
	assert.strictEqual(fixture.sourceBuffers.get(FALLBACK_SOURCE_ID), fixture.priorBuffer);
	assert.strictEqual(fixture.sourceChunkProviders.get(FALLBACK_SOURCE_ID), fixture.priorProvider);
	assert.deepEqual(fixture.chunkSourcePublications, []);
	assert.equal(fixture.preparedProviderDisposals(), 1);
	assert.equal(fixture.priorProviderDisposals(), 0);
});

test('successful activation applies staged inputs before publishing them after reservation and currentness', async () => {
	const fixture = createFixture();

	await fixture.service.switchProject(fixture.incoming, { skipFlush: true });

	const prepared = fixture.events.indexOf('source:provider:prepared');
	const current = fixture.events.indexOf('integrity:current:2');
	const reserved = fixture.events.indexOf('activation:begin');
	const commitCurrent = fixture.events.indexOf('integrity:current:4');
	const engineLoad = fixture.events.indexOf('engine:load');
	const publishedCurrent = fixture.events.indexOf('integrity:current:5');
	assert.ok(prepared >= 0 && prepared < current);
	assert.ok(current < reserved && reserved < commitCurrent);
	assert.ok(commitCurrent < engineLoad && engineLoad < publishedCurrent);
	assert.deepEqual(fixture.chunkSourcePublications, []);
	assert.strictEqual(
		fixture.loadedChunkSources()?.get(FALLBACK_SOURCE_ID),
		fixture.preparedProvider,
	);
	assert.strictEqual(fixture.sourceChunkProviders.get(FALLBACK_SOURCE_ID), fixture.preparedProvider);
	assert.equal(fixture.sourceBuffers.has(FALLBACK_SOURCE_ID), false);
	assert.equal(fixture.loadedProject()?.tracks[0]?.id, PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track);
	assert.equal(fixture.priorProviderDisposals(), 1);
	assert.equal(fixture.preparedProviderDisposals(), 0);
	assert.ok(engineLoad < fixture.events.indexOf('provider:prior:dispose'));
});

test('currentness failure before engine entry discards prepared provider identity', async () => {
	const fixture = createFixture({ failCurrentnessAt: 4 });

	const failure = await captureFailure(fixture.service.switchProject(fixture.incoming, { skipFlush: true }));

	assert.strictEqual(failure, fixture.currentnessFailure);
	assert.equal(fixture.events.includes('engine:load'), false);
	assert.strictEqual(fixture.sourceBuffers.get(FALLBACK_SOURCE_ID), fixture.priorBuffer);
	assert.strictEqual(fixture.sourceChunkProviders.get(FALLBACK_SOURCE_ID), fixture.priorProvider);
	assert.deepEqual(fixture.chunkSourcePublications, []);
	assert.equal(fixture.preparedProviderDisposals(), 1);
	assert.equal(fixture.priorProviderDisposals(), 0);
	assert.equal(fixture.events.filter((event) => event === 'engine:stop').length, 2);
	assert.ok(fixture.events.lastIndexOf('engine:stop') < fixture.events.indexOf('provider:replacement:rollback'));
});

test('currentness failure after engine return blocks prepared provider publication', async () => {
	const fixture = createFixture({ failCurrentnessAt: 5 });

	const failure = await captureFailure(fixture.service.switchProject(fixture.incoming, { skipFlush: true }));

	assert.strictEqual(failure, fixture.currentnessFailure);
	assert.equal(fixture.events.includes('engine:load'), true);
	assert.strictEqual(fixture.sourceBuffers.get(FALLBACK_SOURCE_ID), fixture.priorBuffer);
	assert.strictEqual(fixture.sourceChunkProviders.get(FALLBACK_SOURCE_ID), fixture.priorProvider);
	assert.deepEqual(fixture.chunkSourcePublications, []);
	assert.equal(fixture.preparedProviderDisposals(), 1);
	assert.equal(fixture.priorProviderDisposals(), 0);
	assert.equal(fixture.events.filter((event) => event === 'engine:stop').length, 3);
	const disposal = fixture.events.indexOf('provider:prepared:dispose');
	const retirement = fixture.events.lastIndexOf('engine:stop', disposal);
	assert.ok(fixture.events.indexOf('engine:load') < retirement && retirement < disposal);
	assert.ok(fixture.events.lastIndexOf('engine:stop') < fixture.events.indexOf('provider:replacement:rollback'));
});

test('failed activation releases its reservation and aggregates prepared-provider cleanup', async () => {
	const cleanupFailure = new Error('prepared provider cleanup failed');
	const fixture = createFixture({
		failCurrentnessAt: 4,
		preparedProviderDisposalFailure: cleanupFailure,
	});

	const failure = await captureFailure(fixture.service.switchProject(fixture.incoming, { skipFlush: true }));

	assert.ok(failure instanceof AggregateError);
	assert.deepEqual(failure.errors, [fixture.currentnessFailure, cleanupFailure]);
	assert.strictEqual(failure.cause, fixture.currentnessFailure);
	assert.equal(fixture.activationReleases(), 1);
	assert.strictEqual(fixture.sourceChunkProviders.get(FALLBACK_SOURCE_ID), fixture.priorProvider);
});

test('provider cleanup failure after engine commit keeps the new registry authoritative', async () => {
	const cleanupFailure = new Error('prior provider cleanup failed');
	const fixture = createFixture({ priorProviderDisposalFailure: cleanupFailure });

	const failure = await captureFailure(fixture.service.switchProject(fixture.incoming, { skipFlush: true }));

	assert.strictEqual(failure, cleanupFailure);
	assert.strictEqual(fixture.sourceChunkProviders.get(FALLBACK_SOURCE_ID), fixture.preparedProvider);
	assert.equal(fixture.priorProviderDisposals(), 1);
	assert.equal(fixture.preparedProviderDisposals(), 0);
	assert.equal(fixture.events.filter((event) => event === 'engine:stop').length, 1);
});

test('project activation loads a manifest-only video fallback before applying its preview projection', async () => {
	const incoming = videoRenderedFallbackProject('video-fallback-project');
	const fixture = createFixture({
		incoming,
		productCapabilities: { audioEffects: true, videoEffects: false },
	});

	await fixture.service.switchProject(incoming, { skipFlush: true });

	assert.deepEqual(fixture.activatedVideoSourceIds, ['original-video', 'fallback-video']);
	assert.equal(fixture.loadedProject()?.tracks[0]?.id, PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.track);
	assert.equal(fixture.loadedProject()?.clips[0]?.sourceId, 'fallback-video');
	assert.equal(
		(fixture.tabMetadata()?.featureRequirementsVideoRenderedFallback as
			Readonly<{ sourceId?: unknown }> | undefined)?.sourceId,
		'fallback-video',
	);
	assert.ok(fixture.events.indexOf('source:video:fallback-video') < fixture.events.indexOf('engine:load'));
});

function createFixture(options: Readonly<{
	collideDuringPreparation?: boolean;
	failCurrentnessAt?: number;
	incoming?: TestProject;
	priorProviderDisposalFailure?: Error;
	preparedProviderDisposalFailure?: Error;
	productCapabilities?: Readonly<Record<string, unknown>>;
}> = {}) {
	const incoming = options.incoming ?? renderedFallbackProject('incoming-project');
	const active = createAudioEditorProjectV9({ id: 'active-project' }) as unknown as TestProject;
	const lifetime = new EditorControllerLifetime();
	const events: string[] = [];
	const reservationFailure = new DOMException('The project history changed before activation.', 'AbortError');
	const currentnessFailure = new DOMException('Fallback admission became stale.', 'AbortError');
	const priorBuffer = Object.freeze({ id: 'prior-buffer' });
	let priorProviderDisposals = 0;
	let preparedProviderDisposals = 0;
	const priorProvider = Object.freeze({
		id: 'prior-provider',
		async dispose() {
			priorProviderDisposals += 1;
			events.push('provider:prior:dispose');
			if (options.priorProviderDisposalFailure) throw options.priorProviderDisposalFailure;
		},
	});
	const preparedProvider = Object.freeze({
		id: 'prepared-provider',
		async dispose() {
			preparedProviderDisposals += 1;
			events.push('provider:prepared:dispose');
			if (options.preparedProviderDisposalFailure) throw options.preparedProviderDisposalFailure;
		},
	});
	const sourceBuffers = new TestSourceBufferCache([[FALLBACK_SOURCE_ID, priorBuffer]]);
	const sourceChunkProviders = new SourceChunkProviderRegistry<string, unknown>([[FALLBACK_SOURCE_ID, priorProvider]]);
	const chunkSourcePublications: ReadonlyMap<string, unknown>[] = [];
	const tabs = new Map<string, ProjectLifecycleTab<TestProject, TestHistory>>();
	tabs.set(active.id, { projectId: active.id, history: { present: active }, metadata: {} });
	let currentProject: TestProject | null = active;
	let loadedProject: TestProject | null = null;
	let loadedChunkSources: ReadonlyMap<string, unknown> | null = null;
	let activeLock = lock(active.id);
	let activationToken: object | null = null;
	let activationReleases = 0;
	let currentnessChecks = 0;
	const activatedVideoSourceIds: string[] = [];

	const sourceLifecycle = createSourceLifecycleService({
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES: 2,
		MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES: 100,
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 16,
		activateVideoSource: async (source: Readonly<{ id: string }>) => {
			events.push(`source:video:${source.id}`);
			activatedVideoSourceIds.push(source.id);
		},
		allProjectClips: (project: TestProject) => project.clips,
		audioBufferChannels: () => [],
		clipSourceWindowRange: () => ({ startFrame: 0, endFrame: 0 }),
		clipWaveformPcmRequests: new Map(),
		clipWaveformPcmWindows: new Map(),
		copy: {},
		createStoredChunkProvider: () => {
			events.push('source:provider:prepared');
			return preparedProvider;
		},
		engine: {
			getAudioContext: async () => Object.freeze({}),
			setChunkSources(providers: ReadonlyMap<string, unknown>) {
				events.push('engine:chunk-sources');
				chunkSourcePublications.push(new Map(providers));
			},
		},
		findClip: () => null,
		findSource: () => null,
		generateStoredWaveformPeaks: async () => ({ levels: [] }),
		generateWaveformPeaks: async () => ({ levels: [] }),
		getProject: () => currentProject,
		isStreamableStoredSource: (source: Readonly<{ id: string }>) => source.id === FALLBACK_SOURCE_ID,
		legacyPeakCacheKey: (sourceId: string) => `legacy:${sourceId}`,
		peakCacheKey: (sourceId: string) => `peak:${sourceId}`,
		publishDocumentSnapshot: () => undefined,
		readStoredAudioBuffer: async (_store: unknown, source: Readonly<{
			frameCount: number;
			channelCount: number;
			sampleRate: number;
		}>) => Object.freeze({
			length: source.frameCount,
			numberOfChannels: source.channelCount,
			sampleRate: source.sampleRate,
			getChannelData: () => new Float32Array(source.frameCount),
		}),
		readWaveformPcmWindow: async () => [],
		setStatus: () => undefined,
		sourceAudioBufferBytes: () => 8,
		sourceBuffers,
		sourceChunkProviders,
		sourcePcmBytes: (source: Readonly<{ id: string }>) => source.id === FALLBACK_SOURCE_ID ? 32 : 8,
		sourcePeaks: new Map(),
		state: { missingSourceIds: new Set<string>() },
		store: {
			async getSourceMetadata(storageKey: string) {
				events.push(`source:metadata:${storageKey}`);
				const source = incoming.sources.find((candidate) => candidate.storageKey === storageKey);
				if (!source) return null;
				if (source.id === FALLBACK_SOURCE_ID && options.collideDuringPreparation) {
					tabs.set(incoming.id, {
						projectId: incoming.id,
						history: { present: incoming },
						metadata: {},
					});
				}
				return Object.freeze({
					frameCount: source.frameCount,
					channelCount: source.channelCount,
					sampleRate: source.sampleRate,
				});
			},
			readSourceChunk() {},
			loadAnalysis: async () => ({ levels: [] }),
			saveAnalysis: async () => undefined,
			deleteAnalysis: async () => undefined,
		},
		waveformPcmWindowContains: () => false,
		waveformPeaksHaveRms: () => true,
	} satisfies SourceLifecycleServiceRuntime);

	const state: ProjectSwitchState<TestProject, TestHistory> = {
		projectQueue: Promise.resolve(), projectLock: activeLock, readOnly: false,
		history: { present: active }, selectedTrackId: null, selectedClipId: null,
		clipboard: null, rackEffectGestures: new Map(), parametricEqGestures: new Map(),
		videoEffectGestures: new Map(), exportAbort: null, sampleEditAbort: null,
		sampleEditMode: null, sampleEditAvailable: false, audacityNoiseProfile: null,
		audacityControlTrackId: null, analysisResult: null, analysisVisuals: null,
		analysisReport: null, analysisProcessing: false,
		contrastSelections: { foreground: null, background: null }, outputUrl: null,
		outputCleanup: null, exportOutput: null, missingSourceIds: new Set(),
		saveState: 'saved', projects: [],
	};
	const session = {
		captureProjectHistory(projectId: string) {
			const history = tabs.get(projectId)?.history;
			if (!history) throw new Error(`Missing history for ${projectId}.`);
			return { history, token: history };
		},
		beginProjectActivation(projectId: string, activationOptions: Readonly<{
			expectedHistoryToken?: unknown;
			requireAbsent?: boolean;
		}>) {
			events.push('activation:begin');
			if (activationOptions.requireAbsent !== true || tabs.has(projectId)) throw reservationFailure;
			activationToken = Object.freeze({});
			return { token: activationToken, release: () => {
				activationReleases += 1;
				activationToken = null;
				return true;
			} };
		},
		switchProject() { throw new Error('Existing-tab activation is not expected.'); },
		openProject(project: TestProject, openOptions: Readonly<{
			activationToken?: unknown;
			history?: TestHistory;
			metadata: Readonly<Record<string, unknown>>;
		}>) {
			if (openOptions.activationToken !== activationToken) throw new Error('Missing activation token.');
			tabs.set(project.id, {
				projectId: project.id,
				history: openOptions.history ?? { present: project },
				metadata: openOptions.metadata,
			});
		},
		updateProjectMetadata() {}, setProjectReadOnly() {},
		getProjectHistory: (projectId: string) => tabs.get(projectId)?.history ?? { present: incoming },
		clipboardForProject: () => null, markProjectSaved() {},
	};
	const runtime = {
		state, productCapabilities: options.productCapabilities ?? { audioEffects: false, videoEffects: true },
		lifetime, scapeInspectionQuiescence: createScapeInspectionQuiescence(),
		projectGeneration: new EditorProjectGeneration(),
		copy: { ready: 'Ready', projectOpenOtherTab: 'Open elsewhere', projectReadOnly: 'Read-only',
			futureProjectReadOnly: 'Future project', untitledProject: 'Untitled', track: 'Track' },
		getProject: () => currentProject,
		setProject: (project: TestProject | null) => { currentProject = project; },
		createProject: () => active, normalizeProjectSampleRate: () => 48_000,
		createInitialAudioTrackCommand: () => ({}), createHistory: (project: TestProject) => ({ present: project }),
		executeCommand: (history: TestHistory) => history,
		migrateProject: (project: unknown) => ({ project: project as TestProject, readOnly: false }),
		verifyProjectFallbackIntegrity: () => ({
			assertCurrent() {
				currentnessChecks += 1;
				events.push(`integrity:current:${currentnessChecks}`);
				if (currentnessChecks === options.failCurrentnessAt) throw currentnessFailure;
			},
		}),
		assignPreferredInputToTrack: () => undefined, cancelTimedRecording: () => undefined,
		cancelRecordingStart: () => undefined, cancelPlaybackCachePreparation: () => undefined,
		cancelPlayAtSpeedPreparation: () => undefined, stopRecording: async () => undefined,
		persistActiveSessionUiState: () => undefined, saveNow: async () => undefined,
		cancelScheduledSave: () => undefined, stopEngine: () => { events.push('engine:stop'); },
		stopProjectBinPreview: async () => undefined,
		disposeRenderEngines: async () => undefined,
		beginSourceChunkProviderReplacement: () => {
			events.push('provider:replacement:begin');
			const replacement = sourceChunkProviders.beginReplacement();
			return Object.freeze({
				async commit() {
					events.push('provider:replacement:commit');
					await replacement.commit();
				},
				async rollback() {
					events.push('provider:replacement:rollback');
					await replacement.rollback();
				},
			});
		},
		cancelEffectPreview: () => undefined,
		releaseProjectLock: async () => { state.projectLock = null; },
		acquireProjectLock: async (projectId: string) => { activeLock = lock(projectId); return activeLock; },
		watchProjectLockLoss: () => undefined, scheduleProjectLockRecovery: () => undefined,
		sessionTab: (projectId: string) => tabs.get(projectId) ?? null, session,
		loadRecordingRouting: async () => undefined, findTrack: () => null, findClip: () => null,
		revokeOutputUrl: () => undefined, revokeVideoVisuals: () => undefined,
		clearWaveformPcmWindows: () => undefined,
		loadProjectSources: sourceLifecycle.loadProjectSources,
		prepareRequiredProjectSources: sourceLifecycle.prepareRequiredProjectSources,
		retainLiveClipIds: () => undefined, evictUnreferencedSourceCaches: () => undefined,
		loadEngineProject: (project: TestProject, _transient: unknown, preparedSources) => {
			events.push('engine:load');
			assert.strictEqual(sourceBuffers.get(FALLBACK_SOURCE_ID), priorBuffer);
			assert.equal(sourceChunkProviders.has(FALLBACK_SOURCE_ID), false);
			loadedChunkSources = preparedSources?.chunkSources ?? null;
			loadedProject = project;
		},
		recordOpenedProject: async () => undefined, maintainOpenedProject: async () => undefined, saveProject: async () => undefined,
		listProjects: async () => [], synchronizeMicrophoneMeterTarget: () => undefined,
		publishProjectState: () => undefined, garbageCollectSources: async () => undefined,
		setStatus: () => undefined, isDisposedError: () => false,
		clearSourceCaches: async () => {
			sourceChunkProviders.clear();
			await sourceChunkProviders.drain();
		},
	} satisfies ProjectSwitchServiceRuntime<TestProject, TestHistory>;
	return Object.freeze({
		incoming, events, reservationFailure, currentnessFailure, priorBuffer, priorProvider, preparedProvider,
		sourceBuffers, sourceChunkProviders, chunkSourcePublications, activatedVideoSourceIds,
		priorProviderDisposals: () => priorProviderDisposals,
		preparedProviderDisposals: () => preparedProviderDisposals,
		activationReleases: () => activationReleases,
		loadedProject: () => loadedProject, loadedChunkSources: () => loadedChunkSources,
		tabMetadata: () => tabs.get(incoming.id)?.metadata,
		service: createProjectSwitchService(runtime),
	});
}

function renderedFallbackProject(id: string): TestProject {
	const source = createAudioSourceV9({
		id: 'original-source', storageKey: 'original-source', frameCount: 4,
		channelCount: 2, sampleRate: 48_000,
	});
	const fallback = createAudioSourceV9({
		id: FALLBACK_SOURCE_ID, storageKey: FALLBACK_SOURCE_ID, frameCount: 6,
		channelCount: 2, sampleRate: 48_000,
	});
	const clip = createAudioClipV9({ id: 'original-clip', sourceId: source.id, durationFrames: 4 });
	const track = createAudioTrackV9({
		id: 'original-track', clipIds: [clip.id],
		effects: [createEffect('compressor', { id: 'effect-a' })],
	});
	return createAudioEditorProjectV9({
		id, now: '2026-07-30T12:00:00.000Z', sources: [source, fallback], clips: [clip], tracks: [track],
		featureRequirements: { schemaVersion: 1, requirements: [{
			id: 'publisher-render', featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
			displayName: 'Publisher render', disposition: 'rendered-fallback',
			fallback: { kind: 'audio', sourceId: fallback.id, sha256: 'ef'.repeat(32) },
		}] },
	}) as unknown as TestProject;
}

function videoRenderedFallbackProject(id: string): TestProject {
	const original = createVideoSourceV9({
		id: 'original-video', storageKey: 'original-video', frameCount: 4,
		sampleRate: 48_000, width: 1_920, height: 1_080, frameRate: 30,
	});
	const fallback = createVideoSourceV9({
		id: 'fallback-video', storageKey: 'fallback-video', frameCount: 6,
		sampleRate: 48_000, width: 1_280, height: 720, frameRate: 24,
	});
	const clip = createVideoClipV9({ id: 'original-video-clip', sourceId: original.id, durationFrames: 4 });
	const track = createVideoTrackV9({ id: 'original-video-track', clipIds: [clip.id] });
	return createAudioEditorProjectV9({
		id, now: '2026-08-01T12:00:00.000Z', sources: [original, fallback], clips: [clip], tracks: [track],
		featureRequirements: { schemaVersion: 1, requirements: [{
			id: 'publisher-video-render', featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
			displayName: 'Publisher video render', disposition: 'rendered-fallback',
			fallback: { kind: 'video', sourceId: fallback.id, sha256: 'ab'.repeat(32) },
		}] },
	}) as unknown as TestProject;
}

function lock(projectId: string): ProjectLifecycleLock {
	return { projectId, readOnly: false, method: 'test', release() {} };
}

async function captureFailure(value: PromiseLike<unknown>): Promise<unknown> {
	try { await value; return null; } catch (error) { return error; }
}
