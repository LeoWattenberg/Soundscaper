/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEffectAudioService,
	type EffectAudioProject,
	type EffectAudioState,
} from '../src/common/editor/controller/effect-audio-service.ts';
import { createEffectControlsService } from '../src/common/editor/controller/effect-controls-service.ts';
import { createSelectionEffectExecutionService } from '../src/common/editor/controller/effect-execution-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import type { EffectTarget } from '../src/common/editor/controller/effect-selection-service.ts';
import { projectGraphLatencyFramesV21 } from '../src/common/editor/engine/project-graph-v21.ts';
import {
	AUDIO_SELECTION_EFFECT_DEFINITIONS,
	createEffect,
	normalizeAudioSelectionEffectParams,
} from '../src/common/editor/effects.js';
import { createAudioClipV10, createAudioSourceV10, createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { projectTrackFolderMediaStateV12 } from '../src/common/editor/track-folder-media-runtime.ts';
import {
	estimateAudioSelectionEffectOutputFrames,
	estimateAudioSelectionEffectPeakBytes,
} from '../src/common/editor/selection-effects.js';
import type { SoundscaperProductionDialogOperation } from '../src/common/editor/ui/dialogs/SoundscaperProductionDialog.tsx';
import {
	executeSoundscaperProductionOperation,
	type SoundscaperProductionControllerPort,
} from '../src/common/editor/ui/workspace/useSoundscaperProductionWorkspace.ts';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';

function deferred<Value>() {
	let resolve: (value: Value) => void = () => undefined;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve };
}

