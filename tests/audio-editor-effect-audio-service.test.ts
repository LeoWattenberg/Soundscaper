/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { EffectAudioProject } from '../src/common/editor/controller/effect-audio-service.ts';
import { createEffectControlsService } from '../src/common/editor/controller/effect-controls-service.ts';
import { createSelectionEffectExecutionService } from '../src/common/editor/controller/effect-execution-service.ts';
import {
	EditorControllerLifetime,
	EditorProjectGeneration,
	type EditorProjectToken,
} from '../src/common/editor/controller/lifecycle.ts';
import { projectGraphLatencyFramesV21 } from '../src/common/editor/engine/project-graph-v21.ts';
import {
	AUDIO_SELECTION_EFFECT_DEFINITIONS,
	createEffect,
	normalizeAudioSelectionEffectParams,
} from '../src/common/editor/effects.js';
import { projectTrackFolderMediaStateV12 } from '../src/common/editor/track-folder-media-runtime.ts';
import {
	estimateAudioSelectionEffectOutputFrames,
	estimateAudioSelectionEffectPeakBytes,
} from '../src/common/editor/selection-effects.js';
import {
	createHarness,
	deferred,
	folderedLegacyProject,
	v21RenderProject,
} from './audio-editor-effect-audio-service-fixture.ts';

test('dry rendering isolates the selected track, rack, mixer state, and clips', async () => {
	const harness = createHarness();
	await harness.service.renderDryTrackRange('track-a', 100, 200, 1, ['clip-a']);
	const snapshot = harness.snapshots[0]!;
	assert.deepEqual(snapshot.tracks.map((track) => track.id), ['track-a']);
	assert.deepEqual(snapshot.tracks[0]?.effects, []);
	assert.equal(snapshot.tracks[0]?.gain, 1);
	assert.deepEqual(snapshot.master.effects.map(({ id }) => id), ['master']);
	assert.equal(Object.hasOwn(snapshot.mixer, 'routes'), false);
	assert.deepEqual((snapshot.mixer as { groups: unknown[] }).groups, []);
	assert.deepEqual((snapshot.mixer as { sends: unknown[] }).sends, []);
});

test('authored track rendering preserves strip processing and only its V21 automation', async () => {
	const project = v21RenderProject();
	const harness = createHarness({ project: project as unknown as EffectAudioProject });
	await harness.service.renderDryTrackRange('track-a', 0, 8, 1, null, null, 'authored');
	const snapshot = harness.snapshots[0]! as EffectAudioProject & { automationLanes: unknown[] };
	assert.deepEqual(snapshot.tracks.map((track) => track.id), ['track-a']);
	assert.deepEqual(snapshot.tracks[0]?.effects?.map(({ id }) => id), ['before', 'noise']);
	assert.deepEqual(snapshot.automationLanes, project.automationLanes);
});

