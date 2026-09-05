/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { prepareThreePointEditCommand } from '../src/common/editor/commands/three-point-edit-runtime.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

/**
 * The two edit paths that moved a track's material without its take graph.
 *
 * A three-point insert opens the same span on every media lane of the sequence
 * and shifts everything from the insert point rightwards. It already stages the
 * timeline annotations that ride that shift, because that member of the class
 * was fixed earlier, and never touched `project.takeGroups` — so a graph on an
 * opened lane stayed anchored to samples its takes had moved off.
 *
 * `range/keep` deletes the material outside the kept range and leaves what
 * survives where it is. A take group outside that range lost the audio it was
 * recorded against and stayed behind on a track that no longer had it, and a
 * group the kept range's boundary ran through was left half-covered.
 */

const NOW = '2026-09-05T12:00:00.000Z';

test('a three-point insert carries the take graph with the lanes it opens', () => {
	const project = takeProject();
	const inserted = applyEditorCommand(project, insertCommand(project, 0, 32));

	const [group] = inserted.takeGroups;
	assert.deepEqual(
		{ startSample: group?.startSample, endSample: group?.endSample },
		{ startSample: 128, endSample: 136 },
	);
	assert.deepEqual(
		group?.takes.map(({ startSample, endSample, sourceStartSample }) => (
			{ startSample, endSample, sourceStartSample }
		)),
		[{ startSample: 128, endSample: 136, sourceStartSample: 0 }],
		'a take moves on the timeline without moving inside its source',
	);
	assert.deepEqual(
		group?.compRegions.map(({ startSample, endSample }) => ({ startSample, endSample })),
		[{ startSample: 128, endSample: 136 }],
	);
	assert.equal(
		inserted.clips.find(({ id }) => id === 'take-clip')?.timelineStartFrame,
		128,
		'the opened lane and its take graph answer to the same span',
	);
});

test('a three-point insert through the take graph is refused, not silently trimmed', () => {
	// Trimming a group means splitting its takes and comp regions and minting
	// the identities for the halves, which the range delete already refuses to
	// do rather than leaving the comp adrift from its audio.
	const project = takeProject();
	assert.throws(
		() => applyEditorCommand(project, insertCommand(project, 100, 132)),
		/split identities/iu,
	);
});

test('a three-point insert after the take graph leaves it where it is', () => {
	const project = takeProject();
	const inserted = applyEditorCommand(project, insertCommand(project, 200, 232));
	assert.equal(inserted.takeGroups[0]?.startSample, 96);
});

test('keeping a range drops a take graph whose material is gone', () => {
	const kept = applyEditorCommand(takeProject(), {
		type: 'range/keep', startFrame: 0, endFrame: 48, trackIds: ['vocals'],
	});
	assert.deepEqual(kept.takeGroups, [], 'the graph went with the material it annotated');
	assert.equal(kept.clips.some(({ id }) => id === 'take-clip'), false);
});

test('keeping a range that contains the take graph leaves it alone', () => {
	const kept = applyEditorCommand(takeProject(), {
		type: 'range/keep', startFrame: 90, endFrame: 200, trackIds: ['vocals'],
	});
	assert.deepEqual(
		kept.takeGroups.map(({ id, startSample, endSample }) => ({ id, startSample, endSample })),
		[{ id: 'group-a', startSample: 96, endSample: 104 }],
	);
});

test('keeping a range that runs through the take graph is refused', () => {
	assert.throws(() => applyEditorCommand(takeProject(), {
		type: 'range/keep', startFrame: 100, endFrame: 200, trackIds: ['vocals'],
	}), /split identities/iu);
});

test('keeping a range on another track leaves the take graph alone', () => {
	const kept = applyEditorCommand(takeProject(), {
		type: 'range/keep', startFrame: 0, endFrame: 8, trackIds: ['guitar'],
	});
	assert.equal(kept.takeGroups[0]?.startSample, 96);
});

function insertCommand(
	project: ReturnType<typeof takeProject>,
	startFrame: number,
	endFrame: number,
): AudioEditorCommand {
	return prepareThreePointEditCommand(project, {
		mode: 'insert',
		startFrame,
		endFrame,
		placements: [{
			trackId: 'guitar',
			clipId: 'inserted-clip',
			sourceId: 'lead-source',
			sourceIn: 0,
			sourceCount: endFrame - startFrame,
		}],
	}) as AudioEditorCommand;
}

function takeProject() {
	return createAudioEditorProjectV17({
		id: 'take-graph-insert-keep', title: 'Take graph insert and keep', now: NOW, sampleRate: 48_000,
		sources: [source('lead-source', 400), source('take-source-a', 8)],
		clips: [
			clip('lead-clip', 'lead-source', 0, 48),
			clip('take-clip', 'take-source-a', 96, 8),
			clip('guitar-clip', 'lead-source', 0, 48),
		],
		tracks: [
			createAudioTrack({ id: 'vocals', name: 'Vocals', clipIds: ['lead-clip', 'take-clip'] }),
			createAudioTrack({ id: 'guitar', name: 'Guitar', clipIds: ['guitar-clip'] }),
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

function clip(id: string, sourceId: string, timelineStartFrame: number, durationFrames: number) {
	return createAudioClip({
		id, sourceId, title: id,
		timelineStartFrame, sourceStartFrame: 0,
		sourceDurationFrames: durationFrames, durationFrames,
	});
}
