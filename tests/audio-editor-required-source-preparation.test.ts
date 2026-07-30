/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createSourceLifecycleService,
	type SourceLifecycleServiceRuntime,
} from '../src/common/editor/controller/source-lifecycle-service.ts';

interface RequiredSourcePreparation {
	commit<Result>(
		apply: (inputs: Readonly<{
			readonly sourceBuffers: ReadonlyMap<string, unknown>;
			readonly chunkSources: ReadonlyMap<string, unknown>;
		}>) => PromiseLike<Result> | Result,
		options?: Readonly<{
			assertCurrent?: () => void;
			transientBuffers?: ReadonlyMap<string, unknown>;
		}>,
	): Promise<Result>;
	discard(): void;
}

interface TransactionalSourceLifecycleService {
	prepareRequiredProjectSources(
		project: Readonly<Record<string, unknown>>,
		options: Readonly<{
			readonly requiredAudioSourceIds: readonly string[];
			readonly signal?: AbortSignal;
		}>,
	): Promise<RequiredSourcePreparation>;
}

class TestSourceBufferCache extends Map<string, unknown> {
	readonly #fits: boolean;
	readonly #throws: boolean;

	constructor(entries: readonly (readonly [string, unknown])[], fits: boolean, throws: boolean) {
		super(entries);
		this.#fits = fits;
		this.#throws = throws;
	}

