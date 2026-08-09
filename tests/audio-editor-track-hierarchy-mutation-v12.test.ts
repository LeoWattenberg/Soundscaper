/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	TRACK_FOLDER_EDIT_CODES,
	TrackFolderEditError,
	insertTrackNodeV12,
	moveTrackNodeV12,
	orderByHierarchyPreorderV12,
	removeTrackNodeV12,
	resolveRootFolderIdV12,
	resolveTrackNodeAncestorsV12,
	resolveTrackNodeSpanV12,
	trackNodeLaneGroupsV12,
	type MutableHierarchySequenceV12,
} from '../src/common/editor/track-hierarchy-mutation-v12.ts';
import {
	deriveTrackHierarchyOrderV12,
	validateTrackHierarchyV12,
} from '../src/common/editor/track-hierarchy-v12.ts';
import { createTrackFolderV12 } from '../src/common/editor/track-folder-v12.ts';

function folderNode(id: string, parentFolderId: string | null = null) {
	return { kind: 'folder' as const, id, parentFolderId };
}

function trackNode(id: string, parentFolderId: string | null = null) {
	return { kind: 'track' as const, id, parentFolderId };
}

/**
 * music
 *   drums
 *     kick, snare
 *   bass
 * vocals (root track)
 */
function nestedSequence(): MutableHierarchySequenceV12 {
	return {
		id: 'main',
		trackNodes: [
			folderNode('music'),
			folderNode('drums', 'music'),
			trackNode('kick', 'drums'),
			trackNode('snare', 'drums'),
			trackNode('bass', 'music'),
			trackNode('vocals'),
		],
		trackIds: ['kick', 'snare', 'bass', 'vocals'],
	};
}

function threeSequences(): MutableHierarchySequenceV12[] {
	return [
		nestedSequence(),
		{ id: 'alt', trackNodes: [folderNode('fx'), trackNode('reverb', 'fx')], trackIds: ['reverb'] },
		{ id: 'stems', trackNodes: [trackNode('stem')], trackIds: ['stem'] },
	];
}

function contextFor(sequences: readonly MutableHierarchySequenceV12[], laneGroups = new Map<string, string>()) {
	const order = deriveTrackHierarchyOrderV12(sequences);
	return {
		trackFolders: order.folderIds.map((id) => createTrackFolderV12({ id, name: id })),
		tracks: order.trackIds.map((id) => ({
			id,
			type: laneGroups.has(id) && id.startsWith('video') ? 'video' as const : 'audio' as const,
			laneGroupId: laneGroups.get(id) ?? null,
		})),
	};
}

function assertHierarchyValid(sequences: readonly MutableHierarchySequenceV12[], laneGroups?: Map<string, string>) {
	assert.equal(validateTrackHierarchyV12(sequences, contextFor(sequences, laneGroups)), true);
}

test('a folder span covers its whole subtree and a plain track covers only itself', () => {
	const sequence = nestedSequence();
	assert.deepEqual(resolveTrackNodeSpanV12(sequence.trackNodes, 'music'), { start: 0, end: 5 });
	assert.deepEqual(resolveTrackNodeSpanV12(sequence.trackNodes, 'drums'), { start: 1, end: 4 });
	assert.deepEqual(resolveTrackNodeSpanV12(sequence.trackNodes, 'bass'), { start: 4, end: 5 });
	assert.deepEqual(resolveTrackNodeSpanV12(sequence.trackNodes, 'vocals'), { start: 5, end: 6 });

	assert.deepEqual(resolveTrackNodeAncestorsV12(sequence.trackNodes, 'kick'), ['music', 'drums']);
	assert.deepEqual(resolveTrackNodeAncestorsV12(sequence.trackNodes, 'vocals'), []);
	assert.equal(resolveRootFolderIdV12(sequence.trackNodes, 'kick'), 'music');
	assert.equal(resolveRootFolderIdV12(sequence.trackNodes, 'vocals'), null);

	assert.throws(
		() => resolveTrackNodeSpanV12(sequence.trackNodes, 'missing'),
		(error: unknown) => error instanceof TrackFolderEditError
			&& error.code === TRACK_FOLDER_EDIT_CODES.unknownNode,
	);
});

