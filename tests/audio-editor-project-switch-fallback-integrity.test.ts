/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import type { PreparedProjectSourceInputs, PreparedRequiredProjectSources, SourceLifecycleLoadOptions } from '../src/common/editor/controller/source-lifecycle-service.ts';
import type { ProjectLifecycleHistory, ProjectLifecycleLock, ProjectLifecycleProject, ProjectLifecycleTab } from '../src/common/editor/controller/project-lifecycle-types.ts';
import { createProjectSwitchService, type ProjectSwitchServiceRuntime, type ProjectSwitchState } from '../src/common/editor/controller/project-switch-service.ts';
import { createScapeInspectionQuiescence } from '../src/common/editor/controller/scape-inspection-quiescence.ts';
import { SourceChunkProviderRegistry } from '../src/common/editor/controller/source-chunk-provider-registry.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-audio-rendered-fallback.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { createAudioClipV9, createAudioSourceV9, createAudioTrackV9 } from '../src/common/editor/project-v9.ts';

interface TestProject extends ProjectLifecycleProject {
	readonly marker: string;
	readonly tracks: readonly Readonly<{ id: string; type: string }>[];
	readonly clips?: readonly Readonly<{ sourceId: string }>[];
}
interface TestHistory extends ProjectLifecycleHistory<TestProject> {
	readonly present: TestProject;
}

interface FallbackIntegrityOptions {
	readonly signal?: AbortSignal;
}

interface FallbackIntegrityAdmission {
	assertCurrent(project: TestProject): void;
}

function preparedSourceLoad(): PreparedRequiredProjectSources {
	return Object.freeze({ async commit<Result>(apply: (inputs: PreparedProjectSourceInputs) => PromiseLike<Result> | Result, options: Readonly<{ assertCurrent?: () => void; transientBuffers?: ReadonlyMap<string, unknown> }> = {}) { const result = await apply(Object.freeze({ sourceBuffers: new Map([...(options.transientBuffers ?? []), ['fallback-source', 'prepared-buffer'] as const]), chunkSources: new Map() })); options.assertCurrent?.(); return result; }, discard() {} });
}

type FallbackIntegrityRuntime = ProjectSwitchServiceRuntime<TestProject, TestHistory> & Readonly<{
	verifyProjectFallbackIntegrity(
		project: TestProject,
		options: FallbackIntegrityOptions,
	): PromiseLike<FallbackIntegrityAdmission> | FallbackIntegrityAdmission;
}>;

interface FixtureOptions {
	readonly storedProject?: TestProject;
	readonly productCapabilities?: Readonly<Record<string, unknown>>;
	readonly verify: FallbackIntegrityRuntime['verifyProjectFallbackIntegrity'];
	readonly onStopRecording?: (replaceTabProject: (candidate: TestProject) => void) => void;
	readonly onLoadProjectSources?: (
		candidate: TestProject,
		options: SourceLifecycleLoadOptions,
	) => void;
}

test('raw project fallback verification rejects before activation side effects', async () => {
	const integrityFailure = new Error('Fallback integrity does not match the declared digest.');
	const fixture = createFixture({
		verify: async () => { throw integrityFailure; },
	});
	const incoming = project('incoming-project', 'incoming');

	const failure = await captureFailure(fixture.service.switchProject(incoming));

	assert.equal(failure, integrityFailure);
	assert.deepEqual(fixture.effects, ['verify:incoming']);
});

test('an existing tab verifies stored history with the controller lifetime signal', async () => {
	const integrityFailure = new Error('Stored fallback integrity failed.');
	const stored = project('shared-project', 'stored-present');
	const incoming = project(stored.id, 'ignored-incoming');
	const verifiedProjects: TestProject[] = [];
	let verifierSignal: AbortSignal | undefined;
	const fixture = createFixture({
		storedProject: stored,
		verify: async (candidate, options) => {
			verifiedProjects.push(candidate);
			verifierSignal = options.signal;
			throw integrityFailure;
		},
	});

	const failure = await captureFailure(fixture.service.switchProject(incoming));

	assert.equal(failure, integrityFailure);
	assert.equal(verifiedProjects[0]?.marker, stored.marker);
	assert.notEqual(verifiedProjects[0], stored);
	assert.notEqual(verifiedProjects[0], incoming);
	assert.equal(verifierSignal, fixture.lifetime.signal);
	assert.equal(verifierSignal?.aborted, false);
	assert.deepEqual(fixture.effects, ['verify:stored-present']);
});

