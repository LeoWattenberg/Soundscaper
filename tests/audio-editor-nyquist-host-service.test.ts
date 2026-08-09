/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createNyquistHostService,
	type NyquistHostProject,
	type NyquistHostState,
} from '../src/common/editor/controller/nyquist-host-service.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import type { EffectTarget } from '../src/common/editor/controller/effect-selection-service.ts';

function deferred<Value>() {
	let resolve: (value: Value) => void = () => undefined;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve };
}

function createHarness(options: Readonly<{ deferContext?: boolean }> = {}) {
	let project: NyquistHostProject = {
		id: 'project-a', schemaVersion: 5, title: 'Nyquist Project', sampleRate: 1_000,
		tempo: { bpm: 90 },
		tracks: [
			{ id: 'track-a', name: 'Voice', type: 'audio', clipIds: ['clip-a'] },
			{ id: 'labels', name: 'Labels', type: 'label', clipIds: [] },
		],
		clips: [{
			id: 'clip-a', kind: 'audio', sourceId: 'source-a', title: 'Clip',
			timelineStartFrame: 100, sourceStartFrame: 0, sourceDurationFrames: 400, durationFrames: 400,
		}],
		selection: {
			startFrame: 100, endFrame: 500, trackIds: ['track-a'], clipIds: ['clip-a'],
			frequencyRange: { minimumFrequency: 100, maximumFrequency: 400 },
		},
		master: { effects: [] }, mixer: { groups: [], sends: [], routes: {} },
	};
	const state: NyquistHostState = {
		selectedTrackId: 'track-a',
		nyquistAbort: null,
		audacityEffectProcessing: false,
		audacityPreviewSource: null,
	};
	const target: EffectTarget = {
		track: project.tracks[0]!, clipId: 'clip-a', clipIds: ['clip-a'], startFrame: 100, endFrame: 500,
		durationFrames: 400, channelCount: 1, hasAudio: true,
	};
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate(project.id);
	const contextDeferred = deferred<ReturnType<typeof createContext>>();
	const context = createContext();
	const commands: unknown[] = [];
	const statuses: string[] = [];
	let cancelledPreviews = 0;
	let publications = 0;
	const service = createNyquistHostService({
		state,
		copy: {
			audacityPreviewCancelled: 'Cancelled', audacityPreviewComplete: 'Complete',
			audacityPreviewPlaying: 'Preview playing', labels: 'Labels', playing: 'Playing', ready: 'Ready',
		},
		locale: 'de-DE',
		getProject: () => project,
		captureProject: () => projectGeneration.capture(project.id),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		activeSelection: () => project.selection ?? null,
		projectSampleRate: () => project.sampleRate,
		getPositionFrames: () => 250,
		getAudioContext: async () => options.deferContext ? contextDeferred.promise : context,
		pauseTransport: () => undefined,
		assertAudioOutput: () => undefined,
		bufferFromChannels: async () => ({ audio: true }),
		cancelAudacityEffectPreview: () => { cancelledPreviews += 1; return true; },
		createId: (prefix) => `${prefix}-1`,
		commit: (command) => { commands.push(command); },
		setStatus: (message) => { statuses.push(message); },
		publishDocumentSnapshot: () => { publications += 1; },
	});
	return {
		get cancelledPreviews() { return cancelledPreviews; },
		commands,
		context,
		contextDeferred,
		get publications() { return publications; },
		service,
		state,
		statuses,
		updateProject(changes: Partial<NyquistHostProject>) {
			project = { ...project, ...changes };
		},
		switchProject() {
			project = { ...project, id: 'project-b' };
			projectGeneration.invalidate();
			projectGeneration.activate(project.id);
		},
		target,
	};
}

function createContext() {
	const sources: Array<{
		buffer: unknown;
		onended: (() => void) | null;
		onerror: (() => void) | null;
		started: number;
		disconnected: number;
		connect(): void;
		start(): void;
		stop(): void;
		disconnect(): void;
	}> = [];
	return {
		destination: {},
		resume: async () => undefined,
		createBufferSource() {
			const source = {
				buffer: null as unknown,
				onended: null as (() => void) | null,
				onerror: null as (() => void) | null,
				started: 0,
				disconnected: 0,
				connect() { /* Contract-only fake. */ },
				start() { this.started += 1; },
				stop() { /* Contract-only fake. */ },
				disconnect() { this.disconnected += 1; },
			};
			sources.push(source);
			return source;
		},
		sources,
	};
}

