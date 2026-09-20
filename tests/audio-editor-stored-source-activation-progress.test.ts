/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { activateStoredSourceWithProgress } from '../src/common/editor/controller/source/internal/stored-source-activation.ts';
import { generateStoredWaveformPeaksFallback, type StoredWaveformAnalysisOptions } from '../src/common/editor/controller/source/waveform-analysis.ts';
import type { SourceLifecycleCopy, SourceLifecycleSource } from '../src/common/editor/controller/source/source-lifecycle-service.ts';
import { createSourceRuntimeComposition, type SourceRuntimeCompositionDependencies } from '../src/common/editor/controller/source/source-runtime-composition.ts';

test('the production source composition preserves progress and cancellation through its waveform adapter', async () => {
	let pulls = 0;
	const controller = new AbortController();
	const source = { id: 'source', frameCount: 4, channelCount: 1, sampleRate: 48_000, chunkFrames: 2 };
	const buffers = new Map<string, AudioBuffer>();
	const ports = {
		state: { missingSourceIds: new Set(), recordingStarting: false, recorder: null },
		copy: { ready: 'ready', audioAnalysisWorkerFailed: 'worker failed', audioAnalysisFailed: 'analysis failed' },
		engine: {},
		sourceBuffers: Object.assign(buffers, { setIfFits: () => false }),
		sourceChunkProviders: new Map(), sourcePeaks: new Map(),
		playbackProjects: {},
		store: {
			readSourceChunk: async () => { throw new Error('Waveform scan must use the bounded chunk iterator'); },
			async *readSourceChunks() {
				pulls++; yield { channels: [Float32Array.of(0, 1)], frames: 2 };
				pulls++; yield { channels: [Float32Array.of(1, 0)], frames: 2 };
			},
			saveAnalysis: async () => { throw new Error('Cancelled waveform must not be saved'); },
		},
	};
	const dependencies = new Proxy(ports, { get(target, key) {
		return Reflect.get(target, key) ?? (() => { throw new Error(`Unexpected source composition port ${String(key)}`); });
	} }) as unknown as SourceRuntimeCompositionDependencies;
	const { sourceLifecycle } = createSourceRuntimeComposition(dependencies);
	const progress: number[] = [];
	await assert.rejects(sourceLifecycle.activateStoredSource(source, {
		...source, chunkCount: 2,
	}, { requireChunkStream: true, signal: controller.signal, onProgress(value) {
		progress.push(value); controller.abort();
	} }), { name: 'AbortError' });
	assert.deepEqual(progress, [0.49]);
	assert.equal(pulls, 1);
	assert.equal(ports.sourcePeaks.size, 0);
});

test('source activation carries cancellation through stored waveform scanning and avoids stale caches', async () => {
	const fixture = activationFixture();
	const controller = new AbortController();
	await assert.rejects(activateStoredSourceWithProgress(fixture.runtime, fixture.source, null, {
		requireChunkStream: true, signal: controller.signal, onProgress() { controller.abort(); },
	}), { name: 'AbortError' });
	assert.equal(fixture.pulls(), 1);
	assert.equal(fixture.sourcePeaks.size, 0);
	assert.equal(fixture.saved(), 0);
});

test('waveform activation reports final completion only after the analysis cache is stored', async () => {
	const fixture = activationFixture();
	const progress: number[] = [];
	await activateStoredSourceWithProgress(fixture.runtime, fixture.source, null, {
		requireChunkStream: true, onProgress(value) {
			if (value === 1) assert.equal(fixture.saved(), 1);
			progress.push(value);
		},
	});
	assert.deepEqual(progress, [0.49, 0.98, 1]);
	assert.equal(fixture.sourcePeaks.size, 1);
});

