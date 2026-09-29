/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { UnifiedExactRenderVisualFrameEntryV13 } from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';
import { renderSoundVisualizerRgba } from '../src/common/editor/sound-visualizer-rgba.ts';
import {
	createFramescaperSoundVisualizerWindowReader,
} from '../src/framescaper/sound-visualizer-window.ts';

const sampleRate = 1_000;
const samples = Float32Array.from({ length: 64 }, (_, index) => index);

function entry(sourceIds: string[] = [], windowSeconds = 0.01,
	mode: 'waveform' | 'spectrum' = 'waveform'): UnifiedExactRenderVisualFrameEntryV13 {
	return {
		nodeId: 'visual-node', modelId: 'visual-clip', modelKind: 'sound-visualizer',
		trackId: 'video-track',
		authoredState: {
			source: {
				schemaVersion: 1, kind: 'generator', id: 'visual-source', name: 'Sound visualizer',
				width: 320, height: 180, frameRate: { num: 25, den: 1 }, frameCount: 100,
				generator: {
					kind: 'sound-visualizer', mode, sourceIds, windowSeconds,
					backgroundColor: '#00000000', foregroundColor: '#ffffffff',
				},
			},
			clip: {
				schemaVersion: 1, kind: 'generator', id: 'visual-clip', sourceId: 'visual-source',
				sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 100,
				sourceInFrame: 0, sourceFrameCount: 100,
			},
		},
		opacity: 1, blendMode: 'normal', masks: [],
	};
}

function project(clips: readonly Record<string, unknown>[]): Record<string, unknown> {
	return {
		sampleRate,
		tempoMap: { mode: 'musical', events: [{
			id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 },
		}] },
		primarySequenceId: 'main',
		sequences: [{ id: 'main', trackIds: ['video-track', 'audio-track'] },
			{ id: 'other', trackIds: ['other-track'] }],
		tracks: [
			{ id: 'video-track', type: 'video', clipIds: ['visual-clip'] },
			{ id: 'audio-track', type: 'audio', clipIds: clips.map(({ id }) => id) },
			{ id: 'other-track', type: 'audio', clipIds: ['other-clip'] },
		],
		sources: ['audio-source', 'audio-source-b', 'other-source'].map((id) => ({
			kind: 'audio', id, storageKey: id,
			frameCount: samples.length, channelCount: 1, chunkFrames: 4, sampleRate,
		})),
		clips: [...clips, { kind: 'audio', id: 'other-clip', sourceId: 'other-source',
			timelineStartFrame: 0, durationFrames: 10, sourceStartFrame: 40,
			sourceDurationFrames: 10 }],
	};
}

function clip(id: string, timelineStartFrame: number, sourceStartFrame: number,
	extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		kind: 'audio', id, sourceId: 'audio-source', timelineStartFrame,
		durationFrames: 10, sourceStartFrame, sourceDurationFrames: 10, ...extra,
	};
}

test('spectrum reads bounded FFT spans and matches the full-window temporal average', async () => {
	const frameCount = 4_096;
	const chunkFrames = 64;
	const reads: number[] = [];
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: {
			...project([clip('long', 0, 0, {
				durationFrames: frameCount, sourceDurationFrames: frameCount,
			})]),
			sources: [{ kind: 'audio', id: 'audio-source', storageKey: 'audio-source',
				frameCount, channelCount: 1, chunkFrames, sampleRate }],
		},
		store: {
			readSourceChunk(_sourceId: string, index: number) {
				reads.push(index);
				return { index, frames: chunkFrames, channels: [Float32Array.from({ length: chunkFrames },
					(_, offset) => Math.sin((index * chunkFrames + offset) * 0.037))] };
			},
		},
	});
	const chosen = await reader.window(entry([], 2, 'spectrum'), 2_048, 7,
		new AbortController().signal);
	assert.equal(chosen.windowStartFrame, 1_048);
	assert.equal(chosen.sampleRate, sampleRate);
	assert.equal(chosen.channels![0]!.length, 2_048);
	assert.equal(reads.length, 32);
	const reference = Float32Array.from({ length: 2_000 },
		(_, index) => Math.sin((1_048 + index) * 0.037));
	const packed = new Float32Array(2_048);
	packed.set(reference.subarray(0, 1_024), 0);
	packed.set(reference.subarray(976), 1_024);
	assert.deepEqual(chosen.channels![0], packed);
	const picture = (channels: readonly Float32Array[], windowStartFrame: number) =>
		renderSoundVisualizerRgba({
			mode: 'spectrum', channels, sampleRate, windowStartFrame, timelineFrame: 7,
			width: 160, height: 90, foregroundColor: '#ffffffff', backgroundColor: '#00000000',
		}).pixels;
	assert.deepEqual(picture(chosen.channels!, chosen.windowStartFrame), picture([reference], 1_048));
	reader.dispose();
});

