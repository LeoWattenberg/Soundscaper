/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	planTrackAlignment,
	planTrackSort,
	type TrackAlignmentMode,
} from '../src/common/editor/controller/track-structural-operation-planner.ts';
import {
	createTrackStructuralOperationService,
	type TrackStructuralOperationServiceDependencies,
} from '../src/common/editor/controller/track-structural-operation-service.ts';
import type {
	ControllerClip,
	ControllerProject,
	ControllerTrack,
} from '../src/common/editor/controller/track-domain-types.ts';
import { createTrackStructuralOperationMenuModel } from '../src/common/editor/ui/track-structural-operation-menu-model.ts';

test('the complete structural slice is reachable through opt-in track menus', () => {
	const model = createTrackStructuralOperationMenuModel({
		copy: {
			muteAllTracks: 'Mute all tracks', unmuteAllTracks: 'Unmute all tracks',
			alignTracks: 'Align content', alignEndToEnd: 'Align end to end', alignTogether: 'Align together',
			sortTracks: 'Sort tracks', sortByTime: 'Sort by time', sortByName: 'Sort by name',
		},
		editingBlocked: false, hasTracks: true, hasAlignmentTarget: true,
	});
	assert.deepEqual(model.muteItems.map(({ id }) => id), ['mute-all', 'unmute-all']);
	assert.deepEqual(model.alignMenu.items?.map(({ id }) => id), [
		'align-end-to-end', 'align-together', 'align-start-to-zero', 'align-start-to-playhead',
		'align-start-to-selection-end', 'align-end-to-playhead', 'align-end-to-selection-end',
	]);
	assert.deepEqual(model.sortMenu.items?.map(({ id }) => id), ['sort-by-time', 'sort-by-name']);
});

test('alignment treats folder subtrees and linked A/V lanes as indivisible timing blocks', () => {
	const project = structuralProject();
	assert.deepEqual(
		planTrackAlignment(project, ['dialogue', 'audio', 'music'], 'start-zero').transforms,
		[
			transform('dialogue-clip', 'dialogue', 0),
			transform('fx-clip', 'fx', 20),
			transform('video-clip', 'video', 0),
			transform('audio-clip', 'audio', 0),
			transform('music-clip', 'music', 0),
		],
	);
	assert.deepEqual(
		planTrackAlignment(project, ['dialogue', 'audio', 'music'], 'end-to-end').transforms,
		[
			transform('video-clip', 'video', 60),
			transform('audio-clip', 'audio', 60),
			transform('music-clip', 'music', 80),
		],
	);
	assert.deepEqual(
		planTrackAlignment(project, ['dialogue', 'audio', 'music'], 'together').transforms,
		[
			transform('dialogue-clip', 'dialogue', 47),
			transform('fx-clip', 'fx', 67),
			transform('video-clip', 'video', 47),
			transform('audio-clip', 'audio', 47),
			transform('music-clip', 'music', 47),
		],
	);
});

test('all target alignment modes use one exact block delta and reject impossible negative placement', () => {
	const project = structuralProject();
	const expectations: readonly [TrackAlignmentMode, number, number][] = [
		['start-playhead', 200, 200],
		['start-selection-end', 120, 120],
		['end-playhead', 200, 180],
		['end-selection-end', 120, 100],
	];
	for (const [mode, targetFrame, expectedStart] of expectations) {
		const result = planTrackAlignment(project, ['audio'], mode, targetFrame);
		assert.deepEqual(result.transforms, [
			transform('video-clip', 'video', expectedStart),
			transform('audio-clip', 'audio', expectedStart),
		]);
	}
	assert.throws(
		() => planTrackAlignment(project, ['dialogue'], 'end-playhead', 10),
		/precede frame zero/i,
	);
});

test('sorting moves root structural blocks atomically without splitting a folder or lane pair', () => {
	const project = structuralProject();
	assert.deepEqual(planTrackSort(project, 'name'), [
		{ type: 'track-node/move', sequenceId: 'main', nodeId: 'video', parentFolderId: null, index: 0 },
		{ type: 'track-node/move', sequenceId: 'main', nodeId: 'music', parentFolderId: null, index: 1 },
		{ type: 'track-node/move', sequenceId: 'main', nodeId: 'folder', parentFolderId: null, index: 2 },
	]);
	assert.deepEqual(planTrackSort(project, 'time'), [
		{ type: 'track-node/move', sequenceId: 'main', nodeId: 'video', parentFolderId: null, index: 0 },
		{ type: 'track-node/move', sequenceId: 'main', nodeId: 'folder', parentFolderId: null, index: 1 },
		{ type: 'track-node/move', sequenceId: 'main', nodeId: 'music', parentFolderId: null, index: 2 },
	]);
});

