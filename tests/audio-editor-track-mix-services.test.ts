import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createEditorTrackService,
	type EditorTrackServiceDependencies,
} from '../src/common/editor/controller/track-service.ts';
import {
	createMixRenderSnapshot,
	prepareMixRenderCommit,
	selectAudioTracksForMix,
} from '../src/common/editor/controller/mix-render-model.ts';
import {
	createDerivedSourceService,
} from '../src/common/editor/controller/derived-source-service.ts';
import { SourceChunkProviderRegistry } from '../src/common/editor/controller/source-chunk-provider-registry.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source-audio.ts';
import {
	createTrackTransformService,
} from '../src/common/editor/controller/track-transform-service.ts';
import {
	createMixRenderService,
} from '../src/common/editor/controller/mix-render-service.ts';
import type {
	ControllerProject,
	ControllerTrack,
} from '../src/common/editor/controller/track-domain-types.ts';

test('track service prepares stable atomic track commands and moves linked lanes together', () => {
	let project = projectFixture({
		tracks: [
			trackFixture({ id: 'video', type: 'video', laneGroupId: 'lanes' }),
			trackFixture({ id: 'audio', laneGroupId: 'lanes' }),
			trackFixture({ id: 'other' }),
		],
	});
	const commits: Array<{
		command: AudioEditorCommand;
		selection?: Readonly<{ selectTrackId?: string | null; selectClipId?: string | null }>;
	}> = [];
	let sequence = 0;
	const dependencies: EditorTrackServiceDependencies = {
		lifetime: { assertActive() {} },
		copy: {
			track: 'Track', labels: 'Labels', recordingDesktopAudio: 'Desktop audio',
			trackDestinationInvalid: 'Invalid destination', trackNotFound: 'Track missing',
			v2Required: 'V2 required', audioTrackRequired: 'Audio required',
			unknownTrackDisplay: 'Unknown display',
		},
		trackColors: ['blue', 'green'],
		getProject: () => project,
		getSelectedTrackId: () => 'audio',
		editingBlocked: () => false,
		createId: (prefix) => `${prefix}-${++sequence}`,
		commit: (command, selection) => {
			commits.push({ command, selection });
			if (command.type === 'track/add') {
				project = {
					...project,
					tracks: [...project.tracks, command.track as unknown as ControllerTrack],
				};
			}
			return command;
		},
		getPositionFrames: () => 42,
		snapTimelineFrame: (frame) => frame,
		setTimelineView() {},
		recording: {
			getRouting: () => ({ routes: {} }),
			setRouting() {},
			getPreferredDeviceId: () => 'default',
			getPreferredChannelCount: () => 1,
			getDevices: () => [],
			getPoolSources: () => [],
			setTrackRoute: (routing) => routing,
			setRouteHealth() {},
			updateDeviceRows() {},
			persistRouting: async () => undefined,
			publish() {},
			defaultDeviceId: 'default',
			displaySourceKey: 'display',
		},
	};
	const service = createEditorTrackService(dependencies);

	assert.equal(service.addVideoTrackPair({ name: 'Picture', index: 1 }), 'video-track-2');
	assert.equal(commits[0]?.command.type, 'batch');
	if (commits[0]?.command.type !== 'batch') assert.fail('Expected an atomic video/audio lane batch.');
	assert.deepEqual(commits[0].command.commands.map((command) => command.type), ['track/add', 'track/add']);
	assert.equal(service.moveTrack('audio', 'bottom'), 'audio');
	assert.deepEqual(commits[1], {
		command: { type: 'track/reorder', trackId: 'audio', index: 2 },
		selection: { selectTrackId: 'audio' },
	});

	const labelId = service.addLabel(null, { text: 'Marker' });
	assert.match(labelId ?? '', /^label-/);
	assert.equal(commits.at(-2)?.command.type, 'track/add');
	assert.equal(commits.at(-1)?.command.type, 'label/add');
});

