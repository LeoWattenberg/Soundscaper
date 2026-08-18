/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';

import type { ExportServiceRuntime } from '../../src/common/editor/controller/export-service.ts';
import { createPlaybackProjectService } from '../../src/common/editor/controller/playback-project-service.ts';
import type { EngineChunkSource } from '../../src/common/editor/engine/types.ts';
import { encodeAiff } from '../../src/common/editor/aiff.js';
import { createExportPlan } from '../../src/common/editor/export.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS } from '../../src/common/editor/project-feature-audio-rendered-fallback.ts';
import { PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS } from '../../src/common/editor/project-feature-audio-track-render-v1.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../../src/common/editor/project-feature-capabilities.ts';
import {
	createAudioClipV9,
	createAudioSourceV9,
	createAudioTrackV9,
} from '../../src/common/editor/project-v9.ts';
import { inspectWavLayout } from '../../src/common/editor/wav.js';

const CANONICAL_SOURCE_ID = 'canonical-audio';
const FALLBACK_SOURCE_ID = 'fallback-audio';
const FALLBACK_DIGEST = 'de'.repeat(32);
const FALLBACK_FEATURE_ID = 'org.example.future-mixer';

type Strategy = 'offline' | 'realtime-stream';
type FallbackRole = 'mix' | 'track';