test('explicit history present wins over the incoming project through activation', async () => {
	const incoming = project('history-project', 'ignored-incoming');
	const admitted = project(incoming.id, 'history-present');
	const verifiedProjects: TestProject[] = [];
	const fixture = createFixture({
		verify: (candidate) => {
			verifiedProjects.push(candidate);
			return admission(candidate);
		},
	});

	await fixture.service.switchProject(incoming, { history: { present: admitted } });

	assert.equal(verifiedProjects[0]?.marker, admitted.marker);
	assert.notEqual(verifiedProjects[0], admitted);
	assert.equal(fixture.currentProject()?.marker, admitted.marker);
	assert.ok(fixture.effects.includes('engine:load:history-project'));
});

test('requested history is detached before verification and activation', async () => {
	const incoming = project('drifting-history', 'ignored-incoming');
	const admitted = project(incoming.id, 'admitted-history');
	const history = { present: admitted };
	const fixture = createFixture({
		verify: (candidate) => {
			history.present = project(incoming.id, 'replaced-history');
			return admission(candidate);
		},
	});

	await fixture.service.switchProject(incoming, { history });

	assert.equal(fixture.currentProject()?.marker, 'admitted-history');
	assert.ok(fixture.effects.includes('verify:admitted-history'));
	assert.equal(fixture.effects.includes('verify:replaced-history'), false);
});

test('existing-tab drift during verification rejects before activation side effects', async () => {
	const admitted = project('early-drifting-tab', 'admitted-tab');
	let verificationStarted!: () => void;
	let releaseVerification!: () => void;
	const started = new Promise<void>((resolve) => { verificationStarted = resolve; });
	const release = new Promise<void>((resolve) => { releaseVerification = resolve; });
	const fixture = createFixture({
		storedProject: admitted,
		verify: async (candidate) => {
			verificationStarted();
			await release;
			return admission(candidate);
		},
	});
	const switching = fixture.service.switchProject(project(admitted.id, 'ignored'));
	await started;
	fixture.replaceTabProject(project(admitted.id, 'replaced-tab'));
	releaseVerification();

	const failure = await captureFailure(switching);

	assert.equal((failure as Error).name, 'AbortError');
	assert.deepEqual(fixture.effects, ['verify:admitted-tab']);
});

test('a tab appearing during verification cannot replace the admitted project', async () => {
	const admitted = project('appearing-tab', 'admitted-project');
	let verificationStarted!: () => void;
	let releaseVerification!: () => void;
	const started = new Promise<void>((resolve) => { verificationStarted = resolve; });
	const release = new Promise<void>((resolve) => { releaseVerification = resolve; });
	const fixture = createFixture({
		verify: async (candidate) => {
			verificationStarted();
			await release;
			return admission(candidate);
		},
	});
	const switching = fixture.service.switchProject(admitted);
	await started;
	fixture.addTabProject(project(admitted.id, 'unexpected-tab'));
	releaseVerification();

	const failure = await captureFailure(switching);

	assert.equal((failure as Error).name, 'AbortError');
	assert.deepEqual(fixture.effects, ['verify:admitted-project']);
});

test('an existing-tab mutation during teardown is rejected while activation completes', async () => {
	const admitted = project('drifting-tab', 'admitted-tab');
	const fixture = createFixture({
		storedProject: admitted,
		verify: (candidate) => admission(candidate),
		onStopRecording: (replaceTabProject) => {
			replaceTabProject(project(admitted.id, 'replaced-tab'));
		},
	});

	await fixture.service.switchProject(project(admitted.id, 'ignored'));

	assert.ok(fixture.effects.includes('recording:stop'));
	assert.ok(fixture.effects.includes('session:mutation-blocked:drifting-tab'));
	assert.ok(fixture.effects.includes('session:switch:drifting-tab'));
	assert.ok(fixture.effects.includes('sources:drifting-tab'));
	assert.equal(fixture.currentProject()?.marker, admitted.marker);
	assert.equal(fixture.effects.at(-1), 'activation:release:drifting-tab');
});

