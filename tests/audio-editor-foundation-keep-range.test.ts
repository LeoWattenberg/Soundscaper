/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand, prepareKeepRangeCommand } from '../src/common/editor/commands.js';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	createCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

const NOW = '2026-08-09T12:00:00.000Z';
const SAMPLE_RATE = 44_100;
const RATE = Object.freeze({ num: 24_000, den: 1_001 });

test('keeping a linked video range conforms both media lanes to the video frame grid', () => {
	const project = linkedProject();
	const command = prepareKeepRangeCommand(
		projectForCommand(project as unknown as Record<string, unknown>),
		{ startFrame: 1_000, endFrame: 4_500, trackIds: ['video-track'] },
	);
	const edited = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });
	const resolved = resolveRuntimeProjectProjection(edited);
	assert.deepEqual(
		resolved.clips.map((clip) => [clip.id, clip.timelineStartFrame, clip.timelineEndFrame]),
		[['video', 1_839, 3_679], ['audio', 1_839, 3_679]],
	);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

function linkedProject() {
	const video = createVideoSource({
		id: 'keep-video-source', frameCount: SAMPLE_RATE, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: RATE, sourceFrameCount: 24,
	}, SAMPLE_RATE);
	const audio = createAudioSource({
		id: 'keep-audio-source', frameCount: SAMPLE_RATE, sampleRate: SAMPLE_RATE, channelCount: 1,
	});
	return createCurrentAudioEditorProject({
		id: 'keep-linked-range', now: NOW, sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate: RATE }], primarySequenceId: 'main', sources: [video, audio],
		clips: [
			createVideoClip({
				id: 'video', sourceId: video.id, sequenceId: 'main', sequenceStartFrame: 0,
				sequenceFrameCount: 3, sourceInFrame: 0, sourceFrameCount: 3, avLinkId: 'keep-link',
			}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate: RATE }, source: video }),
			createAudioClip({
				id: 'audio', sourceId: audio.id, timelineStartFrame: 0, durationFrames: 5_518,
				sourceStartFrame: 0, sourceDurationFrames: 5_518, avLinkId: 'keep-link',
			}),
		],
		tracks: [
			createVideoTrack({ id: 'video-track', laneGroupId: 'keep-lane', clipIds: ['video'] }),
			createAudioTrack({ id: 'audio-track', laneGroupId: 'keep-lane', clipIds: ['audio'] }, SAMPLE_RATE),
		],
	});
}
