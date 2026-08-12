/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAudioGeneratorService,
	type AudioGeneratorProject,
	type AudioGeneratorState,
	type AudioGeneratorServiceDependencies,
} from '../src/common/editor/controller/generator-service.ts';
import {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from '../src/common/editor/controller/lifecycle.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source-audio.ts';

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((resolvePromise) => { resolve = resolvePromise; });
	return { promise, resolve };
}

function project(id = 'project-a', selection: AudioGeneratorProject['selection'] = {
	startFrame: 10,
	endFrame: 20,
	trackIds: ['track-a'],
}): AudioGeneratorProject {
	return {
		id,
		schemaVersion: 5,
		title: id,
		sampleRate: 1_000,
		masterChannels: 2,
		selection,
		sources: [{ id: 'existing-source', channelCount: 1 }],
		clips: [{
			id: 'existing-clip', sourceId: 'existing-source', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100,
		}],
		tracks: [{ id: 'track-a', type: 'audio', clipIds: ['existing-clip'] }],
	};
}

function createFixture(overrides: Partial<AudioGeneratorServiceDependencies> = {}) {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	let activeProject = project();
	projectGeneration.activate(activeProject.id);
	const state: AudioGeneratorState = { selectedTrackId: 'track-a', audacityEffectProcessing: false, lastGeneratorRequest: null };
	const commits: Array<Readonly<{
		command: AudioEditorCommand;
		selection?: Readonly<{ selectTrackId?: string | null; selectClipId?: string | null }>;
	}>> = [];
	const statuses: Array<Readonly<{ message: string; state?: string }>> = [];
	const preflights: number[] = [];
	const deletedSources: string[] = [];
	const sourceBuffers = new Map<string, AudioBufferLike>();
	const sourcePeaks = new Map<string, unknown>();
	let publishes = 0;
	let nextId = 0;
	const writer = {
		write: async () => undefined,
		commit: async () => undefined,
		abort: async () => undefined,
	};
	const dependencies: AudioGeneratorServiceDependencies = {
		lifetime,
		projectGeneration,
		state,
		copy: {
			audioBufferUnsupported: 'Audio buffers unsupported.',
			audacityProjectTooLong: 'Too long.',
			chirpGenerator: 'Chirp',
			decodedAudioEmpty: 'Empty audio.',
			decodedChannelLengthsMismatch: 'Channel mismatch.',
			done: 'Done.',
			dtmfGenerator: 'DTMF',
			generatingAudio: 'Generating audio.',
			noiseGenerator: 'Noise',
			silenceAudio: 'Silence',
			silenceGenerator: 'Silence',
			timeSelectionRequired: 'Select time.',
			toneGenerator: 'Tone',
		},
		getProject: () => activeProject,
		editingBlocked: () => false,
		getPositionFrames: () => 40,
		snapFrame: (value) => Math.round(Number(value)),
		trackChannelCount: () => 1,
		effectTargets: () => [],
		persistEffectResults: async () => undefined,
		preflightStorage: async (bytes) => { preflights.push(bytes); },
		getAudioContext: async () => ({}),
		createBuffer: async (channels, sampleRate) => ({
			length: channels[0]?.length ?? 0,
			numberOfChannels: channels.length,
			sampleRate,
			getChannelData: (channel) => channels[channel] ?? new Float32Array(),
		}),
		store: {
			beginSourceWrite: async () => writer,
			saveAnalysis: async () => undefined,
			deleteSource: async (sourceId) => { deletedSources.push(sourceId); },
		},
		writeBuffer: async () => undefined,
		cacheSourceBuffer: (sourceId, buffer) => { sourceBuffers.set(sourceId, buffer); },
		generatePeaks: async (channels) => ({ frameCount: channels[0]?.length ?? 0 }),
		peakCacheKey: (sourceId) => `peaks:${sourceId}`,
		sourceBuffers,
		sourcePeaks,
		sourceChunkFrames: 65_536,
		createId: (prefix) => `${prefix}-${++nextId}`,
		commit: (command, selectionValue) => { commits.push({ command, selection: selectionValue }); },
		setStatus: (message, nextState) => { statuses.push({ message, state: nextState }); },
		publish: () => { publishes += 1; },
		...overrides,
	};
	return {
		commits,
		deletedSources,
		dependencies,
		lifetime,
		preflights,
		projectGeneration,
		publishes: () => publishes,
		replaceProject(id: string) {
			activeProject = project(id);
			projectGeneration.activate(id);
		},
		sourceBuffers,
		sourcePeaks,
		state,
		statuses,
		writer,
	};
}

test('generator persists audio and commits a prepared range replacement exactly once', async () => {
	const fixture = createFixture();
	const service = createAudioGeneratorService(fixture.dependencies);

	const clipId = await service.generateSignal('silence');

	assert.equal(clipId, 'clip-2');
	assert.deepEqual(fixture.preflights, [40]);
	assert.equal(fixture.commits.length, 1);
	assert.equal(fixture.commits[0]?.command.type, 'range/replace');
	assert.deepEqual(fixture.commits[0]?.selection, { selectTrackId: 'track-a', selectClipId: 'clip-2' });
	assert.equal(fixture.sourceBuffers.has('generator-1'), true);
	assert.equal(fixture.sourcePeaks.has('generator-1'), true);
	assert.equal(fixture.state.audacityEffectProcessing, false);
	assert.deepEqual(fixture.statuses, [
		{ message: 'Generating audio.', state: undefined },
		{ message: 'Done.', state: 'success' },
	]);
});

