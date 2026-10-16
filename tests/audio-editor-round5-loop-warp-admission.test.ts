/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioWarpAuthoringService } from '../src/common/editor/controller/track-audio/internal/audio-warp/audio-warp-authoring-service.ts';
import { identityWarpMap } from '../src/common/editor/controller/track-audio/internal/audio-warp/audio-warp-composition.ts';

function fixture(offsetFrames = 0) {
	const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Recording',
		sampleRate: 48_000, frameCount: 38_400, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Recording',
		anchor: 'sample', timelineStartFrame: 0, durationFrames: 38_400,
		sourceStartFrame: 0, sourceDurationFrames: 38_400 });
	let project = createSoundscaperProject({ id: 'loop-warp', sampleRate: 48_000,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', name: 'Recording', clipIds: ['clip'] })] });
	project = applySoundscaperProjectCommand(project, { type: 'clip/update', clipId: 'clip',
		changes: { loop: { periodFrames: 38_400, durationFrames: 76_800, offsetFrames } } });
	let commits = 0;
	const service = createAudioWarpAuthoringService({
		lifetime: { assertActive: () => undefined }, getProject: () => project,
		editingBlocked: () => false,
		commit(command) {
			commits++;
			project = applySoundscaperProjectCommand(project, command);
			return project;
		},
	});
	return { service, project: () => project, commits: () => commits,
		removeLoop() {
			project = applySoundscaperProjectCommand(project, { type: 'clip/update', clipId: 'clip',
				changes: { loop: false } });
		} };
}

for (const offset of [0, 9600]) test(`warp authoring refuses a repeated recording at phase ${offset} before publication`, () => {
	const state = fixture(offset);
	const original = state.project();
	const preparation = state.service.prepareClipEdit('clip');
	assert.throws(() => state.service.setWarpMap(preparation, identityWarpMap(preparation)), /turn off clip looping/iu);
	assert.equal(state.project(), original);
	assert.equal(state.commits(), 0);
});

test('turning off looping recovers ordinary identity-map authoring', () => {
	const state = fixture();
	state.removeLoop();
	const preparation = state.service.prepareClipEdit('clip');
	state.service.setWarpMap(preparation, identityWarpMap(preparation));
	assert.equal(state.commits(), 1);
	assert.deepEqual(state.project().clips[0]?.warpMap, identityWarpMap(preparation));
});
