/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createNyquistGeneratedAudioService,
	type NyquistGeneratedAudioProject,
	type NyquistGeneratedAudioState,
} from '../src/common/editor/controller/nyquist-generated-audio-service.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import type { EffectTarget } from '../src/common/editor/controller/effect-selection-service.ts';

function deferred<Value>() {
	let resolve: (value: Value) => void = () => undefined;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve };
}

function createHarness(options: Readonly<{ selection?: boolean; deferAnalysis?: boolean }> = {}) {
	let project: NyquistGeneratedAudioProject = {
		id: 'project-a', schemaVersion: 5, title: 'Project', sampleRate: 1_000,
		tracks: [{ id: 'track-a', name: 'Track', type: 'audio', clipIds: [] }],
		clips: [],
		selection: options.selection ? { startFrame: 100, endFrame: 200, trackIds: ['track-a'] } : null,
	};
	const state: NyquistGeneratedAudioState = { selectedTrackId: 'track-a' };
	const target: EffectTarget = {
		track: project.tracks[0]!, startFrame: 100, endFrame: 200, durationFrames: 100,
		channelCount: 1, hasAudio: true,
	};
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate(project.id);
	const analysis = deferred<void>();
	const analysisStarted = deferred<void>();
	const sourceBuffers = new Map<string, unknown>();
	const sourcePeaks = new Map<string, unknown>();
	const commands: unknown[] = [];
	const replacementCalls: unknown[] = [];
	const deletedSources: string[] = [];
	const deletedAnalysis: string[] = [];
	let writerAborts = 0;
	let writerCommits = 0;
	let beginWrites = 0;
	let id = 0;
	const service = createNyquistGeneratedAudioService({
		state,
		copy: {
			effectChannelLengthsMismatch: 'Channel mismatch', effectInvalidAudio: 'Invalid audio',
			nyquistPrompt: 'Nyquist Prompt',
		},
		sourceChunkFrames: 64,
		getProject: () => project,
		captureProject: () => projectGeneration.capture(project.id),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		activeSelection: () => project.selection ?? null,
		audacityEffectTarget: () => target,
		persistAudacityEffectResult: async (...args) => { replacementCalls.push(args); return 'replacement'; },
		matchAudacitySelectionChannels: (channels, count) => channels.slice(0, count),
		assertAudioOutput: () => undefined,
		projectSampleRate: () => project.sampleRate,
		preflightStorage: async () => undefined,
		createId: (prefix) => `${prefix}-${++id}`,
		getAudioContext: async () => ({}),
		bufferFromChannels: async (channels) => ({
			numberOfChannels: channels.length,
			length: channels[0]?.length ?? 0,
			getChannelData: (index: number) => channels[index]!,
		}),
		store: {
			beginSourceWrite: async () => {
				beginWrites += 1;
				return {
					write: async () => undefined,
					commit: async () => { writerCommits += 1; },
					abort: async () => { writerAborts += 1; },
				};
			},
			saveAnalysis: async () => {
				analysisStarted.resolve();
				return options.deferAnalysis ? analysis.promise : undefined;
			},
			deleteAnalysis: async (key) => { deletedAnalysis.push(key); },
			deleteSource: async (sourceId) => { deletedSources.push(sourceId); },
		},
		writeBuffer: async (writer, buffer, signal) => { await writer.write(buffer, signal); },
		snapTimelineFrame: (frame) => Math.round(Number(frame)),
		getPositionFrames: () => 250,
		cacheSourceBuffer: (sourceId, buffer) => { sourceBuffers.set(sourceId, buffer); },
		generateWaveformPeaks: async () => ({ minimum: [-1], maximum: [1] }),
		peakCacheKey: (sourceId) => `peaks:${sourceId}`,
		sourceBuffers,
		sourcePeaks,
		commit: (command) => { commands.push(command); },
	});
	return {
		analysis,
		analysisStarted,
		get beginWrites() { return beginWrites; },
		commands,
		deletedAnalysis,
		deletedSources,
		replacementCalls,
		service,
		sourceBuffers,
		sourcePeaks,
		switchProject() {
			project = { ...project, id: 'project-b' };
			projectGeneration.invalidate();
			projectGeneration.activate(project.id);
		},
		get writerAborts() { return writerAborts; },
		get writerCommits() { return writerCommits; },
	};
}

test('Nyquist audio replaces an active selection through the existing effect-result owner', async () => {
	const harness = createHarness({ selection: true });
	assert.equal(await harness.service.persistNyquistGeneratedAudio(
		[new Float32Array(100)], { name: 'Generated' },
	), 'replacement');
	assert.equal(harness.replacementCalls.length, 1);
	assert.equal(harness.beginWrites, 0);
});

test('generator output writes one source and commits one prepared batch', async () => {
	const harness = createHarness();
	const clipId = await harness.service.persistNyquistGeneratedAudio(
		[new Float32Array([0.1, 0.2])], { name: 'Tone', atFrame: 25 },
	);
	assert.equal(clipId, 'clip-2');
	assert.equal(harness.writerCommits, 1);
	assert.equal(harness.commands.length, 1);
	const command = harness.commands[0] as { commands: readonly { type: string }[] };
	assert.deepEqual(command.commands.map(({ type }) => type), ['source/add', 'clip/add']);
	assert.equal(harness.sourceBuffers.size, 1);
	assert.equal(harness.sourcePeaks.size, 1);
});

test('project switching after durable analysis rolls back every generated artifact', async () => {
	const harness = createHarness({ deferAnalysis: true });
	const pending = harness.service.persistNyquistGeneratedAudio([new Float32Array([0.1, 0.2])]);
	await harness.analysisStarted.promise;
	harness.switchProject();
	harness.analysis.resolve();
	await assert.rejects(pending, { code: 'PROJECT_CHANGED' });
	assert.equal(harness.commands.length, 0);
	assert.equal(harness.sourceBuffers.size, 0);
	assert.equal(harness.sourcePeaks.size, 0);
	assert.deepEqual(harness.deletedSources, ['nyquist-generator-1']);
	assert.deepEqual(harness.deletedAnalysis, ['peaks:nyquist-generator-1']);
	assert.equal(harness.writerAborts, 1);
});

test('invalid channel layouts fail before allocating storage', async () => {
	const harness = createHarness();
	await assert.rejects(
		() => harness.service.persistNyquistGeneratedAudio([]),
		/Invalid audio/u,
	);
	await assert.rejects(
		() => harness.service.persistNyquistGeneratedAudio([new Float32Array(0)]),
		/Invalid audio/u,
	);
	await assert.rejects(
		() => harness.service.persistNyquistGeneratedAudio([
			new Float32Array(2), new Float32Array(3),
		]),
		/Channel mismatch/u,
	);
	assert.equal(harness.beginWrites, 0);
});

test('an already-aborted generator signal fails before allocating storage', async () => {
	const harness = createHarness();
	const controller = new AbortController();
	controller.abort('cancelled');
	await assert.rejects(
		() => harness.service.persistNyquistGeneratedAudio(
			[new Float32Array([0.1])], { signal: controller.signal },
		),
		{ name: 'AbortError' },
	);
	assert.equal(harness.beginWrites, 0);
});