test('mix model scopes routing and auto-duck control tracks without mutating the live project', () => {
	const first = trackFixture({ id: 'first', clipIds: ['first-clip'], effects: [{
		id: 'duck', type: 'audacity-auto-duck', enabled: true, context: { controlTrackId: 'control' },
	}] });
	const second = trackFixture({ id: 'second', clipIds: ['second-clip'] });
	const control = trackFixture({ id: 'control', clipIds: ['control-clip'], gain: 0.75 });
	const ignored = trackFixture({ id: 'ignored', clipIds: ['ignored-clip'] });
	const project = projectFixture({
		tracks: [first, second, control, ignored],
		clips: [
			clipFixture('first-clip', 'first-source'),
			clipFixture('second-clip', 'second-source'),
			clipFixture('control-clip', 'control-source'),
			clipFixture('ignored-clip', 'ignored-source'),
		],
		sources: ['first-source', 'second-source', 'control-source', 'ignored-source']
			.map((id) => sourceFixture(id)),
		selection: { startFrame: 10, endFrame: 20, trackIds: ['first', 'second'], clipIds: [] },
		mixer: {
			groups: [{ id: 'group', effects: [], pan: 0 }],
			sends: [{ id: 'send', effects: [], pan: 0 }, { id: 'unused', effects: [], pan: 0 }],
			routes: {
				first: { groupId: 'group', sends: { send: 0.5, unused: 0 } },
				second: { groupId: null, sends: {} },
				control: { groupId: null, sends: {} },
			},
		},
	});
	const targets = selectAudioTracksForMix(project, 'first', null);
	const snapshot = createMixRenderSnapshot(project, targets);

	assert.deepEqual(targets.map((track) => track.id), ['first', 'second']);
	assert.deepEqual(snapshot.tracks.map((track) => track.id), ['first', 'second', 'control']);
	assert.equal(snapshot.tracks.find((track) => track.id === 'control')?.gain, 0);
	assert.deepEqual(snapshot.mixer.groups.map((bus) => bus.id), ['group']);
	assert.deepEqual(snapshot.mixer.sends.map((bus) => bus.id), ['send']);
	assert.deepEqual(project.tracks.map((track) => track.id), ['first', 'second', 'control', 'ignored']);

	let sequence = 0;
	const prepared = prepareMixRenderCommit(project, targets, sourceFixture('mix-source'), {
		startFrame: 100,
		mixName: 'Mix',
		createId: (prefix) => `${prefix}-${++sequence}`,
	});
	assert.equal(prepared.command.type, 'batch');
	assert.deepEqual(prepared.command.commands.map((command) => command.type), [
		'source/add', 'track/remove', 'track/remove', 'track/add', 'clip/add', 'selection/set',
	]);
	assert.equal(prepared.trackId, 'mixed-track-1');
	assert.equal(prepared.clipId, 'mixed-clip-2');
});

