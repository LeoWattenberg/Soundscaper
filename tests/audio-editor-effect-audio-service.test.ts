/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEffectAudioService,
	type EffectAudioProject,
	type EffectAudioState,
} from '../src/common/editor/controller/effect-audio-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import type { EffectTarget } from '../src/common/editor/controller/effect-selection-service.ts';

function deferred<Value>() {
	let resolve: (value: Value) => void = () => undefined;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve };
}

function createHarness(options: Readonly<{
	deferRender?: boolean;
	deferWorker?: boolean;
	loadFailure?: boolean;
}> = {}) {
	let project: EffectAudioProject = {
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
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate(project.id);
	const render = deferred<Readonly<{ channels: readonly Float32Array[] }>>();
	const worker = deferred<Readonly<{ profile: unknown }>>();
	const snapshots: EffectAudioProject[] = [];
	const commands: unknown[] = [];
	const persisted: unknown[] = [];
	const statuses: string[] = [];
	let publications = 0;
	let prefixDisposals = 0;
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
		memoryLimitBytes: 1_000_000_000,
		getProject: () => project,
		activeSelection: () => project.selection ?? null,
		audacityEffectTarget: () => target,
		audacityEffectTargets: () => [target],
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
		preflightStorage: async () => undefined,
		cloneProject: (value) => structuredClone(value),
		audacitySelectionChannelCount: () => 1,
		renderSnapshot: async (snapshot) => {
			snapshots.push(structuredClone(snapshot));
			return options.deferRender ? render.promise : { channels: [new Float32Array([0.2, 0.4])] };
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
		runSpectralEditWorker: async (channels) => channels.map((channel) => Float32Array.from(channel)),
		serializeNoiseProfile: (profile) => ({ serialized: profile }),
		commit: (command) => { commands.push(command); },
		persistAudacityEffectResults: async (...args) => { persisted.push(args); },
		setStatus: (message) => { statuses.push(message); },
		publishDocumentSnapshot: () => { publications += 1; },
	});
	return {
		commands,
		get prefixDisposals() { return prefixDisposals; },
		get publications() { return publications; },
		persisted,
		render,
		service,
		setSelection(selection: EffectAudioProject['selection']) { project = { ...project, selection }; },
		snapshots,
		state,
		statuses,
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

test('master noise profiling commits a master-scoped effect update', async () => {
	const harness = createHarness();
	await harness.service.captureRackNoiseProfile(
		{ id: 'master', type: 'delay', params: {}, enabled: true }, 'master', null,
	);
	assert.equal((harness.commands[0] as { scope: string }).scope, 'master');
	assert.equal(harness.state.audacityEffectProcessing, false);
});