test('a media lane track expands its span to keep the A/V pair adjacent through a move', () => {
	const laneGroups = new Map([['videoA', 'lane-a'], ['audioA', 'lane-a']]);
	const sequences: MutableHierarchySequenceV12[] = [{
		id: 'main',
		trackNodes: [folderNode('bin'), trackNode('videoA'), trackNode('audioA'), trackNode('tail')],
		trackIds: ['videoA', 'audioA', 'tail'],
	}];
	const groups = trackNodeLaneGroupsV12(contextFor(sequences, laneGroups).tracks);
	assert.deepEqual(resolveTrackNodeSpanV12(sequences[0].trackNodes, 'audioA', groups), { start: 1, end: 3 });

	moveTrackNodeV12(sequences, { sequenceId: 'main', nodeId: 'audioA', parentFolderId: 'bin', index: 0 }, groups);
	assert.deepEqual(sequences[0].trackNodes.map(({ id }) => id), ['bin', 'videoA', 'audioA', 'tail']);
	assert.deepEqual(
		sequences[0].trackNodes.map(({ parentFolderId }) => parentFolderId),
		[null, 'bin', 'bin', null],
	);
	assertHierarchyValid(sequences, laneGroups);
});

test('moving a folder relocates its whole subtree and keeps the derived preorder exact', () => {
	const sequences = threeSequences();
	moveTrackNodeV12(sequences, { sequenceId: 'main', nodeId: 'drums', parentFolderId: null, index: 0 });
	assert.deepEqual(sequences[0].trackNodes.map(({ id }) => id), [
		'drums', 'kick', 'snare', 'music', 'bass', 'vocals',
	]);
	assert.deepEqual(sequences[0].trackIds, ['kick', 'snare', 'bass', 'vocals']);
	assertHierarchyValid(sequences);

	const order = deriveTrackHierarchyOrderV12(sequences);
	assert.deepEqual(order.folderIds, ['drums', 'music', 'fx']);
	assert.deepEqual(order.trackIds, ['kick', 'snare', 'bass', 'vocals', 'reverb', 'stem']);
});

test('a move under its own subtree, across a sequence, or onto a track rejects before mutating', () => {
	const sequences = threeSequences();
	const before = JSON.stringify(sequences);

	assert.throws(
		() => moveTrackNodeV12(sequences, { sequenceId: 'main', nodeId: 'music', parentFolderId: 'drums', index: 0 }),
		(error: unknown) => error instanceof TrackFolderEditError
			&& error.code === TRACK_FOLDER_EDIT_CODES.cyclicParent,
	);
	assert.throws(
		() => moveTrackNodeV12(sequences, { sequenceId: 'main', nodeId: 'bass', parentFolderId: 'fx', index: 0 }),
		(error: unknown) => error instanceof TrackFolderEditError
			&& error.code === TRACK_FOLDER_EDIT_CODES.crossSequence,
	);
	assert.throws(
		() => moveTrackNodeV12(sequences, { sequenceId: 'main', nodeId: 'bass', parentFolderId: 'vocals', index: 0 }),
		(error: unknown) => error instanceof TrackFolderEditError
			&& error.code === TRACK_FOLDER_EDIT_CODES.parentNotFolder,
	);
	assert.throws(
		() => moveTrackNodeV12(sequences, { sequenceId: 'main', nodeId: 'bass', parentFolderId: 'ghost', index: 0 }),
		(error: unknown) => error instanceof TrackFolderEditError
			&& error.code === TRACK_FOLDER_EDIT_CODES.unknownParent,
	);
	assert.throws(
		() => moveTrackNodeV12(sequences, { sequenceId: 'ghost', nodeId: 'bass', parentFolderId: null, index: 0 }),
		(error: unknown) => error instanceof TrackFolderEditError
			&& error.code === TRACK_FOLDER_EDIT_CODES.unknownSequence,
	);
	assert.throws(
		() => moveTrackNodeV12(sequences, { sequenceId: 'main', nodeId: 'bass', parentFolderId: null, index: -1 }),
		(error: unknown) => error instanceof TrackFolderEditError
			&& error.code === TRACK_FOLDER_EDIT_CODES.invalidIndex,
	);

	assert.equal(JSON.stringify(sequences), before);
});