test('short stored sources use the composed audio context and full-buffer waveform path', async () => {
	const fixture = activationFixture();
	const context = { kind: 'offline-audio-context' };
	const buffer = { channels: [Float32Array.of(0, 1, 0, -1)] };
	const cached: unknown[] = [];
	Object.assign(fixture.runtime, {
		registerStoredChunkProvider: () => null,
		engine: { getAudioContext: () => context },
		readStoredAudioBuffer: (_store: unknown, _source: SourceLifecycleSource, value: unknown) => {
			assert.equal(value, context);
			return buffer;
		},
		audioBufferChannels: (value: typeof buffer) => value.channels,
		generateWaveformPeaks: (channels: readonly Float32Array[]) => ({ channels }),
		cacheSourceBuffer: (_sourceId: string, value: unknown) => { cached.push(value); },
	});

	const peaks = await activateStoredSourceWithProgress(fixture.runtime, fixture.source, null, {});
	assert.deepEqual(peaks, { channels: buffer.channels });
	assert.deepEqual(cached, [buffer]);
});

test('late cancellation removes a waveform cache saved while cancellation was pending', async () => {
	const fixture = activationFixture();
	const controller = new AbortController();
	const removed: string[] = [];
	Object.assign(fixture.runtime.store, {
		saveAnalysis: () => { controller.abort(); },
		deleteAnalysis: (key: string) => { removed.push(key); },
	});
	await assert.rejects(activateStoredSourceWithProgress(fixture.runtime, fixture.source, null, {
		requireChunkStream: true, signal: controller.signal,
	}), { name: 'AbortError' });
	assert.deepEqual(removed, ['source']);
	assert.equal(fixture.sourcePeaks.size, 0);
});

test('late cancellation preserves a failed waveform cache cleanup', async () => {
	const fixture = activationFixture();
	const controller = new AbortController();
	const failure = new Error('cache cleanup failed');
	Object.assign(fixture.runtime.store, {
		saveAnalysis: () => { controller.abort(); },
		deleteAnalysis: () => { throw failure; },
	});
	await assert.rejects(activateStoredSourceWithProgress(fixture.runtime, fixture.source, null, {
		requireChunkStream: true, signal: controller.signal,
	}), (error: unknown) => error instanceof AggregateError && error.errors.includes(failure));
	assert.equal(fixture.sourcePeaks.size, 0);
});

function activationFixture() {
	let pulls = 0;
	let saved = 0;
	const source = { id: 'source', frameCount: 4, channelCount: 1 };
	const sourcePeaks = new Map<string, unknown>();
	const runtime = {
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 32,
		registerStoredChunkProvider: () => ({}),
		cacheSourceBuffer: () => { throw new Error('Unexpected full buffer cache'); },
		audioBufferChannels: () => [], copy: {},
		engine: { getAudioContext: () => { throw new Error('Unexpected audio context request'); } },
		generateStoredWaveformPeaks: (_store: unknown, _source: SourceLifecycleSource, _copy: SourceLifecycleCopy, options?: StoredWaveformAnalysisOptions) =>
			generateStoredWaveformPeaksFallback({ async *readSourceChunks() {
				pulls++; yield { channels: [Float32Array.of(0, 1)], frames: 2 };
				pulls++; yield { channels: [Float32Array.of(1, 0)], frames: 2 };
			} }, source, options),
		generateWaveformPeaks: () => { throw new Error('Unexpected full buffer analysis'); },
		peakCacheKey: (id: string) => id,
		readStoredAudioBuffer: () => { throw new Error('Unexpected full buffer read'); },
		sourceBuffers: { ...new Map(), [Symbol.iterator]: () => new Map<string, unknown>()[Symbol.iterator](),
			has: () => false, get: () => undefined, delete: () => true, setIfFits: () => false },
		sourcePcmBytes: () => 16, sourcePeaks,
		store: {
			getSourceMetadata: () => null,
			loadAnalysis: () => null,
			saveAnalysis: () => { saved++; },
			deleteAnalysis: () => undefined,
		},
	};
	return { runtime, source, sourcePeaks, pulls: () => pulls, saved: () => saved };
}
