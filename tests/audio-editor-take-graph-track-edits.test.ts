/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createAudioSourceV10, createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';

/**
 * Editing a track carries its take graph, or refuses.
 *
 * A take group is owned by one track at one place on the timeline, and the
 * document validator enforces that on every commit: a group whose track is gone
 * fails the whole command, and two groups that overlap on one track fail it too.
 * The ordinary track and range commands were written before comping existed and
 * never learned about `takeGroups`, so a cycle-recorded track could not be
 * deleted at all — the failure surfaced as an internal ReferenceError naming the
 * missing track — and a ripple that moved the track's material left its take
 * graph anchored to the samples it no longer occupies.
 */

const NOW = '2026-08-19T12:00:00.000Z';

test('removing a track removes the take graph it owned', () => {
	const project = takeProject();
	const removed = applyEditorCommand(project, { type: 'track/remove', trackId: 'vocals' });

	assert.deepEqual(removed.tracks.map(({ id }) => id), ['guitar']);
	assert.deepEqual(removed.takeGroups, [], 'the graph belonged to the track that is gone');
});

test('removing a different track leaves the take graph alone', () => {
	const project = takeProject();
	const removed = applyEditorCommand(project, { type: 'track/remove', trackId: 'guitar' });

	assert.deepEqual(removed.tracks.map(({ id }) => id), ['vocals']);
	assert.deepEqual(
		removed.takeGroups.map(({ id, startSample }) => ({ id, startSample })),
		[{ id: 'group-a', startSample: 96 }],
	);
});

function takeProject() {
	return createAudioEditorProjectV17({
		id: 'take-graph-edits', title: 'Take graph edits', now: NOW, sampleRate: 48_000,
		sources: [
			source('take-source-a'),
			source('take-source-b'),
		],
		tracks: [
			createAudioTrackV10({ id: 'vocals', name: 'Vocals', clipIds: [] }),
			createAudioTrackV10({ id: 'guitar', name: 'Guitar', clipIds: [] }),
		],
		sequences: [{ id: 'main-sequence', trackIds: ['vocals', 'guitar'] }],
		primarySequenceId: 'main-sequence',
		takeGroups: [{
			id: 'group-a',
			sequenceId: 'main-sequence',
			trackId: 'vocals',
			startSample: 96,
			endSample: 104,
			laneOrder: ['lane-a', 'lane-b'],
			lanes: [{ id: 'lane-a' }, { id: 'lane-b' }],
			takes: [
				take('take-a', 'lane-a', 'take-source-a'),
				take('take-b', 'lane-b', 'take-source-b'),
			],
			compRegions: [{ id: 'comp-a', takeId: 'take-a', startSample: 96, endSample: 104 }],
		}],
	});
}

function source(id: string) {
	return createAudioSourceV10({
		id, name: id, storageKey: id, mimeType: 'audio/wav',
		frameCount: 8, channelCount: 2, sampleRate: 48_000, chunkFrames: 65_536,
	});
}

function take(id: string, laneId: string, sourceId: string) {
	return { id, laneId, sourceId, startSample: 96, endSample: 104, sourceStartSample: 0 };
}
