/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { requestCachedWaveformPeakWindow } from '../src/common/editor/controller/source/internal/waveform-peak-window-cache.ts';
import {
	MAXIMUM_WAVEFORM_PEAK_WINDOW_BUCKETS,
	readWaveformPeakWindow,
} from '../src/common/editor/controller/source/waveform-analysis.ts';
import { createSourceLifecycleFixture } from './helpers/audio-editor-source-lifecycle-fixture.ts';

function deferred<T>() {
	let resolvePromise: (value: T) => void = () => undefined;
	const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
	return { promise, resolve: resolvePromise };
}

function peakWindow(blockSize: number) {
	return {
		startFrame: 0,
		endFrame: 100,
		blockSize,
		pixelsPerSample: 0.1,
		channels: [{
			minimums: new Float32Array(Math.ceil(100 / blockSize)),
			maximums: new Float32Array(Math.ceil(100 / blockSize)),
			rms: new Float32Array(Math.ceil(100 / blockSize)),
		}],
	};
}

test('PCM remains available when only read-ahead padding crosses the window cap', async () => {
	const fixture = createSourceLifecycleFixture({
		maximumWaveformFrames: 20,
		clipSourceWindowRange: (_clip, startFrame, endFrame, _sourceFrameCount, paddingFrames = 2) => ({
			startFrame: Math.max(0, startFrame - paddingFrames),
			endFrame: endFrame + paddingFrames,
		}),
	});
	const pending = fixture.service.requestWaveformPcmWindow('clip', { startFrame: 0, endFrame: 20 });
	await Promise.resolve();
	fixture.resolveRead([new Float32Array(20)]);

	const window = await pending;
	assert.deepEqual(window && { startFrame: window.startFrame, endFrame: window.endFrame }, {
		startFrame: 0,
		endFrame: 20,
	});
});

test('waveform peak windows stream exact extrema and RMS across storage chunks', async () => {
	const samples = Float32Array.of(99, 99, -1, 0, 1, 2, -2, 1, 0.5, -0.5, 0.25, 99);
	const chunks = [samples.slice(0, 4), samples.slice(4, 8), samples.slice(8)];
	const reads: number[] = [];
	const window = await readWaveformPeakWindow({
		channelCount: 1,
		chunkFrames: 4,
		readStorageChunk(chunkIndex) {
			reads.push(chunkIndex);
			return { channels: [chunks[chunkIndex]!] };
		},
	}, { startFrame: 2, endFrame: 11 }, { pixelWidth: 3 });

	assert.deepEqual(reads, [0, 1, 2]);
	assert.equal(window.startFrame, 2);
	assert.equal(window.endFrame, 11);
	assert.equal(window.blockSize, 3);
	assert.equal(window.blockSize * window.pixelsPerSample, 1);
	assert.deepEqual([...window.channels[0]!.minimums], [-1, -2, -0.5]);
	assert.deepEqual([...window.channels[0]!.maximums], [1, 2, 0.5]);
	assert.ok(Math.abs(window.channels[0]!.rms[0]! - Math.sqrt(2 / 3)) < 1e-6);
	assert.ok(Math.abs(window.channels[0]!.rms[1]! - Math.sqrt(3)) < 1e-6);
	assert.ok(Math.abs(window.channels[0]!.rms[2]! - Math.sqrt(0.1875)) < 1e-6);
});

test('waveform peak windows keep output bounded beyond the raw PCM window cap', async () => {
	const frameCount = 262_145;
	const chunkFrames = 65_536;
	const pixelWidth = 512;
	const window = await readWaveformPeakWindow({
		channelCount: 2,
		chunkFrames,
		readStorageChunk(chunkIndex) {
			const length = Math.min(chunkFrames, frameCount - chunkIndex * chunkFrames);
			return { channels: [new Float32Array(length).fill(-0.25), new Float32Array(length).fill(0.5)] };
		},
	}, { startFrame: 0, endFrame: frameCount }, { pixelWidth });

	assert.ok(window.blockSize * window.pixelsPerSample <= 1);
	assert.ok(window.channels[0]!.minimums.length <= pixelWidth * 2);
	assert.equal(window.channels[0]!.minimums.length, window.channels[1]!.minimums.length);
	assert.equal(window.channels[0]!.minimums[0], -0.25);
	assert.equal(window.channels[1]!.maximums.at(-1), 0.5);
});

