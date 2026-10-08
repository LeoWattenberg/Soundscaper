/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { audioTrackChannelCount } from '../src/common/editor/project-audio-factory.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAudioGeneratorService, type AudioGeneratorDocument } from '../src/common/editor/controller/edit/generator-service.ts';
import { createFixture } from './helpers/audio-editor-generator-service-fixture.ts';

for (const widths of [[1, 2], [2, 1], [0, 1, 2], [2, 2, 6]]) {
	test(`labeled silence retains canonical source widths ${widths.join(',')}`, async () => {
		const originals = widths.flatMap((channelCount, index) => channelCount ? [{ index, channelCount }] : []);
		let project = createSoundscaperProject({ id: 'project-a', sampleRate: 48_000,
			sources: originals.map(({ index, channelCount }) => createAudioSource({ id: `source-${index}`, storageKey: `source-${index}`,
				sampleRate: 48_000, channelCount, frameCount: 100 })),
			clips: originals.map(({ index }) => createAudioClip({ id: `clip-${index}`, sourceId: `source-${index}`,
				sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100, timelineStartFrame: 0 })),
			tracks: widths.map((channelCount, index) => createAudioTrack({ id: `track-${index}`,
				clipIds: channelCount ? [`clip-${index}`] : [] })) });
		const before = project;
		let commits = 0;
		const fixture = createFixture({ getProject: () => project as unknown as AudioGeneratorDocument,
			trackChannelCount: audioTrackChannelCount,
			commit: command => { project = applySoundscaperProjectCommand(project, command); commits++; } });
		await createAudioGeneratorService(fixture.dependencies).generateLabeledSilence(
			[{ startFrame: 0, endFrame: 100 }], project.tracks.map(({ id }) => id));
		assert.equal(commits, 1);
		assert.deepEqual(project.tracks.map(track => audioTrackChannelCount(project, track)), widths);
		assert.equal(project.clips.length, originals.length, 'empty lanes receive no material');
		for (const clip of project.clips) {
			const source = project.sources.find(({ id }) => id === clip.sourceId);
			const audio = fixture.sourceBuffers.get(String(source?.id));
			assert.ok(audio);
			assert.equal(audio.numberOfChannels, source?.channelCount);
			for (let channel = 0; channel < audio.numberOfChannels; channel++) {
				assert.equal(audio.getChannelData(channel).every(value => value === 0), true);
			}
		}
		assert.equal(new Set(project.clips.map(({ sourceId }) => sourceId)).size,
			new Set(originals.map(({ channelCount }) => channelCount)).size, 'equal widths share their zero PCM');
		assert.deepEqual(before.sources.map(({ channelCount }) => channelCount), originals.map(({ channelCount }) => channelCount));
	});
}

test('a later silence source failure rolls every earlier prepared width back before history publication', async () => {
	const project = createSoundscaperProject({ id: 'project-a', sampleRate: 48_000,
		sources: [1, 2].map(channelCount => createAudioSource({ id: `source-${channelCount}`, storageKey: `source-${channelCount}`,
			sampleRate: 48_000, channelCount, frameCount: 100 })),
		clips: [1, 2].map(channelCount => createAudioClip({ id: `clip-${channelCount}`, sourceId: `source-${channelCount}`,
			sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100, timelineStartFrame: 0 })),
		tracks: [1, 2].map(channelCount => createAudioTrack({ id: `track-${channelCount}`, clipIds: [`clip-${channelCount}`] })) });
	const fixture = createFixture({ getProject: () => project as unknown as AudioGeneratorDocument,
		trackChannelCount: audioTrackChannelCount });
	let writes = 0;
	fixture.dependencies.store.beginSourceWrite = async () => {
		if (++writes === 2) throw new Error('storage unavailable');
		return fixture.writer;
	};
	await assert.rejects(createAudioGeneratorService(fixture.dependencies).generateLabeledSilence(
		[{ startFrame: 0, endFrame: 100 }], ['track-1', 'track-2']), /storage unavailable/u);
	assert.equal(fixture.commits.length, 0);
	assert.equal(fixture.sourceBuffers.size, 0);
	assert.equal(fixture.sourcePeaks.size, 0);
	assert.equal(fixture.deletedSources.length, 2);
	assert.equal(fixture.state.audacityEffectProcessing, false);
});
