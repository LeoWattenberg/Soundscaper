/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';

import {
	createSourceLifecycleService,
	type SourceLifecycleServiceRuntime,
} from '../src/common/editor/controller/source-lifecycle-service.ts';

function createFixture() {
	const source = { id: 'source', kind: 'audio', frameCount: 100, storageKey: 'source' };
	const clip = { id: 'clip', sourceId: source.id, durationFrames: 100 };
	let project = { id: 'project-a', clips: [clip], sources: [source] };
	let resolveRead: (channels: Float32Array[]) => void = () => undefined;
	let publishes = 0;
	const clipWaveformPcmRequests = new Map<string, unknown>();
	const clipWaveformPcmWindows = new Map<string, unknown>();
	const sourceChunkProviders = new Map<string, unknown>([['source', { id: 'provider' }]]);
	const sourcePeaks = new Map<string, unknown>();
	const cachedBuffers = new Map<string, unknown>();
	const sourceBuffers = {
		has: (id: string) => cachedBuffers.has(id),
		get: (id: string) => cachedBuffers.get(id),
		delete: (id: string) => cachedBuffers.delete(id),
		setIfFits(id: string, value: unknown) {
			cachedBuffers.set(id, value);
			return true;
		},
	};
	const runtime: SourceLifecycleServiceRuntime = {
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES: 2,
		MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES: 100,
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 1_024,
		activateVideoSource: async () => undefined,
		allProjectClips: (value) => value.clips,
		audioBufferChannels: () => [],
		clipSourceWindowRange: (_value, startFrame, endFrame) => ({ startFrame, endFrame }),
		clipWaveformPcmRequests,
		clipWaveformPcmWindows,
		copy: {},
		createStoredChunkProvider: () => ({ id: 'created-provider' }),
		engine: { getAudioContext: async () => null },
		findClip: (value, id) => value.clips.find((candidate: { id: string }) => candidate.id === id),
		findSource: (value, id) => value.sources.find((candidate: { id: string }) => candidate.id === id),
		generateStoredWaveformPeaks: async () => ({ levels: [] }),
		generateWaveformPeaks: async () => ({ levels: [] }),
		getProject: () => project,
		isStreamableStoredSource: () => true,
		legacyPeakCacheKey: (id) => `legacy:${id}`,
		peakCacheKey: (id) => `peak:${id}`,
		publishDocumentSnapshot: () => { publishes += 1; },
		readStoredAudioBuffer: async () => null,
		readWaveformPcmWindow: () => new Promise<Float32Array[]>((resolve) => { resolveRead = resolve; }),
		setStatus: () => undefined,
		sourceAudioBufferBytes: (value) => value.byteLength,
		sourceBuffers,
		sourceChunkProviders,
		sourcePcmBytes: () => 0,
		sourcePeaks,
		state: { missingSourceIds: new Set<string>() },
		store: {},
		waveformPcmWindowContains: () => false,
		waveformPeaksHaveRms: () => true,
	};
	return {
		service: createSourceLifecycleService(runtime),
		cachedBuffers,
		clipWaveformPcmRequests,
		clipWaveformPcmWindows,
		publishes: () => publishes,
		replaceProject() {
			project = { ...project, id: 'project-b' };
		},
		resolveRead(channels: Float32Array[]) {
			resolveRead(channels);
		},
	};
}

test('late waveform PCM completion is discarded after a project switch', async () => {
	const fixture = createFixture();
	const pending = fixture.service.requestWaveformPcmWindow('clip', { startFrame: 0, endFrame: 20 });
	fixture.replaceProject();
	fixture.resolveRead([new Float32Array(20)]);
	assert.equal(await pending, null);
	assert.equal(fixture.clipWaveformPcmRequests.size, 0);
	assert.equal(fixture.clipWaveformPcmWindows.size, 0);
	assert.equal(fixture.publishes(), 0);
});

test('short source buffers are cached and oversized buffers evict stale entries', () => {
	const fixture = createFixture();
	assert.equal(fixture.service.cacheSourceBuffer('source', { byteLength: 128 }), true);
	assert.equal(fixture.cachedBuffers.has('source'), true);
	assert.equal(fixture.service.cacheSourceBuffer('source', { byteLength: 2_048 }), false);
	assert.equal(fixture.cachedBuffers.has('source'), false);
});