	setIfFits(sourceId: string, buffer: unknown): boolean {
		if (this.#throws) throw new Error('cache publication failed');
		if (!this.#fits) return false;
		this.set(sourceId, buffer);
		return true;
	}
}

function createFixture(options: Readonly<{ long?: boolean; cacheFits?: boolean; cacheThrows?: boolean }> = {}) {
	const source = Object.freeze({
		id: 'fallback-source',
		kind: 'audio',
		storageKey: 'fallback-source',
		frameCount: 4,
		channelCount: 2,
		sampleRate: 48_000,
	});
	const project = Object.freeze({
		id: 'fallback-project',
		clips: Object.freeze([]),
		projectBin: Object.freeze({ clips: Object.freeze([]) }),
		sources: Object.freeze([source]),
	});
	const metadata = Object.freeze({
		id: source.id,
		frameCount: source.frameCount,
		channelCount: source.channelCount,
		sampleRate: source.sampleRate,
		chunkFrames: source.frameCount,
		chunkCount: 1,
	});
	const oldBuffer = Object.freeze({ id: 'old-buffer' });
	const preparedBuffer = Object.freeze({
		id: 'prepared-buffer',
		length: source.frameCount,
		numberOfChannels: source.channelCount,
		sampleRate: source.sampleRate,
		getChannelData: () => new Float32Array(source.frameCount),
	});
	const oldProvider = Object.freeze({ id: 'old-provider' });
	const preparedProvider = Object.freeze({ id: 'prepared-provider' });
	const sourceBuffers = new TestSourceBufferCache(
		[[source.id, oldBuffer]],
		options.cacheFits !== false,
		options.cacheThrows === true,
	);
	const sourceChunkProviders = new Map<string, unknown>([[source.id, oldProvider]]);
	const publishedProviders: Array<ReadonlyMap<string, unknown>> = [];
	const missingSourceIds = new Set<string>();
	const statuses: string[] = [];
	const runtime = {
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES: 2,
		MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES: 100,
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 64,
		activateVideoSource: async () => undefined,
		allProjectClips: (candidate: typeof project) => [
			...candidate.clips,
			...candidate.projectBin.clips,
		],
		audioBufferChannels: () => [],
		clipSourceWindowRange: (_clip: unknown, startFrame: number, endFrame: number) => ({ startFrame, endFrame }),
		clipWaveformPcmRequests: new Map(),
		clipWaveformPcmWindows: new Map(),
		copy: {},
		createStoredChunkProvider: () => preparedProvider,
		engine: {
			getAudioContext: async () => Object.freeze({ createBuffer() {} }),
			setChunkSources(providers: ReadonlyMap<string, unknown>) {
				publishedProviders.push(new Map(providers));
			},
		},
		findClip: () => null,
		findSource: () => source,
		generateStoredWaveformPeaks: async () => ({ levels: [] }),
		generateWaveformPeaks: async () => ({ levels: [] }),
		getProject: () => project,
		isStreamableStoredSource: () => options.long === true,
		legacyPeakCacheKey: (sourceId: string) => `legacy:${sourceId}`,
		peakCacheKey: (sourceId: string) => `peak:${sourceId}`,
		publishDocumentSnapshot: () => undefined,
		readStoredAudioBuffer: async () => preparedBuffer,
		readWaveformPcmWindow: async () => [],
		setStatus: (message: unknown) => { statuses.push(String(message)); },
		sourceAudioBufferBytes: (buffer: typeof preparedBuffer) => buffer.length * buffer.numberOfChannels * 4,
		sourceBuffers,
		sourceChunkProviders,
		sourcePcmBytes: () => options.long ? 128 : 32,
		sourcePeaks: new Map(),
		state: { missingSourceIds },
		store: {
			getSourceMetadata: async () => metadata,
			readSourceChunk: async () => ({ channels: [] }),
			loadAnalysis: async () => null,
			saveAnalysis: async () => undefined,
			deleteAnalysis: async () => undefined,
		},
		waveformPcmWindowContains: () => false,
		waveformPeaksHaveRms: () => true,
	} satisfies SourceLifecycleServiceRuntime;
	return Object.freeze({
		service: createSourceLifecycleService(runtime) as unknown as TransactionalSourceLifecycleService,
		project,
		source,
		oldBuffer,
		preparedBuffer,
		oldProvider,
		preparedProvider,
		sourceBuffers,
		sourceChunkProviders,
		publishedProviders,
		missingSourceIds,
		statuses,
	});
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return Object.freeze({ promise, resolve });
}

function prepare(
	fixture: ReturnType<typeof createFixture>,
	signal?: AbortSignal,
): Promise<RequiredSourcePreparation> {
	return fixture.service.prepareRequiredProjectSources(fixture.project, {
		requiredAudioSourceIds: [fixture.source.id],
		signal,
	});
}

function assertUnpublished(fixture: ReturnType<typeof createFixture>): void {
	assert.strictEqual(fixture.sourceBuffers.get(fixture.source.id), fixture.oldBuffer);
	assert.strictEqual(fixture.sourceChunkProviders.get(fixture.source.id), fixture.oldProvider);
	assert.deepEqual(fixture.publishedProviders, []);
	assert.equal(fixture.missingSourceIds.size, 0);
	assert.deepEqual(fixture.statuses, []);
}

test('required short-buffer preparation publishes only after its engine callback succeeds', async () => {
	const fixture = createFixture();
	const prepared = await prepare(fixture);

	assertUnpublished(fixture);
	const result = await prepared.commit((inputs) => {
		assertUnpublished(fixture);
		assert.strictEqual(inputs.sourceBuffers.get(fixture.source.id), fixture.preparedBuffer);
		assert.equal(inputs.chunkSources.has(fixture.source.id), false);
		return 'applied';
	});
	assert.equal(result, 'applied');
	assert.strictEqual(fixture.sourceBuffers.get(fixture.source.id), fixture.preparedBuffer);
	assert.equal(fixture.sourceChunkProviders.has(fixture.source.id), false);
	assert.deepEqual(fixture.publishedProviders, []);

	await assert.rejects(prepared.commit(() => undefined), /already committed/iu);
	prepared.discard();
	assert.strictEqual(fixture.sourceBuffers.get(fixture.source.id), fixture.preparedBuffer);
	assert.deepEqual(fixture.publishedProviders, []);
});

test('required long-provider preparation publishes only after its engine callback succeeds', async () => {
	const fixture = createFixture({ long: true });
	const prepared = await prepare(fixture);

	assertUnpublished(fixture);
	await prepared.commit((inputs) => {
		assertUnpublished(fixture);
		assert.equal(inputs.sourceBuffers.has(fixture.source.id), false);
		assert.strictEqual(inputs.chunkSources.get(fixture.source.id), fixture.preparedProvider);
	});
	assert.equal(fixture.sourceBuffers.has(fixture.source.id), false);
	assert.strictEqual(fixture.sourceChunkProviders.get(fixture.source.id), fixture.preparedProvider);
	assert.deepEqual(fixture.publishedProviders, []);

	await assert.rejects(prepared.commit(() => undefined), /already committed/iu);
	prepared.discard();
	assert.strictEqual(fixture.sourceChunkProviders.get(fixture.source.id), fixture.preparedProvider);
	assert.deepEqual(fixture.publishedProviders, []);
});

test('discarding prepared short buffers or long providers preserves prior identities', async () => {
	for (const fixture of [createFixture(), createFixture({ long: true })]) {
		const prepared = await prepare(fixture);
		assertUnpublished(fixture);

		prepared.discard();
		prepared.discard();
		assertUnpublished(fixture);
		await assert.rejects(prepared.commit(() => undefined), /already discarded/iu);
		assertUnpublished(fixture);
	}
});

test('engine failure and cache refusal never expose a stale required representation', async () => {
	const failed = createFixture();
	const failedPreparation = await prepare(failed);
	const engineFailure = new Error('engine load failed');
	await assert.rejects(failedPreparation.commit(() => { throw engineFailure; }), (error) => error === engineFailure);
	assertUnpublished(failed);

	const uncached = createFixture({ cacheFits: false });
	const uncachedPreparation = await prepare(uncached);
	await uncachedPreparation.commit((inputs) => {
		assert.strictEqual(inputs.sourceBuffers.get(uncached.source.id), uncached.preparedBuffer);
		assert.equal(inputs.chunkSources.has(uncached.source.id), false);
	});
	assert.equal(uncached.sourceBuffers.has(uncached.source.id), false);
	assert.equal(uncached.sourceChunkProviders.has(uncached.source.id), false);
});

test('cache publication failure preserves prior required source identities', async () => {
	const fixture = createFixture({ cacheThrows: true });
	const prepared = await prepare(fixture);
	await assert.rejects(prepared.commit(() => undefined), /cache publication failed/iu);
	assertUnpublished(fixture);
});

test('a publication-boundary currentness failure preserves prior required source identities', async () => {
	const fixture = createFixture({ long: true });
	const prepared = await prepare(fixture);
	const stale = new DOMException('prepared source owner is stale', 'AbortError');
	await assert.rejects(prepared.commit(() => undefined, {
		assertCurrent() { throw stale; },
	}), (error) => error === stale);
	assertUnpublished(fixture);
});

test('cancellation after engine entry preserves the exact reason and prior shared identities', async () => {
	const fixture = createFixture({ long: true });
	const controller = new AbortController();
	const prepared = await prepare(fixture, controller.signal);
	const started = deferred<void>();
	const release = deferred<void>();
	const reason = new DOMException('superseded during engine apply', 'AbortError');
	const committing = prepared.commit(async (inputs) => {
		assert.strictEqual(inputs.chunkSources.get(fixture.source.id), fixture.preparedProvider);
		assertUnpublished(fixture);
		started.resolve();
		await release.promise;
	});
	await started.promise;
	controller.abort(reason);
	release.resolve();
	await assert.rejects(committing, (error) => error === reason);
	assertUnpublished(fixture);
});

test('required staged buffers win over ordinary transients in the private engine snapshot', async () => {
	const fixture = createFixture();
	const prepared = await prepare(fixture);
	const ordinary = Object.freeze({ id: 'ordinary-buffer' });
	const conflicting = Object.freeze({ id: 'conflicting-buffer' });
	await prepared.commit((inputs) => {
		assert.strictEqual(inputs.sourceBuffers.get('ordinary-source'), ordinary);
		assert.strictEqual(inputs.sourceBuffers.get(fixture.source.id), fixture.preparedBuffer);
	}, { transientBuffers: new Map<string, unknown>([
		['ordinary-source', ordinary],
		[fixture.source.id, conflicting],
	]) });
});
