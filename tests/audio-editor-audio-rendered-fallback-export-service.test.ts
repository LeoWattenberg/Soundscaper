/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEditorExportService,
	type ExportServiceRuntime,
} from '../src/common/editor/controller/export-service.ts';
import { createPlaybackProjectService } from '../src/common/editor/controller/playback-project-service.ts';
import type { EngineChunkSource } from '../src/common/editor/engine/types.ts';
import { PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-audio-rendered-fallback.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { PROJECT_AUDIO_FALLBACK_INTEGRITY_ERROR_CODE } from '../src/common/editor/project-fallback-integrity.ts';
import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
	type AudioEditorProjectV9,
} from '../src/common/editor/project-v9.ts';
import { inspectWavLayout } from '../src/common/editor/wav.js';

const CANONICAL_SOURCE_ID = 'canonical-audio';
const FALLBACK_SOURCE_ID = 'fallback-audio';
const FALLBACK_DIGEST = 'de'.repeat(32);

type Strategy = 'offline' | 'realtime-stream';

interface FixtureOptions {
	readonly activeFallback?: boolean;
	readonly directDestination?: boolean;
	readonly renderFailure?: unknown;
	readonly strategy?: Strategy;
}

interface ExportPlan extends Readonly<Record<string, unknown>> {
	readonly mode: 'mix';
	readonly format: 'wav';
	readonly mimeType: 'audio/wav';
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly outputFrames: number;
	readonly outputBytesPerRender: number;
	readonly outputFileBytesPerRender: number;
	readonly requiredTemporaryBytes: number;
	readonly encoding: Readonly<{
		bitDepth: 24;
		floatingPoint: false;
		sampleFormat: 'int24';
	}>;
	readonly ditherMode: 'none';
	readonly render: Readonly<{ strategy: Strategy }>;
	readonly range: Readonly<{ startFrame: number; endFrame: number; durationFrames: number }>;
	readonly tailFrames: number;
	readonly outputs: readonly Readonly<{ fileName: string; trackId: null }>[];
}

test('active audio fallback offline mix uses only the private verified source', async () => {
	const fixture = createFixture();
	const before = structuredClone(fixture.canonical);

	const result = await createEditorExportService(fixture.runtime).handleExportAction('export');

	assert.equal(result.fileName, 'fallback-mix.wav');
	assert.deepEqual(fixture.canonical, before, 'export must not mutate canonical project state');
	assertOrder(fixture.events, [
		'projection', 'verify', 'admission-current', 'provider', 'plan', 'preflight', 'render-offline',
	]);
	assert.equal(fixture.events.includes('prepare-caches'), false);
	assert.equal(fixture.events.includes('create-engine'), false);
	assertGlobalCachesUnchanged(fixture);
});

test('active audio fallback realtime mix routes the private provider into the render engine', async () => {
	const fixture = createFixture({ strategy: 'realtime-stream', directDestination: true });

	const result = await createEditorExportService(fixture.runtime).handleExportAction('export');

	assert.equal(result.fileName, 'fallback-mix.wav');
	assert.equal(result.url, null);
	assert.equal(result.method, 'filesystem');
	assertOrder(fixture.events, [
		'projection', 'verify', 'admission-current', 'provider', 'plan', 'picker', 'destination-open',
		'create-engine', 'load-project', 'render-realtime', 'destination-close', 'destination-commit',
	]);
	assert.equal(fixture.events.includes('render-offline'), false);
	assert.equal(fixture.events.includes('prepare-caches'), false);
	assert.equal(fixture.events.includes('preflight'), false);
	assert.equal(fixture.events.includes('temporary-sink'), false);
	assert.equal(fixture.events.includes('download'), false);
	assertGlobalCachesUnchanged(fixture);
});