interface FixtureOptions {
	readonly activeFallback?: boolean;
	readonly directDestination?: boolean;
	readonly renderFailure?: unknown;
	readonly role?: FallbackRole;
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

export function createFixture(options: FixtureOptions = {}) {
	const activeFallback = options.activeFallback !== false;
	const directDestination = options.directDestination === true;
	const strategy = options.strategy ?? 'offline';
	const role = options.role ?? 'mix';
	const featureId = activeFallback && role === 'mix'
		? FALLBACK_FEATURE_ID
		: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects;
	const canonical = fallbackProject(featureId, role);
	const events: string[] = [];
	const errors: unknown[] = [];
	const fallbackFrameCount = role === 'track' ? 8 : 12;
	const globalBuffer = Object.freeze({ owner: 'global-buffer' });
	const globalProvider = chunkProvider('global', fallbackFrameCount);
	const verifiedProvider = chunkProvider('verified', fallbackFrameCount);
	const sourceBuffers = new Map<string, unknown>([[CANONICAL_SOURCE_ID, globalBuffer]]);
	const sourceChunkProviders = new Map<string, EngineChunkSource>([[CANONICAL_SOURCE_ID, globalProvider]]);
	const store = Object.freeze({ owner: 'project-store' });
	const playback = createPlaybackProjectService({
		audioEffects: !activeFallback,
	});
	const exactOfflineDirect = directDestination && strategy === 'offline';
	const plan = exactOfflineDirect
		? createExportPlan(
			playback.projectForAudioRenderedFallbackDelivery(canonical).project,
			{ format: 'wav', includeTail: false, livePcmBytes: 0, date: '2026-08-02' },
		) as unknown as ExportPlan
		: exportPlan(strategy);
	const audio = Object.freeze({
		sampleRate: 48_000,
		length: plan.outputFrames,
		numberOfChannels: 2,
		channels: Object.freeze([
			new Float32Array(plan.outputFrames).fill(0.25),
			new Float32Array(plan.outputFrames).fill(-0.25),
		]),
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
		cloneProject: (project: AudioEditorProjectCurrent) => structuredClone(project),
		copy: {
			localSourcesMissing: 'Local sources missing.', rendering: 'Rendering', encoding: 'Encoding', done: 'Done',
			largeProjectRealtimeExport: 'Realtime export', realtimeExportFallback: 'Realtime fallback',
			realtimeStorageRequired: 'Realtime storage required',
		},
		createAiffStreamEncoder: createStreamEncoder,
		createCacheAwareRenderEngine() {
			events.push('create-engine');
			return {
				loadProject(project: AudioEditorProjectCurrent, buffers: ReadonlyMap<string, unknown>, renderOptions?: Readonly<{
					chunkSources?: ReadonlyMap<string, EngineChunkSource>;
				}>) {
					events.push('load-project');
					assertProjectedFallback(project, role);
					assertPrivateSources(buffers, renderOptions?.chunkSources, verifiedProvider, role, {
						buffer: globalBuffer, provider: globalProvider,
					});
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
		createExportPlan(project: AudioEditorProjectCurrent) {
			events.push('plan');
			if (activeFallback) assertProjectedFallback(project, role);
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
		// Real containers, because a delivery is conformed by reopening what it
		// wrote: a writer stub that returns three bytes is the writer fault
		// conformance exists to catch, not an ordinary delivery.
		encodeAiff: (channels: readonly Float32Array[], encodeOptions: Record<string, unknown>) => (
			encodeAiff(channels as Float32Array[], encodeOptions as never)
		),
		encodeWav: (channels: readonly Float32Array[], encodeOptions: Record<string, unknown>) => (
			encodeWav(channels as Float32Array[], encodeOptions as never)
		),
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
					AudioEditorProjectCurrent, unknown, ReadonlyMap<string, unknown>, AbortSignal,
					ReadonlyMap<string, EngineChunkSource> | undefined,
				];
				assert.equal(signal.aborted, false);
				if (activeFallback) {
					assert.equal(args.length, 5);
					assertProjectedFallback(project, role);
					assertPrivateSources(buffers, chunkSources, verifiedProvider, role, {
						buffer: globalBuffer, provider: globalProvider,
					});
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
			assert.deepEqual(verifyOptions.audioFallback, expectedSelector(role));
			return Object.freeze({
				assertCurrent(candidate: unknown) {
					events.push('admission-current');
					assert.strictEqual(candidate, canonical);
				},
				getVerifiedAudioChunkProvider(selector: unknown) {
					events.push('provider');
					assert.deepEqual(selector, expectedSelector(role));
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

function fallbackProject(featureId: string, role: FallbackRole = 'mix'): AudioEditorProjectCurrent {
	const canonical = createAudioSourceV9({
		id: CANONICAL_SOURCE_ID, storageKey: CANONICAL_SOURCE_ID, frameCount: 8,
		channelCount: 2, sampleRate: 48_000, chunkFrames: 4,
	});
	const fallback = createAudioSourceV9({
		id: FALLBACK_SOURCE_ID, storageKey: FALLBACK_SOURCE_ID, frameCount: role === 'track' ? 8 : 12,
		channelCount: 2, sampleRate: 48_000, chunkFrames: 4,
	});
	const clip = createAudioClipV9({
		id: 'canonical-clip', sourceId: canonical.id, durationFrames: canonical.frameCount,
	});
	return createCurrentAudioEditorProject({
		id: 'audio-fallback-export-service', now: '2026-08-02T12:00:00.000Z',
		sources: [canonical, fallback], clips: [clip],
		tracks: [createAudioTrackV9({
			id: 'canonical-track',
			clipIds: [clip.id],
			effects: role === 'track'
				? [{ id: 'foreign-fx', type: 'com.example.saturator', enabled: true, params: {} }]
				: [],
		})],
		featureRequirements: role === 'track'
			? { schemaVersion: 2, requirements: [{
				id: 'publisher-audio-render', featureId,
				displayName: 'Publisher audio render', disposition: 'rendered-fallback',
				fallback: {
					role: 'audio-track-render-v1', kind: 'audio', sourceId: FALLBACK_SOURCE_ID,
					sha256: FALLBACK_DIGEST, targetTrackId: 'canonical-track',
				},
			}] }
			: { schemaVersion: 1, requirements: [{
				id: 'publisher-audio-render', featureId,
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

function chunkProvider(owner: string, frameCount = 12): EngineChunkSource {
	return Object.freeze({
		channelCount: 2,
		frameCount,
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

function expectedSelector(role: FallbackRole = 'mix') {
	if (role === 'track') {
		return Object.freeze({
			requirementId: 'publisher-audio-render',
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
			kind: 'audio',
			sourceId: FALLBACK_SOURCE_ID,
			sha256: FALLBACK_DIGEST,
			role: 'audio-track-render-v1',
			targetTrackId: 'canonical-track',
		});
	}
	return Object.freeze({
		requirementId: 'publisher-audio-render',
		featureId: FALLBACK_FEATURE_ID,
		kind: 'audio',
		sourceId: FALLBACK_SOURCE_ID,
		sha256: FALLBACK_DIGEST,
		role: 'project-audio-mix-v1',
		targetTrackId: null,
	});
}

function assertProjectedFallback(project: AudioEditorProjectCurrent, role: FallbackRole = 'mix'): void {
	if (role === 'track') {
		assert.equal(project.tracks[0]?.id, 'canonical-track');
		assert.deepEqual(project.tracks[0]?.clipIds, [PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS.clip]);
		assert.deepEqual(project.tracks[0]?.effects, []);
		assert.equal(project.clips[0]?.id, PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS.clip);
		assert.equal(project.clips[0]?.sourceId, FALLBACK_SOURCE_ID);
		return;
	}
	assert.equal(project.tracks[0]?.id, PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track);
	assert.equal(project.clips[0]?.id, PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip);
	assert.equal(project.clips[0]?.sourceId, FALLBACK_SOURCE_ID);
}

function assertPrivateSources(
	buffers: ReadonlyMap<string, unknown>,
	chunkSources: ReadonlyMap<string, EngineChunkSource> | undefined,
	verifiedProvider: EngineChunkSource,
	role: FallbackRole = 'mix',
	globals: Readonly<{ buffer: unknown; provider: EngineChunkSource }> | null = null,
): void {
	assert.ok(chunkSources);
	if (role === 'track') {
		assert.ok(globals);
		assert.deepEqual([...buffers.entries()], [[CANONICAL_SOURCE_ID, globals.buffer]],
			'track fallback render keeps ordinary lane buffers');
		assert.deepEqual([...chunkSources.keys()], [CANONICAL_SOURCE_ID, FALLBACK_SOURCE_ID]);
		assert.strictEqual(chunkSources.get(CANONICAL_SOURCE_ID), globals.provider);
		assert.strictEqual(chunkSources.get(FALLBACK_SOURCE_ID), verifiedProvider);
		return;
	}
	assert.equal(buffers.size, 0, 'fallback render must not receive global AudioBuffers');
	assert.deepEqual([...chunkSources.keys()], [FALLBACK_SOURCE_ID]);
	assert.strictEqual(chunkSources.get(FALLBACK_SOURCE_ID), verifiedProvider);
}

export function assertGlobalCachesUnchanged(fixture: ReturnType<typeof createFixture>): void {
	assert.deepEqual([...fixture.sourceBuffers.entries()], [[CANONICAL_SOURCE_ID, fixture.globalBuffer]]);
	assert.deepEqual([...fixture.sourceChunkProviders.entries()], [[CANONICAL_SOURCE_ID, fixture.globalProvider]]);
}

export function assertOrder(events: readonly string[], expected: readonly string[]): void {
	const positions = expected.map((event) => events.indexOf(event));
	assert.equal(positions.every((position) => position >= 0), true, `missing workflow event: ${String(events)}`);
	assert.deepEqual([...positions].sort((left, right) => left - right), positions, `workflow order: ${String(events)}`);
}
