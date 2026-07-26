import assert from 'node:assert/strict';
import test from 'node:test';

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

test('committed cache preparation retains the semantic clip inventory and materializes exact entries', async () => {
	const project = projectFixture();
	const harness = createHarness(project);

	const entries = await harness.service.prepareCommittedTimePitchCaches(project);

	assert.deepEqual(harness.cache.retained, ['pitched', 'plain', 'video']);
	assert.deepEqual(harness.cache.prepared, ['pitched']);
	assert.equal(entries.length, 1);
	assert.equal(entries[0]?.cacheKey, 'committed-pitched');
	assert.equal(entries[0]?.audioBuffer?.length, 4);
	assert.deepEqual(harness.cache.attached, ['committed-pitched']);
	assert.equal(harness.service.projectHasTimePitchClips(project), true);
	assert.deepEqual(harness.service.projectTimePitchPairs(project).map(({ clip, source }) => [
		clip.id, source.id,
	]), [['pitched', 'source']]);
});

test('late committed preparation cannot attach buffers after a project switch', async () => {
	const project = projectFixture();
	const gate = deferred<ClipTimePitchCacheEntry>();
	const harness = createHarness(project, {
		prepareCommitted: () => gate.promise,
	});

	const pending = harness.service.prepareCommittedTimePitchCaches(project);
	await Promise.resolve();
	harness.switchProject(projectFixture({ id: 'other-project' }));
	gate.resolve(cacheEntry('late', { channels: [new Float32Array(4)] }));

	await assert.rejects(pending, { name: 'AbortError', code: 'PROJECT_CHANGED' });
	assert.deepEqual(harness.cache.attached, []);
});

test('stale playback refreshes apply only while generation, project, and playback still own the task', async () => {
	const project = projectFixture();
	const refresh = deferred<ClipTimePitchCacheEntry>();
	const harness = createHarness(project, {
		resolvePlayback: () => Promise.resolve(cacheEntry('stale', {
			audioBuffer: audioBufferFixture(), stale: true, pending: refresh.promise,
		})),
	});

	const refreshes = await harness.service.beginPlaybackCachePreparation(project);
	assert.equal(refreshes.length, 1);
	assert.ok(harness.state.playbackCacheAbort);
	refresh.resolve(cacheEntry('fresh', { channels: [new Float32Array(4)] }));
	await refreshes[0];
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.deepEqual(harness.appliedProjects, ['project']);
	assert.equal(harness.state.playbackCacheAbort, null);

	const staleRefresh = deferred<ClipTimePitchCacheEntry>();
	harness.setResolvePlayback(() => Promise.resolve(cacheEntry('second-stale', {
		audioBuffer: audioBufferFixture(), stale: true, pending: staleRefresh.promise,
	})));
	const staleRefreshes = await harness.service.beginPlaybackCachePreparation(project);
	assert.equal(harness.service.cancelPlaybackCachePreparation(), true);
	assert.equal(harness.state.playbackCacheAbort, null);
	staleRefresh.resolve(cacheEntry('too-late', { channels: [new Float32Array(4)] }));
	await assert.rejects(staleRefreshes[0]!, { name: 'AbortError' });
	await Promise.resolve();
	assert.deepEqual(harness.appliedProjects, ['project']);
});

test('cache-aware render engines receive both the StaffPad resolver and chunk inventory', () => {
	const harness = createHarness(projectFixture());
	const engine = harness.service.createCacheAwareRenderEngine();

	assert.equal(engine, harness.renderEngine);
	assert.equal(harness.renderEngine.sourceResolver, harness.sourceResolver);
	assert.equal(harness.renderEngine.chunkSources, harness.sourceChunkProviders);
});

