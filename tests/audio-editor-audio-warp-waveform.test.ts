/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	prepareAudioWarpPeakPyramidWaveformWindow,
	prepareAudioWarpWaveformWindow,
} from '../src/common/editor/ui/timeline/audio-warp-waveform.ts';
import { WAVEFORM_PEAKS_VERSION } from '../src/common/editor/waveform-peak-contract.ts';

test('overlapping fades on warped clips match the multiplied playback envelope', () => {
	const project = { sampleRate: 4, tempoMap: { mode: 'musical' as const,
		events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] } };
	const clip = {
		id: 'clip', kind: 'audio', anchor: 'sample', timelineStartFrame: 0,
		durationFrames: 4, sourceStartFrame: 0, sourceDurationFrames: 4,
		gain: 1, fadeInFrames: 4, fadeOutFrames: 4,
		warpMap: { feature: 'audio-warp' as const, points: [
			{ outer: 0, source: 0, mode: 'forward' as const },
			{ outer: 4, source: 4, mode: 'forward' as const },
		] },
	};
	const prepared = prepareAudioWarpWaveformWindow(project, clip, [new Float32Array(4).fill(1)],
		{ startFrame: 0, endFrame: 4, pixelWidth: 4, maxSamples: 4, sourceFrameOffset: 0 });
	const channel = prepared.rendering?.channels[0] as { maximum: Float32Array };
	assert.equal(Math.max(...channel.maximum), 0.25);
});