test('V21 dry rendering reaches the exact graph compiler without fabricating legacy authority', async () => {
	const project = v21RenderProject();
	const canonical = structuredClone(project);
	const persisted: unknown[] = [];
	const workerRequests: unknown[] = [];
	const harness = createHarness({
		project: project as unknown as EffectAudioProject,
		validateRenderSnapshot: (snapshot) => {
			assert.doesNotThrow(() => projectGraphLatencyFramesV21(snapshot as never, { includeMaster: false }));
		},
	});
	const state = {
		audacityEffectType: 'eq',
		audacityEffectParams: {},
		audacityEffectTouchedParams: new Map<string, Set<string>>(),
		audacityPreviewSource: null,
		audacityPreviewAuditionBandId: null,
		audacityPreviewGeneration: 0,
		audacityControlTrackId: null,
		audacityNoiseProfile: null,
		audacityEffectProcessing: false,
		effectPresets: { schemaVersion: 1 as const, presets: [] },
		lastAudacityEffect: null,
	};
	let applySelected = async (): Promise<unknown> => undefined;
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate(project.id);
	const controls = createEffectControlsService({
		state,
		copy: {
			audacitySelectionHint: 'Select audio', controlTrackNotFound: 'Missing control track',
			rackEffectNotFound: 'Missing rack effect', ready: 'Ready', selectionEffectUnsupported: 'Unsupported',
		},
		createId: (prefix) => `${prefix}-id`,
		getProject: () => project as never,
		persistSetting: async () => undefined,
		publishDocumentSnapshot: () => undefined,
		setStatus: () => undefined,
		applySelectedAudacityEffect: () => applySelected(),
		captureRackNoiseProfile: async () => undefined,
	});
	const execution = createSelectionEffectExecutionService({
		lifetime,
		captureProject: () => projectGeneration.capture(project.id),
		assertProject: (token: EditorProjectToken) => projectGeneration.assertCurrent(token),
		AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 1_000_000_000,
		AUDIO_SELECTION_EFFECT_DEFINITIONS,
		activeSelection: () => null,
		assertAudacityEffectOutput: () => undefined,
		audacityEffectMemoryError: () => new Error('Too large'),
		audacityEffectSelectionDetails: () => ({ trackIds: ['track-a'], clipIds: [], frequencyRange: null }),
		audacityEffectTargets: () => [harness.target],
		audacitySpectralEffectContext: () => null,
		copy: {
			audacityApplied: 'Applied', audacityProcessing: 'Processing', audacitySelectionHint: 'Select audio',
			autoDuckControlTrack: 'Select control track', effectChannelLayoutChanged: 'Channel layout changed',
			noiseProfileMissing: 'Capture noise profile',
		},
		currentAudacityEffectParams: controls.currentAudacityEffectParams,
		editingBlocked: () => false,
		estimateAudioSelectionEffectOutputFrames,
		estimateAudioSelectionEffectPeakBytes,
		getProject: () => project,
		normalizeAudioSelectionEffectParams,
		persistAudacityEffectResults: async (...args: unknown[]) => { persisted.push(args); },
		preflightStorage: async () => undefined,
		projectDurationFrames: () => 1_000,
		projectSampleRate: () => 48_000,
		publishDocumentSnapshot: () => undefined,
		renderDryTrackRange: harness.service.renderDryTrackRange,
		resolveInteractiveAudacityParams: controls.resolveInteractiveAudacityParams,
		runSelectionEffectWorker: async (request: Readonly<{
			effectType: string;
			channels: Float32Array[];
			params: Readonly<Record<string, unknown>>;
		}>) => {
			workerRequests.push(request);
			return { channels: request.channels.map((channel) => Float32Array.from(
				channel, (sample) => sample * Number(request.params.gain),
			)) };
		},
		setStatus: () => undefined,
		state,
	});
	applySelected = execution.applySelectedAudacityEffect;
	await controls.applyAudacityEffectFromController({
		type: 'reviewed-utility-gain', params: { gain: 1.25 },
	});

	const snapshot = harness.snapshots[0]!;
	assert.equal(workerRequests.length, 1);
	assert.equal((workerRequests[0] as { effectType: string }).effectType, 'reviewed-utility-gain');
	assert.equal(persisted.length, 1);
	assert.deepEqual(project, canonical);
	assert.deepEqual(snapshot.tracks.map(({ id }) => id), ['track-a']);
	assert.equal(Object.hasOwn(snapshot.tracks[0]!, 'envelope'), false);
	assert.deepEqual((snapshot as Readonly<Record<string, unknown>>).automationLanes, []);
	assert.deepEqual(snapshot.mixer, {
		schemaVersion: 1,
		groups: [], sends: [], cues: [], vcas: [],
		outputs: [{ id: 'main', name: 'Main output', role: 'main', channelCount: 2 }],
		edges: [
			{
				id: 'assignment:track:track-a:master', kind: 'assignment',
				source: { kind: 'track', id: 'track-a' }, destination: { kind: 'master' },
				position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1],
			},
			{
				id: 'assignment:master:output:main', kind: 'assignment',
				source: { kind: 'master' }, destination: { kind: 'output', id: 'main' },
				position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1],
			},
		],
	});
});

