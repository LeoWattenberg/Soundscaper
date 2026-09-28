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

function store(reads: string[]): Readonly<{
	readSourceChunk(sourceId: string, index: number, options?: { signal?: AbortSignal }): Promise<unknown>;
}> {
	return {
		readSourceChunk(sourceId, index, options) {
			assert.ok(['audio-source', 'audio-source-b', 'other-source'].includes(sourceId));
			assert.equal(options?.signal?.aborted, false);
			reads.push(`${sourceId}:${String(index)}`);
			const start = index * 4;
			return Promise.resolve({ index, frames: Math.min(4, samples.length - start),
				channels: [samples.slice(start, start + 4)] });
		},
	};
}

test('window follows the nearest same-sequence audio clip and advances with video time', async () => {
	const reads: string[] = [];
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: project([clip('early', 0, 0), clip('late', 20, 20)]), store: store(reads),
	});
	const signal = new AbortController().signal;
	const first = await reader.window(entry(), 24, 6, signal);
	assert.equal(first.sampleRate, sampleRate);
	assert.equal(first.timelineFrame, 6);
	assert.equal(first.windowStartFrame, 19);
	assert.deepEqual([...first.channels![0]!], [0, 20, 21, 22, 23, 24, 25, 26, 27, 28]);
	const next = await reader.window(entry(), 25, 7, signal);
	assert.equal(next.windowStartFrame, 20);
	assert.deepEqual([...next.channels![0]!], [20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
	assert.ok(reads.length > 0);
	reader.dispose();
});

test('the window moves from timeline zero through leading silence', async () => {
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: project([clip('first', 0, 0)]), store: store([]),
	});
	const signal = new AbortController().signal;
	const first = await reader.window(entry(), 0, 0, signal);
	const second = await reader.window(entry(), 1, 1, signal);
	assert.equal(first.windowStartFrame, -5);
	assert.equal(second.windowStartFrame, -4);
	assert.deepEqual([...first.channels![0]!], [0, 0, 0, 0, 0, 0, 1, 2, 3, 4]);
	assert.deepEqual([...second.channels![0]!], [0, 0, 0, 0, 0, 1, 2, 3, 4, 5]);
	reader.dispose();
});

test('fractional video timeline samples round to the nearest audio sample', async () => {
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: project([clip('first', 0, 0)]), store: store([]),
	});
	const signal = new AbortController().signal;
	const fractional = await reader.window(entry(), 1.6, 7, signal);
	const rounded = await reader.window(entry(), 2, 7, signal);
	assert.equal(fractional.windowStartFrame, -3);
	assert.equal(fractional.timelineFrame, 7);
	assert.deepEqual(fractional.channels, rounded.channels);
	await assert.rejects(reader.window(entry(), Number.POSITIVE_INFINITY, 7, signal), /timeline sample/iu);
	await assert.rejects(reader.window(entry(), -0.1, 7, signal), /timeline sample/iu);
	await assert.rejects(reader.window(entry(), Number.MAX_SAFE_INTEGER + 1, 7, signal), /timeline sample/iu);
	reader.dispose();
});

test('specific source IDs select among overlaps and ignore clips in other sequences', async () => {
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: project([clip('early', 0, 0), clip('late', 5, 20, {
			sourceId: 'audio-source-b',
		})]), store: store([]),
	});
	const signal = new AbortController().signal;
	const chosen = await reader.window(entry(['audio-source-b']), 8, 2, signal);
	assert.deepEqual([...chosen.channels![0]!], [0, 0, 20, 21, 22, 23, 24, 25, 26, 27]);
	await assert.rejects(reader.window(entry(['other-source']), 8, 2, signal), /audio clip|sequence|source/iu);
	reader.dispose();
});

