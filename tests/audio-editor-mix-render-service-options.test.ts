/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createMixRenderService,
	type MixRenderServiceDependencies,
} from '../src/common/editor/controller/mix-render-service.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source-audio.ts';
import type {
	ControllerProject,
	ControllerSource,
	DerivedSourceRecord,
	SourceWriter,
} from '../src/common/editor/controller/track-domain-types.ts';

test('individual Mix and Render skips empty targets and stages project-ordered outputs in one commit', async () => {
	const project = fixture();
	const renders: ControllerProject[] = [];
	const commits: AudioEditorCommand[] = [];
	const persisted: DerivedSourceRecord[] = [];
	let preflightBytes = 0;
	const dependencies = runtime(project, {
		renderSnapshot: async (snapshot) => {
			renders.push(snapshot);
			return buffer([new Float32Array(6).fill(Math.SQRT1_2), new Float32Array(6).fill(Math.SQRT1_2)]);
		},
		persistRenderedMixSource: async (rendered, name) => {
			const record = derived(`render-${String(persisted.length + 1)}`, rendered, name);
			persisted.push(record);
			return record;
		},
		preflightStorage: async (bytes) => { preflightBytes = bytes; },
		commit: (command) => { commits.push(command); },
	});
	const service = createMixRenderService(dependencies);

	const result = await service.mixAndRenderTracks({
		mixDown: false, renderEffects: true, replaceOriginals: true,
	});

	assert.deepEqual(renders.map((snapshot) => snapshot.tracks.map(({ id }) => id)), [['first'], ['second']]);
	assert.deepEqual(renders.map((snapshot) => snapshot.mixer.groups), [[], []]);
	assert.equal(preflightBytes, 2 * 6 * Float32Array.BYTES_PER_ELEMENT);
	assert.equal(persisted.length, 2);
	assert.deepEqual(result, { trackId: 'first', clipId: 'rendered-clip-1', sourceId: 'render-1' });
	assert.equal(commits.length, 1);
	const command = commits[0];
	assert.equal(command?.type, 'batch');
	if (command?.type !== 'batch') assert.fail('Expected one atomic Mix and Render batch.');
	const selection = command.commands.find((entry) => entry.type === 'selection/set');
	assert.equal(selection?.type, 'selection/set');
	if (selection?.type !== 'selection/set') assert.fail('Expected an output selection.');
	assert.deepEqual(selection.trackIds, ['first', 'second']);
});

test('a later individual-output failure rolls back every staged source and publishes no command', async () => {
	const project = fixture();
	const staged: DerivedSourceRecord[] = [];
	const rolledBack: DerivedSourceRecord[][] = [];
	let persistenceCalls = 0;
	let commitCalls = 0;
	const dependencies = runtime(project, {
		persistRenderedMixSource: async (rendered, name) => {
			persistenceCalls += 1;
			if (persistenceCalls === 2) throw new Error('second output failed');
			const record = derived('first-staged', rendered, name);
			staged.push(record);
			return record;
		},
		rollbackDerivedSources: async (records) => { rolledBack.push([...records]); },
		commit: () => { commitCalls += 1; },
	});
	const service = createMixRenderService(dependencies);

	await assert.rejects(
		() => service.mixAndRenderTracks({
			mixDown: false, renderEffects: true, replaceOriginals: true,
		}),
		/second output failed/,
	);
	assert.equal(commitCalls, 0);
	assert.deepEqual(rolledBack, [staged]);
});