test('waveform peak windows reject a scale that requires individual PCM samples', async () => {
	await assert.rejects(readWaveformPeakWindow({
		channelCount: 1,
		chunkFrames: 4,
		readStorageChunk: () => ({ channels: [new Float32Array(4)] }),
	}, { startFrame: 0, endFrame: 4 }, { pixelWidth: 8 }), /individual PCM samples/iu);
});

test('waveform peak windows honor the exact projected block limit for fractional ranges', async () => {
	const window = await readWaveformPeakWindow({
		channelCount: 1,
		chunkFrames: 300,
		readStorageChunk: () => ({ channels: [new Float32Array(300)] }),
	}, { startFrame: 0, endFrame: 300 }, { pixelWidth: 100, maximumBlockSize: 2 });

	assert.equal(window.blockSize, 2);
});

test('waveform peak windows reject allocation beyond the viewport bucket budget', async () => {
	await assert.rejects(readWaveformPeakWindow({
		channelCount: 1,
		chunkFrames: MAXIMUM_WAVEFORM_PEAK_WINDOW_BUCKETS + 1,
		readStorageChunk: () => ({
			channels: [new Float32Array(MAXIMUM_WAVEFORM_PEAK_WINDOW_BUCKETS + 1)],
		}),
	}, {
		startFrame: 0,
		endFrame: MAXIMUM_WAVEFORM_PEAK_WINDOW_BUCKETS + 1,
	}, {
		pixelWidth: MAXIMUM_WAVEFORM_PEAK_WINDOW_BUCKETS + 1,
	}), /bucket budget/iu);
});

test('waveform peak windows explicitly bound retained channels and total transient memory', async () => {
	const channels = Array.from({ length: 4 }, (_, channel) => new Float32Array(100).fill(channel));
	const window = await readWaveformPeakWindow({
		channelCount: channels.length,
		chunkFrames: 100,
		readStorageChunk: () => ({ channels }),
	}, { startFrame: 0, endFrame: 100 }, { pixelWidth: 10, maximumChannels: 2 });
	assert.equal(window.channels.length, 2);
	assert.equal(window.channels[1]?.maximums[0], 1);

	await assert.rejects(readWaveformPeakWindow({
		channelCount: 1_024,
		chunkFrames: 200,
		readStorageChunk: () => { throw new Error('memory validation must precede source reads'); },
	}, { startFrame: 0, endFrame: 200 }, { pixelWidth: 200 }), /memory budget/iu);
});

test('identical peak requests share provider acquisition and analysis', async () => {
	const providerGate = deferred<object>();
	const requests = new Map();
	const windows = new Map();
	let providerReads = 0;
	let windowReads = 0;
	const options = {
		cacheKey: 'clip', sourceId: 'source', range: { startFrame: 0, endFrame: 100 },
		pixelWidth: 10, maximumBlockSize: 10, maximumEntries: 2,
		requests, windows,
		getProvider: async () => { providerReads += 1; return providerGate.promise; },
		readWindow: async () => { windowReads += 1; return peakWindow(10); },
		isCurrent: () => true,
		isRetiredError: () => false,
		publish: () => undefined,
	};
	const first = requestCachedWaveformPeakWindow(options);
	const second = requestCachedWaveformPeakWindow(options);
	providerGate.resolve({});

	assert.strictEqual(await first, await second);
	assert.equal(providerReads, 1);
	assert.equal(windowReads, 1);
});