test('a tone near the long-window edge contributes to spectrum only when in view', async () => {
	const frameCount = 10_000;
	const chunkFrames = 1_000;
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: {
			...project([clip('long', 0, 0, {
				durationFrames: frameCount, sourceDurationFrames: frameCount,
			})]),
			sources: [{ kind: 'audio', id: 'audio-source', storageKey: 'audio-source',
				frameCount, channelCount: 1, chunkFrames, sampleRate }],
		},
		store: {
			readSourceChunk(_sourceId: string, index: number) {
				return { index, frames: chunkFrames, channels: [Float32Array.from({ length: chunkFrames },
					(_, offset) => index === 0 ? Math.sin(2 * Math.PI * 80 * offset / sampleRate) : 0)] };
			},
		},
	});
	const signal = new AbortController().signal;
	const long = await reader.window(entry([], 10, 'spectrum'), 5_000, 5, signal);
	const short = await reader.window(entry([], 1, 'spectrum'), 5_000, 5, signal);
	assert.equal(long.channels![0]!.length, 9 * 1_024);
	assert.equal(short.channels![0]!.length, 1_000);
	const picture = (window: typeof long) => renderSoundVisualizerRgba({
		mode: 'spectrum', ...window, width: 160, height: 90,
		foregroundColor: '#ffffffff', backgroundColor: '#00000000',
	}).pixels;
	const longPixels = picture(long);
	const shortPixels = picture(short);
	const atTone = (pixels: Uint8Array, y: number) =>
		[...pixels.subarray((y * 160 + 112) * 4, (y * 160 + 113) * 4)];
	assert.deepEqual([atTone(longPixels, 16), atTone(shortPixels, 16),
		atTone(longPixels, 89), atTone(shortPixels, 89)], [
		[255, 255, 255, 255], [0, 0, 0, 0], [0, 0, 0, 0], [255, 255, 255, 255],
	], 'the 80 Hz tone raises its spectrum bin only inside the long window');
	assert.deepEqual(longPixels, picture(await reader.window(entry([], 10, 'spectrum'),
		5_000, 5, signal)));
	reader.dispose();
});

test('a long spectrum window includes a brief tone at the playhead center', async () => {
	const frameCount = 10_000;
	const chunkFrames = 1_000;
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: {
			...project([clip('long', 0, 0, {
				durationFrames: frameCount, sourceDurationFrames: frameCount,
			})]),
			sources: [{ kind: 'audio', id: 'audio-source', storageKey: 'audio-source',
				frameCount, channelCount: 1, chunkFrames, sampleRate }],
		},
		store: {
			readSourceChunk(_sourceId: string, index: number) {
				return { index, frames: chunkFrames, channels: [Float32Array.from({ length: chunkFrames },
					(_, offset) => {
						const frame = index * chunkFrames + offset;
						return frame >= 4_900 && frame < 5_100
							? Math.cos(2 * Math.PI * 80 * (frame - 5_000) / sampleRate) : 0;
					})] };
			},
		},
	});
	const chosen = await reader.window(entry([], 10, 'spectrum'), 5_000, 5,
		new AbortController().signal);
	assert.equal(chosen.channels![0]!.length, 9 * 1_024);
	assert.equal(chosen.channels![0]![4 * 1_024 + 512], 1);
	assert.ok(chosen.channels![0]!.subarray(4 * 1_024, 5 * 1_024)
		.some((value) => value !== 0));
	reader.dispose();
});

test('long spectrum windows accept four-frame source chunks', async () => {
	const frameCount = 10_000;
	const chunkFrames = 4;
	const reads: number[] = [];
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: {
			...project([clip('long', 0, 0, {
				durationFrames: frameCount, sourceDurationFrames: frameCount,
			})]),
			sources: [{ kind: 'audio', id: 'audio-source', storageKey: 'audio-source',
				frameCount, channelCount: 1, chunkFrames, sampleRate }],
		},
		store: {
			readSourceChunk(_sourceId: string, index: number) {
				reads.push(index);
				return { index, frames: chunkFrames, channels: [Float32Array.from({ length: chunkFrames },
					(_, offset) => (index * chunkFrames + offset) / frameCount)] };
			},
		},
	});
	const chosen = await reader.window(entry([], 10, 'spectrum'), 5_000, 5,
		new AbortController().signal);
	assert.equal(chosen.channels![0]!.length, 9 * 1_024);
	assert.equal(chosen.channels![0]![0], 0);
	assert.ok(Math.abs(chosen.channels![0]![9 * 1_024 - 1]! - 0.9999) < 0.000_001);
	assert.ok(reads.length > 1_024 && reads.length <= 9_216);
	reader.dispose();
});

test('spectrum keeps evenly spaced source positions at a high-rate sampling stride', async () => {
	const highRate = 768_000;
	const frameCount = 5_000_000;
	const chunkFrames = 65_536;
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: {
			...project([clip('long', 0, 0, {
				durationFrames: frameCount, sourceDurationFrames: frameCount,
			})]),
			sampleRate: highRate,
			sources: [{ kind: 'audio', id: 'audio-source', storageKey: 'audio-source',
				frameCount, channelCount: 1, chunkFrames, sampleRate: highRate }],
		},
		store: {
			readSourceChunk(_sourceId: string, index: number) {
				const frames = Math.min(chunkFrames, frameCount - index * chunkFrames);
				return { index, frames, channels: [Float32Array.from({ length: frames },
					(_, offset) => ((index * chunkFrames + offset) % 1_000) / 1_000)] };
			},
		},
	});
	const chosen = await reader.window(entry([], 10, 'spectrum'), 2_500_000, 7,
		new AbortController().signal);
	assert.equal(chosen.sampleRate, 96_000);
	assert.equal(chosen.windowStartFrame, -1_340_000);
	assert.equal(chosen.channels![0]!.length, 9 * 1_024);
	assert.equal(chosen.channels![0]![0], 0);
	assert.ok(Math.abs(chosen.channels![0]![3 * 1_024]! - 0.928) < 0.000_001);
	assert.ok(Math.abs(chosen.channels![0]![3 * 1_024 + 1]! - 0.936) < 0.000_001);
	assert.ok(Math.abs(chosen.channels![0]![4 * 1_024 + 511]! - 0.992) < 0.000_001);
	assert.equal(chosen.channels![0]![4 * 1_024 + 512], 0);
	reader.dispose();
});
