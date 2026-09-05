/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	preparePunchCommand,
	prepareRangeReplacementCommand,
} from '../src/common/editor/commands/range-runtime.js';
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

/**
 * Replacing part of an imported video's audio drops the A/V link instead of
 * failing the commit.
 *
 * `range/replace` and `punch/replace` cut one track's material. Both left the
 * survivors carrying the original `avLinkId` while the replacement carried
 * none, so the link ended up with three members — or one, when the range took
 * the whole clip — and the foundation validator refused the whole command with
 * `A/V link ... must contain one audio and one video clip.` Every Audacity-style
 * effect on a time selection over imported video audio was impossible, and a
 * punch-in recording on that track destroyed the take it had just captured.
 *
 * The pair stops being a pair the moment the audio is replaced by other
 * material, so both partners are unlinked. Cutting the video into three to keep
 * two thirds of it linked would edit a lane the user never touched.
 */

const NOW = '2026-09-05T12:00:00.000Z';
const SAMPLE_RATE = 44_100;
const RATE = Object.freeze({ num: 24_000, den: 1_001 });
/** The sample span of one video frame boundary at this rate. */
const FRAME_1 = 1_839;
const FRAME_2 = 3_679;
const FRAME_3 = 5_518;

test('replacing an interior range of linked audio keeps the project valid', () => {
	const project = linkedProject();
	const edited = replaceRange(project, FRAME_1, FRAME_2, FRAME_2 - FRAME_1);

	assert.equal(validateCurrentAudioEditorProject(edited), true);
	assert.deepEqual(
		edited.clips.filter((clip) => clip.avLinkId).map(({ id }) => id),
		[],
		'the replaced audio is no longer the video\'s audio',
	);
	assert.deepEqual(
		trackSpans(edited, 'audio-track'),
		[[0, FRAME_1], [FRAME_1, FRAME_2], [FRAME_2, FRAME_3]],
	);
	assert.deepEqual(
		trackSpans(edited, 'video-track'),
		[[0, FRAME_3]],
		'the video lane is untouched',
	);
});

test('replacing the whole linked audio clip keeps the project valid', () => {
	const project = linkedProject();
	const edited = replaceRange(project, 0, FRAME_3, FRAME_3);

	assert.equal(validateCurrentAudioEditorProject(edited), true);
	assert.deepEqual(edited.clips.filter((clip) => clip.avLinkId).map(({ id }) => id), []);
	assert.deepEqual(trackSpans(edited, 'audio-track'), [[0, FRAME_3]]);
});

test('a shorter replacement unlinks the linked material it ripples past', () => {
	const project = linkedProject(true);
	const edited = replaceRange(project, FRAME_1, FRAME_2, 920);

	assert.equal(validateCurrentAudioEditorProject(edited), true);
	assert.deepEqual(edited.clips.filter((clip) => clip.avLinkId).map(({ id }) => id), []);
	assert.deepEqual(
		edited.clips.find(({ id }) => id === 'audio-2')?.timelineStartFrame,
		FRAME_3 - 920,
		'the later linked audio ripples while its video partner stays put',
	);
});

test('a range replacement on an unlinked track leaves the A/V links alone', () => {
	const project = linkedProject();
	const command = prepareRangeReplacementCommand(
		projectForCommand(project as unknown as Record<string, unknown>),
		{ trackId: 'extra-track', startFrame: 0, endFrame: 1_000, source: replacementSource(1_000) },
	);
	const edited = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });

	assert.equal(validateCurrentAudioEditorProject(edited), true);
	assert.deepEqual(
		edited.clips.filter((clip) => clip.avLinkId).map(({ id }) => id),
		['video', 'audio'],
	);
});

test('punching into linked audio keeps the recorded take and the project valid', () => {
	const project = linkedProject();
	const edited = punch(project, FRAME_1, FRAME_2);

	assert.equal(validateCurrentAudioEditorProject(edited), true);
	assert.deepEqual(edited.clips.filter((clip) => clip.avLinkId).map(({ id }) => id), []);
	assert.deepEqual(
		trackSpans(edited, 'audio-track'),
		[[0, FRAME_1], [FRAME_1, FRAME_2], [FRAME_2, FRAME_3]],
	);
	assert.ok(edited.clips.some(({ id }) => id === 'take'), 'the captured take survives');
});

test('punching a range off the video frame grid still lands', () => {
	const project = linkedProject();
	const edited = punch(project, 1_000, 2_000);

	assert.equal(validateCurrentAudioEditorProject(edited), true);
	assert.deepEqual(
		trackSpans(edited, 'audio-track'),
		[[0, 1_000], [1_000, 2_000], [2_000, FRAME_3]],
	);
});

