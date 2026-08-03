/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorExportService, type ExportServiceRuntime } from '../src/common/editor/controller/export-service.ts';
import { createPlaybackProjectService } from '../src/common/editor/controller/playback-project-service.ts';
import type { EngineChunkSource } from '../src/common/editor/engine/types.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import type { FfmpegOutputSink } from '../src/common/editor/ffmpeg-output-stream.ts';
import { PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-audio-rendered-fallback.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
	type AudioEditorProjectV9,
} from '../src/common/editor/project-v9.ts';

const CANONICAL_SOURCE_ID = 'canonical-audio';
const FALLBACK_SOURCE_ID = 'fallback-audio';
const FALLBACK_DIGEST = 'de'.repeat(32);

test('private rendered fallback publishes an admitted offline compressed mix directly', async () => {
	const canonical = fallbackProject();
	const before = structuredClone(canonical);
	const events: string[] = [];
	const errors: unknown[] = [];
	const playback = createPlaybackProjectService({ audioEffects: false });
	const projected = playback.projectForAudioRenderedFallbackDelivery(canonical).project;
	const plan = createExportPlan(projected, {
		format: 'mp3', channelMapping: 'mono', includeTail: false, livePcmBytes: 0,
		date: '2026-08-02',
	});
	const globalBuffer = Object.freeze({ owner: 'global-buffer' });
	const globalProvider = chunkProvider('global');
	const verifiedProvider = chunkProvider('verified');
	const sourceBuffers = new Map<string, unknown>([[CANONICAL_SOURCE_ID, globalBuffer]]);
	const sourceChunkProviders = new Map<string, EngineChunkSource>([[CANONICAL_SOURCE_ID, globalProvider]]);
	const store = Object.freeze({ owner: 'project-store' });
	const state = {
		exportGeneration: 0, exportAbort: null, mobile: false, outputUrl: null,
		outputCleanup: null, exportOutput: null, disposed: false,
	};
	let taskController: AbortController | null = null;
	let targetBytes = 0;
	const target = {
		mode: 'stream' as const,
		async createWritable() {
			events.push('target:open');
			return new WritableStream<Uint8Array>({
				write(chunk) { targetBytes += chunk.byteLength; },
				close() { events.push('target:close'); },
			});
		},
		bytesWritten: () => targetBytes,
		async commit() {
			events.push('target:commit');
			return { fileName: plan.outputs[0].fileName, size: targetBytes, method: 'filesystem' };
		},
		async abort() { events.push('target:abort'); },
	};
	const runtime: ExportServiceRuntime = {
		abortError: () => Object.assign(new Error('aborted'), { name: 'AbortError' }),
		applyMediaChannelMapping: () => { throw new Error('renderer-side mapping reached'); },
		audioBufferChannels: (value: Readonly<{ channels: readonly Float32Array[] }>) => value.channels,
		cloneProject: (project: AudioEditorProjectV9) => structuredClone(project),
		copy: {
			localSourcesMissing: 'missing', rendering: 'Rendering', encoding: 'Encoding', done: 'Done',
			largeProjectRealtimeExport: 'Realtime', realtimeExportFallback: 'Fallback',
			realtimeStorageRequired: 'Storage required',
		},
		createAiffStreamEncoder: () => { throw new Error('AIFF reached'); },
		createCacheAwareRenderEngine: () => { throw new Error('global render engine reached'); },
		createExportPlan(project: AudioEditorProjectV9) {
			events.push('plan');
			assertProjectedFallback(project);
			return plan;
		},
		createStableId: () => 'fallback-compressed',
		createStreamingStemArchive: () => { throw new Error('stems reached'); },
		createStreamingWindowedSincResampler: () => { throw new Error('realtime resampler reached'); },
		createTemporaryFileSink: () => { throw new Error('temporary sink reached'); },
		createWavStreamEncoder: () => { throw new Error('stream encoder reached'); },
		encodeAiff: () => { throw new Error('AIFF reached'); },
		encodeWav(channels: readonly Float32Array[]) {
			events.push('stage');
			assert.equal(channels.length, 2);
			assert.equal(channels[0]!.length, plan.outputFrames);
			return Uint8Array.of(82, 73, 70, 70);
		},
		ffmpeg: {
			dispose() {},
			encode: async () => { throw new Error('whole-output encode reached'); },
			encodeFile: async () => { throw new Error('file encode reached'); },
			async encodeFileToSink(_file: Blob, format: string, sink: FfmpegOutputSink<unknown>, settings: Readonly<Record<string, unknown>>) {
				assert.equal(format, 'mp3');
				assert.equal((settings.channelMapping as Readonly<{ mode: string }>).mode, 'mono');
				events.push('ffmpeg:stat');
				(settings.assertCurrent as () => void)();
				await sink.open(5);
				await sink.write(Uint8Array.of(1, 2, 3, 4, 5));
				const output = await sink.close();
				return { output, byteLength: 5, chunkCount: 1, extension: '.mp3', mimeType: 'audio/mpeg' };
			},
		},
		fileService: {
			prepareSave() { events.push('picker'); return target; },
			createDownload: () => { throw new Error('download reached'); },
		},
		getProject: () => canonical,
		handleError(error: unknown) { errors.push(error); },
		hasMissingTimelineSources: () => false,
		lifetime: {
			startTask() {
				taskController = new AbortController();
				return { signal: taskController.signal, assertCurrent() {}, finish() {} };
			},
			cancelTask() { taskController?.abort(); },
		},
		normalizeExportSettings: () => ({ mode: 'mix', format: 'mp3', includeTail: false }),
		normalizeProjectSampleRate: (sampleRate: number) => sampleRate,
		options: {
			async renderSnapshot(
				project: AudioEditorProjectV9,
				_range: unknown,
				buffers: ReadonlyMap<string, unknown>,
				signal: AbortSignal,
				chunkSources: ReadonlyMap<string, EngineChunkSource>,
			) {
				events.push('render');
				assert.equal(signal.aborted, false);
				assertProjectedFallback(project);
				assert.equal(buffers.size, 0);
				assert.deepEqual([...chunkSources.keys()], [FALLBACK_SOURCE_ID]);
				assert.strictEqual(chunkSources.get(FALLBACK_SOURCE_ID), verifiedProvider);
				return {
					sampleRate: plan.sampleRate,
					channels: [new Float32Array(plan.outputFrames).fill(0.25), new Float32Array(plan.outputFrames).fill(-0.25)],
				};
			},
		},
		playbackProjects: {
			projectForAudioRenderedFallbackDelivery<Project extends object>(project: Project) {
				events.push('projection');
				return playback.projectForAudioRenderedFallbackDelivery(project);
			},
		},
		preflightStorage: async () => { events.push('preflight'); },
		prepareCommittedTimePitchCaches: () => { throw new Error('global caches reached'); },
		productName: 'Soundscaper',
		projectGeneration: { capture: () => canonical.id, assertCurrent() {} },
		publishDocumentSnapshot() {},
		resampleBuffer: async (value: unknown) => value,
		setStatus() {}, sourceBuffers, sourceChunkProviders, state,
		stemProject: () => { throw new Error('stems reached'); }, store,
		taskProgress: { begin: () => ({ setPhase: () => true, finish: () => true }), setActivePhase: () => true },
		throwIfAborted(signal?: AbortSignal | null) { if (signal?.aborted) throw signal.reason; },
		toggleExport() {}, updateExportProgress() {},
		verifyProjectFallbackIntegrity(project: unknown, candidateStore: unknown, verifyOptions: Readonly<{ audioFallback?: unknown }>) {
			events.push('verify');
			assert.strictEqual(project, canonical);
			assert.strictEqual(candidateStore, store);
			assert.deepEqual(verifyOptions.audioFallback, expectedSelector());
			return {
				assertCurrent(candidate: unknown) { events.push('current'); assert.strictEqual(candidate, canonical); },
				getVerifiedAudioChunkProvider(selector: unknown) {
					events.push('provider');
					assert.deepEqual(selector, expectedSelector());
					return verifiedProvider;
				},
			};
		},
	};

	const result = await createEditorExportService(runtime).handleExportAction('export', { format: 'mp3' });
	assert.deepEqual(errors, []);
	assert.equal(result.url, null);
	assert.equal(result.fileName, plan.outputs[0].fileName);
	assertOrder(events, [
		'projection', 'verify', 'current', 'provider', 'plan', 'picker', 'preflight',
		'render', 'stage', 'ffmpeg:stat', 'target:open', 'target:close', 'target:commit',
	]);
	assert.deepEqual(canonical, before);
	assert.deepEqual([...sourceBuffers.entries()], [[CANONICAL_SOURCE_ID, globalBuffer]]);
	assert.deepEqual([...sourceChunkProviders.entries()], [[CANONICAL_SOURCE_ID, globalProvider]]);
});

