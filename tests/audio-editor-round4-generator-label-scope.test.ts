/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioGeneratorService, type AudioGeneratorDocument } from '../src/common/editor/controller/edit/generator-service.ts';
import { createAudioClip, createAudioSource, createAudioTrack, createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createFixture } from './helpers/audio-editor-generator-service-fixture.ts';

const now = '2026-10-07T00:00:00.000Z';

for (const selectAudio of [false, true]) {
	test(`generation from a focused label track ${selectAudio ? 'honors selected audio' : 'preserves unselected audio'}`, async () => {
		const project = createSoundscaperProject({ id: 'project-a', title: 'Label selection', now,
			tracks: [createAudioTrack({ id: 'recording', clipIds: ['take'] }),
				createLabelTrack({ id: 'labels', labels: [{ id: 'intro', title: 'Intro', startFrame: 0, endFrame: 19_200 }] })],
			sources: [createAudioSource({ id: 'recording-source', storageKey: 'recording-source', sampleRate: 48_000,
				frameCount: 38_400, channelCount: 1, sampleFormat: 'float32', chunkFrames: 65_536 })],
			clips: [createAudioClip({ id: 'take', sourceId: 'recording-source', title: 'Recording',
				timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 38_400, durationFrames: 38_400 })],
			selection: { startFrame: 0, endFrame: 19_200, trackIds: selectAudio ? ['recording', 'labels'] : ['labels'], clipIds: [] },
			sequences: [{ id: 'main', trackIds: ['recording', 'labels'] }], primarySequenceId: 'main',
		});
		const original = structuredClone(project);
		const host = createFixture({ getProject: () => project as unknown as AudioGeneratorDocument });
		host.state.selectedTrackId = 'labels';
		await createAudioGeneratorService(host.dependencies).generateSignal('tone', { durationSeconds: 0.4 });
		assert.equal(host.commits.length, 1);
		const applied = applySoundscaperProjectCommand(project, host.commits[0]!.command, { now });
		assert.deepEqual(applied.tracks.find(track => track.id === 'labels'), project.tracks[1]);
		if (selectAudio) {
			assert.equal(applied.tracks.length, 2);
			assert.notDeepEqual(applied.tracks[0]?.clipIds, project.tracks[0]?.clipIds);
		} else {
			assert.deepEqual(applied.tracks[0], project.tracks[0]);
			assert.deepEqual(applied.clips.find(clip => clip.id === 'take'), project.clips[0]);
			assert.equal(applied.tracks.length, 3);
			assert.notEqual(host.commits[0]?.selection?.selectTrackId, 'recording');
		}
		assert.deepEqual(project, original);
	});
}