test('derived source persistence removes a committed source when project ownership changes', async () => {
	const project = projectFixture({ sources: [sourceFixture('source')] });
	let currentProjectId = project.id;
	let resolvePeaks!: (value: unknown) => void;
	const peaks = new Promise<unknown>((resolve) => { resolvePeaks = resolve; });
	const deleted: string[] = [];
	const buffers = new Map<string, { length: number; numberOfChannels: number; sampleRate: number; getChannelData(channel: number): Float32Array }>();
	const peakCache = new Map<string, unknown>();
	const providers = new SourceChunkProviderRegistry<string, unknown>();
	const service = createDerivedSourceService({
		lifetime: { assertActive() {} },
		copy: { effectInvalidAudio: 'Invalid audio' },
		getProject: () => project,
		captureProject: () => ({ generation: 1, projectId: currentProjectId }),
		assertProject: (token) => {
			if (token.projectId !== currentProjectId) throw Object.assign(new Error('Project changed'), { code: 'PROJECT_CHANGED' });
		},
		createId: () => 'derived',
		projectSampleRate: () => 48_000,
		retireSourceChunkProvider: async (sourceId) => {
			providers.delete(sourceId);
			await providers.drain();
		},
		getAudioContext: async () => ({}),
		createBufferFromChannels: async (channels, sampleRate) => audioBufferFixture(channels, sampleRate),
		loadSourceChannels: async () => [new Float32Array([1, 2])],
		writeBuffer: async (writer, buffer) => {
			await writer.write([buffer.getChannelData(0)]);
		},
		generateWaveformPeaks: async () => peaks,
		peakCacheKey: (sourceId) => `peaks:${sourceId}`,
		cacheSourceBuffer: (sourceId, buffer) => { buffers.set(sourceId, buffer); },
		sourceBuffers: buffers,
		sourcePeaks: peakCache,
		sourceChunkFrames: 65_536,
		store: {
			beginSourceWrite: async () => ({
				write: async () => undefined,
				commit: async () => undefined,
				abort: async () => undefined,
			}),
			saveAnalysis: async () => undefined,
			deleteAnalysis: async () => undefined,
			deleteSource: async (sourceId) => { deleted.push(sourceId); },
		},
	});
	const pending = service.persistDerivedSource(
		sourceFixture('source'),
		[new Float32Array([1, 2])],
		'Derived',
	);
	await Promise.resolve();
	await Promise.resolve();
	currentProjectId = 'switched';
	resolvePeaks({ levels: [] });

	await assert.rejects(pending, { code: 'PROJECT_CHANGED' });
	assert.deepEqual(deleted, ['derived']);
	assert.equal(buffers.has('derived'), false);
	assert.equal(peakCache.has('derived'), false);
});

test('derived source persistence replaces inherited identity with its committed PCM identity', async () => {
	const channels = [Float32Array.of(0.25, -0.5)];
	const identity = canonicalPcmIdentity(channels);
	const buffers = new Map<string, AudioBufferLike>();
	const service = createDerivedSourceService({
		lifetime: { assertActive() {} },
		copy: { effectInvalidAudio: 'Invalid audio' },
		getProject: () => projectFixture(),
		captureProject: () => ({ generation: 1, projectId: 'project' }),
		assertProject() {},
		createId: () => 'derived',
		projectSampleRate: () => 48_000,
		retireSourceChunkProvider: async () => undefined,
		getAudioContext: async () => ({}),
		createBufferFromChannels: async (values, sampleRate) => audioBufferFixture(values, sampleRate),
		loadSourceChannels: async () => channels,
		writeBuffer: async (writer, buffer) => { await writer.write([buffer.getChannelData(0)]); },
		generateWaveformPeaks: async () => ({ levels: [] }),
		peakCacheKey: (sourceId) => `peaks:${sourceId}`,
		cacheSourceBuffer: (sourceId, buffer) => { buffers.set(sourceId, buffer); },
		sourceBuffers: buffers,
		sourcePeaks: new Map(),
		sourceChunkFrames: channels[0]!.length,
		store: {
			beginSourceWrite: async () => ({
				write: async () => undefined,
				commit: async () => ({
					sha256: identity.contentSha256,
					byteLength: identity.byteLength,
					frameCount: channels[0]!.length,
				}),
				abort: async () => undefined,
			}),
			saveAnalysis: async () => undefined,
			deleteSource: async () => undefined,
		},
	});

	const result = await service.persistDerivedSource({
		...sourceFixture('source'),
		contentSha256: 'a'.repeat(64),
		byteLength: 99,
	}, channels, 'Derived');

	assert.notEqual(result.source.contentSha256, 'a'.repeat(64));
	assert.equal(result.source.contentSha256, identity.contentSha256);
	assert.equal(result.source.byteLength, identity.byteLength);
});