test('project switching during selection-effect persistence fences stale commit and publication', async () => {
	let project = { id: 'project-a' };
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate(project.id);
	const persistenceStarted = deferred<void>();
	const persistence = deferred<void>();
	const persistedProjects: string[] = [];
	const statuses: string[] = [];
	let publications = 0;
	const state = {
		audacityEffectType: 'audacity-invert',
		audacityEffectParams: {},
		audacityEffectTouchedParams: new Map<string, Set<string>>(),
		audacityPreviewSource: null,
		audacityPreviewAuditionBandId: null,
		audacityPreviewGeneration: 0,
		audacityControlTrackId: null,
		audacityNoiseProfile: null,
		audacityEffectProcessing: false,
		effectPresets: { schemaVersion: 1 as const, presets: [] },
		lastAudacityEffect: null,
	};
	const target = {
		track: { id: 'track-a', name: 'Track' },
		startFrame: 0,
		endFrame: 4,
		durationFrames: 4,
		channelCount: 1,
		hasAudio: true,
	};
	const execution = createSelectionEffectExecutionService({
		lifetime,
		captureProject: () => projectGeneration.capture(project.id),
		assertProject: (token: EditorProjectToken) => projectGeneration.assertCurrent(token),
		AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 1_000_000_000,
		AUDIO_SELECTION_EFFECT_DEFINITIONS,
		activeSelection: () => null,
		audacityEffectMemoryError: () => new Error('Too large'),
		audacityEffectSelectionDetails: () => ({ trackIds: ['track-a'], clipIds: [], frequencyRange: null }),
		audacityEffectTargets: () => [target],
		audacitySpectralEffectContext: () => null,
		copy: {
			audacityApplied: 'Applied', audacityProcessing: 'Processing', audacitySelectionHint: 'Select audio',
			autoDuckControlTrack: 'Select control track', effectChannelLayoutChanged: 'Channel layout changed',
			noiseProfileMissing: 'Capture noise profile',
		},
		currentAudacityEffectParams: () => ({}),
		editingBlocked: () => false,
		estimateAudioSelectionEffectOutputFrames,
		estimateAudioSelectionEffectPeakBytes,
		getProject: () => project,
		normalizeAudioSelectionEffectParams,
		persistAudacityEffectResults: async (
			_results: unknown,
			_type: unknown,
			options: Readonly<{ assertCurrent?: () => void }>,
		) => {
			persistenceStarted.resolve(undefined);
			await persistence.promise;
			options.assertCurrent?.();
			persistedProjects.push(project.id);
		},
		preflightStorage: async () => undefined,
		projectDurationFrames: () => 4,
		projectSampleRate: () => 1_000,
		publishDocumentSnapshot: () => { publications += 1; },
		renderDryTrackRange: async () => [new Float32Array([0.1, -0.2, 0.3, -0.4])],
		resolveInteractiveAudacityParams: (_type: unknown, params: unknown) => params,
		runSelectionEffectWorker: async (request: Readonly<{ channels: Float32Array[] }>) => ({
			channels: request.channels,
		}),
		setStatus: (message: string) => { statuses.push(message); },
		state,
	});

	const pending = execution.applySelectedAudacityEffect();
	await persistenceStarted.promise;
	const publicationsBeforeSwitch = publications;
	project = { id: 'project-b' };
	projectGeneration.invalidate();
	projectGeneration.activate(project.id);
	persistence.resolve(undefined);

	await assert.rejects(pending, { code: 'PROJECT_CHANGED' });
	assert.deepEqual(persistedProjects, []);
	assert.equal(publications, publicationsBeforeSwitch);
	assert.equal(state.lastAudacityEffect, null);
	assert.notEqual(statuses.at(-1), 'Applied');
	assert.equal(state.audacityEffectProcessing, false);
});

