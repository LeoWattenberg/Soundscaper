/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';

import {
	createSourceLifecycleService,
	type SourceLifecycleServiceRuntime,
} from '../src/common/editor/controller/source/source-lifecycle-service.ts';
import { createSourceLifecycleFixture } from './helpers/audio-editor-source-lifecycle-fixture.ts';

test('visual-only still, generator, and timeline image sources do not enter the PCM missing-source fence', async () => {
	for (const kind of ['still', 'generator', 'image']) {
		const fixture = createSourceLifecycleFixture();
		const source = { id: `${kind}-source`, kind };
		await fixture.service.loadProjectSources({ id: `${kind}-project`, sources: [source],
			clips: [{ id: `${kind}-clip`, kind, sourceId: source.id }] });
		assert.deepEqual([...fixture.missingSourceIds], []);
	}
});
test('a required rendered-video source activates even when only its manifest references it', async () => {
	const fixture = createSourceLifecycleFixture();
	const source = Object.freeze({
		id: 'fallback-video', kind: 'video', storageKey: 'fallback-video',
		frameCount: 48, sampleRate: 48_000, width: 1_280, height: 720, frameRate: 24,
	});
	const project = Object.freeze({
		id: 'video-fallback-project', clips: Object.freeze([]), sources: Object.freeze([source]),
	});
	const controller = new AbortController();

	await fixture.service.loadProjectSources(project, {
		requiredVideoSourceIds: [source.id],
		signal: controller.signal,
	});
	assert.deepEqual(fixture.activatedVideoSources, [source]);

	await fixture.service.ensureProjectSourcesAvailable(project, {
		requiredVideoSourceIds: [source.id],
		signal: controller.signal,
	});
	assert.deepEqual(fixture.activatedVideoSources, [source, source]);
	assert.deepEqual(fixture.activatedVideoSignals, [controller.signal, controller.signal]);
});

test('required rendered-video activation rejects missing, wrong-kind, and unreadable sources', async () => {
	const audio = Object.freeze({ id: 'fallback-video', kind: 'audio' });
	const wrongKind = createSourceLifecycleFixture();
	await assert.rejects(
		wrongKind.service.loadProjectSources(
			{ id: 'project', clips: [], sources: [audio] },
			{ requiredVideoSourceIds: [audio.id] },
		),
		/must be video/iu,
	);
	await assert.rejects(
		wrongKind.service.loadProjectSources(
			{ id: 'project', clips: [], sources: [] },
			{ requiredVideoSourceIds: ['missing-video'] },
		),
		/unavailable/iu,
	);

	const failure = new Error('video body disappeared');
	const unreadable = createSourceLifecycleFixture({ videoFailure: failure });
	await assert.rejects(
		unreadable.service.loadProjectSources(
			{ id: 'project', clips: [], sources: [{ id: 'fallback-video', kind: 'video' }] },
			{ requiredVideoSourceIds: ['fallback-video'] },
		),
		(error) => error === failure,
	);
});

test('late waveform PCM completion is discarded after a project switch', async () => {
	const fixture = createSourceLifecycleFixture();
	const pending = fixture.service.requestWaveformPcmWindow('clip', { startFrame: 0, endFrame: 20 });
	fixture.replaceProject();
	fixture.resolveRead([new Float32Array(20)]);
	assert.equal(await pending, null);
	assert.equal(fixture.clipWaveformPcmRequests.size, 0);
	assert.equal(fixture.clipWaveformPcmWindows.size, 0);
	assert.equal(fixture.publishes(), 0);
});

test('waveform PCM requests reject numeric-string persisted geometry', async () => {
	for (const field of ['durationFrames', 'frameCount'] as const) {
		const fixture = createSourceLifecycleFixture();
		const target = field === 'durationFrames' ? fixture.clip : fixture.source;
		Object.defineProperty(target, field, { value: '100' });
		const pending = fixture.service.requestWaveformPcmWindow('clip', { startFrame: 0, endFrame: 20 });
		fixture.resolveRead([new Float32Array(20)]);
		await assert.rejects(pending, field === 'durationFrames'
			? /non-negative clip duration/iu
			: /non-negative source frame count/iu);
	}
});

test('short source buffers are cached and oversized buffers evict stale entries', () => {
	const fixture = createSourceLifecycleFixture();
	assert.equal(fixture.service.cacheSourceBuffer('source', { byteLength: 128 }), true);
	assert.equal(fixture.cachedBuffers.has('source'), true);
	assert.equal(fixture.service.cacheSourceBuffer('source', { byteLength: 2_048 }), false);
	assert.equal(fixture.cachedBuffers.has('source'), false);
});