test('a dry combined keep-original render has no effect tail and creates a mono Mix track', async () => {
	const project = fixture({
		selection: { startFrame: 0, endFrame: 0, trackIds: ['first'], clipIds: [] },
	});
	let renderedSnapshot: ControllerProject | null = null;
	let renderOptions: Readonly<Record<string, unknown>> | null = null;
	let persisted: DerivedSourceRecord | null = null;
	let committed: AudioEditorCommand | null = null;
	const dependencies = runtime(project, {
		renderSnapshot: async (snapshot, options) => {
			renderedSnapshot = snapshot;
			renderOptions = options;
			return buffer([Float32Array.of(Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2),
				Float32Array.of(Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2)]);
		},
		persistRenderedMixSource: async (rendered, name) => {
			persisted = derived('dry-mix', rendered, name);
			return persisted;
		},
		commit: (command) => { committed = command; },
	});
	const service = createMixRenderService(dependencies);

	await service.mixAndRenderTracks({
		mixDown: true, renderEffects: false, replaceOriginals: false,
	});

	assert.deepEqual((renderedSnapshot as ControllerProject | null)?.tracks[0]?.effects, []);
	assert.deepEqual((renderedSnapshot as ControllerProject | null)?.mixer.groups[0]?.effects, []);
	assert.equal((renderOptions as Readonly<Record<string, unknown>> | null)?.includeTail, false);
	assert.equal((persisted as DerivedSourceRecord | null)?.source.channelCount, 1);
	assert.equal((persisted as DerivedSourceRecord | null)?.source.name, 'Mix — Mix and Render.wav');
	const command = committed as unknown as AudioEditorCommand;
	assert.equal(command.type, 'batch');
	if (command.type !== 'batch') assert.fail('Expected an atomic dry mix command.');
	const added = command.commands.find((entry) => entry.type === 'track/add');
	assert.equal(added?.type, 'track/add');
	if (added?.type !== 'track/add') assert.fail('Expected a new combined track.');
	assert.equal(added.track.name, 'Mix');
	assert.equal(command.commands.some(({ type }) => type === 'track/remove'), false);
});

test('buffered Mix and Render rejects a frame-count mismatch before persistence or commit', async () => {
	const project = fixture({
		selection: { startFrame: 0, endFrame: 0, trackIds: ['first'], clipIds: [] },
	});
	let persisted = 0;
	let committed = 0;
	const service = createMixRenderService(runtime(project, {
		renderSnapshot: async () => buffer([new Float32Array(5), new Float32Array(5)]),
		persistRenderedMixSource: async () => { persisted += 1; return assert.fail('Invalid audio persisted.'); },
		commit: () => { committed += 1; },
	}));
	await assert.rejects(() => service.mixAndRenderTracks({
		mixDown: false, renderEffects: true, replaceOriginals: true,
	}), /Invalid audio/);
	assert.equal(persisted, 0);
	assert.equal(committed, 0);
});

test('Mix and Render rolls back a staged source when project ownership changes', async () => {
	const project = fixture();
	let stale = false;
	let committed = 0;
	const rolledBack: string[] = [];
	const service = createMixRenderService(runtime(project, {
		persistRenderedMixSource: async (rendered, name) => {
			const record = derived('stale-source', rendered, name);
			stale = true;
			return record;
		},
		assertProject: () => { if (stale) throw new Error('stale project'); },
		rollbackDerivedSources: async (records) => { rolledBack.push(...records.map(({ source }) => source.id)); },
		commit: () => { committed += 1; },
	}));
	await assert.rejects(() => service.mixAndRenderTracks({
		mixDown: false, renderEffects: true, replaceOriginals: true,
	}), /stale project/);
	assert.deepEqual(rolledBack, ['stale-source']);
	assert.equal(committed, 0);
});

test('Mix and Render rolls back every staged output when the atomic commit fails', async () => {
	const project = fixture();
	const attempts: string[] = [];
	let committed = 0;
	let persisted = 0;
	const service = createMixRenderService(runtime(project, {
		persistRenderedMixSource: async (rendered, name) => (
			derived(`staged-${String(++persisted)}`, rendered, name)
		),
		rollbackDerivedSources: async (records) => {
			attempts.push(records[0]!.source.id);
			if (attempts.length === 1) throw new Error('cleanup failed');
		},
		commit: () => { committed += 1; throw new Error('commit failed'); },
	}));
	await assert.rejects(() => service.mixAndRenderTracks({
		mixDown: false, renderEffects: true, replaceOriginals: true,
	}), /cleanup was incomplete/);
	assert.deepEqual(attempts, ['staged-2', 'staged-1']);
	assert.equal(committed, 1);
});