function createHarness(options: Readonly<{
	deferRender?: boolean;
	deferPersistence?: boolean;
	deferWorker?: boolean;
	loadFailure?: boolean;
	memoryLimitBytes?: number;
	project?: EffectAudioProject;
	spectralRenderFrameDelta?: number;
	spectralTargetCount?: 1 | 2;
	spectralWorkerFrameDelta?: number;
	validateRenderSnapshot?: (project: EffectAudioProject) => void;
}> = {}) {
	let project: EffectAudioProject = options.project ?? {
		id: 'project-a', schemaVersion: 5, sampleRate: 48_000,
		tracks: [
			{
				id: 'track-a', name: 'A', type: 'audio', clipIds: ['clip-a'], gain: 0.5, pan: 0.2,
				mute: true, solo: true, envelope: [{ frame: 0 }], spectrogram: { windowSize: 2_048 },
				effects: [
					{ id: 'before', type: 'delay', params: {}, enabled: true },
					{ id: 'noise', type: 'audacity-noise-reduction', params: {}, enabled: false },
				],
			},
			{ id: 'track-b', name: 'B', type: 'audio', clipIds: [], effects: [] },
		],
		clips: [{
			id: 'clip-a', kind: 'audio', sourceId: 'source-a', title: 'Clip',
			timelineStartFrame: 100, sourceStartFrame: 0, sourceDurationFrames: 4_000, durationFrames: 4_000,
		}],
		selection: {
			startFrame: 100, endFrame: 4_100, trackIds: ['track-a'], clipIds: ['clip-a'],
			frequencyRange: { minimumFrequency: 80, maximumFrequency: 4_000 },
		},
		master: { gain: 0.8, effects: [{ id: 'master', type: 'delay', params: {} }] },
		mixer: { groups: [{ id: 'group' }], sends: [{ id: 'send' }], routes: { 'track-a': {} } },
	};
	const state: EffectAudioState = {
		selectedTrackId: 'track-a',
		selectedClipId: 'clip-a',
		audacityEffectProcessing: false,
		audacityNoiseProfile: null,
	};
	const target: EffectTarget = {
		track: project.tracks[0]!, clipId: 'clip-a', clipIds: ['clip-a'],
		startFrame: 100, endFrame: 4_100, durationFrames: 4_000, channelCount: 1, hasAudio: true,
	};
	const spectralTargets: EffectTarget[] = [target];
	if (options.spectralTargetCount === 2) {
		spectralTargets.push({
			track: project.tracks[1]!, startFrame: 100, endFrame: 4_100,
			durationFrames: 4_000, channelCount: 1, hasAudio: true,
		});
	}
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate(project.id);
	const render = deferred<Readonly<{ channels: readonly Float32Array[] }>>();
	const persistence = deferred<void>();
	const persistenceStarted = deferred<void>();
	const worker = deferred<Readonly<{ profile: unknown }>>();
	const snapshots: EffectAudioProject[] = [];
	const commands: unknown[] = [];
	const persisted: unknown[] = [];
	const preflightBytes: number[] = [];
	const statuses: string[] = [];
	let publications = 0;
	let persistenceCommits = 0;
	let prefixDisposals = 0;
	let spectralWorkerCalls = 0;
	const service = createEffectAudioService({
		lifetime,
		captureProject: () => projectGeneration.capture(project.id),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		state,
		copy: {
			audacityApplied: 'Applied', audacityProcessing: 'Processing', audacityProfileProcessing: 'Profiling',
			audacitySelectionHint: 'Select audio', audioTrackNotFound: 'Track missing', effectProcessingFailed: 'Failed',
			noiseProfileMinimumSamples: 'Too short', noiseProfileReady: 'Profile ready', rackEffectNotFound: 'Effect missing',
			spectralAmplify: 'Spectral amplify', spectralApplied: 'Spectral applied', spectralDelete: 'Spectral delete',
			spectralGainInvalid: 'Bad spectral gain', spectralProcessing: 'Spectral processing',
			spectralSelectionRequired: 'Select spectrum', v2Required: 'Version 2 required',
		},
		memoryLimitBytes: options.memoryLimitBytes ?? 1_000_000_000,
		getProject: () => project as never,
		activeSelection: () => project.selection ?? null,
		audacityEffectTarget: () => target,
		audacityEffectTargets: () => spectralTargets,
		audacityEffectSelectionDetails: (selection, targets) => ({
			trackIds: selection?.trackIds ?? targets.map((entry) => entry.track.id),
			clipIds: targets.flatMap((entry) => entry.clipId ? [entry.clipId] : []),
			frequencyRange: selection?.frequencyRange ?? null,
		}),
		editingBlocked: () => state.audacityEffectProcessing,
		projectSampleRate: () => project.sampleRate,
		currentAudacityEffectParams: () => ({}),
		estimateAudacityEffectPeakBytes: () => 1,
		audacityEffectMemoryError: () => new Error('Too large'),
		preflightStorage: async (bytes) => { preflightBytes.push(bytes); },
		cloneProject: (value) => structuredClone(value),
		audacitySelectionChannelCount: () => 1,
		renderSnapshot: async (snapshot, renderOptions) => {
			snapshots.push(structuredClone(snapshot));
			options.validateRenderSnapshot?.(snapshot);
			const outputFrames = Number(renderOptions.outputFrames) + (options.spectralRenderFrameDelta ?? 0);
			return options.deferRender ? render.promise : { channels: [new Float32Array(outputFrames)] };
		},
		prepareCommittedTimePitchCaches: async () => undefined,
		createRenderEngine: () => ({
			loadProject: (snapshot) => {
				snapshots.push(structuredClone(snapshot));
				if (options.loadFailure) throw new Error('load failed');
			},
			renderTrack: async () => ({ channels: [new Float32Array([0.3])] }),
			renderMix: async () => ({ channels: [new Float32Array([0.3]), new Float32Array([0.3])] }),
			dispose: async () => { prefixDisposals += 1; },
		}),
		sourceBuffers: new Map(),
		audioBufferChannels: (buffer) => [...buffer.channels ?? []],
		matchAudacitySelectionChannels: (channels, channelCount) => channels.slice(0, channelCount),
		runSelectionEffectWorker: async () => options.deferWorker
			? worker.promise
			: { profile: { bins: [1, 2] } },
		runSpectralEditWorker: async (channels) => {
			spectralWorkerCalls += 1;
			return channels.map((channel) => new Float32Array(
				channel.length + (options.spectralWorkerFrameDelta ?? 0),
			));
		},
		serializeNoiseProfile: (profile) => ({ serialized: profile }),
		commit: (command) => { commands.push(command); },
		persistAudacityEffectResults: async (...args) => {
			persisted.push(args);
			if (options.deferPersistence) {
				persistenceStarted.resolve(undefined);
				await persistence.promise;
			}
			const persistenceOptions = args[2] as Readonly<{ assertCurrent?: () => void }>;
			persistenceOptions.assertCurrent?.();
			persistenceCommits += 1;
		},
		setStatus: (message) => { statuses.push(message); },
		publishDocumentSnapshot: () => { publications += 1; },
	});
	return {
		commands,
		get prefixDisposals() { return prefixDisposals; },
		get publications() { return publications; },
		persistence,
		get persistenceCommits() { return persistenceCommits; },
		persistenceStarted,
		persisted,
		preflightBytes,
		render,
		service,
		setSelection(selection: EffectAudioProject['selection']) { project = { ...project, selection }; },
		snapshots,
		state,
		statuses,
		target,
		get spectralWorkerCalls() { return spectralWorkerCalls; },
		switchProject() {
			project = { ...project, id: 'project-b' };
			projectGeneration.invalidate();
			projectGeneration.activate(project.id);
		},
		worker,
	};
}