test('structural operations refuse locked blocks and blocked writes before committing', () => {
	const locked = structuralProject({
		tracks: structuralProject().tracks.map((track) => (
			track.id === 'fx' ? { ...track, locked: true } : track
		)),
	});
	assert.throws(() => planTrackAlignment(locked, ['dialogue'], 'start-zero'), /locked track fx/i);
	assert.throws(() => planTrackSort(locked, 'name'), /locked track fx/i);

	const commits: AudioEditorCommand[] = [];
	const dependencies = serviceDependencies(structuralProject(), commits);
	const blocked = createTrackStructuralOperationService({ ...dependencies, editingBlocked: () => true });
	assert.throws(() => blocked.alignStartToZero(), /editing is blocked/i);
	assert.throws(() => blocked.muteAll(), /editing is blocked/i);
	assert.deepEqual(commits, []);

	const lockedCommits: AudioEditorCommand[] = [];
	const lockedService = createTrackStructuralOperationService(serviceDependencies(locked, lockedCommits));
	assert.doesNotThrow(() => lockedService.muteAll());
	assert.equal(lockedCommits[0]?.type, 'batch');

	const labelCommits: AudioEditorCommand[] = [];
	const withLabel = structuralProject({
		tracks: [...structuralProject().tracks, track('labels', 'Labels', [], { type: 'label' })],
	});
	createTrackStructuralOperationService(serviceDependencies(withLabel, labelCommits)).muteAll();
	assert.equal(labelCommits[0]?.type, 'batch');
	if (labelCommits[0]?.type !== 'batch') assert.fail('Expected one media-track mute batch.');
	assert.equal(labelCommits[0].commands.some((command) => (
		command.type === 'track/update' && command.trackId === 'labels'
	)), false);
});

test('controller service commits one transform or batch for every structural action', () => {
	const commits: AudioEditorCommand[] = [];
	const service = createTrackStructuralOperationService(serviceDependencies(structuralProject(), commits));

	service.alignEndToEnd();
	service.alignTogether();
	service.alignStartToZero();
	service.alignStartToPlayhead();
	service.alignStartToSelectionEnd();
	service.alignEndToPlayhead();
	service.alignEndToSelectionEnd();
	service.sortByTime();
	service.sortByName();
	service.muteAll();
	service.unmuteAll();

	assert.equal(commits.length, 11);
	assert.deepEqual(commits.slice(0, 7).map(({ type }) => type), Array(7).fill('clip/transform-many'));
	assert.deepEqual(commits.slice(7).map(({ type }) => type), Array(4).fill('batch'));
	const alignment = commits[3];
	assert.equal(alignment?.type, 'clip/transform-many');
	if (alignment?.type !== 'clip/transform-many') assert.fail('Expected one conformed transform command.');
	assert.deepEqual(alignment.transforms.map(({ changes }) => changes.timelineStartFrame), [200, 220, 200, 200, 200]);
	const mute = commits[9];
	assert.equal(mute?.type, 'batch');
	if (mute?.type !== 'batch') assert.fail('Expected one atomic mute batch.');
	assert.equal(mute.commands.length, 5);
	assert.ok(mute.commands.every((command) => command.type === 'track/update' && command.changes.mute === true));
});

function serviceDependencies(
	project: ControllerProject,
	commits: AudioEditorCommand[],
): TrackStructuralOperationServiceDependencies {
	return {
		lifetime: { assertActive() {} },
		getProject: () => project,
		getSelectedTrackId: () => 'audio',
		editingBlocked: () => false,
		getPositionFrames: () => 200,
		commit: (command) => { commits.push(command); return command; },
	};
}

function structuralProject(overrides: Partial<ControllerProject> = {}): ControllerProject {
	const tracks = [
		track('dialogue', 'Dialogue', ['dialogue-clip']),
		track('fx', 'FX', ['fx-clip']),
		track('video', 'Alpha Picture', ['video-clip'], { type: 'video', laneGroupId: 'lanes' }),
		track('audio', 'Alpha Picture Audio', ['audio-clip'], { laneGroupId: 'lanes' }),
		track('music', 'Mike Music', ['music-clip']),
	];
	return {
		schemaVersion: 16,
		id: 'project', title: 'Project', sampleRate: 48_000,
		tracks,
		clips: [
			clip('dialogue-clip', 30, 10), clip('fx-clip', 50, 10),
			clip('video-clip', 10, 20, {
				kind: 'video', avLinkId: 'av', sequenceId: 'main',
				sequenceStartFrame: 10, sequenceFrameCount: 20, sourceInFrame: 0, sourceFrameCount: 20,
			}),
			clip('audio-clip', 10, 20, { avLinkId: 'av' }),
			clip('music-clip', 100, 5),
		],
		sources: [],
		selection: { startFrame: 0, endFrame: 120, trackIds: ['dialogue', 'audio', 'music'], clipIds: [] },
		mixer: { groups: [], sends: [], routes: {} },
		trackFolders: [{ id: 'folder', name: 'Zulu Folder' }],
		primarySequenceId: 'main',
		sequences: [{
			id: 'main',
			rate: { num: 48_000, den: 1 },
			trackNodes: [
				{ kind: 'folder', id: 'folder', parentFolderId: null },
				{ kind: 'track', id: 'dialogue', parentFolderId: 'folder' },
				{ kind: 'track', id: 'fx', parentFolderId: 'folder' },
				{ kind: 'track', id: 'video', parentFolderId: null },
				{ kind: 'track', id: 'audio', parentFolderId: null },
				{ kind: 'track', id: 'music', parentFolderId: null },
			],
			trackIds: tracks.map(({ id }) => id),
		}],
		...overrides,
	};
}

function track(
	id: string,
	name: string,
	clipIds: readonly string[],
	overrides: Partial<ControllerTrack> = {},
): ControllerTrack {
	return { id, name, type: 'audio', clipIds, locked: false, ...overrides };
}

function clip(
	id: string,
	timelineStartFrame: number,
	durationFrames: number,
	overrides: Readonly<Record<string, unknown>> = {},
): ControllerClip {
	return {
		kind: 'audio', id, sourceId: `${id}-source`, title: id, timelineStartFrame,
		sourceStartFrame: 0, sourceDurationFrames: durationFrames, durationFrames,
		...overrides,
	};
}

function transform(clipId: string, trackId: string, timelineStartFrame: number) {
	return { clipId, trackId, changes: { timelineStartFrame } };
}