function replaceRange(
	project: ReturnType<typeof linkedProject>,
	startFrame: number,
	endFrame: number,
	frameCount: number,
) {
	const command = prepareRangeReplacementCommand(
		projectForCommand(project as unknown as Record<string, unknown>),
		{ trackId: 'audio-track', startFrame, endFrame, source: replacementSource(frameCount) },
	);
	return applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });
}

function punch(project: ReturnType<typeof linkedProject>, startFrame: number, endFrame: number) {
	const command = preparePunchCommand(
		projectForCommand(project as unknown as Record<string, unknown>),
		{
			trackId: 'audio-track',
			startFrame,
			endFrame,
			sourceId: 'take-source',
			sourceStartFrame: 0,
			sourceDurationFrames: endFrame - startFrame,
			clipId: 'take',
		},
	);
	return applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });
}

function trackSpans(projectValue: unknown, trackId: string) {
	const project = projectValue as Record<string, unknown>;
	const resolved = resolveRuntimeProjectProjection(project);
	const track = (project.tracks as readonly Record<string, unknown>[]).find(({ id }) => id === trackId);
	return (track?.clipIds as readonly string[]).map((clipId) => {
		const clip = resolved.clips.find(({ id }) => id === clipId)!;
		return [clip.timelineStartFrame, clip.timelineEndFrame];
	});
}

function replacementSource(frameCount: number) {
	return {
		id: 'replacement-source',
		storageKey: 'replacement-source',
		name: 'replacement.wav',
		mimeType: 'audio/wav',
		frameCount,
		channelCount: 1,
		sampleRate: SAMPLE_RATE,
		originalSampleRate: SAMPLE_RATE,
	};
}

function linkedProject(secondPair = false) {
	const video = createVideoSource({
		id: 'linked-video-source', frameCount: SAMPLE_RATE, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: RATE, sourceFrameCount: 24,
	}, SAMPLE_RATE);
	const audio = createAudioSource({
		id: 'linked-audio-source', frameCount: SAMPLE_RATE, sampleRate: SAMPLE_RATE, channelCount: 1,
	});
	const take = createAudioSource({
		id: 'take-source', frameCount: SAMPLE_RATE, sampleRate: SAMPLE_RATE, channelCount: 1,
	});
	const sequence = { id: 'main', rate: RATE } as const;
	const context = { projectSampleRate: SAMPLE_RATE, sequence, source: video };
	return createCurrentAudioEditorProject({
		id: 'linked-replace', now: NOW, sampleRate: SAMPLE_RATE,
		sequences: [sequence], primarySequenceId: 'main', sources: [video, audio, take],
		clips: [
			createVideoClip({
				id: 'video', sourceId: video.id, sequenceId: 'main', sequenceStartFrame: 0,
				sequenceFrameCount: 3, sourceInFrame: 0, sourceFrameCount: 3, avLinkId: 'link',
			}, context),
			createAudioClip({
				id: 'audio', sourceId: audio.id, timelineStartFrame: 0, durationFrames: FRAME_3,
				sourceStartFrame: 0, sourceDurationFrames: FRAME_3, avLinkId: 'link',
			}),
			...(secondPair ? [
				createVideoClip({
					id: 'video-2', sourceId: video.id, sequenceId: 'main', sequenceStartFrame: 3,
					sequenceFrameCount: 3, sourceInFrame: 3, sourceFrameCount: 3, avLinkId: 'link-2',
				}, context),
				createAudioClip({
					id: 'audio-2', sourceId: audio.id, timelineStartFrame: FRAME_3, durationFrames: FRAME_3,
					sourceStartFrame: 0, sourceDurationFrames: FRAME_3, avLinkId: 'link-2',
				}),
			] : []),
			createAudioClip({
				id: 'extra', sourceId: audio.id, timelineStartFrame: 0, durationFrames: 2_000,
				sourceStartFrame: 0, sourceDurationFrames: 2_000,
			}),
		],
		tracks: [
			createVideoTrack({
				id: 'video-track', laneGroupId: 'lane',
				clipIds: secondPair ? ['video', 'video-2'] : ['video'],
			}),
			createAudioTrack({
				id: 'audio-track', laneGroupId: 'lane',
				clipIds: secondPair ? ['audio', 'audio-2'] : ['audio'],
			}, SAMPLE_RATE),
			createAudioTrack({ id: 'extra-track', clipIds: ['extra'] }, SAMPLE_RATE),
		],
	});
}