test('warped waveform columns consume the shared source map instead of linear clip stretch', () => {
	const project = {
		sampleRate: 4,
		tempoMap: {
			mode: 'musical' as const,
			events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
	};
	const clip = {
		id: 'clip', kind: 'audio', anchor: 'sample', timelineStartFrame: 0,
		durationFrames: 4, sourceStartFrame: 0, sourceDurationFrames: 8,
		gain: 1, fadeInFrames: 0, fadeOutFrames: 0,
		warpMap: {
			feature: 'audio-warp' as const,
			points: [
				{ outer: 0, source: 0, mode: 'forward' as const },
				{ outer: 2, source: 1, mode: 'forward' as const },
				{ outer: 4, source: 8, mode: 'forward' as const },
			],
		},
	};
	const prepared = prepareAudioWarpWaveformWindow(
		project,
		clip,
		[Float32Array.from({ length: 8 }, (_, index) => index / 10)],
		{ startFrame: 0, endFrame: 4, pixelWidth: 4, maxSamples: 8, sourceFrameOffset: 0 },
	);
	assert.equal(prepared.rendering?.mode, 'summary');
	const channel = prepared.rendering?.channels[0] as Readonly<{
		minimum: Float32Array;
		maximum: Float32Array;
	}>;
	const rounded = (values: Float32Array) => [...values].map((value) => Math.round(value * 10) / 10);
	assert.deepEqual(rounded(channel.minimum), [0, 0, 0.1, 0.4]);
	assert.deepEqual(rounded(channel.maximum), [0, 0, 0.4, 0.7]);
	assert.equal(prepared.sampleCount, 8);
});

test('warped summary columns aggregate persisted peak blocks through the exact map', () => {
	const project = {
		sampleRate: 4,
		tempoMap: {
			mode: 'musical' as const,
			events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
	};
	const clip = {
		id: 'clip', kind: 'audio', anchor: 'sample', timelineStartFrame: 0,
		durationFrames: 4, sourceStartFrame: 0, sourceDurationFrames: 8,
		gain: 1, fadeInFrames: 0, fadeOutFrames: 0,
		warpMap: {
			feature: 'audio-warp' as const,
			points: [
				{ outer: 0, source: 0, mode: 'forward' as const },
				{ outer: 2, source: 1, mode: 'forward' as const },
				{ outer: 4, source: 8, mode: 'forward' as const },
			],
		},
	};
	const values = Float32Array.from({ length: 8 }, (_, index) => index / 10);
	const prepared = prepareAudioWarpPeakPyramidWaveformWindow(project, clip, {
		version: WAVEFORM_PEAKS_VERSION,
		channelCount: 1,
		levels: [{
			blockSize: 1,
			channels: [{ minimums: values, maximums: values, rms: values }],
		}],
	}, { startFrame: 0, endFrame: 4, pixelWidth: 4, maxSamples: 8, sourceFrameCount: 8 });
	const channel = prepared.rendering?.channels[0] as Readonly<{
		minimum: Float32Array;
		maximum: Float32Array;
	}>;
	const rounded = (data: Float32Array) => [...data].map((value) => Math.round(value * 10) / 10);
	assert.deepEqual(rounded(channel.minimum), [0, 0, 0, 0.4]);
	assert.deepEqual(rounded(channel.maximum), [0, 0, 0.4, 0.7]);
	assert.equal(prepared.rendering?.peakBlockSize, 1);
});

test('inverted warped PCM waveforms mirror every summary column about zero', () => {
	const project = {
		sampleRate: 4,
		tempoMap: {
			mode: 'musical' as const,
			events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
	};
	const clip = {
		id: 'clip', kind: 'audio', anchor: 'sample', timelineStartFrame: 0,
		durationFrames: 4, sourceStartFrame: 0, sourceDurationFrames: 4,
		gain: 2, inverted: true, fadeInFrames: 0, fadeOutFrames: 0,
		warpMap: { feature: 'audio-warp' as const, points: [
			{ outer: 0, source: 0, mode: 'forward' as const },
			{ outer: 4, source: 4, mode: 'forward' as const },
		] },
	};
	const prepared = prepareAudioWarpWaveformWindow(
		project,
		clip,
		[Float32Array.of(0.25, 0.5, 0.75, 1)],
		{ startFrame: 0, endFrame: 4, pixelWidth: 4, maxSamples: 8, sourceFrameOffset: 0 },
	);
	const channel = prepared.rendering?.channels[0] as Readonly<{
		minimum: Float32Array;
		maximum: Float32Array;
	}>;
	assert.deepEqual([...channel.minimum], [-0.5, -1, -1.5, -2]);
	assert.deepEqual([...channel.maximum], [-0.5, -1, -1.5, -2]);
});

test('inverted warped peak-pyramid waveforms swap and negate extrema', () => {
	const project = {
		sampleRate: 4,
		tempoMap: {
			mode: 'musical' as const,
			events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
	};
	const clip = {
		id: 'clip', kind: 'audio', anchor: 'sample', timelineStartFrame: 0,
		durationFrames: 4, sourceStartFrame: 0, sourceDurationFrames: 4,
		gain: 2, inverted: true, fadeInFrames: 0, fadeOutFrames: 0,
		warpMap: { feature: 'audio-warp' as const, points: [
			{ outer: 0, source: 0, mode: 'forward' as const },
			{ outer: 4, source: 4, mode: 'forward' as const },
		] },
	};
	const prepared = prepareAudioWarpPeakPyramidWaveformWindow(project, clip, {
		version: WAVEFORM_PEAKS_VERSION,
		channelCount: 1,
		levels: [{
			blockSize: 1,
			channels: [{
				minimums: Float32Array.of(0.2, 0.3, 0.4, 0.5),
				maximums: Float32Array.of(0.6, 0.7, 0.8, 0.9),
				rms: Float32Array.of(0.4, 0.5, 0.6, 0.7),
			}],
		}],
	}, { startFrame: 0, endFrame: 4, pixelWidth: 1, maxSamples: 2, sourceFrameCount: 4 });
	const channel = prepared.rendering?.channels[0] as Readonly<{
		minimum: Float32Array;
		maximum: Float32Array;
		rms: Float32Array;
	}>;
	assert.deepEqual([...channel.minimum], [...Float32Array.of(-1.8)]);
	assert.deepEqual([...channel.maximum], [...Float32Array.of(-0.4)]);
	assert.deepEqual([...channel.rms], [...Float32Array.of(Math.sqrt(0.315) * 2)]);
});
