/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createClipTimePitchCacheService,
	type ClipTimePitchCacheEntry,
	type ClipTimePitchCachePort,
} from '../src/common/editor/controller/clip-time-pitch-service.ts';
import {
	createEditorTransportService,
	type TransportServiceRuntime,
} from '../src/common/editor/controller/transport-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-domain-types.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source-audio.ts';
import {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from '../src/common/editor/controller/lifecycle.ts';

test('play starts again after playback ended while a background cache refresh is still rendering', async () => {
	const harness = createPlaybackHarness({
		resolveForPlayback: (signal) => Promise.resolve(staleEntry(signal)),
	});

	assert.equal(await harness.transport.handleTransport('play'), 'played');
	assert.equal(harness.calls.plays, 1);
	assert.equal(harness.resolveSignals.length, 1);
	assert.equal(harness.resolveSignals[0]?.aborted, false, 'the background refresh is still rendering');

	// Playback reaches the end of the project on its own; nothing cancels the refresh.
	harness.setPlaybackState('stopped');

	assert.equal(await harness.transport.handleTransport('play'), 'played');
	assert.equal(harness.calls.plays, 2);
});

test('play cancels a foreground cache preparation that the previous press is still awaiting', async () => {
	const harness = createPlaybackHarness({
		resolveForPlayback: (signal) => new Promise<ClipTimePitchCacheEntry>((_resolve, reject) => {
			signal?.addEventListener('abort', () => {
				reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
			});
		}),
	});

	const pending = harness.transport.handleTransport('play');
	await Promise.resolve();
	assert.equal(harness.calls.plays, 0);

	assert.equal(await harness.transport.handleTransport('play'), undefined);
	assert.equal(harness.calls.plays, 0);
	await assert.rejects(pending, { name: 'AbortError' });
});

function createPlaybackHarness(options: Readonly<{
	resolveForPlayback(signal: AbortSignal | null | undefined): Promise<ClipTimePitchCacheEntry>;
}>) {
	const project = projectFixture();
	const calls = { plays: 0, pauses: 0, stops: 0 };
	const resolveSignals: (AbortSignal | null | undefined)[] = [];
	let playbackState = 'stopped';
	const state = {
		playbackCacheGeneration: 0,
		playbackCacheAbort: null as AbortController | null,
		playbackCacheRefreshAbort: null as AbortController | null,
		recordingStarting: false,
		recorder: null as unknown,
		playAtSpeedRate: 1,
		playAtSpeedAbort: null as AbortController | null,
		playAtSpeedGeneration: 0,
		timedRecordingPreparing: false,
		timedRecording: false,
		projectBinPreview: null as unknown,
	};
	const cache: ClipTimePitchCachePort = {
		retainClipIds() {},
		prepareCommittedOutput: () => Promise.resolve(cacheEntry('committed')),
		resolveForPlayback: (_clip, _source, resolveOptions) => {
			resolveSignals.push(resolveOptions?.signal);
			return options.resolveForPlayback(resolveOptions?.signal);
		},
		getCommitted: () => undefined,
		loadCommittedChannels: () => Promise.resolve([new Float32Array(4)]),
		attachAudioBuffer() {},
	};
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const generation = new EditorProjectGeneration();
	generation.activate(project.id);
	const timePitch = createClipTimePitchCacheService({
		lifetime,
		state,
		cache,
		sourceResolver: null,
		sourceChunkProviders: new Map<string, unknown>(),
		getProject: () => project,
		captureProject: (projectId) => generation.capture(projectId),
		assertProject: (token) => generation.assertCurrent(token),
		createBufferFromChannels: () => Promise.resolve(audioBufferFixture()),
		createRenderEngine: () => ({ dispose() {} }),
		applyProjectToPlaybackEngine: () => Promise.resolve(undefined),
		getPlaybackState: () => playbackState,
		handleError: (error) => { throw error; },
	});
	const runtime = {
		state,
		copy: { ready: 'Ready', localSourcesMissing: 'Sources missing' },
		engine: {
			getState: () => ({ state: playbackState, playbackMode: 'normal', playbackRate: 1 }),
			play: () => { calls.plays += 1; playbackState = 'playing'; return 'played'; },
			pause: () => { calls.pauses += 1; playbackState = 'paused'; return 'paused'; },
			stop: () => { calls.stops += 1; playbackState = 'stopped'; return 'stopped'; },
		},
		getProject: () => project,
		hasMissingTimelineSources: () => false,
		beginPlaybackCachePreparation: timePitch.beginPlaybackCachePreparation,
		cancelPlaybackCachePreparation: timePitch.cancelPlaybackCachePreparation,
		publishDocumentSnapshot: () => {},
		setStatus: () => {},
		stopProjectBinPreview: () => Promise.resolve(),
	} as unknown as TransportServiceRuntime;
	return {
		calls,
		resolveSignals,
		state,
		transport: createEditorTransportService(runtime),
		setPlaybackState(value: string) { playbackState = value; },
	};
}

function staleEntry(signal: AbortSignal | null | undefined): ClipTimePitchCacheEntry {
	return cacheEntry('stale', {
		audioBuffer: audioBufferFixture(),
		stale: true,
		// A StaffPad render that is still running when playback ends.
		pending: new Promise<ClipTimePitchCacheEntry>((_resolve, reject) => {
			signal?.addEventListener('abort', () => {
				reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
			});
		}),
	});
}

function cacheEntry(
	cacheKey: string,
	overrides: Partial<ClipTimePitchCacheEntry> = {},
): ClipTimePitchCacheEntry {
	return { cacheKey, sampleRate: 48_000, ...overrides };
}

function audioBufferFixture(): AudioBufferLike {
	const channel = new Float32Array(4);
	return {
		length: channel.length,
		numberOfChannels: 1,
		sampleRate: 48_000,
		getChannelData: () => channel,
	};
}

function projectFixture(): ClipTransformProject {
	return {
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		id: 'project',
		title: 'Project',
		sampleRate: 48_000,
		tracks: [{ id: 'track', name: 'Track', type: 'audio', clipIds: ['pitched'] }],
		clips: [{
			id: 'pitched', sourceId: 'source', title: 'Clip', kind: 'audio',
			timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 4,
			durationFrames: 4, trimStartFrames: 0, trimEndFrames: 0,
			gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
			envelope: [], groupId: null, avLinkId: null, pitchCents: 200, speedRatio: 1,
			preserveFormants: false, stretchToTempo: false, renderCacheRevision: 0,
		}],
		sources: [{
			id: 'source', storageKey: 'source', name: 'Source', mimeType: 'audio/wav',
			frameCount: 4, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		}],
		selection: null,
	};
}