test('a post-reservation activation failure releases the project reservation', async () => {
	const admitted = project('failing-activation', 'admitted-tab');
	const activationFailure = new Error('Source loading failed.');
	const fixture = createFixture({
		storedProject: admitted,
		verify: (candidate) => admission(candidate),
		onLoadProjectSources: () => { throw activationFailure; },
	});

	const failure = await captureFailure(fixture.service.switchProject(project(admitted.id, 'ignored')));

	assert.equal(failure, activationFailure);
	assert.equal(fixture.effects.at(-1), `activation:release:${admitted.id}`);
	assert.doesNotThrow(() => fixture.replaceTabProject(project(admitted.id, 'after-failure')));
});

test('controller disposal aborts in-flight verification with the exact lifetime reason', async () => {
	let verificationStarted!: () => void;
	const started = new Promise<void>((resolve) => { verificationStarted = resolve; });
	const fixture = createFixture({
		verify: (_candidate, options) => new Promise<FallbackIntegrityAdmission>((_resolve, reject) => {
			verificationStarted();
			options.signal?.addEventListener('abort', () => { reject(options.signal?.reason); }, { once: true });
		}),
	});
	const switching = fixture.service.switchProject(project('dispose-project', 'dispose'));
	await started;

	fixture.lifetime.beginDisposal();
	const failure = await captureFailure(switching);

	assert.equal(failure, fixture.lifetime.signal.reason);
	assert.deepEqual(fixture.effects, ['verify:dispose']);
});

test('exact-current rendered fallback readiness rejects before activation side effects', async () => {
	const readinessFailure = new Error('Required rendered fallback source fallback-source has no stored metadata.');
	const incoming = renderedFallbackProject('unready-rendered-project', 'unready-rendered');
	const fixture = createFixture({
		productCapabilities: { audioEffects: false, videoEffects: true },
		verify: (candidate) => admission(candidate),
		onLoadProjectSources: () => { throw readinessFailure; },
	});
	const activeProject = fixture.currentProject()!;
	const activeTab = fixture.tabProject(activeProject.id);
	const activeLock = fixture.projectLock();

	const failure = await captureFailure(fixture.service.switchProject(incoming));

	assert.equal(failure, readinessFailure);
	assert.deepEqual(fixture.effects, ['verify:unready-rendered', 'sources:unready-rendered-project']);
	assert.strictEqual(fixture.currentProject(), activeProject);
	assert.strictEqual(fixture.tabProject(activeProject.id), activeTab);
	assert.equal(fixture.tabProject(incoming.id), null);
	assert.strictEqual(fixture.projectLock(), activeLock);
});

test('activation loads a required rendered source and sends only the transient whole-mix projection to the engine', async () => {
	const canonical = renderedFallbackProject('rendered-project', 'rendered');
	const readinessOptions: SourceLifecycleLoadOptions[] = [];
	const fixture = createFixture({
		productCapabilities: { audioEffects: false, videoEffects: true },
		verify: (candidate) => admission(candidate),
		onLoadProjectSources: (_candidate, options) => { if (options.requiredAudioSourceIds?.length) readinessOptions.push(options); },
	});

	await fixture.service.switchProject(canonical);

	assert.strictEqual(fixture.currentProject()?.tracks[0]?.id, 'original-track');
	assert.deepEqual(fixture.requiredAudioSourceIds(), ['fallback-source']);
	assert.deepEqual(readinessOptions[0]?.requiredAudioSourceIds, ['fallback-source']);
	assert.strictEqual(readinessOptions[0]?.signal, fixture.lifetime.signal);
	assert.equal(fixture.loadedEngineProject()?.tracks[0]?.id, PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track);
	assert.equal(fixture.loadedEngineProject()?.clips?.[0]?.sourceId, 'fallback-source');
	assert.equal(fixture.loadedTransientBuffers()?.get('fallback-source'), 'prepared-buffer');
	assert.equal(fixture.loadedTransientBuffers()?.get('ordinary-source'), 'ordinary-buffer');
	assert.ok(fixture.effects.indexOf('verify:rendered') < fixture.effects.indexOf('sources:rendered-project'));
	assert.ok(fixture.effects.indexOf('sources:rendered-project') < fixture.effects.indexOf('engine:load:rendered-project'));
});

