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

test('a ripple delete before the take graph moves it with the material', () => {
	const project = takeProject();
	const rippled = applyEditorCommand(project, {
		type: 'range/ripple-delete', startFrame: 0, endFrame: 32, trackIds: ['vocals'],
		annotationRippleOperations: [],
	});

	const [group] = rippled.takeGroups;
	assert.deepEqual(
		{ startSample: group?.startSample, endSample: group?.endSample },
		{ startSample: 64, endSample: 72 },
	);
	assert.deepEqual(
		group?.takes.map(({ startSample, endSample, sourceStartSample }) => (
			{ startSample, endSample, sourceStartSample }
		)),
		[
			{ startSample: 64, endSample: 72, sourceStartSample: 0 },
			{ startSample: 64, endSample: 72, sourceStartSample: 0 },
		],
		'a take moves on the timeline without moving inside its source',
	);
	assert.deepEqual(
		group?.compRegions.map(({ startSample, endSample }) => ({ startSample, endSample })),
		[{ startSample: 64, endSample: 72 }],
	);
});

test('a ripple delete on another track leaves the take graph where it is', () => {
	const project = takeProject();
	const rippled = applyEditorCommand(project, {
		type: 'range/ripple-delete', startFrame: 0, endFrame: 32, trackIds: ['guitar'],
		annotationRippleOperations: [],
	});
	assert.equal(rippled.takeGroups[0]?.startSample, 96);
});

test('a lift delete leaves the take graph alone, because nothing moved', () => {
	const project = takeProject();
	const lifted = applyEditorCommand(project, {
		type: 'range/lift-delete', startFrame: 0, endFrame: 32, trackIds: ['vocals'],
	});
	assert.equal(lifted.takeGroups[0]?.startSample, 96);
});

test('a delete that runs through the take graph is refused, not silently trimmed', () => {
	const project = takeProject();
	// Trimming a group means splitting its takes and comp regions and minting the
	// identities for the halves, which the clipboard already refuses to do on the
	// way in. Leaving it in place instead desynchronized the comp from its audio.
	assert.throws(() => applyEditorCommand(project, {
		type: 'range/ripple-delete', startFrame: 64, endFrame: 100, trackIds: ['vocals'],
		annotationRippleOperations: [],
	}), /take graph|split identities/iu);
	assert.throws(() => applyEditorCommand(project, {
		type: 'range/lift-delete', startFrame: 100, endFrame: 200, trackIds: ['vocals'],
	}), /take graph|split identities/iu);
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
