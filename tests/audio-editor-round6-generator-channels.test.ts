/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { audioTrackChannelCount } from '../src/common/editor/project-audio-factory.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAudioGeneratorService, type AudioGeneratorDocument } from '../src/common/editor/controller/edit/generator-service.ts';
import { createFixture } from './helpers/audio-editor-generator-service-fixture.ts';

for (const { widths, streamed, requestedWidth } of [
	{ widths: [1, 2], streamed: false }, { widths: [2, 1], streamed: false }, { widths: [2, 2, 6], streamed: false },
	{ widths: [1, 2], streamed: true }, { widths: [1, 2], streamed: false, requestedWidth: 2 },
]) {
	test(`signal generation retains channel intent ${widths.join(',')}, stream=${streamed}, explicit=${requestedWidth}`, async () => {
		let project = createSoundscaperProject({ id: 'project-a', sampleRate: 48_000,
			sources: widths.map((channelCount, index) => createAudioSource({ id: `source-${index}`, storageKey: `source-${index}`,
				sampleRate: 48_000, channelCount, frameCount: 100 })),
			clips: widths.map((_channelCount, index) => createAudioClip({ id: `clip-${index}`, sourceId: `source-${index}`,
				sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100, timelineStartFrame: 0 })),
			tracks: widths.map((_channelCount, index) => createAudioTrack({ id: `track-${index}`, clipIds: [`clip-${index}`] })) });
		project = applySoundscaperProjectCommand(project, { type: 'selection/set', startFrame: 0, endFrame: 100,
			trackIds: project.tracks.map(({ id }) => id), clipIds: [] });
		const before = project;
		let commits = 0;
		let ids = 0;
		let closedStreams = 0;
		const fixture = createFixture({ getProject: () => project as unknown as AudioGeneratorDocument,
			trackChannelCount: audioTrackChannelCount,
			createId: prefix => `generated-${prefix}-${++ids}`,
			...(streamed ? {
				generateStream: async (_type, options) => {
					const channelCount = Number(options.channelCount);
					return { type: 'silence', sampleRate: 48_000, frameCount: 100, channelCount,
						async *chunks() { yield Array.from({ length: channelCount }, () => new Float32Array(100)); },
						finish: async () => ({ version: 1, channelCount, levels: [] }),
						close() { closedStreams++; } };
				},
				createEmptyBuffer: async (channelCount, length, sampleRate) => {
					const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
					return { length, sampleRate, numberOfChannels: channelCount, getChannelData: channel => channels[channel]! };
				},
			} : {}),
			commit: command => { project = applySoundscaperProjectCommand(project, command); commits++; } });
		fixture.state.selectedTrackId = 'track-0';
		await createAudioGeneratorService(fixture.dependencies).generateSignal('silence', { channelCount: requestedWidth });
		assert.equal(commits, 1);
		assert.deepEqual(project.tracks.map(track => audioTrackChannelCount(project, track)),
			requestedWidth ? widths.map(() => requestedWidth) : widths);
		assert.equal(closedStreams, streamed ? new Set(widths).size : 0);
		assert.equal(project.clips.length, widths.length);
		for (const clip of project.clips) {
			const source = project.sources.find(({ id }) => id === clip.sourceId);
			const audio = fixture.sourceBuffers.get(String(source?.storageKey));
			assert.ok(audio);
			assert.equal(audio.numberOfChannels, source?.channelCount);
			for (let channel = 0; channel < audio.numberOfChannels; channel++) {
				assert.equal(audio.getChannelData(channel).every(value => value === 0), true);
			}
		}
		assert.deepEqual(before.sources.map(({ channelCount }) => channelCount), widths);
	});
}

test('a later generator width failure rolls every unpublished source back without history', async () => {
	const project = createSoundscaperProject({ id: 'project-a', sampleRate: 48_000,
		sources: [1, 2].map(channelCount => createAudioSource({ id: `source-${channelCount}`, storageKey: `source-${channelCount}`,
			sampleRate: 48_000, channelCount, frameCount: 100 })),
		clips: [1, 2].map(channelCount => createAudioClip({ id: `clip-${channelCount}`, sourceId: `source-${channelCount}`,
			sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100, timelineStartFrame: 0 })),
		tracks: [1, 2].map(channelCount => createAudioTrack({ id: `track-${channelCount}`, clipIds: [`clip-${channelCount}`] })),
		selection: { startFrame: 0, endFrame: 100, trackIds: ['track-1', 'track-2'], clipIds: [] } });
	let ids = 0;
	const fixture = createFixture({ getProject: () => project as unknown as AudioGeneratorDocument,
		trackChannelCount: audioTrackChannelCount,
		createId: prefix => `generated-${prefix}-${++ids}` });
	fixture.state.selectedTrackId = 'track-1';
	let writes = 0;
	fixture.dependencies.store.beginSourceWrite = async () => {
		if (++writes === 2) throw new Error('storage unavailable');
		return fixture.writer;
	};
	await assert.rejects(createAudioGeneratorService(fixture.dependencies).generateSignal('silence'), /storage unavailable/u);
	assert.equal(fixture.commits.length, 0);
	assert.equal(fixture.sourceBuffers.size, 0);
	assert.equal(fixture.sourcePeaks.size, 0);
	assert.equal(fixture.deletedSources.length, 2);
	assert.equal(fixture.state.audacityEffectProcessing, false);
});