test('active audio fallback refuses stems and BW64 or ADM before export side effects', async () => {
	for (const [label, settings] of [
		['stems', { mode: 'stems', format: 'wav' }],
		['BW64', { mode: 'mix', format: 'bw64' }],
		['ADM', { mode: 'mix', format: 'wav', adm: { mode: 'authored' } }],
	] as const) {
		const fixture = createFixture();

		assert.equal(
			await createEditorExportService(fixture.runtime).handleExportAction('export', settings),
			undefined,
			label,
		);
		assert.equal(fixture.errors.length, 1, `${label} must report one refusal`);
		assert.match((fixture.errors[0] as Error).message, /audio rendered-fallback|fallback.*(?:mix|BW64|ADM)/iu);
		for (const forbidden of [
			'verify', 'plan', 'picker', 'preflight', 'render-offline', 'create-engine', 'render-realtime',
		]) {
			assert.equal(fixture.events.includes(forbidden), false, `${label} reached ${forbidden}`);
		}
		assertGlobalCachesUnchanged(fixture);
	}
});

test('ordinary audio export preserves the existing render callback contract', async () => {
	const fixture = createFixture({ activeFallback: false });

	const result = await createEditorExportService(fixture.runtime).handleExportAction('export');

	assert.deepEqual(fixture.errors, [], `ordinary export errors: ${String(fixture.errors)}`);
	assert.equal(result.fileName, 'fallback-mix.wav');
	assert.equal(fixture.events.includes('verify'), false);
	assert.equal(fixture.ordinaryRenderObserved, true);
	assertGlobalCachesUnchanged(fixture);
});

test('audio fallback integrity errors do not retry offline rendering in realtime', async () => {
	const integrityFailure = Object.assign(
		new Error('Fallback source changed after integrity admission.'),
		{ code: PROJECT_AUDIO_FALLBACK_INTEGRITY_ERROR_CODE },
	);
	const fixture = createFixture({ renderFailure: integrityFailure });

	assert.equal(
		await createEditorExportService(fixture.runtime).handleExportAction('export'),
		undefined,
	);
	assert.strictEqual(fixture.errors[0], integrityFailure);
	assert.equal(fixture.events.includes('render-offline'), true);
	assert.equal(fixture.events.includes('prepare-caches'), false);
	assert.equal(fixture.events.includes('create-engine'), false);
	assert.equal(fixture.events.includes('render-realtime'), false);
	assert.equal(fixture.events.includes('status:Realtime fallback'), false);
});

