/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioGeneratorService, type AudioGeneratorDocument } from '../src/common/editor/controller/edit/generator-service.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createFixture } from './helpers/audio-editor-generator-service-fixture.ts';

const now = '2026-10-07T00:00:00.000Z';

test('one generated source replaces every selected audio track in an atomic validated batch', async () => {
	const project = fixture();
	const original = structuredClone(project);
	const host = createFixture({ getProject: () => project as unknown as AudioGeneratorDocument });
	host.state.selectedTrackId = 'first';
	await createAudioGeneratorService(host.dependencies).generateSignal('tone', { amplitude: 0 });
	assert.equal(host.commits.length, 1);
	const command = host.commits[0]!.command;
	const applied = applySoundscaperProjectCommand(project, command, { now });
	const printed = ['first', 'second'].map(id => {
		const track = applied.tracks.find(track => track.id === id)!;
		const clipIds = track.clipIds;
		if (!Array.isArray(clipIds) || !clipIds.every((id: unknown): id is string => typeof id === 'string')) assert.fail('Expected audio clip IDs.');
		assert.equal(clipIds.length, 1);
		return applied.clips.find(clip => clip.id === clipIds[0])!;
	});
	assert.ok(printed.every(clip => clip.sourceId !== 'first-source' && clip.sourceId !== 'second-source'));
	assert.deepEqual(printed.map(clip => [clip.timelineStartFrame, clip.durationFrames]), [[0, 48_000], [0, 48_000]]);
	const bodies = printed.map(clip => applied.sources.find(source => source.id === clip.sourceId)!);
	assert.equal(bodies[0]?.storageKey, bodies[1]?.storageKey);
	assert.equal(new Set(bodies.map(source => source.id)).size, 2);
	assert.deepEqual(applied.tracks.find(track => track.id === 'unselected'), project.tracks[2]);
	assert.deepEqual(applied.clips.find(clip => clip.id === 'unselected-clip'), project.clips[2]);
	assert.deepEqual(project, original);
});

test('an explicit generator track request retains its single-track scope despite a wider selection', async () => {
	const project = fixture();
	const host = createFixture({ getProject: () => project as unknown as AudioGeneratorDocument });
	await createAudioGeneratorService(host.dependencies).generateSignal('tone', { amplitude: 0, trackId: 'first' });
	const applied = applySoundscaperProjectCommand(project, host.commits[0]!.command, { now });
	assert.notDeepEqual(applied.tracks[0]?.clipIds, project.tracks[0]?.clipIds);
	assert.deepEqual(applied.tracks[1], project.tracks[1]);
});

function fixture() {
	const ids = ['first', 'second', 'unselected'];
	return createSoundscaperProject({ id: 'project-a', title: 'Generated selection', now,
		tracks: ids.map(id => createAudioTrack({ id, name: id, clipIds: [`${id}-clip`] })),
		sources: ids.map(id => createAudioSource({ id: `${id}-source`, storageKey: `${id}-source`,
			name: id, mimeType: 'audio/wav', sampleRate: 48_000, originalSampleRate: 48_000,
			frameCount: 48_000, channelCount: 1, sampleFormat: 'float32', chunkFrames: 65_536 })),
		clips: ids.map(id => createAudioClip({ id: `${id}-clip`, sourceId: `${id}-source`, title: id,
			timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000 })),
		selection: { startFrame: 0, endFrame: 48_000, trackIds: ['first', 'second'], clipIds: [] },
		sequences: [{ id: 'main', trackIds: ids }], primarySequenceId: 'main',
	});
}