test('source offsets, reverse, gain and fades affect PCM supplied to the picture', async () => {
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: project([clip('reversed', 0, 4, {
			reversed: true, gain: 2, fadeInFrames: 2, fadeOutFrames: 0,
		})]), store: store([]),
	});
	const window = await reader.window(entry(['audio-source']), 5, 1, new AbortController().signal);
	assert.deepEqual([...window.channels![0]!], [0, 12, 22, 20, 18, 16, 14, 12, 10, 8]);
	reader.dispose();
});

test('warped audio follows the shared clip source map at each timeline sample', async () => {
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: project([clip('warped', 0, 4, {
			anchor: 'sample', warpMap: {
				feature: 'audio-warp',
				points: [
					{ outer: 0, source: 4, mode: 'forward' },
					{ outer: 5, source: 6, mode: 'forward' },
					{ outer: 10, source: 14, mode: 'forward' },
				],
			},
		})]), store: store([]),
	});
	const window = await reader.window(entry(), 5, 1, new AbortController().signal);
	const expected = [4, 4.4, 4.8, 5.2, 5.6, 6, 7.6, 9.2, 10.8, 12.4];
	for (const [index, value] of expected.entries()) {
		assert.ok(Math.abs(window.channels![0]![index]! - value) < 0.000_001);
	}
	reader.dispose();
});

test('surround source channels all contribute to the visual signal', async () => {
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: {
			...project([clip('surround', 0, 0)]),
			sources: [{ kind: 'audio', id: 'audio-source', storageKey: 'audio-source',
				frameCount: 64, channelCount: 6, chunkFrames: 4, sampleRate }],
		},
		store: {
			readSourceChunk(_sourceId: string, index: number) {
				return { index, frames: 4, channels: Array.from({ length: 6 }, (_, channel) =>
					Float32Array.from({ length: 4 }, () => channel === 2 ? 1 : 0)) };
			},
		},
	});
	const window = await reader.window(entry(), 5, 1, new AbortController().signal);
	assert.equal(window.channels?.length, 1);
	assert.ok(window.channels![0]!.every((value) => Math.abs(value - 1 / 6) < 0.000_001));
	reader.dispose();
});

test('high-rate ten-second windows use bounded PCM at the effective sample rate', async () => {
	const highRate = 768_000;
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: {
			...project([clip('fast', 0, 0, { durationFrames: 32, sourceDurationFrames: 32 })]),
			sampleRate: highRate,
			sources: [{ kind: 'audio', id: 'audio-source', storageKey: 'audio-source',
				frameCount: 64, channelCount: 1, chunkFrames: 4, sampleRate: highRate }],
		},
		store: store([]),
	});
	const window = await reader.window(entry([], 10), 3_840_000, 125, new AbortController().signal);
	assert.equal(window.windowStartFrame, 0);
	assert.equal(window.sampleRate, 96_000);
	assert.equal(window.channels?.length, 2);
	assert.equal(window.channels![0]!.length, 960_001);
	assert.deepEqual([...window.channels![0]!.subarray(0, 4)], [0, 8, 16, 24]);
	assert.deepEqual([...window.channels![1]!.subarray(0, 4)], [7, 15, 23, 31]);
	assert.equal(renderSoundVisualizerRgba({
		mode: 'waveform', channels: window.channels, sampleRate: window.sampleRate,
		windowStartFrame: window.windowStartFrame, timelineFrame: window.timelineFrame,
		width: 16, height: 9, foregroundColor: '#ffffffff', backgroundColor: '#00000000',
	}).pixels.length, 16 * 9 * 4);
	reader.dispose();
});