test('dry rendering removes unrelated tracks, racks, mixer state, and unselected clips', async () => {
	const harness = createHarness();
	await harness.service.renderDryTrackRange('track-a', 100, 200, 1, ['clip-a']);
	const snapshot = harness.snapshots[0]!;
	assert.deepEqual(snapshot.tracks.map((track) => track.id), ['track-a']);
	assert.deepEqual(snapshot.tracks[0]?.effects, []);
	assert.equal(snapshot.tracks[0]?.gain, 1);
	assert.deepEqual(snapshot.master.effects, []);
	assert.deepEqual(snapshot.mixer, { groups: [], sends: [], routes: {} });
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
	const controller: SoundscaperProductionControllerPort = {
		actions: {
			edit: { commit: () => undefined },
			effects: { applySelection: controls.applyAudacityEffectFromController },
		},
	};

	await executeSoundscaperProductionOperation(controller, {
		type: 'reviewed-effect/apply',
		package: { id: 'org.soundscaper.utility-gain', version: '1.0.0' },
		params: { gain: 1.25 },
	} satisfies SoundscaperProductionDialogOperation, () => undefined);

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
	assert.equal(await harness.service.captureSelectedNoiseProfile(), undefined);
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

function folderedLegacyProject() {
	return createAudioEditorProjectV17({
		id: 'project-folders', title: 'Foldered legacy', now: '2026-08-19T12:00:00.000Z',
		sources: [createAudioSourceV10({
			id: 'source-a', storageKey: 'pcm:a', frameCount: 8, channelCount: 1,
			sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
		})],
		clips: [createAudioClipV10({
			id: 'voice-clip', sourceId: 'source-a', title: 'Voice', timelineStartFrame: 0,
			durationFrames: 8, sourceStartFrame: 0, sourceDurationFrames: 8,
		})],
		tracks: [
			createAudioTrackV10({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'], effects: [] }),
			createAudioTrackV10({ id: 'music', name: 'Music', clipIds: [], effects: [] }),
		],
		trackFolders: [{ id: 'stems', name: 'Stems', mute: true }],
		sequences: [{
			id: 'main',
			trackNodes: [
				{ kind: 'folder', id: 'stems', parentFolderId: null },
				{ kind: 'track', id: 'voice', parentFolderId: 'stems' },
				{ kind: 'track', id: 'music', parentFolderId: null },
			],
		}],
		primarySequenceId: 'main',
	});
}

function v21RenderProject() {
	return createSoundscaperProjectV21({
		id: 'project-a', title: 'Selection render', now: '2026-08-14T12:00:00.000Z',
		tracks: [
			createAudioTrackV10({
				id: 'track-a', name: 'A', clipIds: [],
				effects: [
					createEffect('delay', { id: 'before' }),
					createEffect('audacity-noise-reduction', { id: 'noise', enabled: false }),
				],
			}),
			createAudioTrackV10({ id: 'track-b', name: 'B', clipIds: [] }),
		],
		sequences: [{ id: 'main', trackIds: ['track-a', 'track-b'] }],
		primarySequenceId: 'main',
		automationLanes: [{
			id: 'track-a-gain',
			address: { kind: 'strip', strip: { kind: 'track', id: 'track-a' }, parameterId: 'gain' },
			timebase: 'absolute-samples',
			points: [{ id: 'start', position: 0, value: 0.25 }],
			segments: [],
		}],
	});
}

test('master noise profiling commits a master-scoped effect update', async () => {
	const harness = createHarness();
	await harness.service.captureRackNoiseProfile(
		{ id: 'master', type: 'delay', params: {}, enabled: true }, 'master', null,
	);
	assert.equal((harness.commands[0] as { scope: string }).scope, 'master');
	assert.equal(harness.state.audacityEffectProcessing, false);
});
