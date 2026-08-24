/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	appendRecordingPreview,
	createRecordingPreview,
	normalizeAudioDevicePreferences,
	normalizeLatencyOffset,
	normalizeTimedRecordingStart,
	recordingPreviewSnapshot,
	recordingStreamIsLive,
	scaleRecordingFrames,
	streamAudioChannelCount,
} from '../src/common/editor/controller/recording-model.ts';

test('recording preferences and timing inputs are normalized at the controller boundary', () => {
	assert.deepEqual(normalizeAudioDevicePreferences({
		inputDeviceId: '  microphone  ',
		inputChannelCount: 2,
		outputDeviceId: 'default',
	}), {
		inputDeviceId: 'microphone',
		inputChannelCount: 2,
		outputDeviceId: '',
	});
	assert.equal(normalizeLatencyOffset(-900), -500);
	assert.equal(normalizeLatencyOffset(900), 500);
	assert.equal(normalizeTimedRecordingStart('2026-01-02T03:04:05.000Z'), 1_767_323_045_000);
	assert.throws(() => normalizeTimedRecordingStart('not a date'), /valid timer recording start time/u);
	assert.equal(scaleRecordingFrames(48_000, 48_000, 96_000), 96_000);
	assert.equal(
		scaleRecordingFrames(Number.MAX_SAFE_INTEGER, 96_000, 32_000),
		3_002_399_751_580_330,
		'large frame changes of basis use exact integer arithmetic',
	);
});

test('recording stream inspection accounts for channels and display-video lifetime', () => {
	const stream = {
		getAudioTracks: () => [{ readyState: 'live', getSettings: () => ({ channelCount: 8 }) }],
		getVideoTracks: () => [{ readyState: 'live' }],
	};
	assert.equal(streamAudioChannelCount(stream), 8);
	assert.equal(recordingStreamIsLive(stream, 'display'), true);
	assert.equal(recordingStreamIsLive({ ...stream, getVideoTracks: () => [{ readyState: 'ended' }] }, 'display'), false);
	assert.equal(recordingStreamIsLive(stream, 'hardware'), true);
});

test('recording preview skips latency frames, snapshots partial buckets, and compacts deterministically', () => {
	const preview = createRecordingPreview({ trackId: 'track-1', startFrame: 120, channelCount: 1, framesToSkip: 2 });
	appendRecordingPreview(preview, [Float32Array.from([0.9, -0.9, 0.25, -0.5])]);
	assert.deepEqual(recordingPreviewSnapshot(preview), {
		trackId: 'track-1',
		startFrame: 120,
		durationFrames: 2,
		channels: [Float32Array.from([-0.5, 0.25])],
	});

	const manyFrames = new Float32Array(64 * 2_048);
	for (let index = 0; index < manyFrames.length; index += 1) manyFrames[index] = index % 2 ? 0.75 : -0.25;
	appendRecordingPreview(preview, [manyFrames]);
	assert.equal(preview.framesPerBucket, 128);
	assert.ok(preview.buckets[0].length <= 2_048);
});