test('clearing waveform windows also forgets in-flight ownership', () => {
	const fixture = createFixture();
	fixture.clipWaveformPcmRequests.set('clip', {});
	fixture.clipWaveformPcmWindows.set('clip', {});
	fixture.service.clearWaveformPcmWindows();
	assert.equal(fixture.clipWaveformPcmRequests.size, 0);
	assert.equal(fixture.clipWaveformPcmWindows.size, 0);
});

interface RequiredSourceFixtureOptions {
	readonly long?: boolean;
	readonly streamable?: boolean;
	readonly buffer?: Readonly<Record<string, unknown>> | null;
	readonly cacheFits?: boolean;
	readonly metadata?: Readonly<Record<string, unknown>> | null;
	readonly stall?: 'metadata' | 'context' | 'buffer';
}

function deferred<T>() {
	let resolvePromise: (value: T) => void = () => undefined;
	const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
	return Object.freeze({ promise, resolve: resolvePromise });
}

function createRequiredSourceFixture(options: RequiredSourceFixtureOptions = {}) {
	const source = Object.freeze({
		id: 'fallback-source', kind: 'audio', storageKey: 'fallback-storage',
		frameCount: 4, channelCount: 2, sampleRate: 48_000, chunkFrames: 4,
	});
	const project = Object.freeze({
		id: 'fallback-project',
		clips: Object.freeze([]),
		projectBin: Object.freeze({ clips: Object.freeze([]) }),
		sources: Object.freeze([source]),
	});
	const defaultBuffer = Object.freeze({
		length: 4,
		numberOfChannels: 2,
		sampleRate: 48_000,
		getChannelData: () => new Float32Array(4),
	});
	const loadedBuffer = options.buffer === undefined ? defaultBuffer : options.buffer;
	const metadata = options.metadata === undefined ? Object.freeze({
		id: source.id,
		frameCount: source.frameCount,
		channelCount: source.channelCount,
		sampleRate: source.sampleRate,
		chunkFrames: source.chunkFrames,
		chunkCount: 1,
	}) : options.metadata;
	const metadataStall = deferred<typeof metadata>();
	const audioContext = Object.freeze({ createBuffer() {} });
	const contextStall = deferred<typeof audioContext>();
	const bufferStall = deferred<typeof loadedBuffer>();
	const stallStarted = deferred<void>();
	const cachedBuffers = new Map<string, unknown>([['fallback-source', Object.freeze({ stale: true })]]);
	const sourceBuffers = {
		has: (id: string) => cachedBuffers.has(id),
		get: (id: string) => cachedBuffers.get(id),
		delete: (id: string) => cachedBuffers.delete(id),
		setIfFits(id: string, value: unknown) {
			if (options.cacheFits === false) return false;
			cachedBuffers.set(id, value);
			return true;
		},
	};
	const sourceChunkProviders = new Map<string, unknown>([[source.id, Object.freeze({ stale: true })]]);
	const publishedProviders: Array<ReadonlyMap<string, unknown>> = [];
	const statuses: string[] = [];
	const missingSourceIds = new Set<string>();
	let bufferReads = 0;
	const runtime: SourceLifecycleServiceRuntime = {
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES: 2,
		MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES: 100,
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 16,
		activateVideoSource: async () => undefined,
		allProjectClips: (value) => [...value.clips, ...(value.projectBin?.clips ?? [])],
		audioBufferChannels: () => [],
		clipSourceWindowRange: (_value, startFrame, endFrame) => ({ startFrame, endFrame }),
		clipWaveformPcmRequests: new Map(),
		clipWaveformPcmWindows: new Map(),
		copy: {},
		createStoredChunkProvider: () => Object.freeze({ marker: 'fresh-provider' }),
		engine: {
			getAudioContext: async () => {
				if (options.stall === 'context') {
					stallStarted.resolve();
					return contextStall.promise;
				}
				return audioContext;
			},
			setChunkSources(providers: ReadonlyMap<string, unknown>) {
				publishedProviders.push(new Map(providers));
			},
		},
		findClip: () => null,
		findSource: () => source,
		generateStoredWaveformPeaks: async () => ({ levels: [] }),
		generateWaveformPeaks: async () => ({ levels: [] }),
		getProject: () => project,
		isStreamableStoredSource: () => options.streamable ?? options.long === true,
		legacyPeakCacheKey: (id) => `legacy:${id}`,
		peakCacheKey: (id) => `peak:${id}`,
		publishDocumentSnapshot: () => undefined,
		readStoredAudioBuffer: async () => {
			bufferReads += 1;
			if (options.stall === 'buffer') {
				stallStarted.resolve();
				return bufferStall.promise;
			}
			return loadedBuffer;
		},
		readWaveformPcmWindow: async () => [],
		setStatus: (message) => { statuses.push(String(message)); },
		sourceAudioBufferBytes: (value) => Number(value.length) * Number(value.numberOfChannels) * 4,
		sourceBuffers,
		sourceChunkProviders,
		sourcePcmBytes: () => options.long ? 32 : 8,
		sourcePeaks: new Map(),
		state: { missingSourceIds },
		store: {
			getSourceMetadata: async () => {
				if (options.stall === 'metadata') {
					stallStarted.resolve();
					return metadataStall.promise;
				}
				return metadata;
			},
			readSourceChunk: async () => ({ channels: [] }),
			loadAnalysis: async () => null,
			saveAnalysis: async () => undefined,
			deleteAnalysis: async () => undefined,
		},
		waveformPcmWindowContains: () => false,
		waveformPeaksHaveRms: () => true,
	};
	return {
		bufferReads: () => bufferReads,
		cachedBuffers,
		missingSourceIds,
		project,
		publishedProviders,
		resolveStall() {
			if (options.stall === 'metadata') metadataStall.resolve(metadata);
			if (options.stall === 'context') contextStall.resolve(audioContext);
			if (options.stall === 'buffer') bufferStall.resolve(loadedBuffer);
		},
		service: createSourceLifecycleService(runtime),
		source,
		sourceChunkProviders,
		stallStarted: stallStarted.promise,
		statuses,
	};
}