test('Framescaper baseline linked-audio dry rendering preserves shared production mixer authority', async () => {
	const project = { ...v21RenderProject(), schemaFamily: 'framescaper' as const, schemaVersion: 1 as const };
	const canonical = structuredClone(project);
	const harness = createHarness({
		project: project as unknown as EffectAudioProject,
		validateRenderSnapshot: (snapshot) => {
			assert.doesNotThrow(() => projectGraphLatencyFramesV21(snapshot as never, {
				includeMaster: false,
			}));
		},
	});

	await harness.service.renderDryTrackRange('track-a', 100, 200, 1, ['clip-a']);

	const snapshot = harness.snapshots[0]!;
	assert.deepEqual([snapshot.schemaFamily, snapshot.schemaVersion], ['framescaper', 1]);
	assert.equal(Object.hasOwn(snapshot.mixer, 'routes'), false);
	assert.deepEqual(project, canonical);
});

test('dry render completion is rejected after a project switch', async () => {
	const harness = createHarness({ deferRender: true });
	const pending = harness.service.renderDryTrackRange('track-a', 100, 200);
	harness.switchProject();
	harness.render.resolve({ channels: [new Float32Array([0.2])] });
	await assert.rejects(pending, { code: 'PROJECT_CHANGED' });
});

test('rack-prefix rendering excludes the profiled effect and always disposes its engine', async () => {
	const harness = createHarness();
	const channels = await harness.service.renderRackPrefixRange(
		{ id: 'noise', type: 'audacity-noise-reduction', params: {}, enabled: false },
		'track', 100, 4_100, 1, 'track-a',
	);
	assert.deepEqual(channels[0], new Float32Array([0.3]));
	assert.deepEqual(harness.snapshots[0]?.tracks[0]?.effects?.map((effect) => effect.id), ['before']);
	assert.equal(harness.prefixDisposals, 1);
});

test('V21 rack-prefix rendering reaches the exact graph compiler without legacy strip state', async () => {
	const project = v21RenderProject();
	const canonical = structuredClone(project);
	const effect = createEffect('audacity-noise-reduction', { id: 'noise', enabled: false });
	const harness = createHarness({ project: project as unknown as EffectAudioProject });
	await harness.service.renderRackPrefixRange(effect, 'track', 100, 4_100, 1, 'track-a');
	const snapshot = harness.snapshots[0]!;
	assert.doesNotThrow(() => projectGraphLatencyFramesV21(snapshot as never, { includeMaster: false }));
	assert.deepEqual(snapshot.tracks.map(({ id }) => id), ['track-a']);
	assert.deepEqual(snapshot.tracks[0]?.effects?.map(({ id }) => id), ['before']);
	assert.equal(Object.hasOwn(snapshot.tracks[0]!, 'envelope'), false);
	assert.equal(Object.hasOwn(snapshot.mixer, 'routes'), false);
	assert.deepEqual(project, canonical);
});

test('late noise-profile completion cannot mutate a replacement project', async () => {
	const harness = createHarness({ deferWorker: true });
	const pending = harness.service.captureSelectedNoiseProfile();
	await Promise.resolve();
	harness.switchProject();
	harness.worker.resolve({ profile: { bins: [1] } });
	await assert.rejects(pending, { code: 'PROJECT_CHANGED' });
	assert.equal(harness.state.audacityNoiseProfile, null);
	assert.equal(harness.state.audacityEffectProcessing, false);
	assert.notEqual(harness.statuses.at(-1), 'Profile ready');
});

test('selected noise-profile capture returns the serialized standalone profile', async () => {
	const harness = createHarness();
	const params = {
		reductionDb: 18, sensitivity: 7.5, frequencySmoothingBands: 4,
		output: 'reduce',
	};

	const profile = await harness.service.captureSelectedNoiseProfile(params);

	assert.deepEqual(profile, { serialized: { bins: [1, 2] } });
	assert.deepEqual(harness.noiseProfileWorkerParams, [params]);
	assert.deepEqual(harness.state.audacityNoiseProfile, { bins: [1, 2] });
	assert.equal(harness.statuses.at(-1), 'Profile ready');
});