function createFixture(options: FixtureOptions = {}) {
	const activeFallback = options.activeFallback !== false;
	const directDestination = options.directDestination === true;
	const strategy = options.strategy ?? 'offline';
	const canonical = fallbackProject();
	const events: string[] = [];
	const errors: unknown[] = [];
	const globalBuffer = Object.freeze({ owner: 'global-buffer' });
	const globalProvider = chunkProvider('global');
	const verifiedProvider = chunkProvider('verified');
	const sourceBuffers = new Map<string, unknown>([[CANONICAL_SOURCE_ID, globalBuffer]]);
	const sourceChunkProviders = new Map<string, EngineChunkSource>([[CANONICAL_SOURCE_ID, globalProvider]]);
	const store = Object.freeze({ owner: 'project-store' });
	const playback = createPlaybackProjectService({
		audioEffects: !activeFallback,
	});
	const audio = Object.freeze({
		sampleRate: 48_000,
		length: 2,
		numberOfChannels: 2,
		channels: Object.freeze([Float32Array.of(0.25, -0.25), Float32Array.of(-0.25, 0.25)]),
	});
	const state = {
		exportGeneration: 0,
		exportAbort: null,
		mobile: false,
		outputUrl: null,
		outputCleanup: null,
		exportOutput: null,
		disposed: false,
	};
	let ordinaryRenderObserved = false;
	let currentController: AbortController | null = null;
	const plan = exportPlan(strategy);
	let destinationBytes = 0;
	let destinationClosed = false;
	const preparedDirectDestination = Object.freeze({
		mode: 'stream' as const,
		async createWritable(byteLength: number, sizeMode: string) {
			events.push('destination-open');
			assert.equal(byteLength, plan.outputFileBytesPerRender);
			assert.equal(sizeMode, 'exact');
			return new WritableStream<Uint8Array>({
				write(chunk) { destinationBytes += chunk.byteLength; },
				close() { destinationClosed = true; events.push('destination-close'); },
			});
		},
		bytesWritten: () => destinationBytes,
		commit() {
			events.push('destination-commit');
			assert.equal(destinationClosed, true);
			return Object.freeze({
				fileName: 'fallback-mix.wav', size: destinationBytes, method: 'filesystem',
			});
		},
		abort() { events.push('destination-abort'); },
	});
	const runtime: ExportServiceRuntime = {
		abortError: () => Object.assign(new Error('aborted'), { name: 'AbortError' }),
		applyMediaChannelMapping: (channels: readonly Float32Array[]) => channels,
		audioBufferChannels: (value: typeof audio) => value.channels,
		cloneProject: (project: AudioEditorProjectV9) => structuredClone(project),
		copy: {
			localSourcesMissing: 'Local sources missing.', rendering: 'Rendering', encoding: 'Encoding', done: 'Done',
			largeProjectRealtimeExport: 'Realtime export', realtimeExportFallback: 'Realtime fallback',
			realtimeStorageRequired: 'Realtime storage required',
		},
		createAiffStreamEncoder: createStreamEncoder,
		createCacheAwareRenderEngine() {
			events.push('create-engine');
			return {
				loadProject(project: AudioEditorProjectV9, buffers: ReadonlyMap<string, unknown>, renderOptions?: Readonly<{
					chunkSources?: ReadonlyMap<string, EngineChunkSource>;
				}>) {
					events.push('load-project');
					assertProjectedFallback(project);
					assertPrivateSources(buffers, renderOptions?.chunkSources, verifiedProvider);
				},
				async renderMix() { throw new Error('fallback offline render must use the injected renderer'); },
				async renderMixRealtime(renderOptions: Readonly<{
					onChunk(channels: readonly Float32Array[], metadata: Readonly<{ sampleRate: number }>): unknown;
				}>) {
					events.push('render-realtime');
					await renderOptions.onChunk(audio.channels, { sampleRate: audio.sampleRate });
				},
				async dispose() { events.push('dispose-engine'); },
			};
		},
		createExportPlan(project: AudioEditorProjectV9) {
			events.push('plan');
			if (activeFallback) assertProjectedFallback(project);
			else assert.deepEqual(project, canonical);
			return plan;
		},
		createStableId: () => 'fallback-export',
		createStreamingStemArchive() { events.push('archive'); throw new Error('stem archive reached'); },
		createStreamingWindowedSincResampler: () => ({
			push: (channels: readonly Float32Array[]) => channels,
			finish: () => [new Float32Array(), new Float32Array()],
		}),
		createTemporaryFileSink: async () => {
			events.push('temporary-sink');
			return {
				persistent: true,
				async write() { events.push('sink-write'); },
				async close(mimeType: string) { return new Blob([], { type: mimeType }); },
				async remove() { events.push('sink-remove'); },
				async abort() { events.push('sink-abort'); },
			};
		},
		createWavStreamEncoder: directDestination
			? (encoderOptions: Readonly<{ onChunk?(chunk: Uint8Array): void }>) => {
				encoderOptions.onChunk?.(new Uint8Array(plan.outputFileBytesPerRender - 1));
				return {
					write() { encoderOptions.onChunk?.(Uint8Array.of(1)); },
					finalize() { return Object.freeze({ byteLength: plan.outputFileBytesPerRender }); },
				};
			}
			: createStreamEncoder,
		encodeAiff: () => Uint8Array.of(1),
		encodeWav: () => Uint8Array.of(1, 2, 3),
		ffmpeg: {
			dispose() {},
			async encode() { throw new Error('FFmpeg encode reached'); },
			async encodeFile() { throw new Error('FFmpeg file encode reached'); },
		},
		fileService: {
			async prepareSave() {
				events.push('picker');
				return directDestination ? preparedDirectDestination : Object.freeze({ mode: 'blob' });
			},
			async createDownload() {
				events.push('download');
				return Object.freeze({ cancelled: false, url: 'blob:fallback-export', method: 'memory' });
			},
		},
		getProject: () => canonical,
		handleError(error: unknown) { errors.push(error); },
		hasMissingTimelineSources: () => false,
		lifetime: {
			startTask() {
				currentController = new AbortController();
				return Object.freeze({
					signal: currentController.signal,
					assertCurrent() {},
					finish() {},
				});
			},
			cancelTask() { currentController?.abort(); },
		},
		normalizeExportSettings(value: Readonly<Record<string, unknown>> = {}) {
			return Object.freeze({ mode: 'mix', format: 'wav', includeTail: false, bitDepth: 24, ...value });
		},
		normalizeProjectSampleRate: (sampleRate: number) => sampleRate,
		options: {
			async renderSnapshot(...args: unknown[]) {
				events.push('render-offline');
				const [project, , buffers, signal, chunkSources] = args as [
					AudioEditorProjectV9, unknown, ReadonlyMap<string, unknown>, AbortSignal,
					ReadonlyMap<string, EngineChunkSource> | undefined,
				];
				assert.equal(signal.aborted, false);
				if (activeFallback) {
					assert.equal(args.length, 5);
					assertProjectedFallback(project);
					assertPrivateSources(buffers, chunkSources, verifiedProvider);
				} else {
					assert.equal(args.length, 4);
					assert.deepEqual(project, canonical);
					assert.strictEqual(buffers.get(CANONICAL_SOURCE_ID), globalBuffer);
					assert.equal(chunkSources, undefined);
					ordinaryRenderObserved = true;
				}
				if (options.renderFailure !== undefined) throw options.renderFailure;
				return audio;
			},
		},
		playbackProjects: Object.freeze({
			projectForAudioRenderedFallbackDelivery<Project extends object>(project: Project) {
				events.push('projection');
				return playback.projectForAudioRenderedFallbackDelivery(project);
			},
		}),
		preflightStorage: async () => { events.push('preflight'); },
		prepareCommittedTimePitchCaches: async () => { events.push('prepare-caches'); },
		productName: 'Soundscaper',
		projectGeneration: { capture: () => canonical.id, assertCurrent() {} },
		publishDocumentSnapshot() {},
		resampleBuffer: async (value: unknown) => value,
		setStatus(message: string) { events.push(`status:${message}`); },
		sourceBuffers,
		sourceChunkProviders,
		state,
		stemProject() { events.push('stem-project'); throw new Error('stem projection reached'); },
		store,
		taskProgress: {
			begin: () => Object.freeze({ setPhase: () => true, finish: () => true }),
			getSnapshot: () => Object.freeze({ kind: 'export' }),
			setActivePhase: () => true,
			updateActive: () => true,
		},
		throwIfAborted(signal?: AbortSignal | null) {
			if (signal?.aborted) throw signal.reason;
		},
		toggleExport() {},
		updateExportProgress() {},
		verifyProjectFallbackIntegrity(project: unknown, candidateStore: unknown, verifyOptions: Readonly<{
			signal?: AbortSignal;
			audioFallback?: unknown;
		}>) {
			events.push('verify');
			if (!activeFallback) throw new Error('ordinary export reached fallback integrity verification');
			assert.strictEqual(project, canonical);
			assert.strictEqual(candidateStore, store);
			assert.equal(verifyOptions.signal?.aborted, false);
			assert.deepEqual(verifyOptions.audioFallback, expectedSelector());
			return Object.freeze({
				assertCurrent(candidate: unknown) {
					events.push('admission-current');
					assert.strictEqual(candidate, canonical);
				},
				getVerifiedAudioChunkProvider(selector: unknown) {
					events.push('provider');
					assert.deepEqual(selector, expectedSelector());
					return verifiedProvider;
				},
			});
		},
	};
	return {
		canonical,
		errors,
		events,
		globalBuffer,
		globalProvider,
		get ordinaryRenderObserved() { return ordinaryRenderObserved; },
		runtime,
		sourceBuffers,
		sourceChunkProviders,
	};
}