function project(id: string, marker: string): TestProject {
	return Object.freeze({ id, marker, tracks: [] });
}

function renderedFallbackProject(id: string, marker: string): TestProject {
	const source = createAudioSourceV9({
		id: 'original-source', storageKey: 'original-source', frameCount: 4,
		channelCount: 2, sampleRate: 48_000,
	});
	const fallback = createAudioSourceV9({
		id: 'fallback-source', storageKey: 'fallback-source', frameCount: 6,
		channelCount: 2, sampleRate: 48_000,
	});
	const clip = createAudioClipV9({ id: 'original-clip', sourceId: source.id, durationFrames: 4 });
	const track = createAudioTrackV9({
		id: 'original-track', clipIds: [clip.id],
		effects: [createEffect('compressor', { id: 'effect-a' })],
	});
	return Object.freeze({
		...createCurrentAudioEditorProject({
			id, now: '2026-07-30T12:00:00.000Z',
			sources: [source, fallback], clips: [clip], tracks: [track],
			featureRequirements: { schemaVersion: 1, requirements: [{
				id: 'publisher-render', featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
				displayName: 'Publisher render', disposition: 'rendered-fallback',
				fallback: { kind: 'audio', sourceId: fallback.id, sha256: 'ef'.repeat(32) },
			}] },
		}),
		marker,
	}) as unknown as TestProject;
}

function admission(projectAtVerification: TestProject): FallbackIntegrityAdmission {
	return Object.freeze({
		assertCurrent(candidate: TestProject) {
			if (candidate.marker !== projectAtVerification.marker) {
				throw new DOMException('The project changed during fallback verification.', 'AbortError');
			}
		},
	});
}

