/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleProjectClips } from '../src/common/editor/engine/clip-scheduler.ts';
import type { EngineChunkSource, EngineProject } from '../src/common/editor/engine/types.ts';
import { clipLoopUpdateFields } from '../src/common/editor/audio-clip-loop.ts';
import { applyMultibandCompressor } from '../src/common/editor/first-party-effects/multiband-compressor/dsp.ts';
import { MockAudioContext, MockAudioBuffer } from './helpers/mock-audio-context.js';

for (const sampleRate of [8_000, 96_000]) {
	test(`identical native PCM uses the same offline conversion before and after a ${String(sampleRate)} Hz source edit`, async () => {
		const original = Float32Array.from({ length: sampleRate }, (_, frame) => .4 * Math.sin(2 * Math.PI * sampleRate * .475 * frame / sampleRate));
		const edited = applyMultibandCompressor([original], sampleRate, { lowRatio: 1, midRatio: 1, highRatio: 1 })[0]!;
		assert.ok(original.every((value, frame) => Math.abs(value - edited[frame]!) < 1e-7), 'the ordinary neutral effect preserves native source PCM');
		const streamed = await scheduledPcm(original, sampleRate, false);
		const cached = await scheduledPcm(edited, sampleRate, true);
		assert.equal(cached.sampleRate, streamed.sampleRate, 'publishing a source buffer must preserve the existing offline output grid');
		assert.equal(cached.length, streamed.length);
		const reference = streamed.getChannelData(0);
		assert.ok(cached.getChannelData(0).every((value, frame) => Math.abs(value - reference[frame]!) < 1e-6));
	});
}

test('a same-rate source cache retains its exact native PCM without a conversion', async () => {
	const original = Float32Array.from({ length: 48_000 }, (_, frame) => Math.sin(frame * .2));
	const cached = await scheduledPcm(original, 48_000, true);
	assert.equal(cached.sampleRate, 48_000);
	assert.deepEqual(cached.getChannelData(0), original);
});

for (const reversed of [false, true]) {
	test(`cached native-rate conversion retains a cropped ${reversed ? 'reversed' : 'forward'} source window`, async () => {
		const input = Float32Array.from({ length: 96_000 }, (_, frame) => Math.sin(frame * .31));
		const changes = { sourceStartFrame: 400, sourceDurationFrames: 12_000, durationFrames: 6_000, reversed };
		const streamed = await scheduledPcm(input, 96_000, false, changes);
		const cached = await scheduledPcm(input, 96_000, true, changes);
		assert.deepEqual(cached.getChannelData(0), streamed.getChannelData(0));
		assert.equal(cached.length, 6_000);
	});
}

test('a cached native-rate loop preserves source phase across every repetition', async () => {
	const input = Float32Array.from({ length: 8_000 }, (_, frame) => Math.sin(frame * .23));
	const loop = clipLoopUpdateFields({ kind: 'audio', sourceId: 'source', sourceStartFrame: 0,
		sourceDurationFrames: 8_000, durationFrames: 48_000 }, { periodFrames: 48_000, offsetFrames: 12_000, durationFrames: 96_000 });
	const streamed = await scheduledPcm(input, 8_000, false, loop);
	const cached = await scheduledPcm(input, 8_000, true, loop);
	assert.deepEqual(cached.getChannelData(0), streamed.getChannelData(0));
});

async function scheduledPcm(samples: Float32Array, sampleRate: number, cached: boolean, clipChanges: Readonly<Record<string, unknown>> = {}): Promise<AudioBuffer> {
	const context = new MockAudioContext({ sampleRate: 48_000 });
	const buffer = new MockAudioBuffer(1, samples.length, sampleRate) as unknown as AudioBuffer;
	buffer.getChannelData(0).set(samples);
	const project: EngineProject = { sampleRate: 48_000,
		tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
		clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0,
			sourceDurationFrames: samples.length, durationFrames: 48_000, ...clipChanges }] };
	const provider: EngineChunkSource = { channelCount: 1, frameCount: samples.length,
		sampleRate, chunkFrames: 4_096,
		readStorageChunk: (chunkIndex) => [samples.subarray(chunkIndex * 4_096, (chunkIndex + 1) * 4_096)],
	};
	await scheduleProjectClips({ context: context as unknown as BaseAudioContext, project,
		sources: cached ? new Map([['source', buffer]]) : new Map(),
		chunkSources: cached ? new Map() : new Map([['source', provider]]),
		trackInputs: new Map([['track', context.createGain() as unknown as AudioNode]]),
		fromFrame: 0, toFrame: 48_000, sampleRate: 48_000, contextStartTime: 0,
		reversedBuffers: new WeakMap(), sourceResolver: null, activeSources: new Set(), allNodes: [], mode: 'offline' });
	const sources = context.bufferSources as unknown as readonly { buffer: AudioBuffer }[];
	if (sources.length === 1) return sources[0]!.buffer;
	const output = new MockAudioBuffer(1, sources.reduce((frames, source) => frames + source.buffer.length, 0), 48_000) as unknown as AudioBuffer;
	let offset = 0;
	for (const { buffer: segment } of sources) {
		output.getChannelData(0).set(segment.getChannelData(0), offset);
		offset += segment.length;
	}
	return output;
}
