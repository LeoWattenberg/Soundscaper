/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { executeTimelineSpectrogramWorkerRequest, type TimelineSpectrogramWorkerTile } from '../src/common/editor/timeline-spectrogram-worker-runtime.ts';
import { createSpectrogramSampleViews } from '../src/common/editor/spectrogram-sample-view.ts';
import { pffftSpectrogramBandEnergies, preparePffftSpectrogram } from '../src/common/editor/pffft-spectrogram.js';
import { analyzeTimelineSpectrogramTileInWorker } from '../src/common/editor/timeline-spectrogram-worker-client.ts';
import type { OneShotWorkerPort } from '../src/common/editor/one-shot-worker-task.ts';

void test('timeline spectrum worker preserves exact spectral columns and FFT context', async () => {
	const channel = Float32Array.from({ length: 4_000 }, (_, index) => Math.sin(index / 8));
	const request: TimelineSpectrogramWorkerTile = { channels: [channel], clip: { timelineStartFrame: 0, sourceStartFrame: 0,
		durationFrames: 4_000, waveformStartFrame: 500, waveformEndFrame: 3_000, gain: 0.7, inverted: true,
		fadeInFrames: 300, fadeOutFrames: 400, reversed: true }, project: null, sourceFrameOffset: 0, frameCount: 2_000,
		offset: -200, width: 37.5, options: { fftWindowSize: 512, frequencyBands: 16, windowType: 'hann', pixelSkip: 1, pixelStart: 3, pixelEnd: 25 } };
	await preparePffftSpectrogram(512);
	const view = createSpectrogramSampleViews(request.channels, request.clip, { project: null, sourceFrameOffset: 0 })[0]!;
	const expected = pffftSpectrogramBandEnergies({ length: request.frameCount, sampleAt: (index: number) => view.sampleAt(index - request.offset) }, request.width, request.options);
	const result = await executeTimelineSpectrogramWorkerRequest({ ...request, type: 'timeline-spectrogram/v1', requestId: 'fixture' });
	assert.equal(result.type, 'result');
	assert.ok('result' in result); assert.deepEqual(result.result, [expected]);
});

void test('timeline spectrum worker borrows cached PCM and terminates at cancellation', async () => {
	const channel = new Float32Array(100);
	const listeners = new Map<string, (event: { data?: unknown }) => void>();
	let sent: Record<string, unknown> | null = null;
	let transfers: readonly Transferable[] | undefined;
	let terminations = 0;
	const worker: OneShotWorkerPort = { addEventListener: (type, listener) => { listeners.set(type, listener); },
		removeEventListener: type => { listeners.delete(type); }, postMessage: (value, transfer) => { sent = value as Record<string, unknown>; transfers = transfer; },
		terminate: () => { terminations += 1; } };
	const abort = new AbortController();
	const pending = analyzeTimelineSpectrogramTileInWorker({ channels: [channel], clip: { timelineStartFrame: 0,
		sourceStartFrame: 0, durationFrames: 100, waveformStartFrame: 0, waveformEndFrame: 100 }, project: null,
		sourceFrameOffset: 0, frameCount: 100, offset: 0, width: 10, options: { fftWindowSize: 32, pixelSkip: 1, pixelStart: 0, pixelEnd: 10 } },
	{ signal: abort.signal, workerFactory: () => worker });
	assert.ok(sent); const copy = (sent as Record<string, unknown>).channels as Float32Array[];
	assert.notEqual(copy[0]!.buffer, channel.buffer);
	assert.equal(transfers?.[0], copy[0]!.buffer);
	assert.equal(channel.byteLength, 400);
	abort.abort(); await assert.rejects(pending);
	assert.equal(terminations, 1); assert.equal(listeners.size, 0);
});
