/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperCaptureMetrics } from '../src/common/editor/controller/framescaper-capture-metrics.ts';
import type { CapturePcmAudioPacket } from '../src/common/editor/framescaper-capture-domain.ts';

test('capture metrics distinguish unavailable evidence from measured zero', () => {
	const metrics = createFramescaperCaptureMetrics([
		{ streamId: 'camera-stream', role: 'camera' },
		{ streamId: 'microphone-stream', role: 'microphone' },
	]);
	assert.deepEqual(metrics.snapshot[0]?.droppedRatio, {
		value: null, confidence: 'unavailable',
	});
	assert.deepEqual(metrics.snapshot[0]?.currentDriftUs, {
		value: null, confidence: 'unavailable',
	});
	assert.deepEqual(metrics.snapshot[1]?.droppedUnits, {
		value: 0, confidence: 'exact',
	});
});

test('capture metrics aggregate exact PCM drops and shared-clock drift', () => {
	const metrics = createFramescaperCaptureMetrics([
		{ streamId: 'microphone-stream', role: 'microphone' },
	]);
	metrics.observe(pcmPacket({ sequence: 0, presentationTimeUs: 0, dropped: 0 }), 9_800);
	metrics.observe(pcmPacket({ sequence: 1, presentationTimeUs: 10_000, dropped: 2 }), 20_500);

	assert.deepEqual(metrics.snapshot, [{
		streamId: 'microphone-stream',
		role: 'microphone',
		packetCount: 2,
		capturedDurationUs: 20_000,
		droppedUnits: { value: 2, confidence: 'exact' },
		droppedRatio: { value: 2 / 962, confidence: 'exact' },
		currentDriftUs: { value: -500, confidence: 'exact' },
		maximumAbsoluteDriftUs: { value: 500, confidence: 'exact' },
	}]);
});

test('capture metrics reject foreign, duplicated, and non-contiguous packet evidence', () => {
	const metrics = createFramescaperCaptureMetrics([
		{ streamId: 'microphone-stream', role: 'microphone' },
	]);
	assert.throws(
		() => metrics.observe(pcmPacket({ streamId: 'foreign', sequence: 0 }), 0),
		/unknown stream/iu,
	);
	assert.throws(
		() => metrics.observe(pcmPacket({ sequence: 1 }), 0),
		/contiguous/iu,
	);
	metrics.observe(pcmPacket({ sequence: 0 }), 10_000);
	assert.throws(
		() => metrics.observe(pcmPacket({ sequence: 0 }), 10_000),
		/contiguous/iu,
	);
});

function pcmPacket(overrides: Readonly<{
	streamId?: string;
	sequence?: number;
	presentationTimeUs?: number;
	dropped?: number;
}> = {}): CapturePcmAudioPacket {
	return {
		kind: 'pcm-audio',
		sessionId: 'capture-session',
		streamId: overrides.streamId ?? 'microphone-stream',
		role: 'microphone',
		sequence: overrides.sequence ?? 0,
		presentationTimeUs: overrides.presentationTimeUs ?? 0,
		durationUs: 10_000,
		receiptTimeMs: 0,
		droppedBefore: { value: overrides.dropped ?? 0, confidence: 'exact' },
		frameCount: 480,
		sampleRate: 48_000,
		channelCount: 1,
		samples: new Float32Array(480),
	};
}