function fallbackProject(): AudioEditorProjectV9 {
	const canonical = createAudioSourceV9({
		id: CANONICAL_SOURCE_ID, storageKey: CANONICAL_SOURCE_ID, frameCount: 8,
		channelCount: 2, sampleRate: 48_000, chunkFrames: 4,
	});
	const fallback = createAudioSourceV9({
		id: FALLBACK_SOURCE_ID, storageKey: FALLBACK_SOURCE_ID, frameCount: 12,
		channelCount: 2, sampleRate: 48_000, chunkFrames: 4,
	});
	const clip = createAudioClipV9({ id: 'canonical-clip', sourceId: canonical.id, durationFrames: canonical.frameCount });
	return createAudioEditorProjectV9({
		id: 'offline-compressed-fallback', now: '2026-08-02T12:00:00.000Z',
		sources: [canonical, fallback], clips: [clip],
		tracks: [createAudioTrackV9({ id: 'canonical-track', clipIds: [clip.id] })],
		featureRequirements: { schemaVersion: 2, requirements: [{
			id: 'publisher-audio-render', featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
			displayName: 'Publisher audio render', disposition: 'rendered-fallback',
			fallback: {
				role: 'project-audio-mix-v1', kind: 'audio',
				sourceId: FALLBACK_SOURCE_ID, sha256: FALLBACK_DIGEST,
			},
		}] },
	});
}

function chunkProvider(owner: string): EngineChunkSource {
	return Object.freeze({
		channelCount: 2, frameCount: 12, chunkFrames: 4, sampleRate: 48_000,
		async readStorageChunk() { return [Float32Array.of(owner.length), Float32Array.of(-owner.length)]; },
	});
}

function expectedSelector() {
	return {
		requirementId: 'publisher-audio-render', featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
		role: 'project-audio-mix-v1', kind: 'audio', sourceId: FALLBACK_SOURCE_ID, sha256: FALLBACK_DIGEST,
	};
}

function assertProjectedFallback(project: AudioEditorProjectV9): void {
	assert.equal(project.tracks[0]?.id, PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track);
	assert.equal(project.clips[0]?.id, PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip);
	assert.equal(project.clips[0]?.sourceId, FALLBACK_SOURCE_ID);
}

function assertOrder(events: readonly string[], expected: readonly string[]): void {
	const positions = expected.map((event) => events.indexOf(event));
	assert.equal(positions.every((position) => position >= 0), true, `missing event: ${String(events)}`);
	assert.deepEqual([...positions].sort((left, right) => left - right), positions, `workflow order: ${String(events)}`);
}
