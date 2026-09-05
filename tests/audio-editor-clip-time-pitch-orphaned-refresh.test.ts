import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
	createClipTimePitchCacheService,
	type ClipTimePitchCacheEntry,
	type ClipTimePitchCachePort,
	type ClipTimePitchPlaybackState,
} from '../src/common/editor/controller/clip-time-pitch-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-domain-types.ts';
import {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from '../src/common/editor/controller/lifecycle.ts';

test('cancelling playback preparation leaves no unobserved stale-refresh rejection', async (t) => {
	const unobserved: unknown[] = [];
	const collect = (reason: unknown) => { unobserved.push(reason); };
	process.on('unhandledRejection', collect);
	t.after(() => { process.off('unhandledRejection', collect); });

	const staleRefresh = deferred<ClipTimePitchCacheEntry>();
	// The production cache observes its own `pending` the same way, so the only
	// unobserved promise this test can catch is the service's derived refresh.
	staleRefresh.promise.catch(() => undefined);
	const secondResolve = deferred<void>();
	const reachedSecondClip = deferred<void>();
	const harness = createHarness(projectFixture(), {
		resolvePlayback: async (clipId) => {
			if (clipId === 'first') {
				return cacheEntry('first-stale', {
					audioBuffer: audioBufferFixture(),
					stale: true,
					pending: staleRefresh.promise,
				});
			}
			reachedSecondClip.resolve();
			await secondResolve.promise;
			return cacheEntry('second', { audioBuffer: audioBufferFixture() });
		},
	});

	const preparation = harness.service.beginPlaybackCachePreparation(harness.project);
	await reachedSecondClip.promise;
	assert.equal(harness.service.cancelPlaybackCachePreparation(), true);
	secondResolve.resolve();
	await assert.rejects(preparation, { name: 'AbortError' });

	staleRefresh.resolve(cacheEntry('first-fresh', { channels: [new Float32Array(4)] }));
	await delay(20);

	assert.deepEqual(unobserved, []);
});

function createHarness(
	initialProject: ClipTransformProject,
	options: Readonly<{ resolvePlayback: (clipId: string) => Promise<ClipTimePitchCacheEntry> }>,
) {
	const project = initialProject;
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const generation = new EditorProjectGeneration();
	generation.activate(project.id);
	const state: ClipTimePitchPlaybackState = {
		playbackCacheGeneration: 0,
		playbackCacheAbort: null,
		recordingStarting: false,
		recorder: null,
	};
	const cache: ClipTimePitchCachePort = {
		retainClipIds: () => undefined,
		prepareCommittedOutput: async () => cacheEntry('committed', {
			channels: [new Float32Array(4)],
		}),
		resolveForPlayback: async (clip) => options.resolvePlayback(clip.id),
		getCommitted: () => undefined,
		loadCommittedChannels: async (entry) => entry.channels ?? [new Float32Array(4)],
		attachAudioBuffer: () => undefined,
	};
	const service = createClipTimePitchCacheService({
		lifetime,
		state,
		cache,
		sourceResolver: null,
		sourceChunkProviders: new Map<string, unknown>(),
		getProject: () => project,
		captureProject: (projectId) => generation.capture(projectId),
		assertProject: (token) => generation.assertCurrent(token),
		createBufferFromChannels: async (channels, sampleRate) => audioBufferFixture(
			channels,
			sampleRate,
		),
		createRenderEngine: () => ({ dispose: () => undefined }),
		applyProjectToPlaybackEngine: async () => undefined,
		getPlaybackState: () => 'playing',
		handleError: (error) => { throw error; },
	});
	return { project, service, state };
}

function projectFixture(): ClipTransformProject {
	return {
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		id: 'project',
		title: 'Project',
		sampleRate: 48_000,
		tracks: [{ id: 'track', name: 'Track', type: 'audio', clipIds: ['first', 'second'] }],
		clips: [clipFixture('first'), clipFixture('second')],
		sources: [sourceFixture()],
		selection: null,
	};
}

function clipFixture(id: string) {
	return {
		id,
		sourceId: 'source',
		title: 'Clip',
		kind: 'audio' as const,
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: 4,
		durationFrames: 4,
		trimStartFrames: 0,
		trimEndFrames: 0,
		gain: 1,
		fadeInFrames: 0,
		fadeOutFrames: 0,
		reversed: false,
		envelope: [],
		groupId: null,
		avLinkId: null,
		pitchCents: 200,
		speedRatio: 1,
		preserveFormants: false,
		stretchToTempo: false,
		renderCacheRevision: 0,
	};
}

function sourceFixture() {
	return {
		id: 'source',
		storageKey: 'source',
		name: 'Source',
		mimeType: 'audio/wav',
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	};
}

function cacheEntry(
	cacheKey: string,
	overrides: Partial<ClipTimePitchCacheEntry> = {},
): ClipTimePitchCacheEntry {
	return { cacheKey, sampleRate: 48_000, ...overrides };
}

function audioBufferFixture(
	channels: readonly Float32Array[] = [new Float32Array(4)],
	sampleRate = 48_000,
): AudioBuffer {
	return {
		length: channels[0]?.length ?? 0,
		numberOfChannels: channels.length,
		sampleRate,
		getChannelData: (channel: number) => channels[channel]!,
	} as unknown as AudioBuffer;
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve };
}