function createHarness(
	initialProject: ClipTransformProject,
	options: Readonly<{
		prepareCommitted?: () => Promise<ClipTimePitchCacheEntry>;
		resolvePlayback?: () => Promise<ClipTimePitchCacheEntry>;
	}> = {},
) {
	let project = initialProject;
	let resolvePlayback: () => Promise<ClipTimePitchCacheEntry> = options.resolvePlayback
		?? (() => Promise.resolve(cacheEntry('playback', { audioBuffer: audioBufferFixture() })));
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const generation = new EditorProjectGeneration();
	generation.activate(project.id);
	const cache = new MemoryCache(options.prepareCommitted, () => resolvePlayback());
	const state: ClipTimePitchPlaybackState = {
		playbackCacheGeneration: 0,
		playbackCacheAbort: null,
		recordingStarting: false,
		recorder: null,
	};
	const sourceResolver = Object.freeze({ resolve: () => null });
	const sourceChunkProviders = new Map<string, unknown>();
	const renderEngine = {
		sourceResolver: null as unknown,
		chunkSources: null as unknown,
		setSourceResolver(value: unknown) { this.sourceResolver = value; },
		setChunkSources(value: unknown) { this.chunkSources = value; },
	};
	const appliedProjects: string[] = [];
	const service = createClipTimePitchCacheService({
		lifetime,
		state,
		cache,
		sourceResolver,
		sourceChunkProviders,
		getProject: () => project,
		captureProject: (projectId) => generation.capture(projectId),
		assertProject: (token) => generation.assertCurrent(token),
		createBufferFromChannels: async (channels, sampleRate) => audioBufferFixture(channels, sampleRate),
		createRenderEngine: () => renderEngine,
		applyProjectToPlaybackEngine: async (snapshot) => {
			appliedProjects.push(snapshot.id);
		},
		getPlaybackState: () => 'playing',
		handleError: (error) => { throw error; },
	});
	return {
		appliedProjects,
		cache,
		renderEngine,
		service,
		sourceChunkProviders,
		sourceResolver,
		state,
		setResolvePlayback(next: () => Promise<ClipTimePitchCacheEntry>) { resolvePlayback = next; },
		switchProject(next: ClipTransformProject) {
			project = next;
			generation.activate(next.id);
		},
	};
}

class MemoryCache implements ClipTimePitchCachePort {
	readonly retained: string[] = [];
	readonly prepared: string[] = [];
	readonly attached: string[] = [];
	readonly committed = new Map<string, ClipTimePitchCacheEntry>();

	constructor(
		private readonly prepareOverride?: () => Promise<ClipTimePitchCacheEntry>,
		private readonly playbackOverride?: () => Promise<ClipTimePitchCacheEntry>,
	) {}

	retainClipIds(clipIds: readonly string[]): void {
		this.retained.splice(0, this.retained.length, ...clipIds);
	}

	async prepareCommittedOutput(clip: Readonly<{ id: string }>): Promise<ClipTimePitchCacheEntry> {
		this.prepared.push(clip.id);
		return this.prepareOverride?.() ?? cacheEntry(`committed-${clip.id}`, {
			channels: [new Float32Array(4)],
		});
	}

	async resolveForPlayback(): Promise<ClipTimePitchCacheEntry> {
		return this.playbackOverride?.() ?? cacheEntry('playback', { audioBuffer: audioBufferFixture() });
	}

	getCommitted(cacheKey: string): ClipTimePitchCacheEntry | undefined {
		return this.committed.get(cacheKey);
	}

	async loadCommittedChannels(entry: ClipTimePitchCacheEntry): Promise<Float32Array[]> {
		return entry.channels ?? [new Float32Array(4)];
	}

	attachAudioBuffer(cacheKey: string, audioBuffer: AudioBuffer): void {
		this.attached.push(cacheKey);
		this.committed.set(cacheKey, cacheEntry(cacheKey, { audioBuffer }));
	}
}

function projectFixture(overrides: Partial<ClipTransformProject> = {}): ClipTransformProject {
	return {
		schemaVersion: 4, id: 'project', title: 'Project', sampleRate: 48_000,
		tracks: [{ id: 'track', name: 'Track', type: 'audio', clipIds: ['pitched', 'plain'] }, {
			id: 'video-track', name: 'Video', type: 'video', clipIds: ['video'],
		}],
		clips: [clipFixture({ id: 'pitched', pitchCents: 200 }), clipFixture({ id: 'plain' }), clipFixture({
			id: 'video', sourceId: 'video-source', kind: 'video', pitchCents: 200,
		})],
		sources: [sourceFixture(), sourceFixture({ id: 'video-source', kind: 'video' })],
		selection: null,
		...overrides,
	};
}

function clipFixture(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		id: 'pitched', sourceId: 'source', title: 'Clip', kind: 'audio' as const,
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 4,
		durationFrames: 4, trimStartFrames: 0, trimEndFrames: 0,
		gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
		envelope: [], groupId: null, avLinkId: null, pitchCents: 0, speedRatio: 1,
		preserveFormants: false, stretchToTempo: false, renderCacheRevision: 0,
		...overrides,
	};
}

function sourceFixture(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		id: 'source', storageKey: 'source', name: 'Source', mimeType: 'audio/wav',
		frameCount: 4, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		...overrides,
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