test('streamed Mix and Render aborts the raw writer when source-write ownership becomes stale', async () => {
	const project = fixture({
		selection: { startFrame: 0, endFrame: 0, trackIds: ['first'], clipIds: [] },
	});
	let stale = false;
	let rawAborts = 0;
	let wrapperCalls = 0;
	const rawWriter: SourceWriter = {
		write() {},
		commit: async () => ({}),
		abort() { rawAborts += 1; },
	};
	const service = createMixRenderService(runtime(project, {
		memoryLimitBytes: 0,
		store: {
			beginSourceWrite: async () => {
				stale = true;
				return rawWriter;
			},
		},
		assertProject: () => { if (stale) throw new Error('stale source write'); },
		createStreamingWriter: () => {
			wrapperCalls += 1;
			return assert.fail('A stale raw writer must not be wrapped.');
		},
	}));

	await assert.rejects(() => service.mixAndRenderTracks(), /stale source write/);
	assert.equal(rawAborts, 1);
	assert.equal(wrapperCalls, 0);
});

test('streamed Mix and Render aborts the raw writer when streaming-writer creation fails', async () => {
	const project = fixture({
		selection: { startFrame: 0, endFrame: 0, trackIds: ['first'], clipIds: [] },
	});
	let rawAborts = 0;
	const rawWriter: SourceWriter = {
		write() {},
		commit: async () => ({}),
		abort() { rawAborts += 1; },
	};
	const service = createMixRenderService(runtime(project, {
		memoryLimitBytes: 0,
		store: { beginSourceWrite: async () => rawWriter },
		createStreamingWriter: () => { throw new Error('stream wrapper failed'); },
	}));

	await assert.rejects(() => service.mixAndRenderTracks(), /stream wrapper failed/);
	assert.equal(rawAborts, 1);
});

interface RuntimeOverrides {
	renderSnapshot?: MixRenderServiceDependencies['renderSnapshot'];
	persistRenderedMixSource?: (buffer: AudioBufferLike, name: string) => Promise<DerivedSourceRecord>;
	rollbackDerivedSources?: (records: readonly DerivedSourceRecord[]) => Promise<void>;
	preflightStorage?: MixRenderServiceDependencies['preflightStorage'];
	commit?: MixRenderServiceDependencies['commit'];
	assertProject?: MixRenderServiceDependencies['assertProject'];
	previewCommand?: MixRenderServiceDependencies['previewCommand'];
	memoryLimitBytes?: number;
	store?: MixRenderServiceDependencies['store'];
	createStreamingWriter?: MixRenderServiceDependencies['createStreamingWriter'];
}

