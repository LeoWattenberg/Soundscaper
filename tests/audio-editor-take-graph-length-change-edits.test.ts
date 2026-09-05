/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { prepareRangeReplacementCommand } from '../src/common/editor/commands/range-runtime.js';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

/**
 * A length-changing replacement carries the track's take graph with it.
 *
 * `range/replace` and `clip/render-replace-many` are how every length-changing
 * Audacity effect lands — Change Tempo, Paulstretch, Truncate Silence, Repeat —
 * and both ripple the material after the edit. Only the range deletes knew about
 * `takeGroups`, so a cycle-recorded group on the edited track stayed anchored to
 * samples its own material had moved away from, silently and permanently: the
 * document still validated, so undo and reload could not recover the alignment.
 */

const NOW = '2026-09-05T12:00:00.000Z';
const SAMPLE_RATE = 48_000;

test('a shorter range replacement moves the take graph with the material it ripples', () => {
	const project = takeProject();
	const edited = replaceRange(project, 'vocals', 0, 32, 8);

	const [group] = edited.takeGroups;
	assert.deepEqual(
		{ startSample: group?.startSample, endSample: group?.endSample },
		{ startSample: 72, endSample: 80 },
	);
	assert.deepEqual(
		group?.takes.map(({ startSample, endSample, sourceStartSample }) => (
			{ startSample, endSample, sourceStartSample }
		)),
		[
			{ startSample: 72, endSample: 80, sourceStartSample: 0 },
			{ startSample: 72, endSample: 80, sourceStartSample: 0 },
		],
		'a take moves on the timeline without moving inside its source',
	);
	assert.deepEqual(
		group?.compRegions.map(({ startSample, endSample }) => ({ startSample, endSample })),
		[{ startSample: 72, endSample: 80 }],
	);
});

test('a longer range replacement moves the take graph later by the same delta', () => {
	const project = takeProject();
	const edited = replaceRange(project, 'vocals', 0, 32, 64);

	const [group] = edited.takeGroups;
	assert.deepEqual(
		{ startSample: group?.startSample, endSample: group?.endSample },
		{ startSample: 128, endSample: 136 },
	);
});

test('a range replacement on another track leaves the take graph where it is', () => {
	const project = takeProject();
	const edited = replaceRange(project, 'guitar', 0, 32, 8);

	assert.equal(edited.takeGroups[0]?.startSample, 96);
});

test('a range replacement that runs through the take graph is refused', () => {
	const project = takeProject();
	assert.throws(
		() => replaceRange(project, 'vocals', 100, 120, 8),
		/take graph|split identities/iu,
	);
});

test('a rendered clip replacement moves the take graph with the clips it ripples', () => {
	const project = takeProject();
	const command = {
		type: 'clip/render-replace-many',
		entries: [{ clipId: 'clip-a', source: replacementSource('render-source', 32) }],
	} as const;
	const edited = applyEditorCommand(project, command as unknown as AudioEditorCommand, { now: NOW });

	assert.equal(
		edited.clips.find(({ id }) => id === 'clip-b')?.timelineStartFrame,
		32,
		'the later clip on the track ripples by the rendered delta',
	);
	const [group] = edited.takeGroups;
	assert.deepEqual(
		{ startSample: group?.startSample, endSample: group?.endSample },
		{ startSample: 64, endSample: 72 },
	);
});

function replaceRange(
	project: ReturnType<typeof takeProject>,
	trackId: string,
	startFrame: number,
	endFrame: number,
	frameCount: number,
) {
	const command = prepareRangeReplacementCommand(
		projectForCommand(project as unknown as Record<string, unknown>),
		{ trackId, startFrame, endFrame, source: replacementSource('replacement-source', frameCount) },
	);
	return applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });
}

function replacementSource(id: string, frameCount: number) {
	return {
		id,
		storageKey: id,
		name: `${id}.wav`,
		mimeType: 'audio/wav',
		frameCount,
		channelCount: 2,
		sampleRate: SAMPLE_RATE,
		originalSampleRate: SAMPLE_RATE,
	};
}

function takeProject() {
	return createAudioEditorProjectV17({
		id: 'take-graph-length-change', title: 'Take graph length changes', now: NOW, sampleRate: SAMPLE_RATE,
		sources: [
			source('take-source-a', 8),
			source('take-source-b', 8),
			source('clip-source', 64),
		],
		clips: [
			createAudioClip({
				id: 'clip-a', sourceId: 'clip-source', timelineStartFrame: 0,
				durationFrames: 64, sourceStartFrame: 0, sourceDurationFrames: 64,
			}),
			createAudioClip({
				id: 'clip-b', sourceId: 'clip-source', timelineStartFrame: 64,
				durationFrames: 8, sourceStartFrame: 0, sourceDurationFrames: 8,
			}),
		],
		tracks: [
			createAudioTrack({ id: 'vocals', name: 'Vocals', clipIds: ['clip-a', 'clip-b'] }),
			createAudioTrack({ id: 'guitar', name: 'Guitar', clipIds: [] }),
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

function source(id: string, frameCount: number) {
	return createAudioSource({
		id, name: id, storageKey: id, mimeType: 'audio/wav',
		frameCount, channelCount: 2, sampleRate: SAMPLE_RATE, chunkFrames: 65_536,
	});
}

function take(id: string, laneId: string, sourceId: string) {
	return { id, laneId, sourceId, startSample: 96, endSample: 104, sourceStartSample: 0 };
}
