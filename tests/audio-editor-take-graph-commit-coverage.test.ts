/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';

/**
 * A take graph left behind by an edit fails the commit that left it.
 *
 * Every edit path that moves a track's material has to move that track's take
 * graph with it, and each path was taught that rule one at a time. Nothing
 * checked the result, so a path that had not been taught corrupted the document
 * silently: the graph stayed anchored to samples its takes no longer occupied,
 * the document was still perfectly valid, and undo faithfully restored the
 * corruption. The A/V link half of the same class throws at commit and is
 * therefore recoverable; this relates a take group to the material of its own
 * takes so the take graph is too.
 *
 * The relation only speaks where the group's takes are on its track at all. A
 * cycle-recorded graph lives in `project.takeGroups` with no clips behind it
 * until it is flattened, which is the state the take/comp workflow spends most
 * of its life in, so a group whose take sources appear on no clip of its track
 * stands alone and the relation says nothing about it.
 */

const NOW = '2026-09-05T12:00:00.000Z';

test('an edit that leaves the take graph behind is refused at commit', () => {
	// `clip/move` never learned about take graphs, so moving the take's own
	// material out from under the group used to commit a silently desynchronized
	// document rather than failing.
	assert.throws(() => applyEditorCommand(takeProject(), {
		type: 'clip/move', clipId: 'take-clip', timelineStartFrame: 200,
	}), /take group|take material/iu);
});

test('a ripple that carries the take graph with its material still validates', () => {
	const rippled = applyEditorCommand(takeProject(), {
		type: 'range/ripple-delete', startFrame: 0, endFrame: 32, trackIds: ['vocals'],
		annotationRippleOperations: [],
	});

	const [group] = rippled.takeGroups;
	assert.deepEqual(
		{ startSample: group?.startSample, endSample: group?.endSample },
		{ startSample: 64, endSample: 72 },
	);
	assert.equal(
		rippled.clips.find(({ id }) => id === 'take-clip')?.timelineStartFrame,
		64,
		'the material and the graph answer to the same delta',
	);
});

test('a recorded take graph with no material of its own stands alone', () => {
	const recorded = takeProject({ clipIds: ['lead-clip'] });
	assert.equal(recorded.takeGroups[0]?.startSample, 96);
	assert.equal(
		recorded.clips.find(({ id }) => id === 'take-clip')?.timelineStartFrame,
		96,
		"the take material is off the group's own track, so the relation is silent",
	);
});

test('material that covers only part of a take group is refused', () => {
	assert.throws(() => takeProject({ takeClipDurationFrames: 4 }), /take group|take material/iu);
});

interface TakeProjectOverrides {
	readonly clipIds?: readonly string[];
	readonly takeClipDurationFrames?: number;
}

function takeProject(overrides: TakeProjectOverrides = {}) {
	const clipIds = overrides.clipIds ?? ['lead-clip', 'take-clip'];
	const takeClipDurationFrames = overrides.takeClipDurationFrames ?? 8;
	return createAudioEditorProjectV17({
		id: 'take-graph-coverage', title: 'Take graph coverage', now: NOW, sampleRate: 48_000,
		sources: [source('lead-source', 248), source('take-source-a', 8)],
		clips: [
			createAudioClip({
				id: 'lead-clip', sourceId: 'lead-source', title: 'lead-clip',
				timelineStartFrame: 0, sourceStartFrame: 0,
				sourceDurationFrames: 48, durationFrames: 48,
			}),
			createAudioClip({
				id: 'take-clip', sourceId: 'take-source-a', title: 'take-clip',
				timelineStartFrame: 96, sourceStartFrame: 0,
				sourceDurationFrames: takeClipDurationFrames,
				durationFrames: takeClipDurationFrames,
			}),
		],
		tracks: [
			createAudioTrack({ id: 'vocals', name: 'Vocals', clipIds: [...clipIds] }),
			createAudioTrack({
				id: 'guitar',
				name: 'Guitar',
				clipIds: clipIds.includes('take-clip') ? [] : ['take-clip'],
			}),
		],
		sequences: [{ id: 'main-sequence', trackIds: ['vocals', 'guitar'] }],
		primarySequenceId: 'main-sequence',
		takeGroups: [{
			id: 'group-a',
			sequenceId: 'main-sequence',
			trackId: 'vocals',
			startSample: 96,
			endSample: 104,
			laneOrder: ['lane-a'],
			lanes: [{ id: 'lane-a' }],
			takes: [{
				id: 'take-a', laneId: 'lane-a', sourceId: 'take-source-a',
				startSample: 96, endSample: 104, sourceStartSample: 0,
			}],
			compRegions: [{ id: 'comp-a', takeId: 'take-a', startSample: 96, endSample: 104 }],
		}],
	});
}

function source(id: string, frameCount: number) {
	return createAudioSource({
		id, name: id, storageKey: id, mimeType: 'audio/wav',
		frameCount, channelCount: 2, sampleRate: 48_000, chunkFrames: 65_536,
	});
}
