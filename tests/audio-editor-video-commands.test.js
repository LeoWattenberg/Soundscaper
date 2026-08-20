/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyEditorCommand,
	prepareLinkedSplitCommand,
} from '../src/common/editor/commands.js';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';
import {
	createCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';

const NOW = '2026-07-18T12:00:00.000Z';
const RATE = Object.freeze({ num: 30, den: 1 });

function linkedProject() {
	const videoSource = createVideoSource({
		id: 'video-source', name: 'camera.mp4', storageKey: 'video-source',
		mimeType: 'video/mp4', sampleFrameCount: 96_000, sourceFrameCount: 60,
		frameRate: RATE, width: 1_920, height: 1_080, videoCodec: 'h264',
	});
	const audioSource = createAudioSource({
		id: 'audio-source', name: 'camera.wav', storageKey: 'audio-source',
		frameCount: 96_000, channelCount: 2, sampleRate: 48_000,
	});
	const videoClip = createVideoClip({
		id: 'video-clip', sourceId: videoSource.id, sequenceId: 'main',
		sequenceStartFrame: 0, sequenceFrameCount: 60,
		sourceInFrame: 0, sourceFrameCount: 60, avLinkId: 'camera-link',
	}, {
		projectSampleRate: 48_000,
		sequence: { id: 'main', rate: RATE },
		source: videoSource,
	});
	const audioClip = createAudioClip({
		id: 'audio-clip', sourceId: audioSource.id, timelineStartFrame: 0,
		durationFrames: 96_000, sourceDurationFrames: 96_000, avLinkId: 'camera-link',
	});
	return createCurrentAudioEditorProject({
		id: 'current-video-command-project', title: 'Current video commands', now: NOW,
		sources: [videoSource, audioSource],
		clips: [videoClip, audioClip],
		tracks: [
			createVideoTrack({ id: 'video-track', clipIds: [videoClip.id], laneGroupId: 'camera-lanes' }),
			createAudioTrack({ id: 'audio-track', clipIds: [audioClip.id], laneGroupId: 'camera-lanes' }),
		],
		sequences: [{ id: 'main', rate: RATE, trackIds: ['video-track', 'audio-track'] }],
		primarySequenceId: 'main',
	});
}

test('current video documents persist frame authority and resolve sample coordinates for consumers', () => {
	const project = linkedProject();
	const videoClip = project.clips.find(({ id }) => id === 'video-clip');
	assert.deepEqual(
		[videoClip.sequenceStartFrame, videoClip.sequenceFrameCount, videoClip.sourceInFrame, videoClip.sourceFrameCount],
		[0, 60, 0, 60],
	);
	assert.equal(Object.hasOwn(videoClip, 'timelineStartFrame'), false);
	const resolved = resolveRuntimeProjectProjection(project);
	assert.deepEqual(
		resolved.clips.map(({ id, timelineStartFrame, timelineEndFrame }) => [id, timelineStartFrame, timelineEndFrame]),
		[['video-clip', 0, 96_000], ['audio-clip', 0, 96_000]],
	);
	assert.equal(validateCurrentAudioEditorProject(project), true);
});

test('a linked split conforms once and commits aligned current A/V pairs', () => {
	const project = linkedProject();
	const runtime = projectForCommand(project);
	let nextId = 0;
	const command = prepareLinkedSplitCommand(runtime, 'video-clip', 48_000, (prefix) => (
		`${prefix}-${String(nextId++)}`
	));
	const edited = applyEditorCommand(project, command, { now: NOW });
	const resolved = resolveRuntimeProjectProjection(edited);
	const rangesByLink = new Map();
	for (const clip of resolved.clips) {
		const ranges = rangesByLink.get(clip.avLinkId) ?? [];
		ranges.push([clip.kind, clip.timelineStartFrame, clip.timelineEndFrame]);
		rangesByLink.set(clip.avLinkId, ranges);
	}
	assert.deepEqual([...rangesByLink.values()], [
		[['video', 0, 48_000], ['audio', 0, 48_000]],
		[['video', 48_000, 96_000], ['audio', 48_000, 96_000]],
	]);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
	assert.equal(project.clips.length, 2, 'the command does not mutate its input');
});

test('video commands reject retired V4 wire at the exact-current boundary', () => {
	assert.throws(
		() => applyEditorCommand({ schemaVersion: 4 }, {
			type: 'clip/remove', clipId: 'legacy-video-clip',
		}, { now: NOW }),
		/current audio editor project/iu,
	);
});
