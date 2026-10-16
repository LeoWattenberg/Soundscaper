/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';

import {
	createSourceLifecycleService,
	type SourceLifecycleServiceRuntime,
} from '../src/common/editor/controller/source/source-lifecycle-service.ts';
import { EditorDisposedError } from '../src/common/editor/controller/shared/lifecycle.ts';

interface Peaks { readonly levels: readonly number[]; readonly rms: boolean; }
const cachedPeaks: Peaks = Object.freeze({ levels: [1], rms: true });
const generatedPeaks: Peaks = Object.freeze({ levels: [2], rms: true });

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function fixture(long: boolean) {
	const source = { id: 'source', kind: 'audio', frameCount: 4, sampleRate: 48_000, channelCount: 1 };
	const project = { id: 'project', sources: [source], clips: [{ id: 'clip', sourceId: source.id }] };
	const buffer = { byteLength: 16, channels: [new Float32Array(4)] };
	const buffers = new Map([[source.id, buffer]]);
	const peaks = new Map([[source.id, cachedPeaks]]);
	const providers = new Map<string, object>();
	const missingSourceIds = new Set<string>();
	const effects: string[] = [];
	const read = deferred<Peaks | null>();
	const readStarted = deferred<void>();
	const generate = (): Promise<Peaks> => {
		effects.push('generate');
		return Promise.resolve(generatedPeaks);
	};
	const runtime: SourceLifecycleServiceRuntime<typeof buffer, typeof project, object, Peaks> = {
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES: 2, MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES: 100,
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 1_024,
		activateVideoSource: () => undefined,
		allProjectClips: value => value.clips,
		audioBufferChannels: value => value.channels,
		clipSourceWindowRange: (_clip, startFrame, endFrame) => ({ startFrame, endFrame }),
		clipWaveformPcmRequests: new Map(), clipWaveformPcmWindows: new Map(), copy: {},
		createStoredChunkProviderCandidate: () => ({}),
		engine: { getAudioContext: () => { effects.push('context'); return {}; } },
		findClip: value => value.clips[0], findSource: value => value.sources[0],
		generateStoredWaveformPeaks: generate, generateWaveformPeaks: generate,
		getProject: () => project,
		legacyPeakCacheKey: id => `legacy:${id}`, peakCacheKey: id => `peak:${id}`,
		publishDocumentSnapshot: () => { effects.push('publish'); },
		readStoredAudioBuffer: () => { effects.push('buffer-read'); return buffer; },
		readWaveformPcmWindow: () => [],
		setStatus: () => { effects.push('status'); },
		sourceAudioBufferBytes: value => value.byteLength,
		sourceBuffers: {
			[Symbol.iterator]: () => buffers[Symbol.iterator](),
			has: id => buffers.has(id), get: id => buffers.get(id),
			delete: id => { effects.push('buffer-delete'); return buffers.delete(id); },
			setIfFits: (id, value) => { effects.push('buffer-set'); buffers.set(id, value); return true; },
		},
		sourceChunkProviders: providers, sourcePcmBytes: () => long ? 1_025 : 16,
		sourcePeaks: peaks, state: { missingSourceIds },
		store: {
			getSourceMetadata: () => ({}),
			loadAnalysis: () => { readStarted.resolve(); return read.promise; },
			saveAnalysis: () => { effects.push('save'); },
			deleteAnalysis: key => { effects.push(`delete:${key}`); },
		},
		waveformPcmWindowContains: () => false,
		waveformPeaksHaveRms: value => Boolean(value?.rms),
	};
	return { service: createSourceLifecycleService(runtime), project, buffers, buffer, peaks, providers,
		missingSourceIds, effects, read, readStarted };
}

async function cancelPending(
	pending: Promise<unknown>, abort: AbortController, release: () => void,
	cancellation: Error = new DOMException('Source session retired', 'AbortError'),
) {
	let settled = false;
	const outcome = pending.then(value => { settled = true; return value; }, (error: unknown) => {
		settled = true;
		return error;
	});
	abort.abort(cancellation);
	await nextTurn();
	try {
		assert.equal(settled, true, 'cancellation settles while the external operation is still pending');
		assert.strictEqual(await outcome, cancellation);
	} finally {
		release();
		await outcome;
		await nextTurn();
	}
}

for (const long of [false, true]) {
	for (const result of [cachedPeaks, null]) {
		test(`${long ? 'streamed' : 'buffered'} source cancellation fences a late ${result ? 'cached analysis' : 'cache miss'}`, async () => {
			const run = fixture(long);
			const abort = new AbortController();
			const pending = run.service.loadProjectSources(run.project, { signal: abort.signal });
			await run.readStarted.promise;
			const provider = run.providers.get('source');
			await cancelPending(pending, abort, () => { run.read.resolve(result); });
			assert.deepEqual(run.effects, []);
			assert.strictEqual(run.buffers.get('source'), run.buffer);
			assert.strictEqual(run.peaks.get('source'), cachedPeaks);
			assert.strictEqual(run.providers.get('source'), provider);
			assert.equal(run.missingSourceIds.size, 0);
		});
	}
}

test('a rejected analysis read that finishes after cancellation does not mark the source missing', async () => {
	const run = fixture(true);
	const abort = new AbortController();
	const disposed = new EditorDisposedError();
	const pending = run.service.loadProjectSources(run.project, { signal: abort.signal });
	await run.readStarted.promise;
	await cancelPending(pending, abort, () => { run.read.reject(new Error('Late storage error')); }, disposed);
	assert.deepEqual(run.effects, []);
	assert.equal(run.missingSourceIds.size, 0);
});

test('an abort queued after analysis resolution still fences the cache publication checkpoint', async () => {
	const run = fixture(true);
	const abort = new AbortController();
	const cancellation = new EditorDisposedError();
	const pending = run.service.loadProjectSources(run.project, { signal: abort.signal });
	const rejected = assert.rejects(pending, error => error === cancellation);
	await run.readStarted.promise;
	const cancellationQueued = run.read.promise.then(() => { abort.abort(cancellation); });
	run.read.resolve(cachedPeaks);
	await cancellationQueued;
	await rejected;
	assert.deepEqual(run.effects, []);
	assert.strictEqual(run.buffers.get('source'), run.buffer);
	assert.strictEqual(run.peaks.get('source'), cachedPeaks);
});

test('active source loading preserves cached analyses and replaces missing RMS before retiring legacy entries', async () => {
	for (const long of [false, true]) {
		for (const result of [cachedPeaks, null]) {
			const run = fixture(long);
			run.read.resolve(result);
			await run.service.loadProjectSources(run.project);
			assert.strictEqual(run.peaks.get('source'), result ?? generatedPeaks);
			assert.equal(run.buffers.has('source'), !long);
			assert.equal(run.effects.includes('generate'), result === null);
			assert.equal(run.effects.includes('save'), result === null);
			assert.equal(run.effects.at(-1), 'delete:legacy:source');
			assert.equal(run.missingSourceIds.size, 0);
		}
	}
});