function fallbackProject(): AudioEditorProjectV9 {
	const canonical = createAudioSourceV9({
		id: CANONICAL_SOURCE_ID, storageKey: CANONICAL_SOURCE_ID, frameCount: 8,
		channelCount: 2, sampleRate: 48_000, chunkFrames: 4,
	});
	const fallback = createAudioSourceV9({
		id: FALLBACK_SOURCE_ID, storageKey: FALLBACK_SOURCE_ID, frameCount: 12,
		channelCount: 2, sampleRate: 48_000, chunkFrames: 4,
	});
	const clip = createAudioClipV9({
		id: 'canonical-clip', sourceId: canonical.id, durationFrames: canonical.frameCount,
	});
	return createAudioEditorProjectV9({
		id: 'audio-fallback-export-service', now: '2026-08-02T12:00:00.000Z',
		sources: [canonical, fallback], clips: [clip],
		tracks: [createAudioTrackV9({ id: 'canonical-track', clipIds: [clip.id] })],
		featureRequirements: { schemaVersion: 1, requirements: [{
			id: 'publisher-audio-render', featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
			displayName: 'Publisher audio render', disposition: 'rendered-fallback',
			fallback: { kind: 'audio', sourceId: FALLBACK_SOURCE_ID, sha256: FALLBACK_DIGEST },
		}] },
	});
}

