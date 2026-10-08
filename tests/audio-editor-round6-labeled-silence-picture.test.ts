/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack, createVideoClip, createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAudioGeneratorService, type AudioGeneratorDocument } from '../src/common/editor/controller/edit/generator-service.ts';
import { createFixture } from './helpers/audio-editor-generator-service-fixture.ts';

for (const ranges of [
	[{ startFrame: 0, endFrame: 48_000 }],
	[{ startFrame: 4_800, endFrame: 9_600 }],
	[{ startFrame: 4_801, endFrame: 9_601 }],
	[{ startFrame: 4_800, endFrame: 9_600 }, { startFrame: 19_200, endFrame: 24_000 }],
]) {
	test(`labeled audio replacement retains its picture for ${JSON.stringify(ranges)}`, async () => {
		const picture = createVideoSource({ id: 'camera', frameCount: 48_000, sampleRate: 48_000,
			width: 96, height: 54, frameRate: 30, hasAudio: true });
		const recording = createAudioSource({ id: 'recording', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 });
		const clips = [0, 64_000].flatMap(timelineStartFrame => [
			createVideoClip({ id: `picture-${timelineStartFrame}`, sourceId: picture.id, durationFrames: 48_000,
				timelineStartFrame, avLinkId: `camera-link-${timelineStartFrame}` }),
			createAudioClip({ id: `audio-${timelineStartFrame}`, sourceId: recording.id, durationFrames: 48_000,
				timelineStartFrame, avLinkId: `camera-link-${timelineStartFrame}` }),
		]);
		let project = createSoundscaperProject({ id: 'project-a', sampleRate: 48_000, sources: [picture, recording], clips,
			tracks: [createVideoTrack({ id: 'picture-track', laneGroupId: 'camera-lanes', clipIds: clips.filter(({ kind }) => kind === 'video').map(({ id }) => id) }),
				createAudioTrack({ id: 'audio-track', laneGroupId: 'camera-lanes', clipIds: clips.filter(({ kind }) => kind === 'audio').map(({ id }) => id) })] });
		const before = project;
		let commits = 0;
		const fixture = createFixture({ getProject: () => project as unknown as AudioGeneratorDocument,
			commit: command => { project = applySoundscaperProjectCommand(project, command); commits++; } });
		assert.equal(await createAudioGeneratorService(fixture.dependencies).generateLabeledSilence(ranges, ['audio-track']), true);
		assert.equal(commits, 1);
		assert.deepEqual(project.clips.find(({ id }) => id === 'picture-0'),
			{ ...before.clips.find(({ id }) => id === 'picture-0'), avLinkId: null });
		assert.deepEqual(project.clips.filter(({ kind }) => kind === 'video').map(({ id }) => id), ['picture-0', 'picture-64000']);
		for (const id of ['picture-64000', 'audio-64000']) {
			assert.deepEqual(project.clips.find(clip => clip.id === id), before.clips.find(clip => clip.id === id), 'unrelated pair stays linked');
		}
		const silenced = project.clips.filter(({ sourceId }) => fixture.sourceBuffers.has(String(sourceId)));
		assert.deepEqual(silenced.map(({ timelineStartFrame, durationFrames }) => [timelineStartFrame, durationFrames]),
			ranges.map(({ startFrame, endFrame }) => [startFrame, endFrame - startFrame]));
		assert.equal(project.clips.filter(({ kind, sourceId }) => kind === 'audio' && sourceId === recording.id).length,
			ranges.length === 1 && ranges[0]?.startFrame === 0 ? 1 : ranges.length + 2);
		assert.equal(before.clips[0]?.avLinkId, 'camera-link-0', 'preparation leaves the original recording unchanged');
	});
}