test('rack noise profile commits once and spectral processing persists one atomic result', async () => {
	const harness = createHarness();
	await harness.service.captureRackNoiseProfile(
		{ id: 'noise', type: 'audacity-noise-reduction', params: {}, enabled: false },
		'track', 'track-a',
	);
	assert.equal(harness.commands.length, 1);
	assert.equal(await harness.service.applySpectralSelection(-6), true);
	assert.equal(harness.persisted.length, 1);
	assert.equal(harness.statuses.at(-1), 'Spectral applied');
});

test('spectral workflow preflights exact aggregate output and processes admitted targets sequentially', async () => {
	const harness = createHarness({ spectralTargetCount: 2 });

	assert.equal(await harness.service.applySpectralSelection(-6), true);

	assert.deepEqual(harness.preflightBytes, [32_000]);
	assert.equal(harness.snapshots.length, 2);
	assert.equal(harness.spectralWorkerCalls, 2);
	assert.equal(harness.persisted.length, 1);
	const results = (harness.persisted[0] as unknown[])[0] as Array<{
		channels: Float32Array[];
	}>;
	assert.equal(results.length, 2);
	assert.equal(results.every(({ channels }) => channels[0]?.length === 4_000), true);
});

test('project switching during spectral persistence fences stale commit and publication', async () => {
	const harness = createHarness({ deferPersistence: true });
	const pending = harness.service.applySpectralSelection(-6);
	await harness.persistenceStarted.promise;
	const publicationsBeforeSwitch = harness.publications;

	harness.switchProject();
	harness.persistence.resolve(undefined);

	await assert.rejects(pending, { code: 'PROJECT_CHANGED' });
	assert.equal(harness.persistenceCommits, 0);
	assert.equal(harness.publications, publicationsBeforeSwitch);
	assert.equal(harness.state.audacityEffectProcessing, false);
	assert.notEqual(harness.statuses.at(-1), 'Spectral applied');
});

test('aggregate spectral admission refuses before preflight, rendering, workers, persistence, or processing UI', async () => {
	const harness = createHarness({
		memoryLimitBytes: 210_304,
		spectralTargetCount: 2,
	});

	await assert.rejects(
		() => harness.service.applySpectralSelection(-6),
		(error: unknown) => (error as { code?: unknown }).code === 'SPECTRAL_EDIT_MEMORY_LIMIT'
			&& (error as { targetIndex?: unknown }).targetIndex === 1,
	);

	assert.deepEqual(harness.preflightBytes, []);
	assert.deepEqual(harness.snapshots, []);
	assert.equal(harness.spectralWorkerCalls, 0);
	assert.deepEqual(harness.persisted, []);
	assert.equal(harness.state.audacityEffectProcessing, false);
	assert.deepEqual(harness.statuses, []);
	assert.equal(harness.publications, 0);
});

test('spectral workflow rejects unexpected dry-render and worker output geometry before retention', async () => {
	const malformedRender = createHarness({ spectralRenderFrameDelta: -1 });
	await assert.rejects(
		() => malformedRender.service.applySpectralSelection(-6),
		/dry-render.*frame count/iu,
	);
	assert.equal(malformedRender.spectralWorkerCalls, 0);
	assert.deepEqual(malformedRender.persisted, []);

	const malformedWorker = createHarness({ spectralWorkerFrameDelta: -1 });
	await assert.rejects(
		() => malformedWorker.service.applySpectralSelection(-6),
		/result.*frame count/iu,
	);
	assert.equal(malformedWorker.spectralWorkerCalls, 1);
	assert.deepEqual(malformedWorker.persisted, []);
});