test('derived source failure drains its provider before backing deletion and preserves cleanup context', async () => {
	const project = projectFixture({ sources: [sourceFixture('source')] });
	const primaryFailure = new Error('waveform generation failed');
	const cleanupFailure = new Error('provider release failed');
	let resolveCleanup!: () => void;
	const cleanupGate = new Promise<void>((resolve) => { resolveCleanup = resolve; });
	let markCleanupStarted!: () => void;
	const cleanupStarted = new Promise<void>((resolve) => { markCleanupStarted = resolve; });
	const events: string[] = [];
	const deleted: string[] = [];
	const buffers = new Map<string, AudioBufferLike>();
	const providers = new SourceChunkProviderRegistry<string, unknown>();
	const service = createDerivedSourceService({
		lifetime: { assertActive() {} },
		copy: { effectInvalidAudio: 'Invalid audio' },
		getProject: () => project,
		captureProject: () => ({ generation: 1, projectId: project.id }),
		assertProject() {},
		createId: () => 'derived',
		projectSampleRate: () => 48_000,
		retireSourceChunkProvider: async (sourceId) => {
			providers.delete(sourceId);
			events.push('publish-engine-providers');
			await providers.drain();
		},
		getAudioContext: async () => ({}),
		createBufferFromChannels: async (channels, sampleRate) => audioBufferFixture(channels, sampleRate),
		loadSourceChannels: async () => [new Float32Array([1, 2])],
		writeBuffer: async (writer, buffer) => { await writer.write([buffer.getChannelData(0)]); },
		generateWaveformPeaks: async () => { throw primaryFailure; },
		peakCacheKey: (sourceId) => `peaks:${sourceId}`,
		cacheSourceBuffer: (sourceId, buffer) => {
			buffers.set(sourceId, buffer);
			providers.set(sourceId, {
				async dispose() {
					events.push('provider-dispose-start');
					markCleanupStarted();
					await cleanupGate;
					events.push('provider-dispose-end');
					throw cleanupFailure;
				},
			});
		},
		sourceBuffers: buffers,
		sourcePeaks: new Map(),
		sourceChunkFrames: 65_536,
		store: {
			beginSourceWrite: async () => ({
				write: async () => undefined,
				commit: async () => undefined,
				abort: async () => undefined,
			}),
			saveAnalysis: async () => undefined,
			deleteAnalysis: async () => { events.push('analysis-delete'); },
			deleteSource: async (sourceId) => { events.push('source-delete'); deleted.push(sourceId); },
		},
	});
	const pending = service.persistDerivedSource(
		sourceFixture('source'),
		[new Float32Array([1, 2])],
		'Derived',
	);
	await cleanupStarted;
	assert.equal(providers.has('derived'), false);
	assert.deepEqual(events, ['provider-dispose-start', 'publish-engine-providers']);
	assert.deepEqual(deleted, []);
	resolveCleanup();
	await assert.rejects(pending, (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.strictEqual(error.cause, primaryFailure);
		assert.deepEqual(error.errors, [primaryFailure, cleanupFailure]);
		return true;
	});
	assert.deepEqual(events, [
		'provider-dispose-start', 'publish-engine-providers', 'provider-dispose-end',
	]);
	assert.deepEqual(deleted, []);
});