test('a finer peak request aborts superseded analysis and is the only result published', async () => {
	const requests = new Map();
	const windows = new Map();
	const firstSignals: AbortSignal[] = [];
	let publishes = 0;
	const firstStarted = deferred<void>();
	const common = {
		cacheKey: 'clip', sourceId: 'source', range: { startFrame: 0, endFrame: 100 },
		maximumEntries: 2, requests, windows,
		getProvider: async () => ({}),
		isCurrent: () => true,
		isRetiredError: () => false,
		publish: () => { publishes += 1; },
	};
	const first = requestCachedWaveformPeakWindow({
		...common,
		pixelWidth: 10,
		maximumBlockSize: 10,
		readWindow: (_provider, _range, options) => new Promise((_resolve, reject) => {
			if (options.signal) firstSignals.push(options.signal);
			firstStarted.resolve();
			options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
		}),
	});
	await firstStarted.promise;
	const second = requestCachedWaveformPeakWindow({
		...common,
		pixelWidth: 20,
		maximumBlockSize: 5,
		readWindow: async () => peakWindow(5),
	});

	assert.equal(await first, null);
	assert.equal(firstSignals[0]?.aborted, true);
	assert.equal((await second)?.blockSize, 5);
	assert.equal(publishes, 1);
});

test('a provider miss releases request ownership so a later request can retry', async () => {
	const requests = new Map();
	const windows = new Map();
	let available = false;
	let reads = 0;
	const options = {
		cacheKey: 'clip', sourceId: 'source', range: { startFrame: 0, endFrame: 100 },
		pixelWidth: 10, maximumBlockSize: 10, maximumEntries: 2,
		requests, windows,
		getProvider: async () => available ? {} : null,
		readWindow: async () => { reads += 1; return peakWindow(10); },
		isCurrent: () => true,
		isRetiredError: () => false,
		publish: () => undefined,
	};
	assert.equal(await requestCachedWaveformPeakWindow(options), null);
	assert.equal(requests.size, 0);
	available = true;
	assert.equal((await requestCachedWaveformPeakWindow(options))?.blockSize, 10);
	assert.equal(reads, 1);
});

test('returning to a cached range aborts analysis for the superseded viewport', async () => {
	const requests = new Map();
	const cached = Object.freeze({
		clipId: 'clip', sourceId: 'source', ...peakWindow(10),
	});
	const windows = new Map([['clip', cached]]);
	const started = deferred<void>();
	const pendingSignals: AbortSignal[] = [];
	const common = {
		cacheKey: 'clip', sourceId: 'source', pixelWidth: 10, maximumBlockSize: 10,
		maximumEntries: 2, requests, windows,
		getProvider: async () => ({}),
		isCurrent: () => true,
		isRetiredError: () => false,
		publish: () => undefined,
	};
	const superseded = requestCachedWaveformPeakWindow({
		...common,
		range: { startFrame: 100, endFrame: 200 },
		readWindow: (_provider, _range, options) => new Promise((_resolve, reject) => {
			if (options.signal) pendingSignals.push(options.signal);
			started.resolve();
			options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
		}),
	});
	await started.promise;
	const returned = await requestCachedWaveformPeakWindow({
		...common,
		range: { startFrame: 0, endFrame: 100 },
		readWindow: async () => peakWindow(10),
	});

	assert.strictEqual(returned, cached);
	assert.equal(await superseded, null);
	assert.equal(pendingSignals[0]?.aborted, true);
});

test('a clip source replacement cannot reuse its old peak window', async () => {
	const oldWindow = Object.freeze({ clipId: 'clip', sourceId: 'old-source', ...peakWindow(10) });
	const windows = new Map([['clip', oldWindow]]);
	let reads = 0;
	const result = await requestCachedWaveformPeakWindow({
		cacheKey: 'clip', sourceId: 'new-source', range: { startFrame: 0, endFrame: 100 },
		pixelWidth: 10, maximumBlockSize: 10, maximumEntries: 2,
		requests: new Map(), windows,
		getProvider: async () => ({}),
		readWindow: async () => {
			reads += 1;
			return peakWindow(10);
		},
		isCurrent: () => true,
		isRetiredError: () => false,
		publish: () => undefined,
	});
	assert.equal(reads, 1);
	assert.equal(result?.sourceId, 'new-source');
	assert.notStrictEqual(result, oldWindow);
});
