/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipboardDescriptor } from '../src/common/editor/commands/clipboard-runtime.js';
import { createLabeledAudioClipboardDescriptor } from '../src/common/editor/labeled-audio-clipboard.ts';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';
import { createAudioClip, createAudioSource, createAudioTrack, createVideoClip, createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

function cameraProject() {
	const picture = createVideoSource({ id: 'camera', frameCount: 48_000, sampleRate: 48_000,
		width: 96, height: 54, frameRate: 30, hasAudio: true });
	const recording = createAudioSource({ id: 'recording', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 });
	const video = createVideoClip({ id: 'picture', sourceId: picture.id, durationFrames: 48_000, avLinkId: 'camera-link' });
	const audio = createAudioClip({ id: 'audio', sourceId: recording.id, durationFrames: 48_000, avLinkId: 'camera-link' });
	return projectForCommand(createSoundscaperProject({ id: 'camera-project', sources: [picture, recording], clips: [video, audio],
		tracks: [createVideoTrack({ id: 'picture-track', laneGroupId: 'camera-lanes', clipIds: [video.id] }),
			createAudioTrack({ id: 'audio-track', laneGroupId: 'camera-lanes', clipIds: [audio.id] })] }));
}

test('two labeled excerpts carry two independent aligned A/V links', () => {
	const project = cameraProject();
	const original = structuredClone(project);
	const descriptor = createLabeledAudioClipboardDescriptor(project,
		[{ startFrame: 4_800, endFrame: 9_600 }, { startFrame: 19_200, endFrame: 24_000 }],
		['picture-track', 'audio-track'], createClipboardDescriptor);
	assert.ok(descriptor);
	assert.equal(descriptor.durationFrames, 19_200);
	const pictures = descriptor.tracks[0]!.clips;
	const recordings = descriptor.tracks[1]!.clips;
	assert.equal(pictures.length, 2);
	assert.equal(recordings.length, 2);
	assert.notEqual(pictures[0]!.avLinkId, pictures[1]!.avLinkId);
	for (let index = 0; index < 2; index += 1) {
		assert.equal(pictures[index]!.avLinkId, recordings[index]!.avLinkId);
		assert.equal(pictures[index]!.durationFrames, 4_800);
		assert.equal(recordings[index]!.offsetFrame, index * 14_400);
		assert.equal(pictures[index]!.offsetFrame, recordings[index]!.offsetFrame);
	}
	assert.deepEqual(project, original, 'copy must not change the original linked recording');
});
