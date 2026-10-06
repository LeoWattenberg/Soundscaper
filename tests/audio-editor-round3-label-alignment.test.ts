/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTrackStructuralOperationService } from '../src/common/editor/controller/track-audio/internal/track-structural-operation-service.ts';
import { planTrackSort } from '../src/common/editor/controller/track-audio/internal/track-structural-operation-planner.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

function fixture(foldered = false): ControllerProject {
	return { schemaVersion: 17, id: 'project', title: 'Labels', sampleRate: 48_000,
		tracks: [{ id: 'audio', type: 'audio', name: 'Audio', clipIds: ['clip'] },
			{ id: 'labels', type: 'label', name: 'Labels', labels: [
				{ id: 'region', startFrame: 20, endFrame: 40 },
				{ id: 'point', startFrame: 60, endFrame: 60 },
			] }],
		clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 50,
			sourceStartFrame: 0, sourceDurationFrames: 30, durationFrames: 30 }],
		sources: [], mixer: { groups: [], sends: [], routes: {} },
		selection: { startFrame: 0, endFrame: 100, trackIds: ['labels'], clipIds: [] },
		...(foldered ? { trackFolders: [{ id: 'folder', name: 'Folder' }], sequences: [{ id: 'sequence',
			trackNodes: [{ kind: 'folder', id: 'folder', parentFolderId: null },
				{ kind: 'track', id: 'audio', parentFolderId: 'folder' },
				{ kind: 'track', id: 'labels', parentFolderId: 'folder' }] }] } : {}),
	};
}

function align(project: ControllerProject, method: 'alignStartToZero' | 'alignEndToPlayhead') {
	let result: AudioEditorCommand | undefined;
	const service = createTrackStructuralOperationService({ lifetime: { assertActive() {} },
		getProject: () => project, getSelectedTrackId: () => 'labels', editingBlocked: () => false,
		getPositionFrames: () => 100, commit: command => { result = command; },
	});
	service[method]();
	return result;
}

test('the enabled label-track alignment moves every region and point by the same exact delta', () => {
	assert.deepEqual(align(fixture(), 'alignStartToZero'), { type: 'batch', commands: [
		{ type: 'label/update', trackId: 'labels', labelId: 'region', changes: { startFrame: 0, endFrame: 20 } },
		{ type: 'label/update', trackId: 'labels', labelId: 'point', changes: { startFrame: 40, endFrame: 40 } },
	] });
});

test('end alignment derives its extent from the last point label rather than an absent clip', () => {
	assert.deepEqual(align(fixture(), 'alignEndToPlayhead'), { type: 'batch', commands: [
		{ type: 'label/update', trackId: 'labels', labelId: 'region', changes: { startFrame: 60, endFrame: 80 } },
		{ type: 'label/update', trackId: 'labels', labelId: 'point', changes: { startFrame: 100, endFrame: 100 } },
	] });
});

test('folder alignment includes labels and clips in one atomic content block', () => {
	const command = align(fixture(true), 'alignStartToZero');
	assert.equal(command?.type, 'batch');
	if (command?.type !== 'batch') assert.fail('Expected one combined alignment.');
	assert.deepEqual(command.commands, [
		{ type: 'clip/transform-many', transforms: [{ clipId: 'clip', trackId: 'audio', changes: { timelineStartFrame: 30 } }],
			overwrite: false, splitClipIds: {}, splitAvLinkIds: {}, videoEffectIds: {} },
		{ type: 'label/update', trackId: 'labels', labelId: 'region', changes: { startFrame: 0, endFrame: 20 } },
		{ type: 'label/update', trackId: 'labels', labelId: 'point', changes: { startFrame: 40, endFrame: 40 } },
	]);
});

test('Sort by time orders label content by its first region alongside media content', () => {
	assert.deepEqual(planTrackSort(fixture(), 'time'), [
		{ type: 'track/reorder', trackId: 'labels', index: 0 },
		{ type: 'track/reorder', trackId: 'audio', index: 1 },
	]);
});

test('locked label tracks are refused before emitting any alignment command', () => {
	const original = fixture();
	const project = { ...original, tracks: original.tracks.map(track => (
		track.id === 'labels' ? { ...track, locked: true } : track
	)) };
	assert.throws(() => align(project, 'alignStartToZero'), /locked track/u);
});
