/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	planFramescaperCapturePublication,
} from '../src/common/editor/controller/framescaper-capture-publication-plan.ts';
import { videoFrameRangeToSampleRange } from '../src/common/editor/timeline-time.ts';

const EXACT_RANGE = '0:1000000' as const;
const METRICS = Object.freeze({
	confidence: 'exact' as const,
	droppedUnits: 0,
	maximumAbsoluteDriftMicroseconds: 0,
	finalDriftMicroseconds: 0,
});

test('exact NTSC camera and microphone capture shares the video-snapped timeline link', () => {
	let id = 0;
	const plan = planFramescaperCapturePublication({
		sessionId: 'capture-session',
		manifestSha256: 'ab'.repeat(32),
		recoveryProvenance: 'live',
		destination: 'timeline',
		recordStartFrame: 1,
		projectSampleRate: 48_000,
		sequence: { id: 'main-sequence', rate: { num: 30_000, den: 1_001 } },
		trackInsertionIndex: 0,
		streams: [{
			streamId: 'camera-stream', role: 'camera',
			startOffsetFrames: 0, presentationEndOffsetFrames: 48_000,
			exactPresentationRange: EXACT_RANGE, timelineDurationFrames: 48_000,
			metrics: METRICS, terminationReason: null,
			source: {
				kind: 'video', id: 'camera-source', storageKey: 'camera-storage',
				name: 'Camera', mimeType: 'video/webm', sampleRate: 48_000,
				sampleFrameCount: 48_000, sourceFrameCount: 30, width: 1_920, height: 1_080,
				opaqueExtensions: {},
			},
		}, {
			streamId: 'microphone-stream', role: 'microphone',
			startOffsetFrames: 0, presentationEndOffsetFrames: 48_000,
			exactPresentationRange: EXACT_RANGE, timelineDurationFrames: 48_000,
			metrics: METRICS, terminationReason: null,
			source: {
				kind: 'audio', id: 'microphone-source', storageKey: 'microphone-storage',
				name: 'Microphone', mimeType: 'audio/wav', sampleFormat: 'float32',
				sampleRate: 48_000, frameCount: 48_000, channelCount: 1,
				opaqueExtensions: {},
			},
		}],
		createId: (prefix) => `${prefix}-${String(++id)}`,
	});

	const camera = plan.entries.find(({ role }) => role === 'camera');
	const microphone = plan.entries.find(({ role }) => role === 'microphone');
	assert.ok(camera?.avLinkId);
	assert.equal(microphone?.avLinkId, camera.avLinkId);
	assert.equal(microphone?.laneGroupId, camera.laneGroupId);

	const clips = plan.command.commands.filter(({ type }) => type === 'clip/add').map((command) => (
		(command as unknown as { readonly clip: Readonly<Record<string, unknown>> }).clip
	));
	const video = clips.find(({ kind }) => kind === 'video');
	const audio = clips.find(({ kind }) => kind === 'audio');
	assert.ok(video);
	assert.ok(audio);
	const videoRange = videoFrameRangeToSampleRange(
		Number(video.sequenceStartFrame), Number(video.sequenceFrameCount),
		{ num: 30_000, den: 1_001 }, 48_000,
	);
	assert.equal(audio.timelineStartFrame, videoRange.startFrame);
	assert.equal(audio.durationFrames, videoRange.durationFrames);
});