test('Nyquist host properties expose Audacity-compatible project, selection, and clip values', () => {
	const harness = createHarness();
	const properties = harness.service.nyquistHostProperties(
		harness.target, [harness.target], 0, [new Float32Array([0.5, -0.25])], { name: 'Prompt' },
	);
	assert.deepEqual(properties.AUDACITY, { VERSION: [3, 7, 7], LANGUAGE: 'de-DE' });
	assert.equal(properties.PROJECT.RATE, 1_000);
	assert.equal(properties.PROJECT.TEMPO, 90);
	assert.equal(properties.SELECTION.START, 0.1);
	assert.equal(properties.SELECTION.LOW_HZ, 100);
	assert.equal(properties.SELECTION.CENTER_HZ, 200);
	assert.deepEqual(properties.TRACK.CLIPS, [[0.1, 0.5]]);
});

test('Nyquist host properties project musical clips and expose the tempo active at the evaluation frame', () => {
	const harness = createHarness();
	harness.updateProject({
		schemaVersion: 10,
		tempo: { bpm: 120 },
		tempoMap: {
			mode: 'musical',
			events: [
				{ id: 'tempo-0', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
				{ id: 'tempo-1', beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
			],
		},
		clips: [{
			id: 'clip-a', kind: 'audio', sourceId: 'source-a', title: 'Clip',
			timelineStartFrame: 100, durationFrames: 400,
			sourceStartFrame: 0, sourceDurationFrames: 400,
			anchor: 'musical', musicalStartBeat: { num: 5, den: 1 },
			musicalExtent: 'fixedSamples',
		}],
	});
	const target = { ...harness.target, startFrame: 3_000, endFrame: 3_400, durationFrames: 400 };
	const properties = harness.service.nyquistHostProperties(
		target, [target], 0, [new Float32Array([0.5])], { name: 'Prompt' },
	);

	assert.equal(properties.PROJECT.TEMPO, 60);
	assert.deepEqual(properties.TRACK.CLIPS, [[3, 3.4]]);
});

test('Nyquist resolves the active event in a maximum-size tempo map without origin rescans', () => {
	const harness = createHarness();
	harness.updateProject({
		tempoMap: {
			mode: 'musical',
			events: Array.from({ length: 4_096 }, (_, index) => ({
				id: `tempo-${String(index)}`, beat: { num: index * 4, den: 1 },
				bpm: { num: index % 2 ? 90 : 120, den: 1 },
			})),
		},
	});
	const target = { ...harness.target, startFrame: 9_000_000, endFrame: 9_000_400 };
	const startedAt = performance.now();
	const properties = harness.service.nyquistHostProperties(
		target, [target], 0, [new Float32Array([0.5])], { name: 'Prompt' },
	);
	const elapsed = performance.now() - startedAt;
	assert.ok(properties.PROJECT.TEMPO > 0);
	assert.ok(elapsed < 750, `Nyquist tempo lookup took ${String(Math.round(elapsed))} ms`);
});

test('Nyquist host properties fall back to the cursor and request for an untargeted stereo result', () => {
	const harness = createHarness();
	harness.updateProject({ title: '', tempo: 0, selection: null });
	const properties = harness.service.nyquistHostProperties(
		null,
		[null],
		2,
		[new Float32Array([0.25]), new Float32Array([-0.25])],
		{ name: 'Generated' },
	);
	assert.equal(properties.PROJECT.NAME, '');
	assert.equal(properties.PROJECT.TEMPO, 120);
	assert.deepEqual(properties.SELECTION.TRACKS, []);
	assert.equal(properties.SELECTION.START, 0.25);
	assert.equal(properties.SELECTION.END, 0.25);
	assert.equal(properties.SELECTION.LOW_HZ, undefined);
	assert.equal(properties.TRACK.INDEX, 3);
	assert.equal(properties.TRACK.NAME, 'Generated');
	assert.deepEqual(properties.TRACK.CLIPS, [[], []]);
});

test('preview setup cannot publish into a project that changed while audio context resumed', async () => {
	const harness = createHarness({ deferContext: true });
	const pending = harness.service.playNyquistPreview([new Float32Array([0.5])], 1_000);
	harness.switchProject();
	harness.contextDeferred.resolve(harness.context);
	await assert.rejects(pending, { code: 'PROJECT_CHANGED' });
	assert.equal(harness.state.audacityPreviewSource, null);
	assert.equal(harness.context.sources.length, 0);
});

test('preview completion publishes only while its project and source are current', async () => {
	const harness = createHarness();
	await harness.service.playNyquistPreview([new Float32Array([0.5])], 1_000);
	const source = harness.context.sources[0]!;
	assert.equal(source.started, 1);
	harness.switchProject();
	const publications = harness.publications;
	source.onended?.();
	assert.equal(harness.publications, publications);
	assert.equal(source.disconnected, 1);
});

test('label persistence reuses a label track and offsets label times by the evaluation base frame', () => {
	const harness = createHarness();
	assert.equal(harness.service.persistNyquistLabels([
		{ start: 0.1, end: 0.2, text: 'Hallo', baseFrame: 100 },
	], 'Analysis'), 'labels');
	const command = harness.commands[0] as { commands: Array<{ type: string; label?: Record<string, unknown> }> };
	assert.equal(command.commands.length, 1);
	assert.equal(command.commands[0]?.type, 'label/add');
	assert.equal(command.commands[0]?.label?.startFrame, 200);
	assert.equal(command.commands[0]?.label?.endFrame, 300);
});

test('label persistence ignores an empty result and creates a missing label track with safe defaults', () => {
	const harness = createHarness();
	assert.equal(harness.service.persistNyquistLabels([]), null);
	assert.equal(harness.commands.length, 0);
	harness.state.selectedTrackId = 'missing';
	harness.updateProject({
		tracks: [{ id: 'track-a', name: 'Voice', type: 'audio', clipIds: [] }],
		clips: [],
	});
	assert.equal(harness.service.persistNyquistLabels([
		{ baseFrame: 10 },
		{ start: -1, end: -2, text: '', baseFrame: 0 },
	]), 'label-track-1');
	const command = harness.commands[0] as {
		commands: Array<{
			type: string;
			label?: Record<string, unknown>;
			track?: Record<string, unknown>;
		}>;
	};
	assert.deepEqual(command.commands.map(({ type }) => type), [
		'track/add', 'label/add', 'label/add',
	]);
	assert.equal(command.commands[0]?.track?.name, 'Labels');
	assert.deepEqual(command.commands.slice(1).map(({ label }) => [
		label?.startFrame, label?.endFrame, label?.title,
	]), [[10, 10, ''], [0, 0, '']]);
});

test('Nyquist cancellation aborts evaluation and delegates preview ownership', () => {
	const harness = createHarness();
	const abort = new AbortController();
	harness.state.nyquistAbort = abort;
	harness.state.audacityEffectProcessing = true;
	assert.equal(harness.service.cancelNyquistEvaluation(), true);
	assert.equal(abort.signal.aborted, true);
	assert.equal(harness.cancelledPreviews, 1);
});

test('Nyquist cancellation clears processing when no evaluation owns the operation', () => {
	const harness = createHarness();
	harness.state.audacityEffectProcessing = true;
	assert.equal(harness.service.cancelNyquistEvaluation(), true);
	assert.equal(harness.state.audacityEffectProcessing, false);
	assert.deepEqual(harness.statuses, ['Cancelled']);
	assert.equal(harness.publications, 1);
});

test('an already-aborted preview signal fails before creating a source', async () => {
	const harness = createHarness();
	const controller = new AbortController();
	controller.abort('cancelled');
	await assert.rejects(
		() => harness.service.playNyquistPreview([new Float32Array([0.5])], 1_000, controller.signal),
		{ name: 'AbortError' },
	);
	assert.equal(harness.context.sources.length, 0);
});