test('fallback-only required long sources replace stale providers before playback', async () => {
	const fixture = createRequiredSourceFixture({ long: true });
	const transients = await fixture.service.loadProjectSources(fixture.project, {
		requiredAudioSourceIds: [fixture.source.id],
	});
	assert.equal(transients.size, 0);
	assert.deepEqual(fixture.sourceChunkProviders.get(fixture.source.id), { marker: 'fresh-provider' });
	assert.equal(fixture.publishedProviders.length, 1);
	assert.equal(fixture.bufferReads(), 0);
});

test('required long sources reject before whole-buffer decode when chunk streaming is unavailable', async () => {
	const fixture = createRequiredSourceFixture({ long: true, streamable: false });
	await assert.rejects(
		fixture.service.loadProjectSources(fixture.project, {
			requiredAudioSourceIds: [fixture.source.id],
		}),
		/required rendered fallback source.*playable chunk provider/iu,
	);
	assert.equal(fixture.bufferReads(), 0);
	assert.equal(fixture.sourceChunkProviders.has(fixture.source.id), false);
});

test('required short sources are reread and returned transiently when the shared cache is full', async () => {
	const fixture = createRequiredSourceFixture({ cacheFits: false });
	const transients = await fixture.service.loadProjectSources(fixture.project, {
		requiredAudioSourceIds: [fixture.source.id],
	});
	assert.equal(fixture.bufferReads(), 1);
	assert.equal(fixture.cachedBuffers.has(fixture.source.id), false, 'the stale buffer must be evicted');
	assert.equal(transients.get(fixture.source.id)?.length, 4);
	assert.equal(fixture.sourceChunkProviders.has(fixture.source.id), false);
});

test('required source preparation rejects missing bodies and geometry drift while ordinary loads stay best effort', async () => {
	for (const fixture of [
		createRequiredSourceFixture({ buffer: null }),
		createRequiredSourceFixture({ buffer: {
			length: 3, numberOfChannels: 2, sampleRate: 48_000,
			getChannelData: () => new Float32Array(3),
		} }),
		createRequiredSourceFixture({ metadata: null, long: true }),
	]) {
		await assert.rejects(
			fixture.service.loadProjectSources(fixture.project, {
				requiredAudioSourceIds: [fixture.source.id],
			}),
			/rendered fallback|required.*source|unavailable|geometry|metadata/iu,
		);
	}

	const ordinary = createRequiredSourceFixture({ buffer: null });
	const project = {
		...ordinary.project,
		clips: [{ id: 'ordinary-clip', sourceId: ordinary.source.id }],
	};
	const transients = await ordinary.service.loadProjectSources(project);
	assert.equal(transients.size, 0);
	assert.equal(ordinary.statuses.length, 0, 'a legacy null decode remains a silent best-effort miss');
});