test('depth, node, and folder budgets reject before the sequence is rewritten', () => {
	// A root folder sits at depth 0, so a chain of 33 folders is exactly the
	// deepest legal hierarchy and a 34th nested folder must reject.
	const nodes = [folderNode('f0')];
	for (let depth = 1; depth <= 32; depth += 1) nodes.push(folderNode(`f${String(depth)}`, `f${String(depth - 1)}`));
	const sequences: MutableHierarchySequenceV12[] = [{ id: 'main', trackNodes: nodes, trackIds: [] }];
	assertHierarchyValid(sequences);

	assert.throws(
		() => insertTrackNodeV12(sequences, {
			sequenceId: 'main',
			node: folderNode('overflow'),
			parentFolderId: 'f32',
			index: 0,
		}),
		(error: unknown) => error instanceof TrackFolderEditError
			&& error.code === TRACK_FOLDER_EDIT_CODES.depthExceeded,
	);
	assert.equal(sequences[0].trackNodes.length, 33);

	assert.throws(
		() => insertTrackNodeV12(sequences, {
			sequenceId: 'main',
			node: folderNode('f0'),
			parentFolderId: null,
			index: 0,
		}),
		(error: unknown) => error instanceof TrackFolderEditError
			&& error.code === TRACK_FOLDER_EDIT_CODES.duplicateId,
	);
});

test('promote lifts direct children and leaves no unreachable track', () => {
	const sequences = threeSequences();
	const result = removeTrackNodeV12(sequences, {
		sequenceId: 'main',
		nodeId: 'music',
		disposition: 'promote',
	});
	assert.deepEqual(result, { removedTrackIds: [], removedFolderIds: ['music'] });
	assert.deepEqual(sequences[0].trackNodes.map(({ id }) => id), [
		'drums', 'kick', 'snare', 'bass', 'vocals',
	]);
	assert.deepEqual(
		sequences[0].trackNodes.map(({ parentFolderId }) => parentFolderId),
		[null, 'drums', 'drums', null, null],
	);
	assert.deepEqual(sequences[0].trackIds, ['kick', 'snare', 'bass', 'vocals']);
	assertHierarchyValid(sequences);
});

test('delete-contents removes the whole subtree and reports every departing id', () => {
	const sequences = threeSequences();
	const result = removeTrackNodeV12(sequences, {
		sequenceId: 'main',
		nodeId: 'music',
		disposition: 'delete-contents',
	});
	assert.deepEqual(result.removedFolderIds, ['music', 'drums']);
	assert.deepEqual(result.removedTrackIds, ['kick', 'snare', 'bass']);
	assert.deepEqual(sequences[0].trackNodes.map(({ id }) => id), ['vocals']);
	assert.deepEqual(sequences[0].trackIds, ['vocals']);
	assertHierarchyValid(sequences);
});

test('preorder ordering rebuilds project metadata and refuses to drop or invent records', () => {
	const sequences = threeSequences();
	const order = deriveTrackHierarchyOrderV12(sequences);
	const tracks = [{ id: 'stem' }, { id: 'kick' }, { id: 'reverb' }, { id: 'bass' }, { id: 'vocals' }, { id: 'snare' }];
	assert.deepEqual(
		orderByHierarchyPreorderV12(tracks, order.trackIds).map(({ id }) => id),
		['kick', 'snare', 'bass', 'vocals', 'reverb', 'stem'],
	);

	assert.throws(
		() => orderByHierarchyPreorderV12([{ id: 'kick' }], order.trackIds),
		(error: unknown) => error instanceof TrackFolderEditError
			&& error.code === TRACK_FOLDER_EDIT_CODES.unknownNode,
	);
	assert.throws(
		() => orderByHierarchyPreorderV12([...tracks, { id: 'stray' }], order.trackIds),
		/Hierarchy preorder omits 1 record\(s\): stray\./u,
	);
});

test('insertion honours the child-relative index rather than a flat node index', () => {
	const sequences = threeSequences();
	insertTrackNodeV12(sequences, {
		sequenceId: 'main',
		node: trackNode('guitar'),
		parentFolderId: 'music',
		index: 1,
	});
	assert.deepEqual(sequences[0].trackNodes.map(({ id }) => id), [
		'music', 'drums', 'kick', 'snare', 'guitar', 'bass', 'vocals',
	]);

	insertTrackNodeV12(sequences, {
		sequenceId: 'main',
		node: trackNode('room'),
		parentFolderId: null,
		index: 0,
	});
	assert.deepEqual(sequences[0].trackNodes[0].id, 'room');
	assert.deepEqual(sequences[0].trackIds, ['room', 'kick', 'snare', 'guitar', 'bass', 'vocals']);
	assertHierarchyValid(sequences);
});
