/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFcpxmlExport } from '../src/common/editor/fcpxml-export.ts';
import { createAudioClip, createAudioSource, createAudioTrack, createVideoClip, createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { readWithReference } from './helpers/interchange-reference.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { framescaperProjectForRuntimeConsumers } from '../src/framescaper/editor-project-runtime.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createDefaultDissolveVideoTransitionV1 } from '../src/common/editor/video-transition-registry.ts';

for (const offset of [0, 24_000, 48_000]) test(`the reference reader preserves same-track audio at offset ${offset}`, () => {
	const project = fixture([[0, offset]]);
	const before = structuredClone(project);
	const result = createFcpxmlExport({ project: projectForRuntimeConsumers(project), sequenceRate: { num: 30, den: 1 } });
	const timeline = readWithReference(result.text, 'fcpx_xml', {}, '.fcpxml')[0]!;
	assert.equal(Math.max(...timeline.tracks.map(track => track.items.reduce((total, item) => total + item.durationValue / item.durationRate, 0))), 1 + offset / 48_000);
	assert.equal(timeline.tracks.flatMap(track => track.items).filter(item => item.schema === 'Clip').length, 2);
	assert.deepEqual(structuredClone(project), before);
});

test('reused overlap lanes retain later clips and do not collide with another authored track', () => {
	const project = fixture([[0, 0, 48_000], [0]]);
	const result = createFcpxmlExport({ project: projectForRuntimeConsumers(project), sequenceRate: { num: 30, den: 1 } });
	const timeline = readWithReference(result.text, 'fcpx_xml', {}, '.fcpxml')[0]!;
	const clips = timeline.tracks.flatMap(track => track.items).filter(item => item.schema === 'Clip');
	assert.deepEqual(clips.map(clip => clip.name).sort(), ['Take 0-0', 'Take 0-1', 'Take 0-2', 'Take 1-0']);
	assert.ok(clips.every(clip => clip.startValue / clip.startRate === 0 && clip.durationValue / clip.durationRate === 1));
	assert.equal(Math.max(...timeline.tracks.map(track => track.items.reduce((total, item) => total + item.durationValue / item.durationRate, 0))), 2);
	assert.equal(timeline.tracks.length, 3);
});

test('overlapping primary video clips use connected lanes without colliding with later video tracks', () => {
	const base = createFramescaperProject(PROFILE);
	const sequence = base.sequences[0]!;
	const source = createVideoSource({ id: 'camera', name: 'Camera.mp4', sampleFrameCount: 144_000,
		sourceFrameCount: 90, frameRate: { num: 30, den: 1 }, width: 320, height: 180, storageKey: 'media/camera.mp4' });
	const offsets = [[0, 15, 45], [0]];
	const clips = offsets.flatMap((starts, track) => starts.map((start, index) => createVideoClip({
		id: `video-${track}-${index}`, title: `Picture ${track}-${index}`, sourceId: source.id,
		sequenceId: sequence.id, sequenceStartFrame: start, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30,
	}, { projectSampleRate: base.sampleRate, sequence, source })));
	const tracks = offsets.map((starts, track) => createVideoTrack({ id: `video-track-${track}`,
		clipIds: starts.map((_, index) => `video-${track}-${index}`) }));
	const project = createFramescaperProject(PROFILE, { id: 'picture-programme', sampleRate: base.sampleRate,
		sequences: [{ id: sequence.id, name: sequence.name, rate: sequence.rate, trackIds: tracks.map(track => track.id) }],
		primarySequenceId: base.primarySequenceId, sources: [source], clips, tracks,
		videoTransitionsByTrackId: { 'video-track-0': [createDefaultDissolveVideoTransitionV1({
			id: 'dissolve', outgoingClipId: 'video-0-0', incomingClipId: 'video-0-1', durationFrames: 15,
		})] } });
	const result = createFcpxmlExport({ project: framescaperProjectForRuntimeConsumers(PROFILE, project), sequenceRate: sequence.rate });
	const timeline = readWithReference(result.text, 'fcpx_xml', {}, '.fcpxml')[0]!;
	assert.deepEqual(timeline.tracks.flatMap(track => track.items).filter(item => item.schema === 'Clip').map(clip => clip.name).sort(),
		['Picture 0-0', 'Picture 0-1', 'Picture 0-2', 'Picture 1-0']);
	assert.equal(Math.max(...timeline.tracks.map(track => track.items.reduce((total, item) => total + item.durationValue / item.durationRate, 0))), 2.5);
	assert.equal(timeline.tracks.length, 3);
});

function fixture(offsets: readonly (readonly number[])[]) {
	const source = createAudioSource({ id: 'recording', name: 'Recording.wav', sampleRate: 48_000,
		frameCount: 144_000, channelCount: 2, contentSha256: 'ab'.repeat(32), storageKey: 'media/recording.wav' });
	const clips = offsets.flatMap((starts, track) => starts.map((start, index) => createAudioClip({
		id: `take-${track}-${index}`, title: `Take ${track}-${index}`, sourceId: source.id,
		timelineStartFrame: start, durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000,
	})));
	const tracks = offsets.map((starts, track) => createAudioTrack({ id: `track-${track}`, name: `Track ${track}`,
		clipIds: starts.map((_, index) => `take-${track}-${index}`) }));
	return createSoundscaperProject({ id: 'programme', sources: [source], clips, tracks });
}
