/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTimelineClipViewModel } from '../src/common/editor/ui/timeline/waveform-view-model.ts';
import { WAVEFORM_PEAKS_VERSION } from '../src/common/editor/waveform-peak-contract.ts';

const sampleRate = 48_000;
const source = { id: 'source', name: 'Tone', sampleRate, frameCount: sampleRate, channelCount: 1 };
const clip = {
	id: 'clip', sourceId: source.id, timelineStartFrame: 0, sourceStartFrame: 0,
	sourceDurationFrames: sampleRate, durationFrames: sampleRate,
	waveformStartFrame: 0, waveformEndFrame: sampleRate,
};
const tone = Float32Array.from({ length: sampleRate }, (_, frame) => Math.sin(2 * Math.PI * frame / 8));
const buffer = { numberOfChannels: 1, getChannelData: () => tone };
const peaks = {
	version: WAVEFORM_PEAKS_VERSION,
	channelCount: 1,
	levels: [{
		blockSize: 8,
		channels: [{
			minimums: new Float32Array(sampleRate / 8).fill(-1),
			maximums: new Float32Array(sampleRate / 8).fill(1),
			rms: new Float32Array(sampleRate / 8).fill(0.7),
		}],
	}],
};
const cache = new Map();
const base = {
	sourceLookup: new Map([[source.id, source]]),
	clip,
	geometry: { overscanStartFrame: 0, pixelsPerSecond: 120, sampleRate },
	selection: { selectedClipIds: null },
	copy: { clip: 'Clip' },
	rendering: { provideAudacitySpectrogram: true },
	cache,
};

test('spectrogram clip projection keeps PCM across a bounded peak waveform', () => {
	const model = createTimelineClipViewModel({
		...base,
		controller: { getClipVisualData: () => ({ source, buffer, peaks }) },
	});
	const spectral = model.spectrogramWaveform as readonly { length: number; sampleAt(index: number): number }[];
	assert.equal((model.audacityWaveform as { peakBlockSize?: number }).peakBlockSize, 8);
	assert.equal(spectral[0].length, sampleRate);
	assert.ok(Math.abs(spectral[0].sampleAt(40_002) - tone[40_002]) < 1e-6);
	assert.equal(spectral[0].sampleAt(sampleRate), 0);
});

test('a cached peak waveform gains its spectrogram when PCM arrives', () => {
	let currentBuffer: typeof buffer | null = null;
	const options = {
		...base,
		controller: { getClipVisualData: () => ({ source, buffer: currentBuffer, peaks }) },
	};
	const before = createTimelineClipViewModel(options);
	assert.equal(before.spectrogramWaveform, undefined);
	currentBuffer = buffer;
	const after = createTimelineClipViewModel(options);
	const spectral = after.spectrogramWaveform as readonly { length: number; sampleAt(index: number): number }[];
	assert.equal(spectral[0].length, sampleRate);
	assert.equal(spectral[0].sampleAt(20), tone[20]);
});