test('master-prefix rendering uses the mix path and engine setup failures still dispose', async () => {
	const harness = createHarness();
	const channels = await harness.service.renderRackPrefixRange(
		{ id: 'master', type: 'delay', params: {} }, 'master', 100, 200, 2,
	);
	assert.equal(channels.length, 2);
	assert.deepEqual(harness.snapshots[0]?.master.effects, []);
	assert.equal(harness.prefixDisposals, 1);

	const failing = createHarness({ loadFailure: true });
	await assert.rejects(
		() => failing.service.renderRackPrefixRange(
			{ id: 'noise', type: 'audacity-noise-reduction', params: {} },
			'track', 100, 200, 1, 'track-a',
		),
		/load failed/u,
	);
	assert.equal(failing.prefixDisposals, 1);
});

test('render and profile validation paths reject missing targets without leaking processing state', async () => {
	const harness = createHarness();
	await assert.rejects(() => harness.service.renderDryTrackRange('missing', 0, 10), /Track missing/u);
	await assert.rejects(
		() => harness.service.renderRackPrefixRange(
			{ id: 'missing', type: 'delay', params: {} }, 'track', 0, 10, 1, 'track-a',
		),
		/Effect missing/u,
	);
	harness.setSelection({ startFrame: 100, endFrame: 1_000, trackIds: ['track-a'] });
	await assert.rejects(
		() => harness.service.captureRackNoiseProfile(
			{ id: 'noise', type: 'audacity-noise-reduction', params: {} }, 'track', 'track-a',
		),
		/Too short/u,
	);
	assert.equal(harness.state.audacityEffectProcessing, false);
});

test('blocked and invalid spectral requests return before persistence while delete uses its stable label', async () => {
	const harness = createHarness();
	harness.state.audacityEffectProcessing = true;
	assert.equal(await harness.service.captureSelectedNoiseProfile(), null);
	assert.equal(await harness.service.applySpectralSelection(-6), null);
	harness.state.audacityEffectProcessing = false;
	await assert.rejects(() => harness.service.applySpectralSelection(121), /Bad spectral gain/u);
	assert.equal(await harness.service.applySpectralSelection(-Infinity), true);
	const options = (harness.persisted.at(-1) as unknown[])[2] as { effectName: string };
	assert.equal(options.effectName, 'Spectral delete');
});

test('dry rendering a foldered legacy project keeps a hierarchy the engine will load', async () => {
	// The snapshot narrows tracks to the render target while keeping the authored
	// folders and sequence nodes, so it has to carry the folder projection or the
	// engine rejects a hierarchy that names tracks the snapshot no longer has.
	const validated: unknown[] = [];
	const harness = createHarness({
		project: folderedLegacyProject() as unknown as EffectAudioProject,
		validateRenderSnapshot: (snapshot) => {
			assert.doesNotThrow(() => projectTrackFolderMediaStateV12(snapshot));
			validated.push(snapshot);
		},
	});
	await harness.service.renderDryTrackRange('voice', 0, 8, 1, null);
	assert.equal(validated.length, 1);
	const snapshot = harness.snapshots[0]!;
	assert.deepEqual(snapshot.tracks.map((track) => track.id), ['voice']);
});

test('master noise profiling commits a master-scoped effect update', async () => {
	const harness = createHarness();
	await harness.service.captureRackNoiseProfile(
		{ id: 'master', type: 'delay', params: {}, enabled: true }, 'master', null,
	);
	assert.equal((harness.commands[0] as { scope: string }).scope, 'master');
	assert.equal(harness.state.audacityEffectProcessing, false);
});

test('master noise profiling includes every authored output channel', async () => {
	const harness = createHarness({ masterChannels: 6 });
	await harness.service.captureRackNoiseProfile(
		{ id: 'master', type: 'audacity-noise-reduction', params: {}, enabled: false }, 'master', null,
	);
	assert.deepEqual(
		harness.noiseProfileWorkerChannels[0]?.map((channel) => channel[0]),
		[1, 2, 3, 4, 5, 6],
	);
});