test('high-rate waveform bins retain positive and negative off-grid transients', async () => {
	const highRate = 768_000;
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: {
			...project([clip('transient', 0, 0, {
				durationFrames: 32, sourceDurationFrames: 32,
			})]),
			sampleRate: highRate,
			sources: [{ kind: 'audio', id: 'audio-source', storageKey: 'audio-source',
				frameCount: 32, channelCount: 1, chunkFrames: 4, sampleRate: highRate }],
		},
		store: {
			readSourceChunk(_sourceId: string, index: number) {
				return { index, frames: 4, channels: [Float32Array.from({ length: 4 },
					(_, offset) => index * 4 + offset === 1 ? 1
						: index * 4 + offset === 2 ? -0.75 : 0)] };
			},
		},
	});
	const signal = new AbortController().signal;
	const first = await reader.window(entry([], 10), 3_840_000, 1, signal);
	const shifted = await reader.window(entry([], 10), 3_840_001, 2, signal);
	const nextBin = await reader.window(entry([], 10), 3_840_008, 3, signal);
	assert.equal(first.channels![0]![0], -0.75);
	assert.equal(first.channels![1]![0], 1);
	assert.equal(shifted.channels![0]![0], -0.75);
	assert.equal(shifted.channels![1]![0], 1);
	assert.equal(nextBin.channels![0]![0], 0);
	assert.equal(nextBin.channels![1]![0], 0);
	reader.dispose();
});

test('reused high-rate edge bin clears a transient after the view passes its clip', async () => {
	const highRate = 768_000;
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: {
			...project([clip('edge', 0, 0, { durationFrames: 1, sourceDurationFrames: 1 })]),
			sampleRate: highRate,
			sources: [{ kind: 'audio', id: 'audio-source', storageKey: 'audio-source',
				frameCount: 1, channelCount: 1, chunkFrames: 4, sampleRate: highRate }],
		},
		store: { readSourceChunk() { return { index: 0, frames: 1, channels: [Float32Array.of(1)] }; } },
	});
	const signal = new AbortController().signal;
	const first = await reader.window(entry([], 10), 3_840_000, 1, signal);
	const shifted = await reader.window(entry([], 10), 3_840_001, 2, signal);
	assert.equal(first.channels![1]![0], 1);
	assert.equal(shifted.channels![0]![0], 0);
	assert.equal(shifted.channels![1]![0], 0);
	reader.dispose();
});

test('sequential waveform windows reuse overlap and read only the exposed PCM', async () => {
	const reads: number[] = [];
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: {
			...project([clip('long', 0, 0, { durationFrames: 256, sourceDurationFrames: 256 })]),
			sources: [{ kind: 'audio', id: 'audio-source', storageKey: 'audio-source',
				frameCount: 256, channelCount: 1, chunkFrames: 4, sampleRate }],
		},
		store: {
			readSourceChunk(_sourceId: string, index: number) {
				reads.push(index);
				return { index, frames: 4, channels: [Float32Array.from({ length: 4 },
					(_, offset) => index * 4 + offset)] };
			},
		},
	});
	const signal = new AbortController().signal;
	const first = await reader.window(entry([], 0.16), 100, 1, signal);
	first.channels![0]![4] = -1;
	const firstReadCount = reads.length;
	const next = await reader.window(entry([], 0.16), 104, 2, signal);
	assert.equal(firstReadCount, 40);
	assert.deepEqual(reads.slice(firstReadCount), [45]);
	assert.deepEqual([...next.channels![0]!], Array.from({ length: 160 }, (_, index) => index + 24));
	assert.equal(first.channels![0]![0], 20);
	assert.notStrictEqual(first.channels![0], next.channels![0]);
	reader.dispose();
});

test('waveform overlap cache does not cross a changed nearest clip or a seek', async () => {
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: project([clip('early', 0, 0), clip('late', 10, 20)]), store: store([]),
	});
	const signal = new AbortController().signal;
	const early = await reader.window(entry(), 9, 1, signal);
	const late = await reader.window(entry(), 10, 2, signal);
	const back = await reader.window(entry(), 9, 3, signal);
	assert.deepEqual([...early.channels![0]!], [4, 5, 6, 7, 8, 9, 0, 0, 0, 0]);
	assert.deepEqual([...late.channels![0]!], [0, 0, 0, 0, 0, 20, 21, 22, 23, 24]);
	assert.deepEqual(back.channels, early.channels);
	reader.dispose();
});