test('clearing waveform windows also forgets in-flight ownership', () => {
	const fixture = createSourceLifecycleFixture();
	fixture.clipWaveformPcmRequests.set('clip', {
		sourceId: 'source', startFrame: 0, endFrame: 1, promise: Promise.resolve(null),
	});
	fixture.clipWaveformPcmWindows.set('clip', {
		clipId: 'clip', sourceId: 'source', startFrame: 0, endFrame: 1, channels: [],
	});
	fixture.service.clearWaveformPcmWindows();
	assert.equal(fixture.clipWaveformPcmRequests.size, 0);
	assert.equal(fixture.clipWaveformPcmWindows.size, 0);
});

test('source runtime invalidation clears only that source and suppresses its late waveform publication', async () => {
	const fixture = createSourceLifecycleFixture();
	fixture.cachedBuffers.set('source', {}); fixture.cachedBuffers.set('other', {});
	fixture.sourcePeaks.set('source', {}); fixture.sourcePeaks.set('other', {});
	fixture.clipWaveformPcmWindows.set('cached', {
		clipId: 'cached', sourceId: 'source', startFrame: 0, endFrame: 1, channels: [],
	});
	fixture.clipWaveformPcmWindows.set('other', {
		clipId: 'other', sourceId: 'other', startFrame: 0, endFrame: 1, channels: [],
	});
	const pending = fixture.service.requestWaveformPcmWindow('clip', { startFrame: 0, endFrame: 20 });
	fixture.clipWaveformPcmRequests.set('other', {
		sourceId: 'other', startFrame: 0, endFrame: 1, promise: Promise.resolve(null),
	});

	await fixture.service.invalidateSourceRuntime('source');

	assert.deepEqual([...fixture.cachedBuffers.keys()], ['other']);
	assert.deepEqual([...fixture.sourcePeaks.keys()], ['other']);
	assert.deepEqual([...fixture.clipWaveformPcmWindows.keys()], ['other']);
	assert.deepEqual([...fixture.clipWaveformPcmRequests.keys()], ['other']);
	assert.deepEqual(fixture.deletedAnalyses, ['peak:source']);
	assert.equal(fixture.sourceChunkProviders.has('source'), true);
	fixture.resolveRead([new Float32Array(20)]);
	assert.equal(await pending, null);
	assert.equal(fixture.publishes(), 0);
});

