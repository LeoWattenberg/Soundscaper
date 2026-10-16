/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createClipboardEditService, type ClipboardEditProject } from '../src/common/editor/controller/edit/internal/clipboard-edit-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';

for (const labeled of [false, true]) test(`detaching ${labeled ? 'labeled' : 'selected'} grouped silence removes only silent segments`, async () => {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const clips = ['paused', 'companion'].map(id => createAudioClip({ id, sourceId: id,
		title: id, groupId: 'authored-group', timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000 }));
	let project = createSoundscaperProject({ id: 'grouped-silence', sampleRate: 48_000,
		sources: clips.map(({ id }) => createAudioSource({ id, storageKey: id,
			sampleRate: 48_000, channelCount: 1, frameCount: 48_000 })), clips,
		tracks: clips.map(({ id }) => createAudioTrack({ id: `track-${id}`, name: id, clipIds: [id] })),
		selection: { startFrame: 0, endFrame: 0, trackIds: ['track-paused', 'track-companion'], clipIds: ['paused', 'companion'] } });
	const before = project;
	const paused = new Float32Array(48_000).fill(0.5);
	paused.fill(0, 12_000, 24_000);
	let nextId = 0;
	let commits = 0;
	const service = createClipboardEditService({ lifetime,
		state: { selectedTrackId: 'track-paused', selectedClipId: 'paused', clipboard: null },
		copy: { noSilencesFound: 'No silences', track: 'Track' },
		session: { setClipboard: descriptor => ({ clipboard: { descriptor, sources: [] } }), clipboardForProject: () => null },
		sourceBuffers: new Map([['paused', buffer(paused)], ['companion', buffer(new Float32Array(48_000).fill(0.4))]]),
		getProject: () => project as unknown as ClipboardEditProject, editingBlocked: () => false,
		getPositionFrames: () => 0, normalizeFrame: value => Number(value), snapFrame: value => Number(value),
		createId: prefix => `${prefix}-${++nextId}`, setStatus: () => undefined,
		commit: command => { project = applySoundscaperProjectCommand(project, command); commits += 1; },
	});
	if (labeled) await service.disjoinLabeledRegions([{ startFrame: 10_000, endFrame: 26_000 }], ['track-paused']);
	else await service.disjoinSelectedClip();
	assert.equal(commits, 1);
	assert.equal(project.clips.length, 3);
	assert.deepEqual(project.clips.find(({ id }) => id === 'companion'), before.clips[1]);
	const survivors = project.clips.filter(({ sourceId }) => sourceId === 'paused')
		.sort((left, right) => Number(left.timelineStartFrame) - Number(right.timelineStartFrame));
	assert.deepEqual(survivors.map(({ timelineStartFrame, durationFrames, sourceStartFrame, groupId }) =>
		({ timelineStartFrame, durationFrames, sourceStartFrame, groupId })), [
		{ timelineStartFrame: 0, durationFrames: 12_000, sourceStartFrame: 0, groupId: 'authored-group' },
		{ timelineStartFrame: 24_000, durationFrames: 24_000, sourceStartFrame: 24_000, groupId: 'authored-group' },
	]);
	assert.deepEqual(before.clips, clips);
});

function buffer(samples: Float32Array) {
	return { sampleRate: 48_000, numberOfChannels: 1, getChannelData: () => samples };
}