test('late writer completion after a project switch rolls back and cannot commit', async () => {
	const committing = deferred<void>();
	const fixture = createFixture({
		store: {
			beginSourceWrite: async () => ({
				write: async () => undefined,
				commit: () => committing.promise,
				abort: async () => undefined,
			}),
			saveAnalysis: async () => undefined,
			deleteSource: async (sourceId) => { fixture.deletedSources.push(sourceId); },
		},
	});
	const service = createAudioGeneratorService(fixture.dependencies);
	const generating = service.generateSignal('silence');
	await new Promise<void>((resolve) => setImmediate(resolve));
	fixture.replaceProject('project-b');
	committing.resolve();

	await assert.rejects(generating, (error: unknown) => error instanceof Error && error.name === 'AbortError');
	assert.equal(fixture.commits.length, 0);
	assert.deepEqual(fixture.deletedSources, ['generator-1']);
	assert.equal(fixture.sourceBuffers.has('generator-1'), false);
	assert.equal(fixture.sourcePeaks.has('generator-1'), false);
});

test('selection silence without a time selection uses scoped effect persistence', async () => {
	let activeProject = project('project-a', null);
	const persisted: unknown[] = [];
	const fixture = createFixture({
		getProject: () => activeProject,
		effectTargets: () => [{ channelCount: 2, durationFrames: 4 }],
		persistEffectResults: async (results, _type, options) => { persisted.push({ results, options }); },
	});
	fixture.projectGeneration.invalidate();
	fixture.projectGeneration.activate(activeProject.id);
	const service = createAudioGeneratorService(fixture.dependencies);

	assert.equal(await service.generateSelectionSilence(), true);
	assert.equal(persisted.length, 1);
	const result = persisted[0] as { readonly results: readonly { readonly channels: readonly Float32Array[] }[] };
	assert.deepEqual(result.results[0]?.channels.map(({ length }) => length), [4, 4]);
	assert.equal(fixture.state.audacityEffectProcessing, false);
	assert.deepEqual(fixture.statuses.at(-1), { message: 'Done.', state: 'success' });
	activeProject = project('unused');
});

test('selection silence accepts the project document committed by its own persistence transaction', async () => {
	let activeProject = project('project-a', null);
	const fixture = createFixture({
		getProject: () => activeProject,
		effectTargets: () => [{ channelCount: 1, durationFrames: 4 }],
		persistEffectResults: async (_results, _type, options) => {
			options.assertCurrent();
			activeProject = { ...activeProject, title: 'Committed silence' };
		},
	});
	fixture.projectGeneration.invalidate();
	fixture.projectGeneration.activate(activeProject.id);
	const service = createAudioGeneratorService(fixture.dependencies);

	assert.equal(await service.generateSelectionSilence(), true);
	assert.deepEqual(fixture.statuses.at(-1), { message: 'Done.', state: 'success' });
});

test('storage failures abort and delete the partially generated source', async () => {
	let aborts = 0;
	const fixture = createFixture({
		store: {
			beginSourceWrite: async () => ({
				write: async () => undefined,
				commit: async () => { throw new Error('disk full'); },
				abort: async () => { aborts += 1; },
			}),
			saveAnalysis: async () => undefined,
			deleteSource: async (sourceId) => { fixture.deletedSources.push(sourceId); },
		},
	});
	const service = createAudioGeneratorService(fixture.dependencies);

	await assert.rejects(service.generateSignal('silence'), /disk full/u);
	assert.equal(aborts, 1);
	assert.deepEqual(fixture.deletedSources, ['generator-1']);
	assert.equal(fixture.state.audacityEffectProcessing, false);
});

test('generation on an empty timeline prepares source, track, and clip in one batch', async () => {
	const emptyProject: AudioGeneratorProject = {
		...project('project-a', null),
		sources: [],
		clips: [],
		tracks: [],
	};
	const fixture = createFixture({ getProject: () => emptyProject });
	fixture.state.selectedTrackId = null;
	const service = createAudioGeneratorService(fixture.dependencies);

	const clipId = await service.generateSignal('tone', {
		atFrame: 15,
		channelCount: 2,
		durationSeconds: 0.01,
		frequency: 100,
	});

	assert.equal(clipId, 'clip-3');
	const batch = fixture.commits[0]?.command;
	assert.equal(batch?.type, 'batch');
	if (batch?.type !== 'batch') return;
	assert.deepEqual(batch.commands.map(({ type }) => type), ['source/add', 'track/add', 'clip/add']);
	assert.deepEqual(fixture.commits[0]?.selection, { selectTrackId: 'track-2', selectClipId: 'clip-3' });
});

test('silence without a selection or effect target reports the selection requirement', async () => {
	const noSelection = project('project-a', null);
	const fixture = createFixture({ getProject: () => noSelection, effectTargets: () => [] });
	const service = createAudioGeneratorService(fixture.dependencies);

	await assert.rejects(service.generateSelectionSilence(), /Select time/u);
	assert.equal(fixture.state.audacityEffectProcessing, false);
	assert.equal(fixture.publishes(), 0);
});

test('blocked generation returns before allocating an async task', async () => {
	const fixture = createFixture({ editingBlocked: () => true });
	const service = createAudioGeneratorService(fixture.dependencies);

	assert.equal(await service.generateSignal('silence'), null);
	assert.deepEqual(fixture.preflights, []);
	assert.equal(fixture.publishes(), 0);
});

test('repeat generator replays the last successful closed request', async () => {
	const fixture = createFixture();
	const service = createAudioGeneratorService(fixture.dependencies);
	assert.equal(await service.repeatLast(), null);
	await service.generateSignal('tone', { durationSeconds: 0.01, frequency: 220 });
	await service.repeatLast();
	assert.equal(fixture.commits.length, 2);
	assert.deepEqual(fixture.state.lastGeneratorRequest, {
		type: 'tone', options: { durationSeconds: 0.01, frequency: 220 },
	});
});
