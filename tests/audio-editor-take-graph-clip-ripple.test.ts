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
 * A per-track clip ripple carries the take graph, or refuses.
 *
 * `clip/remove-many` with `rippleMode: 'track'` is what the editor commits for
 * a clip selection deleted or cut with a per-track ripple, and it closes the
 * gap on every later clip of the edited track. A take group states where on its
 * track a recording sits, so leaving the graph behind desynchronized every take
 * and comp region from the audio they were recorded against - silently, and for
 * the life of the document. The range ripple already carries the graph; this
 * pins the same rule for the clip path.
 */

const NOW = '2026-09-05T12:00:00.000Z';

test('a per-track clip ripple moves the take graph with the material', () => {
	const project = takeProject();
	const rippled = applyEditorCommand(project, {
		type: 'clip/remove-many', clipIds: ['clip-1'], rippleMode: 'track',
	});

	const [group] = rippled.takeGroups;
	assert.deepEqual(
		{ startSample: group?.startSample, endSample: group?.endSample },
		{ startSample: 48, endSample: 56 },
	);
	assert.deepEqual(
		group?.takes.map(({ startSample, endSample, sourceStartSample }) => (
			{ startSample, endSample, sourceStartSample }
		)),
		[{ startSample: 48, endSample: 56, sourceStartSample: 0 }],
		'a take moves on the timeline without moving inside its source',
	);
	assert.deepEqual(
		group?.compRegions.map(({ startSample, endSample }) => ({ startSample, endSample })),
		[{ startSample: 48, endSample: 56 }],
	);
	assert.equal(
		rippled.clips.find(({ id }) => id === 'clip-2')?.timelineStartFrame,
		152,
		'the graph and the clips move by the same delta',
	);
});

test('a clip removal that does not ripple leaves the take graph where it is', () => {
	for (const rippleMode of ['none', 'clip'] as const) {
		const removed = applyEditorCommand(takeProject(), {
			type: 'clip/remove-many', clipIds: ['clip-1'], rippleMode,
		});
		assert.equal(removed.takeGroups[0]?.startSample, 96, rippleMode);
		assert.equal(removed.clips.find(({ id }) => id === 'clip-2')?.timelineStartFrame, 200);
	}
});

test('a per-track clip ripple on another track leaves the take graph alone', () => {
	const rippled = applyEditorCommand(takeProject(), {
		type: 'clip/remove-many', clipIds: ['guitar-clip'], rippleMode: 'track',
	});
	assert.equal(rippled.takeGroups[0]?.startSample, 96);
});

test('a per-track clip ripple after the take graph leaves it alone', () => {
	const rippled = applyEditorCommand(takeProject(), {
		type: 'clip/remove-many', clipIds: ['clip-2'], rippleMode: 'track',
	});
	assert.equal(rippled.takeGroups[0]?.startSample, 96);
});

test('a per-track clip ripple through the take graph is refused, not silently trimmed', () => {
	// Trimming a group means splitting its takes and comp regions and minting
	// the identities for the halves, which the range ripple already refuses to
	// do rather than leaving the comp adrift from its audio.
	assert.throws(() => applyEditorCommand(takeProject(), {
		type: 'clip/remove-many', clipIds: ['clip-over-group'], rippleMode: 'track',
	}), /take graph|split identities/iu);
});

function takeProject() {
	return createAudioEditorProjectV17({
		id: 'take-graph-clip-ripple', title: 'Take graph clip ripple', now: NOW, sampleRate: 48_000,
		sources: [source('clip-source', 248), source('take-source-a', 8)],
		clips: [
			clip('clip-1', 0, 48),
			clip('clip-over-group', 90, 20),
			clip('clip-2', 200, 48),
			clip('guitar-clip', 0, 48),
		],
		tracks: [
			createAudioTrack({
				id: 'vocals', name: 'Vocals', clipIds: ['clip-1', 'clip-over-group', 'clip-2'],
			}),
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

function clip(id: string, timelineStartFrame: number, durationFrames: number) {
	return createAudioClip({
		id, sourceId: 'clip-source', title: id,
		timelineStartFrame, sourceStartFrame: 0,
		sourceDurationFrames: durationFrames, durationFrames,
	});
}