test('track transforms reject late preflight completion before persistence or commit', async () => {
	const project = projectFixture({
		tracks: [trackFixture({ id: 'stereo', clipIds: ['clip'] })],
		clips: [clipFixture('clip', 'source')],
		sources: [{ ...sourceFixture('source'), channelCount: 2 }],
	});
	let activeProjectId = project.id;
	let resolvePreflight!: () => void;
	const preflight = new Promise<void>((resolve) => { resolvePreflight = resolve; });
	let commitCount = 0;
	let persistenceCount = 0;
	let processing = false;
	const service = createTrackTransformService({
		lifetime: {
			assertActive() {},
			startTask: (name) => ({
				name,
				generation: 1,
				signal: new AbortController().signal,
				assertCurrent() {},
				finish() {},
			}),
		},
		copy: {
			v2Required: 'V2 required', audioTrackRequired: 'Audio required',
			stereoTrackRequired: 'Stereo required', monoTrackRequired: 'Mono required',
			compatibleMonoTrackRequired: 'Partner required', resamplingTrack: 'Resampling',
			audacityProcessing: 'Processing', rewritingChannels: 'Rewriting', done: 'Done',
			channelsSwapped: 'Swapped', leftChannel: 'Left', rightChannel: 'Right', stereo: 'Stereo',
		},
		getProject: () => project,
		getSelectedTrackId: () => 'stereo',
		editingBlocked: () => false,
		captureProject: () => ({ generation: 1, projectId: activeProjectId }),
		assertProject: (token) => {
			if (token.projectId !== activeProjectId) throw Object.assign(new Error('Project changed'), { code: 'PROJECT_CHANGED' });
		},
		createId: (prefix) => `${prefix}-id`,
		commit: () => { commitCount += 1; },
		projectSampleRate: () => 48_000,
		normalizeProjectSampleRate: () => 44_100,
		audioTrackChannelCount: () => 2,
		preflightStorage: async () => preflight,
		setProcessing: (value) => { processing = value; },
		setStatus() {},
		publish() {},
		resampleChannels: (channels) => channels,
		renderDryTrackRange: async () => [new Float32Array([1, 2])],
		derivedSources: {
			uniqueClipSources: () => [{ ...sourceFixture('source'), channelCount: 2 }],
			sourceChannelsForEdit: async () => [new Float32Array([1, 2]), new Float32Array([3, 4])],
			persistDerivedSource: async () => {
				persistenceCount += 1;
				return { source: sourceFixture('derived'), buffer: null, channels: null };
			},
			persistRenderedMixSource: async () => ({ source: sourceFixture('mix'), buffer: null, channels: null }),
			rollbackDerivedSources: async () => undefined,
		},
	});
	const pending = service.resampleTrack('stereo', 44_100);
	assert.equal(processing, true);
	activeProjectId = 'switched';
	resolvePreflight();

	await assert.rejects(pending, { code: 'PROJECT_CHANGED' });
	assert.equal(persistenceCount, 0);
	assert.equal(commitCount, 0);
	assert.equal(processing, false);
});

