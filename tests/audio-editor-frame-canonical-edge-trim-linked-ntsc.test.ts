/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { planFrameCanonicalEdgeTrim } from '../src/common/editor/frame-canonical-edge-trim-planner.ts';
import { projectV10ForCommand } from '../src/common/editor/project-v10-command-projection.ts';
import {
	createAudioClipV10,
	createAudioEditorProjectV10,
	createAudioSourceV10,
	createAudioTrackV10,
	createVideoClipV10,
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import { videoFrameToSampleFrame } from '../src/common/editor/timeline-time.ts';

const SAMPLE_RATE = 48_000;
const NTSC = Object.freeze({ num: 30_000, den: 1_001 });

test('each linked audio member follows its own NTSC video edge delta', () => {
	const project = fixture();
	const plan = planFrameCanonicalEdgeTrim(project, {
		activeClipId: 'video-a', edge: 'left', requestedBoundarySample: boundary(1),
	});
	assert.equal(plan.kind, 'transform');
	assert.equal(plan.sequenceFrameDelta, 1);
	assert.equal(plan.resolvedSampleDelta, 1_602);
	assert.deepEqual(plan.participantClipIds, ['video-a', 'audio-a', 'video-b', 'audio-b']);
	assert.deepEqual(plan.previews.map((preview) => ({
		id: preview.clipId,
		timelineStart: preview.timelineStartFrame,
		sourceStart: preview.sourceStartFrame,
	})), [
		{ id: 'video-a', timelineStart: boundary(1), sourceStart: 1 },
		{ id: 'audio-a', timelineStart: boundary(1), sourceStart: 11_602 },
		{ id: 'video-b', timelineStart: boundary(2), sourceStart: 21 },
		{ id: 'audio-b', timelineStart: boundary(2), sourceStart: 31_601 },
	]);
});

function fixture(): Record<string, unknown> {
	const videoSource = createVideoSourceV10({
		id: 'video-source', frameCount: 200_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: NTSC, sourceFrameCount: 100,
	}, SAMPLE_RATE);
	const audioSource = createAudioSourceV10({
		id: 'audio-source', frameCount: 200_000, sampleRate: SAMPLE_RATE, channelCount: 1,
	});
	const videoA = createVideoClipV10({
		id: 'video-a', sourceId: videoSource.id, sequenceId: 'main',
		sequenceStartFrame: 0, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10,
		groupId: 'video-group', avLinkId: 'link-a',
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate: NTSC }, source: videoSource });
	const videoB = createVideoClipV10({
		id: 'video-b', sourceId: videoSource.id, sequenceId: 'main',
		sequenceStartFrame: 1, sequenceFrameCount: 10,
		sourceInFrame: 20, sourceFrameCount: 10,
		groupId: 'video-group', avLinkId: 'link-b',
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate: NTSC }, source: videoSource });
	const audioA = createAudioClipV10({
		id: 'audio-a', sourceId: audioSource.id,
		timelineStartFrame: boundary(0), durationFrames: boundary(10) - boundary(0),
		sourceStartFrame: 10_000, sourceDurationFrames: boundary(10) - boundary(0),
		avLinkId: 'link-a',
	});
	const audioB = createAudioClipV10({
		id: 'audio-b', sourceId: audioSource.id,
		timelineStartFrame: boundary(1), durationFrames: boundary(11) - boundary(1),
		sourceStartFrame: 30_000, sourceDurationFrames: boundary(11) - boundary(1),
		avLinkId: 'link-b',
	});
	const tracks = [
		createVideoTrackV10({ id: 'video-track-a', clipIds: ['video-a'] }),
		createAudioTrackV10({ id: 'audio-track-a', clipIds: ['audio-a'] }, SAMPLE_RATE),
		createVideoTrackV10({ id: 'video-track-b', clipIds: ['video-b'] }),
		createAudioTrackV10({ id: 'audio-track-b', clipIds: ['audio-b'] }, SAMPLE_RATE),
	];
	const persisted = createAudioEditorProjectV10({
		id: 'linked-ntsc-trim', now: '2026-08-11T14:00:00.000Z', sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate: NTSC, trackIds: tracks.map(({ id }) => String(id)) }],
		primarySequenceId: 'main', sources: [videoSource, audioSource],
		clips: [videoA, audioA, videoB, audioB], tracks,
	});
	return projectV10ForCommand(persisted as unknown as Record<string, unknown>);
}

function boundary(frame: number): number {
	return videoFrameToSampleFrame(frame, NTSC, SAMPLE_RATE, 'point');
}
