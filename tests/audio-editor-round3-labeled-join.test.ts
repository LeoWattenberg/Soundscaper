/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createLabeledAudioEditService } from '../src/common/editor/controller/edit/internal/labeled-audio-edit-service.ts';

function join(regions: readonly (readonly [number, number])[], extents: readonly (readonly [number, number])[]) {
	const clips = extents.map(([start, end], index) => ({ id: `clip-${index}`, timelineStartFrame: start, durationFrames: end - start }));
	const selection = { startFrame: 0, endFrame: 100, trackIds: ['audio'] };
	const project = { selection, tracks: [
		{ id: 'audio', type: 'audio', clipIds: clips.map(clip => clip.id) },
		{ id: 'labels', type: 'label', labels: regions.map(([startFrame, endFrame]) => ({ startFrame, endFrame })) },
	], clips };
	const commits: AudioEditorCommand[] = [];
	const errors: unknown[] = [];
	createLabeledAudioEditService({
		state: { selectedTrackId: 'audio' }, getProject: () => project,
		activeSelection: () => selection, findClip: (_project: unknown, id: string) => clips.find(clip => clip.id === id),
		commit: (command: AudioEditorCommand) => { commits.push(command); },
		handleError: (error: unknown) => { errors.push(error); },
	})('labeled-join');
	assert.deepEqual(errors, []);
	return commits;
}

test('disjoint labels whose requested joins share a middle clip form one atomic run', () => {
	assert.deepEqual(join([[10, 30], [50, 70]], [[0, 20], [20, 60], [60, 80]]), [
		{ type: 'clip/join', clipIds: ['clip-0', 'clip-1', 'clip-2'] },
	]);
});

test('separate point labels at split boundaries reconnect the original clip without repeated IDs', () => {
	assert.deepEqual(join([[20, 20], [60, 60]], [[0, 20], [20, 60], [60, 80]]), [
		{ type: 'clip/join', clipIds: ['clip-0', 'clip-1', 'clip-2'] },
	]);
});

test('independent labeled runs remain independent even when the outer clips touch', () => {
	assert.deepEqual(join([[5, 15], [25, 35]], [[0, 10], [10, 20], [20, 30], [30, 40]]), [{
		type: 'batch', commands: [
			{ type: 'clip/join', clipIds: ['clip-0', 'clip-1'] },
			{ type: 'clip/join', clipIds: ['clip-2', 'clip-3'] },
		],
	}]);
});

test('gaps remain gaps rather than being introduced into a consolidated join', () => {
	assert.deepEqual(join([[10, 30], [35, 70]], [[0, 20], [25, 40], [40, 80]]), [
		{ type: 'clip/join', clipIds: ['clip-1', 'clip-2'] },
	]);
});

test('repeated point labels cannot repeat the same join command', () => {
	assert.deepEqual(join([[20, 20], [20, 20]], [[0, 20], [20, 80]]), [
		{ type: 'clip/join', clipIds: ['clip-0', 'clip-1'] },
	]);
});
