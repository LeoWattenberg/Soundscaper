/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportProjectFcpxml } from '../src/common/editor/controller/export/interchange-export-action.ts';

for (const hours of [0, 1]) test(`FCPXML places ordinary clips in the sequence's ${hours}-hour parent clock`, async () => {
	const source = createAudioSource({ id: 'recording', name: 'Recording.wav', sampleRate: 48_000,
		frameCount: 48_000, channelCount: 2, contentSha256: 'ab'.repeat(32), storageKey: 'media/recording.wav' });
	const clip = createAudioClip({ id: 'take', title: 'Take', sourceId: source.id,
		timelineStartFrame: 48_000, durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000 });
	const track = createAudioTrack({ id: 'track', name: 'Dialogue', clipIds: [clip.id] });
	const project = createSoundscaperProject({ id: 'programme', sources: [source], clips: [clip], tracks: [track],
		sequences: [{ id: 'main-sequence', name: 'Programme', rate: { num: 25, den: 1 }, trackIds: [track.id],
			startTimecode: { hours, minutes: 0, seconds: 0, frames: 0, negative: false } }], primarySequenceId: 'main-sequence' });
	const before = structuredClone(project);
	const result = await exportProjectFcpxml({ getProject: () => project, state: {}, fileService: { saveFile: () => true } });
	assert.ok(result);
	assert.match(result.text, new RegExp(`tcStart="${hours * 3600}s"`, 'u'));
	assert.match(result.text, new RegExp(`offset="${hours * 3600 + 1}s"`, 'u'),
		'the parent clock includes tcStart; offset minus tcStart must remain one second');
	assert.match(result.text, /start="0s" duration="1s"/u, 'source trim and clip extent use their own clocks');
	assert.match(result.text, /<sequence[^>]*duration="2s"/u);
	assert.deepEqual(project, before);
});