function createFixture(options: FixtureOptions) {
	const effects: string[] = [];
	let loadedEngineProject: TestProject | null = null;
	let loadedTransientBuffers: ReadonlyMap<unknown, unknown> | null = null;
	let requiredAudioSourceIds: readonly string[] = [];
	const lifetime = new EditorControllerLifetime();
	const activeProject = project('active-project', 'active');
	let currentProject: TestProject | null = activeProject;
	let activeLock = createLock(activeProject.id);
	let activationReservation: Readonly<{
		projectId: string;
		historyToken: unknown;
		mode: 'absent' | 'existing';
		token: object;
	}> | null = null;
	const tabs = new Map<string, ProjectLifecycleTab<TestProject, TestHistory>>();
	const historyTokens = new Map<string, object>();
	tabs.set(activeProject.id, {
		projectId: activeProject.id,
		history: { present: activeProject },
		metadata: {},
	});
	historyTokens.set(activeProject.id, {});
	if (options.storedProject) {
		tabs.set(options.storedProject.id, {
			projectId: options.storedProject.id,
			history: { present: options.storedProject },
			metadata: {},
		});
		historyTokens.set(options.storedProject.id, {});
	}
	const state: ProjectSwitchState<TestProject, TestHistory> = {
		projectQueue: Promise.resolve(),
		projectLock: activeLock,
		readOnly: false,
		history: { present: activeProject },
		selectedTrackId: null,
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
		missingSourceIds: new Set<string>(),
		saveState: 'saved',
		projects: [],
	};
	const replaceTabProject = (candidate: TestProject) => {
		if (activationReservation?.projectId === candidate.id) {
			effects.push(`session:mutation-blocked:${candidate.id}`);
			throw new DOMException('The project is reserved for activation.', 'AbortError');
		}
		const tab = tabs.get(candidate.id);
		if (!tab) throw new Error(`Missing test tab for ${candidate.id}.`);
		tabs.set(candidate.id, { ...tab, history: { present: candidate } });
		historyTokens.set(candidate.id, {});
	};
	const addTabProject = (candidate: TestProject) => {
		tabs.set(candidate.id, { projectId: candidate.id, history: { present: candidate }, metadata: {} });
		historyTokens.set(candidate.id, {});
	};
	const session = {
		captureProjectHistory(projectId: string) {
			const tab = tabs.get(projectId);
			const token = historyTokens.get(projectId);
			if (!tab || !token) throw new Error(`Missing test tab for ${projectId}.`);
			return { history: structuredClone(tab.history), token };
		},
		beginProjectActivation(projectId: string, activationOptions: Readonly<{
			expectedHistoryToken?: unknown;
			requireAbsent?: boolean;
		}>) {
			const hasHistory = Object.hasOwn(activationOptions, 'expectedHistoryToken');
			if (activationReservation
				|| (hasHistory && historyTokens.get(projectId) !== activationOptions.expectedHistoryToken)
				|| (!hasHistory && (activationOptions.requireAbsent !== true || tabs.has(projectId)))) {
				throw new DOMException('The project history changed before activation.', 'AbortError');
			}
			const token = Object.freeze({});
			const reservation = Object.freeze({
				projectId,
				historyToken: hasHistory ? activationOptions.expectedHistoryToken : null,
				mode: hasHistory ? 'existing' as const : 'absent' as const,
				token,
			});
			activationReservation = reservation;
			effects.push(`activation:begin:${projectId}`);
			return Object.freeze({
				token,
				release() {
					if (activationReservation !== reservation) return false;
					activationReservation = null;
					effects.push(`activation:release:${projectId}`);
					return true;
				},
			});
		},
		switchProject(projectId: string, switchOptions: Readonly<{ activationToken?: unknown }> = {}) {
			if (activationReservation?.projectId !== projectId
				|| activationReservation.mode !== 'existing'
				|| activationReservation.token !== switchOptions.activationToken) {
				throw new DOMException('The project is not reserved for activation.', 'AbortError');
			}
			effects.push(`session:switch:${projectId}`);
		},
		openProject(
			candidate: TestProject,
			openOptions: Readonly<{
				activationToken?: unknown;
				history?: TestHistory;
				metadata: Readonly<Record<string, unknown>>;
			}>,
		) {
			if (activationReservation?.projectId !== candidate.id
				|| activationReservation.mode !== 'absent'
				|| activationReservation.token !== openOptions.activationToken
				|| tabs.has(candidate.id)) {
				throw new DOMException('The project is not reserved for activation.', 'AbortError');
			}
			effects.push(`session:open:${candidate.id}`);
			tabs.set(candidate.id, {
				projectId: candidate.id,
				history: openOptions.history ?? { present: candidate },
				metadata: openOptions.metadata,
			});
			historyTokens.set(candidate.id, {});
		},
		updateProjectMetadata(projectId: string) { effects.push(`session:metadata:${projectId}`); },
		setProjectReadOnly(projectId: string) { effects.push(`session:read-only:${projectId}`); },
		getProjectHistory(projectId: string) {
			const history = tabs.get(projectId)?.history;
			if (!history) throw new Error(`Missing test history for ${projectId}.`);
			return structuredClone(history);
		},
		clipboardForProject() { return null; },
		markProjectSaved() {},
	};
	const sourceChunkProviders = new SourceChunkProviderRegistry<string, unknown>();
	const runtime = {
		state,
		lifetime,
		scapeInspectionQuiescence: createScapeInspectionQuiescence(),
		productCapabilities: options.productCapabilities ?? {},
		projectGeneration: {
			invalidate() { effects.push('generation:invalidate'); },
			activate(projectId: string) { effects.push(`generation:activate:${projectId}`); },
		},
		verifyProjectFallbackIntegrity: (candidate: TestProject, verifyOptions: FallbackIntegrityOptions) => {
			effects.push(`verify:${candidate.marker}`);
			return options.verify(candidate, verifyOptions);
		},
		copy: {
			ready: 'Ready',
			projectOpenOtherTab: 'Open elsewhere',
			projectReadOnly: 'Read-only',
			futureProjectReadOnly: 'Future project',
			untitledProject: 'Untitled',
			track: 'Track',
		},
		getProject: () => currentProject,
		setProject: (candidate: TestProject | null) => {
			effects.push(`set-project:${candidate?.id ?? 'none'}`);
			currentProject = candidate;
		},
		createHistory: (candidate: TestProject) => ({ present: structuredClone(candidate) }),
		cancelTimedRecording: () => { effects.push('recording:cancel-timed'); },
		cancelRecordingStart: () => { effects.push('recording:cancel-start'); },
		cancelPlaybackCachePreparation: () => undefined,
		cancelPlayAtSpeedPreparation: () => undefined,
		stopRecording: async () => {
			effects.push('recording:stop');
			options.onStopRecording?.(replaceTabProject);
		},
		persistActiveSessionUiState: () => undefined,
		saveNow: async () => undefined,
		cancelScheduledSave: () => undefined,
		stopEngine: () => { effects.push('engine:stop'); },
		stopProjectBinPreview: async () => undefined,
		disposeRenderEngines: async () => undefined,
		beginSourceChunkProviderReplacement: () => sourceChunkProviders.beginReplacement(),
		cancelEffectPreview: () => undefined,
		releaseProjectLock: async () => {
			effects.push(`lock:release:${activeLock.projectId}`);
			activeLock.release();
			state.projectLock = null;
		},
		acquireProjectLock: async (projectId: string) => {
			effects.push(`lock:acquire:${projectId}`);
			activeLock = createLock(projectId);
			return activeLock;
		},
		watchProjectLockLoss: (projectId: string) => { effects.push(`lock:watch:${projectId}`); },
		scheduleProjectLockRecovery: (projectId: string) => { effects.push(`lock:recover:${projectId}`); },
		sessionTab: (projectId: string) => tabs.get(projectId) ?? null,
		session,
		loadRecordingRouting: async (candidate: TestProject) => {
			effects.push(`recording:routing:${candidate.id}`);
		},
		findTrack: () => null,
		findClip: () => null,
		revokeOutputUrl: () => undefined,
		revokeVideoVisuals: () => undefined,
		clearWaveformPcmWindows: () => undefined,
		loadProjectSources: async (candidate: TestProject, loadOptions: SourceLifecycleLoadOptions = {}) => {
			effects.push(`sources:${candidate.id}`); options.onLoadProjectSources?.(candidate, loadOptions);
			return new Map([['ordinary-source', 'ordinary-buffer']]);
		},
		prepareRequiredProjectSources: async (candidate: TestProject, loadOptions: SourceLifecycleLoadOptions) => {
			effects.push(`sources:${candidate.id}`); requiredAudioSourceIds = loadOptions.requiredAudioSourceIds ?? [];
			options.onLoadProjectSources?.(candidate, loadOptions);
			return preparedSourceLoad();
		},
		retainLiveClipIds: () => undefined,
		evictUnreferencedSourceCaches: () => undefined,
		loadEngineProject: (candidate: TestProject, transientBuffers?: unknown, preparedSources?: PreparedProjectSourceInputs) => {
			loadedEngineProject = candidate; loadedTransientBuffers = preparedSources?.sourceBuffers ?? transientBuffers as ReadonlyMap<unknown, unknown>;
			effects.push(`engine:load:${candidate.id}`);
		},
		recordOpenedProject: async (projectId: string) => { effects.push(`session:record:${projectId}`); },
		maintainOpenedProject: async () => undefined,
		saveProject: async () => undefined,
		listProjects: async () => [],
		synchronizeMicrophoneMeterTarget: () => undefined,
		publishProjectState: () => { effects.push('session:publish'); },
		garbageCollectSources: async () => undefined,
		setStatus: () => undefined,
		isDisposedError: () => false,
		clearSourceCaches: async () => {
			sourceChunkProviders.clear();
			await sourceChunkProviders.drain();
		},
	} as unknown as FallbackIntegrityRuntime;
	return Object.freeze({
		effects,
		lifetime,
		currentProject: () => currentProject,
		projectLock: () => state.projectLock,
		tabProject: (projectId: string) => tabs.get(projectId)?.history.present ?? null,
		loadedEngineProject: () => loadedEngineProject,
		loadedTransientBuffers: () => loadedTransientBuffers,
		requiredAudioSourceIds: () => requiredAudioSourceIds,
		addTabProject,
		replaceTabProject,
		service: createProjectSwitchService(runtime),
	});
}

function createLock(projectId: string): ProjectLifecycleLock {
	return { projectId, readOnly: false, method: 'test', release() {} };
}

async function captureFailure(value: PromiseLike<unknown>): Promise<unknown> {
	try {
		await value;
		return null;
	} catch (error) {
		return error;
	}
}
