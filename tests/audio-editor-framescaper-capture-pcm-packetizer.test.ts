/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCapturePcmPacketizer,
} from '../src/common/editor/controller/framescaper-capture-pcm-packetizer.ts';

test('PCM packetizer preserves actual format, interleaves samples, and retains the shared active-time grid', () => {
	let now = 10;
	const packetizer = createFramescaperCapturePcmPacketizer({
		sessionId: 'session-1', streamId: 'microphone-1', role: 'microphone',
		sampleRate: 48_000, channelCount: 2, receiptTime: () => now++,
	});
	const first = packetizer.packet({
		frameStart: 4_800, frames: 3,
		channels: [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])],
	});
	const second = packetizer.packet({
		frameStart: 4_803, frames: 2,
		channels: [new Float32Array([7, 8]), new Float32Array([9, 10])],
	});
	assert.deepEqual({
		sequence: first.sequence, presentationTimeUs: first.presentationTimeUs,
		durationUs: first.durationUs, frameCount: first.frameCount,
		sampleRate: first.sampleRate, channelCount: first.channelCount,
		receiptTimeMs: first.receiptTimeMs, samples: [...first.samples],
		droppedBefore: first.droppedBefore,
	}, {
		sequence: 0, presentationTimeUs: 100_000, durationUs: 63, frameCount: 3,
		sampleRate: 48_000, channelCount: 2, receiptTimeMs: 10,
		samples: [1, 4, 2, 5, 3, 6], droppedBefore: { value: 0, confidence: 'exact' },
	});
	assert.equal(second.sequence, 1);
	assert.equal(second.presentationTimeUs, 100_063);
	assert.equal(second.durationUs, 42);
	assert.deepEqual([...second.samples], [7, 9, 8, 10]);
	assert.equal(packetizer.frameCount, 5);
});

test('PCM packetizer reports unannounced source gaps and excludes declared pause gaps', () => {
	const packetizer = createFramescaperCapturePcmPacketizer({
		sessionId: 'session-1', streamId: 'system-1', role: 'system-audio',
		sampleRate: 1_000, channelCount: 1,
	});
	packetizer.packet({ frameStart: 100, frames: 2, channels: [new Float32Array(2)] });
	const dropped = packetizer.packet({ frameStart: 105, frames: 2, channels: [new Float32Array(2)] });
	assert.deepEqual(dropped.droppedBefore, { value: 3, confidence: 'exact' });
	assert.equal(dropped.presentationTimeUs, 105_000, 'unannounced holes remain on the active grid');
	packetizer.expectPauseGap();
	const resumed = packetizer.packet({ frameStart: 1_000, frames: 2, channels: [new Float32Array(2)] });
	assert.deepEqual(resumed.droppedBefore, { value: 0, confidence: 'exact' });
	assert.equal(resumed.presentationTimeUs, 107_000, 'declared pause input is removed from active time');
});

test('PCM packetizer rejects malformed, overlapping, and wrong-format chunks', () => {
	const packetizer = createFramescaperCapturePcmPacketizer({
		sessionId: 'session-1', streamId: 'microphone-1', role: 'microphone',
		sampleRate: 48_000, channelCount: 2,
	});
	assert.throws(() => packetizer.packet({
		frameStart: 0, frames: 2, channels: [new Float32Array(2)],
	}), /channel count/iu);
	packetizer.packet({
		frameStart: 10, frames: 2, channels: [new Float32Array(2), new Float32Array(2)],
	});
	assert.throws(() => packetizer.packet({
		frameStart: 11, frames: 2, channels: [new Float32Array(2), new Float32Array(2)],
	}), /overlap/iu);
});
