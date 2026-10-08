/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSmoothSampleRange, persistImmutableSampleEdit } from '../src/common/editor/sample-edit.js';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import type { SampleEditClip, SampleEditStore } from '../src/common/editor/sample-edit-types.ts';

const source = createAudioSource({ id: 'cycle', name: 'cycle.wav', frameCount: 96, channelCount: 1, sampleRate: 48_000 });
const clip: SampleEditClip = { id: 'middle', sourceId: source.id, timelineStartFrame: 64,
	sourceStartFrame: 0, sourceDurationFrames: 96, durationFrames: 64,
	opaqueExtensions: { 'org.soundscaper.clip-loop/v1': { periodFrames: 96, offsetFrames: 64 } } };

for (const reversed of [false, true]) test(`wrapped loop smoothing maps both audible intervals: reversed=${String(reversed)}`, () => {
	assert.deepEqual(createSmoothSampleRange({ clip: { ...clip, reversed }, source, startFrame: 64, endFrame: 128 }), {
		startFrame: 0, endFrame: 96, channel: null,
		segments: [{ startFrame: 0, endFrame: 32 }, { startFrame: 64, endFrame: 96 }],
	});
});

test('stretched wrapped smoothing retains the authored source phase', () => {
	const stretched = { ...clip, durationFrames: 128,
		opaqueExtensions: { 'org.soundscaper.clip-loop/v1': { periodFrames: 192, offsetFrames: 128 } } };
	assert.deepEqual(createSmoothSampleRange({ clip: stretched, source, startFrame: 64, endFrame: 192 }), {
		startFrame: 0, endFrame: 96, channel: null,
		segments: [{ startFrame: 0, endFrame: 32 }, { startFrame: 64, endFrame: 96 }],
	});
});

test('reversed wrapped smoothing preserves an asymmetric source window', () => {
	const longerSource = createAudioSource({ id: 'trimmed-cycle', frameCount: 192, channelCount: 1, sampleRate: 48_000 });
	const trimmed = { ...clip, sourceId: longerSource.id, sourceStartFrame: 24, reversed: true, durationFrames: 40,
		opaqueExtensions: { 'org.soundscaper.clip-loop/v1': { periodFrames: 96, offsetFrames: 70 } } };
	assert.deepEqual(createSmoothSampleRange({ clip: trimmed, source: longerSource, startFrame: 64, endFrame: 104 }), {
		startFrame: 24, endFrame: 120, channel: null,
		segments: [{ startFrame: 24, endFrame: 50 }, { startFrame: 106, endFrame: 120 }],
	});
});

test('smoothing multiple full repeats edits each source sample once', () => {
	const repeated = { ...clip, durationFrames: 288 };
	assert.deepEqual(createSmoothSampleRange({ clip: repeated, source, startFrame: 64, endFrame: 352 }), {
		startFrame: 0, endFrame: 96, channel: null,
	});
});

test('persisted wrapped smoothing leaves the unselected middle phase byte-identical', async () => {
	const input = Float32Array.from({ length: source.frameCount }, (_, frame) => Math.sin(frame / 4) * 0.5);
	let output: Float32Array | null = null;
	const store: SampleEditStore = {
		async *readSourceChunks() { yield { index: 0, frames: input.length, channels: [input] }; },
		beginSourceWrite() { return {
			write(channels) { output = channels[0]!.slice(); },
			commit() { return {}; }, abort() {},
		}; },
		deleteSource() {},
	};
	await persistImmutableSampleEdit({ store, source, sourceId: 'smoothed',
		smooth: createSmoothSampleRange({ clip, source, startFrame: 64, endFrame: 128 }) });
	const written = output as Float32Array | null;
	assert.ok(written);
	assert.equal(written[40], input[40]);
	assert.notEqual(written[10], input[10]);
	assert.notEqual(written[80], input[80]);
});
