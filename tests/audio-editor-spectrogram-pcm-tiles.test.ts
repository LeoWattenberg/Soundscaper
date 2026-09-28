/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { projectUnwarpedClipSourceRange } from '../src/common/editor/audio-clip-source-projection.ts';
import { audioWarpSourceRange } from '../src/common/editor/audio-warp-runtime.ts';
import { generateSpectrogramPcmTiles } from '../src/common/editor/ui/timeline/spectrogram-pcm-tiles.ts';

test('spectrogram PCM tiles analyze every display pixel by default', async () => {
	const samples = new Float32Array(640);
	const pixels: number[] = [];
	const result = await generateSpectrogramPcmTiles({
		clip: {
			id: 'clip', sourceId: 'source', timelineStartFrame: 0,
			durationFrames: 640, sourceStartFrame: 0, sourceDurationFrames: 640,
			waveformStartFrame: 0, waveformEndFrame: 640,
		},
		width: 16,
		fftWindowSize: 32,
		maximumSourceFrames: 128,
		async requestPcmWindow(startFrame, endFrame) {
			return { startFrame, endFrame, channels: [samples.slice(startFrame, endFrame)] };
		},
		analyze(_view, _width, options) {
			const columns: number[][] = [];
			for (let pixel = options.pixelStart; pixel < options.pixelEnd; pixel += options.pixelSkip) {
				pixels.push(pixel);
				columns.push([pixel]);
			}
			return columns;
		},
	});
	assert.ok(result);
	assert.equal(result.pixelSkip, 1);
	assert.deepEqual(pixels, Array.from({ length: 16 }, (_, pixel) => pixel));
	assert.deepEqual(result.channels[0], pixels.map((pixel) => [pixel]));
});

test('spectrogram PCM tiles stay bounded, sequential, and aligned with global canvas columns', async () => {
	const samples = Float32Array.from({ length: 640 }, (_, frame) => frame / 640);
	const requests: Array<readonly [number, number]> = [];
	const analyzedPixels: number[] = [];
	let activeRequests = 0;
	const result = await generateSpectrogramPcmTiles({
		clip: {
			id: 'clip', sourceId: 'source', timelineStartFrame: 0,
			durationFrames: 640, sourceStartFrame: 0, sourceDurationFrames: 640,
			waveformStartFrame: 0, waveformEndFrame: 640,
		},
		width: 64,
		fftWindowSize: 32,
		pixelSkip: 4,
		maximumSourceFrames: 128,
		async requestPcmWindow(startFrame, endFrame) {
			activeRequests += 1;
			assert.equal(activeRequests, 1, 'the clip cache holds only one PCM window');
			requests.push([startFrame, endFrame]);
			await Promise.resolve();
			activeRequests -= 1;
			return { startFrame, endFrame, channels: [samples.slice(startFrame, endFrame)] };
		},
		analyze(view, width, options) {
			const columns: number[][] = [];
			for (let pixel = options.pixelStart; pixel < options.pixelEnd; pixel += options.pixelSkip) {
				analyzedPixels.push(pixel);
				const center = Math.floor(pixel * view.length / width);
				columns.push([view.sampleAt(center - 16), view.sampleAt(center + 15)]);
			}
			return columns;
		},
	});

	assert.ok(result);
	assert.ok(requests.length > 1);
	assert.ok(requests.every(([start, end]) => end - start <= 124),
		'leave room for the source requester\'s two-frame padding at both ends');
	assert.deepEqual(analyzedPixels, Array.from({ length: 16 }, (_, index) => index * 4));
	const columns = result.channels[0]!;
	assert.equal(columns.length, 16);
	for (let index = 0; index < columns.length; index += 1) {
		const center = index * 40;
		assert.deepEqual(columns[index], [center >= 16 ? samples[center - 16] : 0, samples[center + 15]]);
	}
	assert.equal(result.width, 64);
	assert.equal(result.pixelSkip, 4);
});

test('spectrogram tile sizing follows stretched reverse source geometry', async () => {
	const samples = Float32Array.from({ length: 1_280 }, (_, frame) => frame / 1_280);
	const requests: Array<readonly [number, number]> = [];
	const clip = {
		id: 'clip', sourceId: 'source', timelineStartFrame: 0,
		durationFrames: 640, sourceStartFrame: 0, sourceDurationFrames: 1_280,
		waveformStartFrame: 0, waveformEndFrame: 640, reversed: true,
	};
	const result = await generateSpectrogramPcmTiles({
		clip,
		width: 64,
		fftWindowSize: 32,
		pixelSkip: 4,
		maximumSourceFrames: 128,
		async requestPcmWindow(startFrame, endFrame) {
			const range = projectUnwarpedClipSourceRange(clip, startFrame, endFrame);
			const sourceStart = Math.floor(range.startFrame);
			const sourceEnd = Math.ceil(range.endFrame);
			requests.push([sourceStart, sourceEnd]);
			return { startFrame: sourceStart, endFrame: sourceEnd,
				channels: [samples.slice(sourceStart, sourceEnd)] };
		},
		analyze(view, width, options) {
			const columns: number[][] = [];
			for (let pixel = options.pixelStart; pixel < options.pixelEnd; pixel += options.pixelSkip) {
				const first = Math.floor(pixel * view.length / width);
				columns.push([view.sampleAt(first)]);
			}
			return columns;
		},
	});

	assert.ok(result);
	assert.ok(requests.length > 1);
	assert.ok(requests.every(([start, end]) => end - start <= 124));
	assert.deepEqual(result.channels[0]!.map((column) => column[0]),
		Array.from({ length: 16 }, (_, index) => samples[1_279 - index * 80]));
});