function exportPlan(strategy: Strategy): ExportPlan {
	const outputFrames = 2;
	const layout = inspectWavLayout({
		sampleRate: 48_000, channelCount: 2, totalFrames: outputFrames,
		bitDepth: 24, float: false, metadata: {}, markers: [],
		ixml: null, cart: null,
	});
	return Object.freeze({
		mode: 'mix' as const,
		format: 'wav' as const,
		mimeType: 'audio/wav' as const,
		sampleRate: 48_000,
		channelCount: 2,
		outputFrames,
		outputBytesPerRender: outputFrames * 2 * 4,
		outputFileBytesPerRender: layout.byteLength,
		requiredTemporaryBytes: layout.byteLength,
		encoding: Object.freeze({ bitDepth: 24 as const, floatingPoint: false as const, sampleFormat: 'int24' as const }),
		ditherMode: 'none' as const,
		render: Object.freeze({ strategy }),
		range: Object.freeze({ startFrame: 0, endFrame: outputFrames, durationFrames: outputFrames }),
		tailFrames: 0,
		channelMapping: Object.freeze({ mode: 'preserve' }),
		metadata: Object.freeze({}),
		markers: Object.freeze([]),
		ixml: null,
		cart: null,
		outputs: Object.freeze([Object.freeze({ fileName: 'fallback-mix.wav', trackId: null })]),
		archive: null,
	});
}

function chunkProvider(owner: string): EngineChunkSource {
	return Object.freeze({
		channelCount: 2,
		frameCount: 12,
		chunkFrames: 4,
		sampleRate: 48_000,
		async readStorageChunk() {
			return Object.freeze([Float32Array.of(owner.length), Float32Array.of(-owner.length)]);
		},
	});
}

function createStreamEncoder(options: Readonly<{
	onChunk?(chunk: Uint8Array): PromiseLike<void> | void;
}>) {
	return {
		write() {},
		finalize() { void options.onChunk?.(Uint8Array.of(1, 2, 3)); },
		async settled() {},
	};
}

function expectedSelector() {
	return Object.freeze({
		requirementId: 'publisher-audio-render',
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
		kind: 'audio',
		sourceId: FALLBACK_SOURCE_ID,
		sha256: FALLBACK_DIGEST,
	});
}

function assertProjectedFallback(project: AudioEditorProjectV9): void {
	assert.equal(project.tracks[0]?.id, PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track);
	assert.equal(project.clips[0]?.id, PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip);
	assert.equal(project.clips[0]?.sourceId, FALLBACK_SOURCE_ID);
}

function assertPrivateSources(
	buffers: ReadonlyMap<string, unknown>,
	chunkSources: ReadonlyMap<string, EngineChunkSource> | undefined,
	verifiedProvider: EngineChunkSource,
): void {
	assert.equal(buffers.size, 0, 'fallback render must not receive global AudioBuffers');
	assert.ok(chunkSources);
	assert.deepEqual([...chunkSources.keys()], [FALLBACK_SOURCE_ID]);
	assert.strictEqual(chunkSources.get(FALLBACK_SOURCE_ID), verifiedProvider);
}

function assertGlobalCachesUnchanged(fixture: ReturnType<typeof createFixture>): void {
	assert.deepEqual([...fixture.sourceBuffers.entries()], [[CANONICAL_SOURCE_ID, fixture.globalBuffer]]);
	assert.deepEqual([...fixture.sourceChunkProviders.entries()], [[CANONICAL_SOURCE_ID, fixture.globalProvider]]);
}

function assertOrder(events: readonly string[], expected: readonly string[]): void {
	const positions = expected.map((event) => events.indexOf(event));
	assert.equal(positions.every((position) => position >= 0), true, `missing workflow event: ${String(events)}`);
	assert.deepEqual([...positions].sort((left, right) => left - right), positions, `workflow order: ${String(events)}`);
}