interface RequiredSourceFixtureOptions {
	readonly long?: boolean;
	readonly streamable?: boolean;
	readonly buffer?: Readonly<Record<string, unknown>> | null;
	readonly cacheFits?: boolean;
	readonly metadata?: Readonly<Record<string, unknown>> | null;
	readonly metadataFailure?: Readonly<{ storageKey: string; error: Error }>;
	readonly providerDisposalFailure?: Error;
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
	const cachedBuffers = new Map<string, Readonly<Record<string, unknown>>>([
		['fallback-source', Object.freeze({ stale: true })],
	]);
	const sourceBuffers = {
		[Symbol.iterator]: () => cachedBuffers[Symbol.iterator](),
		has: (id: string) => cachedBuffers.has(id),
		get: (id: string) => cachedBuffers.get(id),
		delete: (id: string) => cachedBuffers.delete(id),
		setIfFits(id: string, value: Readonly<Record<string, unknown>>) {
			if (options.cacheFits === false) return false;
			cachedBuffers.set(id, value);
			return true;
		},
	};
	const sourceChunkProviders = new Map<string, unknown>([[source.id, Object.freeze({ stale: true })]]);
	const publishedProviders: Array<ReadonlyMap<string, unknown>> = [];
	let providerDisposals = 0;
	const freshProvider = Object.freeze({
		marker: 'fresh-provider',
		async dispose() {
			providerDisposals += 1;
			if (options.providerDisposalFailure) throw options.providerDisposalFailure;
		},
	});
	const statuses: string[] = [];
	const missingSourceIds = new Set<string>();
	let bufferReads = 0;
	const runtime: SourceLifecycleServiceRuntime<Readonly<Record<string, unknown>>> = {
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
		createStoredChunkProviderCandidate: () => (
			options.streamable ?? options.long === true ? freshProvider : null
		),
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
			getSourceMetadata: async (storageKey: string) => {
				if (options.metadataFailure?.storageKey === storageKey) {
					throw options.metadataFailure.error;
				}
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
		providerDisposals: () => providerDisposals,
		publishedProviders,
		resolveStall() {
			if (options.stall === 'metadata') metadataStall.resolve(metadata);
			if (options.stall === 'context') contextStall.resolve(audioContext);
			if (options.stall === 'buffer') bufferStall.resolve(loadedBuffer);
		},
		service: createSourceLifecycleService(runtime),
		source,
		sourceChunkProviders,
		freshProvider,
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
	assert.strictEqual(fixture.sourceChunkProviders.get(fixture.source.id), fixture.freshProvider);
	assert.equal(fixture.publishedProviders.length, 1);
	assert.equal(fixture.bufferReads(), 0);
});

test('provider retirement republishes the engine map before awaiting registry cleanup', async () => {
	const fixture = createRequiredSourceFixture({ long: true });
	await fixture.service.loadProjectSources(fixture.project, {
		requiredAudioSourceIds: [fixture.source.id],
	});
	const cleanupStarted = deferred<void>();
	const cleanupGate = deferred<void>();
	Object.assign(fixture.sourceChunkProviders, {
		async drain() {
			cleanupStarted.resolve();
			await cleanupGate.promise;
		},
	});

	const pending = fixture.service.retireSourceChunkProvider(fixture.source.id);
	await cleanupStarted.promise;
	assert.equal(fixture.sourceChunkProviders.has(fixture.source.id), false);
	assert.equal(fixture.publishedProviders.at(-1)?.has(fixture.source.id), false);
	cleanupGate.resolve();
	await pending;
});

test('discard and failed apply retire a staged long-source provider exactly once', async () => {
	const discarded = createRequiredSourceFixture({ long: true });
	const preparation = await discarded.service.prepareRequiredProjectSources(discarded.project, {
		requiredAudioSourceIds: [discarded.source.id],
	});
	await preparation.discard();
	await preparation.discard();
	assert.equal(discarded.providerDisposals(), 1);
	assert.deepEqual(discarded.sourceChunkProviders.get(discarded.source.id), { stale: true });

	const failed = createRequiredSourceFixture({ long: true });
	const failedPreparation = await failed.service.prepareRequiredProjectSources(failed.project, {
		requiredAudioSourceIds: [failed.source.id],
	});
	const failure = new Error('engine apply failed');
	await assert.rejects(
		failedPreparation.commit(() => { throw failure; }),
		(error: unknown) => error === failure,
	);
	await failedPreparation.discard();
	assert.equal(failed.providerDisposals(), 1);
	assert.deepEqual(failed.sourceChunkProviders.get(failed.source.id), { stale: true });
});

test('a later preparation failure retires earlier providers and preserves cleanup failure context', async () => {
	const preparationFailure = new Error('later metadata failed');
	const cleanupFailure = new Error('earlier provider cleanup failed');
	const fixture = createRequiredSourceFixture({
		long: true,
		metadataFailure: { storageKey: 'later-storage', error: preparationFailure },
		providerDisposalFailure: cleanupFailure,
	});
	const laterSource = Object.freeze({
		...fixture.source,
		id: 'later-source',
		storageKey: 'later-storage',
	});
	const project = Object.freeze({
		...fixture.project,
		sources: Object.freeze([fixture.source, laterSource]),
	});

	await assert.rejects(
		fixture.service.prepareRequiredProjectSources(project, {
			requiredAudioSourceIds: [fixture.source.id, laterSource.id],
		}),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.deepEqual(error.errors, [preparationFailure, cleanupFailure]);
			assert.strictEqual(error.cause, preparationFailure);
			return true;
		},
	);
	assert.equal(fixture.providerDisposals(), 1);
	assert.deepEqual(fixture.sourceChunkProviders.get(fixture.source.id), { stale: true });
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
	const prepared = await fixture.service.prepareRequiredProjectSources(playback, {
		requiredAudioSourceIds: [fixture.source.id],
	});
	await prepared.commit((inputs) => {
		assert.equal((inputs.sourceBuffers.get(fixture.source.id) as { length?: number } | undefined)?.length, 4);
	});

	const missing = createRequiredSourceFixture({ buffer: null });
	await assert.rejects(
		missing.service.prepareRequiredProjectSources(playback, {
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
				: fixture.service.prepareRequiredProjectSources(fixture.project, loadOptions);
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