function runtime(project: ControllerProject, overrides: RuntimeOverrides = {}): MixRenderServiceDependencies {
	let id = 0;
	return {
		lifetime: { assertActive() {}, startTask: () => ({
			name: 'mix-render', generation: 1, signal: new AbortController().signal,
			assertCurrent() {}, finish() {},
		}) },
		copy: {
			v2Required: 'V2 required', mixRenderRequiresAudio: 'Audio required',
			audacitySelectionHint: 'Select audio', audioTrackRequired: 'Audio required',
			rendering: 'Rendering', mixedTrack: 'Mix', mixRender: 'Mix and Render',
			mixdownTo: 'Mix down', effectInvalidAudio: 'Invalid audio', done: 'Done',
		},
		derivedSources: {
			persistRenderedMixSource: overrides.persistRenderedMixSource ?? (async (
				rendered: AudioBufferLike,
				name: string,
			) => (
				derived(`render-${String(++id)}`, rendered, name)
			)),
			rollbackDerivedSources: overrides.rollbackDerivedSources ?? (async () => undefined),
		} as never,
		store: overrides.store ?? {
			beginSourceWrite: async () => assert.fail('Streaming was not expected.'),
		},
		sourceBuffers: new Map(), sourceChunkFrames: 65_536,
		memoryLimitBytes: overrides.memoryLimitBytes ?? Number.MAX_SAFE_INTEGER,
		getProject: () => project, getSelectedTrackId: () => 'first', getSelectedClipId: () => null,
		editingBlocked: () => false,
		captureProject: () => ({ generation: 1, projectId: project.id }),
		assertProject: overrides.assertProject ?? (() => undefined),
		createId: (prefix) => `${prefix}-${++id}`,
		commit: overrides.commit ?? (() => undefined),
		preflightStorage: overrides.preflightStorage ?? (async () => undefined),
		setProcessing() {}, setStatus() {}, publish() {}, handleError() {},
		rackTailFrames: (effects) => effects.length ? 2 : 0,
		isFixedStereoEffect: () => false,
		renderSnapshot: overrides.renderSnapshot ?? (async () => buffer([
			new Float32Array(6).fill(Math.SQRT1_2), new Float32Array(6).fill(Math.SQRT1_2),
		])),
		getAudioContext: async () => ({}),
		createBufferFromChannels: async (channels, sampleRate) => buffer(channels, sampleRate),
		createRenderEngine: () => ({ loadProject() {}, renderMixToSink: async () => ({}), dispose() {} }),
		createStreamingWriter: overrides.createStreamingWriter ?? (() => ({
			channelCount: 0, framesWritten: 0, write() {}, commit: async () => ({}), abort() {},
		})),
		prepareCommittedTimePitchCaches: async () => undefined,
		activateStoredSource: async () => undefined,
		previewCommand: overrides.previewCommand,
	};
}

function fixture(overrides: Partial<ControllerProject> = {}): ControllerProject {
	return {
		schemaVersion: 17, id: 'project', title: 'Project', sampleRate: 48_000,
		tracks: [
			{ id: 'first', name: 'First', type: 'audio', clipIds: ['first-clip'], gain: 1, pan: 0,
				effects: [{ id: 'first-effect', type: 'highpass' }] },
			{ id: 'empty', name: 'Empty', type: 'audio', clipIds: [], gain: 1, pan: 0, effects: [] },
			{ id: 'second', name: 'Second', type: 'audio', clipIds: ['second-clip'], gain: 1, pan: 0,
				effects: [{ id: 'second-effect', type: 'highpass' }] },
		],
		clips: [clip('first-clip', 'first-source'), clip('second-clip', 'second-source')],
		sources: [source('first-source'), source('second-source')],
		selection: { startFrame: 0, endFrame: 0, trackIds: ['first', 'empty', 'second'], clipIds: [] },
		mixer: {
			groups: [{ id: 'group', effects: [{ id: 'group-effect', type: 'highpass' }] }],
			sends: [], routes: { first: { groupId: 'group', sends: {} }, second: { groupId: null, sends: {} } },
		},
		trackFolders: [], ...overrides,
	};
}

function clip(id: string, sourceId: string) {
	return { id, sourceId, title: id, timelineStartFrame: 0, sourceStartFrame: 0,
		sourceDurationFrames: 4, durationFrames: 4 };
}

function source(id: string): ControllerSource {
	return { id, storageKey: id, name: id, mimeType: 'audio/wav', frameCount: 4,
		channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000 };
}

function buffer(channels: readonly Float32Array[], sampleRate = 48_000): AudioBufferLike {
	return { length: channels[0]?.length ?? 0, numberOfChannels: channels.length, sampleRate,
		getChannelData: (channel) => channels[channel]! };
}

function derived(id: string, rendered: AudioBufferLike, name: string): DerivedSourceRecord {
	const channels = Array.from({ length: rendered.numberOfChannels }, (_, channel) => rendered.getChannelData(channel));
	return { source: { ...source(id), name, frameCount: rendered.length, channelCount: rendered.numberOfChannels },
		buffer: rendered, channels };
}