test('mix render service publishes one prepared atomic command after source persistence', async () => {
	const project = projectFixture({
		tracks: [trackFixture({ id: 'track', clipIds: ['clip'] })],
		clips: [clipFixture('clip', 'source')],
		sources: [sourceFixture('source')],
		selection: { startFrame: 0, endFrame: 100, trackIds: ['track'], clipIds: ['clip'] },
	});
	const mixCommits: AudioEditorCommand[] = [];
	let sequence = 0;
	let processing = false;
	const rendered = audioBufferFixture([new Float32Array(100).fill(0.25)], 48_000);
	const service = createMixRenderService({
		lifetime: {
			assertActive() {},
			startTask: (name) => ({
				name,
				generation: 1,
				signal: new AbortController().signal,
				assertCurrent() {},
				finish() {},
			}),
		},
		copy: {
			v2Required: 'V2 required', mixRenderRequiresAudio: 'Audio required',
			audacitySelectionHint: 'Select audio', audioTrackRequired: 'Audio required',
			rendering: 'Rendering', mixedTrack: 'Mix', mixRender: 'Mix and render',
			mixdownTo: 'Mix down', effectInvalidAudio: 'Invalid audio', done: 'Done',
		},
		derivedSources: {
			uniqueClipSources: () => [],
			sourceChannelsForEdit: async () => [],
			persistDerivedSource: async () => ({ source: sourceFixture('derived'), buffer: null, channels: null }),
			persistRenderedMixSource: async () => ({ source: sourceFixture('mix'), buffer: rendered, channels: [rendered.getChannelData(0)] }),
			rollbackDerivedSources: async () => undefined,
		},
		store: { beginSourceWrite: async () => assert.fail('Streaming was not expected.') },
		sourceBuffers: new Map(),
		sourceChunkFrames: 65_536,
		memoryLimitBytes: Number.MAX_SAFE_INTEGER,
		getProject: () => project,
		getSelectedTrackId: () => 'track',
		getSelectedClipId: () => 'clip',
		editingBlocked: () => false,
		captureProject: () => ({ generation: 1, projectId: project.id }),
		assertProject: (token) => { assert.equal(token.projectId, project.id); },
		createId: (prefix) => `${prefix}-${++sequence}`,
		commit: (command) => { mixCommits.push(command); },
		preflightStorage: async () => undefined,
		setProcessing: (value) => { processing = value; },
		setStatus() {},
		publish() {},
		handleError: (error) => { throw error; },
		rackTailFrames: () => 0,
		isFixedStereoEffect: () => false,
		renderSnapshot: async () => rendered,
		getAudioContext: async () => ({}),
		createBufferFromChannels: async (channels, sampleRate) => audioBufferFixture(channels, sampleRate),
		createRenderEngine: () => ({
			loadProject() {},
			renderMixToSink: async () => ({}),
			dispose: async () => undefined,
		}),
		createStreamingWriter: () => ({
			channelCount: 0,
			framesWritten: 0,
			write: async () => undefined,
			commit: async () => undefined,
			abort: async () => undefined,
		}),
		prepareCommittedTimePitchCaches: async () => undefined,
		activateStoredSource: async () => undefined,
	});

	const result = await service.mixAndRenderTracks();
	assert.deepEqual(result, { trackId: 'track', clipId: 'mixed-clip-1', sourceId: 'mix' });
	assert.equal(processing, false);
	const committed = mixCommits[0];
	assert.equal(committed?.type, 'batch');
	if (committed?.type !== 'batch') assert.fail('Expected one atomic Mix and Render command.');
	assert.deepEqual(committed.commands.map((command) => command.type), [
		'source/add', 'clip/remove', 'track/update', 'clip/add', 'selection/set',
	]);
});

function projectFixture(overrides: Partial<ControllerProject> = {}): ControllerProject {
	return {
		schemaVersion: 17,
		id: 'project',
		title: 'Project',
		sampleRate: 48_000,
		tracks: [],
		clips: [],
		sources: [],
		selection: { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [] },
		mixer: { groups: [], sends: [], routes: {} },
		trackFolders: [],
		...overrides,
	};
}

function trackFixture(overrides: Partial<ControllerTrack> = {}): ControllerTrack {
	return {
		id: 'track',
		name: 'Track',
		type: 'audio',
		clipIds: [],
		effects: [],
		gain: 1,
		pan: 0,
		...overrides,
	};
}

function clipFixture(id: string, sourceId: string) {
	return {
		id,
		sourceId,
		title: id,
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: 100,
		durationFrames: 100,
	};
}

function sourceFixture(id: string) {
	return {
		id,
		storageKey: id,
		name: id,
		mimeType: 'audio/wav',
		frameCount: 100,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	};
}

function audioBufferFixture(channels: readonly Float32Array[], sampleRate: number) {
	return {
		length: channels[0]?.length ?? 0,
		numberOfChannels: channels.length,
		sampleRate,
		getChannelData: (channel: number) => channels[channel] ?? new Float32Array(),
	};
}

function canonicalPcmIdentity(channels: readonly Float32Array[]) {
	const frameCount = channels[0]?.length ?? 0;
	const bytes = new Uint8Array(4 + channels.length * frameCount * Float32Array.BYTES_PER_ELEMENT);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, frameCount, true);
	let offset = 4;
	for (const channel of channels) {
		for (const sample of channel) {
			view.setFloat32(offset, sample, true);
			offset += Float32Array.BYTES_PER_ELEMENT;
		}
	}
	return Object.freeze({
		contentSha256: createHash('sha256').update(bytes).digest('hex'),
		byteLength: bytes.byteLength,
	});
}