test('reused waveform PCM matches a fresh read through reverse, gain and fades', async () => {
	const audioProject = project([clip('reversed', 0, 4, {
		durationFrames: 20, sourceDurationFrames: 20,
		reversed: true, gain: 2, fadeInFrames: 3, fadeOutFrames: 3,
	})]);
	const signal = new AbortController().signal;
	const reader = createFramescaperSoundVisualizerWindowReader({ project: audioProject, store: store([]) });
	const first = await reader.window(entry(), 10, 1, signal);
	const before = first.channels![0]!.slice();
	const reused = await reader.window(entry(), 11, 2, signal);
	const fresh = createFramescaperSoundVisualizerWindowReader({ project: audioProject, store: store([]) });
	const reference = await fresh.window(entry(), 11, 2, signal);
	assert.deepEqual(reused.channels, reference.channels);
	assert.deepEqual(first.channels![0], before);
	reader.dispose();
	fresh.dispose();
});

test('empty sequences return no PCM and aborted reads stop before storage', async () => {
	const reads: string[] = [];
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: project([]), store: store(reads),
	});
	const signal = new AbortController().signal;
	const empty = await reader.window(entry(), 12, 3, signal);
	assert.equal(empty.channels, null);
	const next = await reader.window(entry(), 12, 4, signal);
	const picture = (window: typeof empty) => renderSoundVisualizerRgba({
		mode: 'waveform', ...window, width: 8, height: 8,
		foregroundColor: '#ffffffff', backgroundColor: '#00000000',
	}).pixels;
	assert.notDeepEqual(picture(empty), picture(next));
	const aborted = new AbortController();
	aborted.abort(new Error('cancelled'));
	await assert.rejects(reader.window(entry(), 12, 3, aborted.signal), /cancelled/u);
	assert.deepEqual(reads, []);
	reader.dispose();
});

test('concurrent reads of one chunk do not double-count cached PCM bytes', async () => {
	const chunkFrames = 65_536;
	const reads: number[] = [];
	let release: () => void = () => { throw new Error('Concurrent PCM gate was not installed.'); };
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: {
			...project([clip('long', 0, 0, {
				durationFrames: chunkFrames * 4, sourceDurationFrames: chunkFrames * 4,
			})]),
			sources: [{ kind: 'audio', id: 'audio-source', storageKey: 'audio-source',
				frameCount: chunkFrames * 4, channelCount: 32, chunkFrames, sampleRate }],
		},
		store: {
			readSourceChunk(_sourceId: string, index: number) {
				reads.push(index);
				const chunk = () => {
					const channel = new Float32Array(chunkFrames).fill(index / 4);
					return { index, frames: chunkFrames,
						channels: Array.from({ length: 32 }, () => channel) };
				};
				return index === 0 && reads.filter((read) => read === 0).length <= 2
					? gate.then(chunk) : chunk();
			},
		},
	});
	const signal = new AbortController().signal;
	const visual = entry([], 0.01, 'spectrum');
	const first = reader.window(visual, 100, 1, signal);
	const concurrent = reader.window(visual, 100, 2, signal);
	assert.deepEqual(reads, [0, 0]);
	release();
	await Promise.all([first, concurrent]);
	for (let index = 1; index < 4; index += 1) {
		await reader.window(visual, index * chunkFrames + 100, index + 2, signal);
	}
	await reader.window(visual, 100, 6, signal);
	assert.equal(reads.filter((index) => index === 0).length, 2);
	reader.dispose();
});

test('a missing PCM store is reported only when an active visualizer needs audio', async () => {
	const reader = createFramescaperSoundVisualizerWindowReader({
		project: project([clip('first', 0, 0)]), store: {},
	});
	await assert.rejects(reader.window(entry(), 5, 1, new AbortController().signal),
		/PCM source reading is unavailable/u);
	reader.dispose();
});