test('playback reapply source preparation enforces required fallback readiness', async () => {
	const fixture = createRequiredSourceFixture({ cacheFits: false });
	const playback = {
		...fixture.project,
		clips: [{ id: 'fallback-clip', kind: 'audio', sourceId: fixture.source.id }],
	};
	const transients = await fixture.service.ensureProjectSourcesAvailable(playback, {
		requiredAudioSourceIds: [fixture.source.id],
	});
	assert.equal(transients.get(fixture.source.id)?.length, 4);

	const missing = createRequiredSourceFixture({ buffer: null });
	await assert.rejects(
		missing.service.ensureProjectSourcesAvailable(playback, {
			requiredAudioSourceIds: [missing.source.id],
		}),
		/rendered fallback|required.*source|unavailable/iu,
	);
});

test('abort promptly and atomically cancels signal-ignoring required source readiness', async () => {
	const timeout = Symbol('timeout');
	const outcomes = [];
	const stalls = [
		{ name: 'metadata', stall: 'metadata', long: false },
		{ name: 'metadata (long stream)', stall: 'metadata', long: true },
		{ name: 'context', stall: 'context', long: false },
		{ name: 'buffer', stall: 'buffer', long: false },
	] as const;
	for (const operationName of ['initial load', 'playback reapply'] as const) {
		for (const stallCase of stalls) {
			const fixture = createRequiredSourceFixture({
				stall: stallCase.stall,
				long: stallCase.long,
			});
			fixture.cachedBuffers.clear();
			fixture.sourceChunkProviders.clear();
			const controller = new AbortController();
			const reason = new DOMException(`cancel stalled ${stallCase.name} readiness`, 'AbortError');
			const loadOptions = {
				requiredAudioSourceIds: [fixture.source.id],
				signal: controller.signal,
			};
			const operation = operationName === 'initial load'
				? fixture.service.loadProjectSources(fixture.project, loadOptions)
				: fixture.service.ensureProjectSourcesAvailable(fixture.project, loadOptions);
			const terminal = operation.then(
				(value) => ({ kind: 'fulfilled' as const, value }),
				(error: unknown) => ({ kind: 'rejected' as const, error }),
			);
			await fixture.stallStarted;
			controller.abort(reason);
			const prompt = await Promise.race([
				terminal,
				delay(250, timeout, { ref: false }),
			]);
			fixture.resolveStall();
			await terminal;
			await nextTurn();
			outcomes.push({
				operationName,
				stall: stallCase.name,
				reason,
				prompt,
				cachedBuffers: fixture.cachedBuffers.size,
				providers: fixture.sourceChunkProviders.size,
				enginePublications: fixture.publishedProviders.length,
				missingSources: fixture.missingSourceIds.size,
				statuses: fixture.statuses.length,
			});
		}
	}

	for (const outcome of outcomes) {
		const label = `${outcome.operationName} ${outcome.stall}`;
		assert.notEqual(outcome.prompt, timeout, `${label} abort must not await the storage provider`);
		assert.equal(typeof outcome.prompt, 'object');
		if (typeof outcome.prompt !== 'object') continue;
		assert.equal(outcome.prompt.kind, 'rejected');
		if (outcome.prompt.kind !== 'rejected') continue;
		assert.equal(outcome.prompt.error, outcome.reason, `${label} must preserve the exact abort reason`);
		assert.equal(outcome.cachedBuffers, 0, `${label} late completion must not publish a buffer`);
		assert.equal(outcome.providers, 0, `${label} late completion must not publish a provider`);
		assert.equal(outcome.enginePublications, 0, `${label} late completion must not publish engine sources`);
		assert.equal(outcome.missingSources, 0, `${label} cancellation must not mark the source missing`);
		assert.equal(outcome.statuses, 0, `${label} cancellation must not publish an error status`);
	}
});