test('an unavailable PCM tile returns null instead of a blue-looking partial spectrogram', async () => {
	let analyses = 0;
	const result = await generateSpectrogramPcmTiles({
		clip: {
			id: 'clip', sourceId: 'source', timelineStartFrame: 0,
			durationFrames: 64, sourceStartFrame: 0, sourceDurationFrames: 64,
			waveformStartFrame: 0, waveformEndFrame: 64,
		},
		width: 16,
		fftWindowSize: 32,
		maximumSourceFrames: 64,
		requestPcmWindow: async () => null,
		analyze: () => { analyses += 1; return []; },
	});
	assert.equal(result, null);
	assert.equal(analyses, 0);
});

test('spectrogram tiles bound nonlinear warp requests by mapped source frames', async () => {
	const project = {
		sampleRate: 48_000,
		tempoMap: { mode: 'musical' as const,
			events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
	};
	const clip = {
		id: 'clip', sourceId: 'source', kind: 'audio', anchor: 'sample',
		timelineStartFrame: 0, durationFrames: 80,
		sourceStartFrame: 0, sourceDurationFrames: 320,
		waveformStartFrame: 0, waveformEndFrame: 80,
		warpMap: { feature: 'audio-warp' as const, points: [
			{ outer: 0, source: 0, mode: 'forward' as const },
			{ outer: 40, source: 40, mode: 'forward' as const },
			{ outer: 80, source: 320, mode: 'forward' as const },
		] },
	};
	const samples = Float32Array.from({ length: 320 }, (_, frame) => frame / 320);
	const spans: number[] = [];
	const result = await generateSpectrogramPcmTiles({
		clip, project, width: 16, fftWindowSize: 32, pixelSkip: 4,
		maximumSourceFrames: 256,
		async requestPcmWindow(startFrame, endFrame) {
			const range = audioWarpSourceRange(project, clip, { startFrame, endFrame });
			const sourceStart = Math.floor(range.startFrame);
			const sourceEnd = Math.ceil(range.endFrame);
			spans.push(sourceEnd - sourceStart);
			return { startFrame: sourceStart, endFrame: sourceEnd,
				channels: [samples.slice(sourceStart, sourceEnd)] };
		},
		analyze(view, width, options) {
			const columns: number[][] = [];
			for (let pixel = options.pixelStart; pixel < options.pixelEnd; pixel += options.pixelSkip) {
				columns.push([view.sampleAt(Math.floor(pixel * view.length / width))]);
			}
			return columns;
		},
	});
	assert.ok(result);
	assert.ok(spans.length > 1);
	assert.ok(spans.every((span) => span <= 252));
	assert.deepEqual(result.channels[0]!.map((column) => column[0]),
		[0, 20 / 320, 40 / 320, 180 / 320].map((value) => Math.fround(value)));
});

test('PFFFT retains a sustained tone through the first, middle, and last streamed PCM tiles', async () => {
	const frameCount = 300_000;
	const samples = Float32Array.from({ length: frameCount }, (_, frame) => (
		0.6 * Math.sin(2 * Math.PI * 1_000 * frame / 48_000)
	));
	const ranges: Array<readonly [number, number]> = [];
	let activeRequests = 0;
	const result = await generateSpectrogramPcmTiles({
		clip: {
			id: 'clip', sourceId: 'source', timelineStartFrame: 0,
			durationFrames: frameCount, sourceStartFrame: 0,
			sourceDurationFrames: frameCount,
			waveformStartFrame: 0, waveformEndFrame: frameCount,
		},
		width: 96,
		fftWindowSize: 2_048,
		frequencyBands: 16,
		pixelSkip: 4,
		windowType: 'hann',
		async requestPcmWindow(startFrame, endFrame) {
			activeRequests += 1;
			assert.equal(activeRequests, 1);
			ranges.push([startFrame, endFrame]);
			await Promise.resolve();
			activeRequests -= 1;
			return { startFrame, endFrame, channels: [samples.slice(startFrame, endFrame)] };
		},
	});
	assert.ok(result);
	assert.ok(ranges.length > 1);
	assert.ok(ranges.every(([start, end]) => end - start <= 262_140));
	const columns = result.channels[0]!;
	assert.equal(columns.length, 24);
	const toneEnergies = [columns[1]![0]!, columns[12]![0]!, columns[23]![0]!];
	assert.ok(toneEnergies.every((energy) => energy > 0.001));
	assert.ok(Math.min(...toneEnergies) / Math.max(...toneEnergies) > 0.9,
		`the same tone must retain comparable energy across PCM tiles: ${toneEnergies}`);
	assert.ok(columns[0]![0]! > toneEnergies[0]! * 0.4,
		'the actual clip start retains spectral energy with half a centered window');
});

test('a highly zoomed projected slice reads centered FFT context without shifting its columns', async () => {
	const samples = Float32Array.from({ length: 10_000 }, (_, frame) => frame / 10_000);
	const requests: Array<readonly [number, number]> = [];
	const result = await generateSpectrogramPcmTiles({
		clip: {
			id: 'clip', sourceId: 'source', timelineStartFrame: 0,
			durationFrames: 10_000, sourceStartFrame: 0,
			sourceDurationFrames: 10_000,
			waveformStartFrame: 5_000, waveformEndFrame: 5_050,
		},
		width: 100, fftWindowSize: 256, pixelSkip: 4,
		maximumSourceFrames: 512,
		async requestPcmWindow(startFrame, endFrame) {
			requests.push([startFrame, endFrame]);
			return { startFrame, endFrame, channels: [samples.slice(startFrame, endFrame)] };
		},
		analyze(view, width, options) {
			const columns: number[][] = [];
			for (let pixel = options.pixelStart; pixel < options.pixelEnd; pixel += options.pixelSkip) {
				const center = Math.floor(pixel * view.length / width);
				columns.push([view.sampleAt(center - 128), view.sampleAt(center + 127)]);
			}
			return columns;
		},
	});
	assert.ok(result);
	assert.deepEqual(requests, [[4_872, 5_176]]);
	const columns = result.channels[0]!;
	assert.equal(columns.length, 25);
	assert.deepEqual(columns[0], [samples[4_872], samples[5_127]]);
	assert.deepEqual(columns[24], [samples[4_920], samples[5_175]]);
});

test('a projected slice at the clip end keeps left FFT context inside the clip', async () => {
	const samples = Float32Array.from({ length: 10_000 }, (_, frame) => frame / 10_000);
	const requests: Array<readonly [number, number]> = [];
	const result = await generateSpectrogramPcmTiles({
		clip: {
			id: 'clip', sourceId: 'source', timelineStartFrame: 0,
			durationFrames: 10_000, sourceStartFrame: 0,
			sourceDurationFrames: 10_000,
			waveformStartFrame: 9_950, waveformEndFrame: 10_000,
		},
		width: 100, fftWindowSize: 256, pixelSkip: 4,
		maximumSourceFrames: 512,
		async requestPcmWindow(startFrame, endFrame) {
			requests.push([startFrame, endFrame]);
			return { startFrame, endFrame, channels: [samples.slice(startFrame, endFrame)] };
		},
		analyze(view, width, options) {
			const columns: number[][] = [];
			for (let pixel = options.pixelStart; pixel < options.pixelEnd; pixel += options.pixelSkip) {
				const center = Math.floor(pixel * view.length / width);
				columns.push([view.sampleAt(center - 128), view.sampleAt(center + 127)]);
			}
			return columns;
		},
	});
	assert.ok(result);
	assert.deepEqual(requests, [[9_822, 10_000]]);
	const columns = result.channels[0]!;
	assert.deepEqual(columns[0], [samples[9_822], 0]);
	assert.deepEqual(columns[24], [samples[9_870], 0]);
});

test('PFFFT paints a short projected tone at interior and final clip positions', async () => {
	const samples = Float32Array.from({ length: 10_000 }, (_, frame) => (
		0.6 * Math.sin(2 * Math.PI * 1_000 * frame / 48_000)
	));
	for (const { startFrame, endFrame, minimumRatio } of [
		{ startFrame: 5_000, endFrame: 5_050, minimumRatio: 0.9 },
		{ startFrame: 9_950, endFrame: 10_000, minimumRatio: 0.7 },
	]) {
		const result = await generateSpectrogramPcmTiles({
			clip: {
				id: 'clip', sourceId: 'source', timelineStartFrame: 0,
				durationFrames: samples.length, sourceStartFrame: 0,
				sourceDurationFrames: samples.length,
				waveformStartFrame: startFrame, waveformEndFrame: endFrame,
			},
			width: 100, fftWindowSize: 2_048, frequencyBands: 16,
			pixelSkip: 4, windowType: 'hann',
			async requestPcmWindow(start, end) {
				return { startFrame: start, endFrame: end,
					channels: [samples.slice(start, end)] };
			},
		});
		assert.ok(result);
		const columns = result.channels[0]!;
		assert.equal(columns.length, 25);
		const energies = [columns[0]![0]!, columns[12]![0]!, columns[24]![0]!];
		assert.ok(energies.every((energy) => energy > 0.001),
			`short view ${startFrame}-${endFrame} lost tone energy: ${energies}`);
		assert.ok(Math.min(...energies) / Math.max(...energies) > minimumRatio,
			`short view ${startFrame}-${endFrame} changed color across its columns: ${energies}`);
	}
});
