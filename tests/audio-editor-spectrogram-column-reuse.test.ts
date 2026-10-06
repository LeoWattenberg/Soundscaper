/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSpectrogramColumnCache } from '../src/common/editor/controller/source/internal/spectrogram-column-cache.ts';
import { spectrogramColumnReuseKey } from '../src/common/editor/ui/timeline/spectrogram-column-reuse.ts';
import { generateSpectrogramPcmTiles, type SpectrogramPcmTileOptions } from '../src/common/editor/ui/timeline/spectrogram-pcm-tiles.ts';

const samples = Float32Array.from({ length: 6_400 }, (_, frame) => Math.sin(frame / 100));
const clip = {
	id: 'clip', sourceId: 'source', timelineStartFrame: 0,
	durationFrames: samples.length, sourceStartFrame: 0, sourceDurationFrames: samples.length,
	waveformStartFrame: 0, waveformEndFrame: 2_560,
};
const source = { id: 'source', sampleRate: 48_000, frameCount: samples.length, channelCount: 1 };
const keyOptions = { clip, source, width: 256, sampleRate: 48_000, fftWindowSize: 32, windowType: 'hann' };

test('aligned scrolls reuse only identical FFT centers and analyze the newly exposed columns', async () => {
	const cache = createSpectrogramColumnCache(100_000);
	const key = spectrogramColumnReuseKey(keyOptions);
	assert.ok(key);
	let reads = 0;
	let analyzed = 0;
	const options: SpectrogramPcmTileOptions = {
		clip, width: 256, fftWindowSize: 32, maximumSourceFrames: 128,
		columnCache: cache.forKey(key),
		async requestPcmWindow(startFrame, endFrame) {
			reads += 1;
			return { startFrame, endFrame, channels: [samples.slice(startFrame, endFrame)] };
		},
		analyze(view, width, geometry) {
			const output: number[][] = [];
			for (let pixel = geometry.pixelStart; pixel < geometry.pixelEnd; pixel += geometry.pixelSkip) {
				const center = Math.floor(pixel * view.length / width);
				output.push([view.sampleAt(center - 16), view.sampleAt(center), view.sampleAt(center + 15)]);
				analyzed += 1;
			}
			return output;
		},
	};
	const first = await generateSpectrogramPcmTiles(options);
	assert.equal(analyzed, 256);
	const shifted = { ...clip, waveformStartFrame: 640, waveformEndFrame: 3_200 };
	assert.equal(spectrogramColumnReuseKey({ ...keyOptions, clip: shifted }), key);
	analyzed = 0;
	reads = 0;
	const next = await generateSpectrogramPcmTiles({ ...options, clip: shifted });
	assert.equal(analyzed, 64, 'three quarters of the requested centers already have exact bands');
	assert.ok(reads < 10, 'cached columns do not require PCM reads');
	assert.ok(first && next);
	assert.equal(next.channels[0]![0], first.channels[0]![64], 'cached band arrays remain borrowed');
	const uncached = await generateSpectrogramPcmTiles({ ...options, clip: shifted, columnCache: undefined });
	assert.deepEqual(next, uncached);
	analyzed = 0;
	reads = 0;
	assert.deepEqual(await generateSpectrogramPcmTiles({ ...options, clip: shifted }), next);
	assert.equal(analyzed, 0);
	assert.equal(reads, 0);
});

test('unaligned canvas centers and FFT/source/time changes cannot reuse old columns', () => {
	const key = spectrogramColumnReuseKey(keyOptions);
	assert.equal(spectrogramColumnReuseKey({ ...keyOptions, width: 255 }), null);
	assert.equal(spectrogramColumnReuseKey({ ...keyOptions, clip: { ...clip, waveformStartFrame: 1, waveformEndFrame: 2_561 } }), null);
	for (const changed of [
		{ source: { ...source, revision: 2 } },
		{ source: { ...source, channelCount: 2 } },
		{ clip: { ...clip, fadeInShape: 0.6, fadeInFrames: 200 } },
		{ fftWindowSize: 64 },
		{ windowType: 'blackman' },
		{ project: { sampleRate: 44_100, tempoMap: { mode: 'sampleLocked' as const, events: [] } } },
	]) assert.notEqual(spectrogramColumnReuseKey({ ...keyOptions, ...changed }), key);
});

test('reused PFFFT energies match a fresh stereo fade analysis at every shifted column', async () => {
	const channels = [samples, Float32Array.from(samples, (sample) => sample * 0.3)];
	const faded = { ...clip, gain: -0.7, fadeInFrames: 2_000, fadeInShape: 0.6, fadeOutFrames: 2_000, fadeOutShape: -0.3 };
	const cache = createSpectrogramColumnCache(100_000);
	const key = spectrogramColumnReuseKey({ ...keyOptions, clip: faded });
	assert.ok(key);
	const options: SpectrogramPcmTileOptions = {
		clip: faded, width: 256, fftWindowSize: 32, windowType: 'hann',
		columnCache: cache.forKey(key), maximumSourceFrames: 128,
		async requestPcmWindow(startFrame, endFrame) {
			return { startFrame, endFrame, channels: channels.map((channel) => channel.slice(startFrame, endFrame)) };
		},
	};
	assert.ok(await generateSpectrogramPcmTiles(options));
	const shifted = { ...faded, waveformStartFrame: 640, waveformEndFrame: 3_200 };
	const reused = await generateSpectrogramPcmTiles({ ...options, clip: shifted });
	const fresh = await generateSpectrogramPcmTiles({ ...options, clip: shifted, columnCache: undefined });
	assert.ok(reused && fresh);
	assert.equal(reused.channels.length, 2);
	assert.deepEqual(reused, fresh);
});

test('the tile generator ignores a supplied cache when its FFT centers are unaligned', async () => {
	let cacheReads = 0;
	let cacheWrites = 0;
	const result = await generateSpectrogramPcmTiles({
		clip: { ...clip, waveformStartFrame: 1, waveformEndFrame: 101 }, width: 3, fftWindowSize: 32,
		columnCache: { read: () => { cacheReads += 1; return [[99]]; }, write: () => { cacheWrites += 1; } },
		async requestPcmWindow(startFrame, endFrame) {
			return { startFrame, endFrame, channels: [samples.slice(startFrame, endFrame)] };
		},
		analyze(view, width, geometry) {
			return Array.from({ length: geometry.pixelEnd - geometry.pixelStart }, (_, offset) => [
				view.sampleAt(Math.floor((geometry.pixelStart + offset) * view.length / width)),
			]);
		},
	});
	assert.ok(result);
	assert.equal(cacheReads, 0);
	assert.equal(cacheWrites, 0);
	assert.deepEqual(result.channels[0], [1, 34, 67].map((frame) => [samples[frame]]));
});

test('aborted spectral analysis does not publish reusable columns', async () => {
	const abort = new AbortController();
	let writes = 0;
	await assert.rejects(generateSpectrogramPcmTiles({
		clip, width: 256, fftWindowSize: 32, signal: abort.signal,
		columnCache: { read: () => null, write: () => { writes += 1; } },
		async requestPcmWindow(startFrame, endFrame) {
			return { startFrame, endFrame, channels: [samples.slice(startFrame, endFrame)] };
		},
		analyze(_view, _width, geometry) {
			abort.abort();
			return Array.from({ length: geometry.pixelEnd - geometry.pixelStart }, () => [1]);
		},
	}), { name: 'AbortError' });
	assert.equal(writes, 0);
});
