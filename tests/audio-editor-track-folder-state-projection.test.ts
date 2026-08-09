/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	deriveTrackFolderStateProjectionV12,
	type TrackFolderAudioStateV12,
	type TrackFolderStateProjectionContextV12,
	type TrackFolderStateAudioTrackV12,
	type TrackFolderStateLabelTrackV12,
	type TrackFolderStateVideoTrackV12,
	type TrackFolderVideoStateV12,
} from '../src/common/editor/track-folder-state-projection.ts';
import { createTrackFoldersV12 } from '../src/common/editor/track-folder-v12.ts';
import {
	TRACK_HIERARCHY_V12_LIMITS,
	createTrackHierarchyV12,
	type TrackHierarchySequenceV12,
} from '../src/common/editor/track-hierarchy-v12.ts';

type DataRecord = Record<string, unknown>;

function audio(
	id: string,
	mute = false,
	solo = false,
	extensions: DataRecord = {},
): TrackFolderStateAudioTrackV12 & DataRecord {
	return { ...extensions, id, type: 'audio' as const, laneGroupId: null, mute, solo };
}

function video(
	id: string,
	hidden = false,
	extensions: DataRecord = {},
): TrackFolderStateVideoTrackV12 & DataRecord {
	return { ...extensions, id, type: 'video' as const, laneGroupId: null, mute: false, hidden };
}

function label(id: string, extensions: DataRecord = {}): TrackFolderStateLabelTrackV12 & DataRecord {
	return { ...extensions, id, type: 'label' as const, laneGroupId: null };
}

function exactHierarchy(
	trackNodes: readonly DataRecord[],
	trackFolders: readonly unknown[],
	tracks: readonly DataRecord[],
): readonly TrackHierarchySequenceV12[] {
	return createTrackHierarchyV12([{ id: 'main', trackNodes }], {
		trackFolders: createTrackFoldersV12(trackFolders),
		tracks: tracks.map(({ id, type, laneGroupId }) => ({ id, type, laneGroupId })),
	});
}

function stateById(
	projection: ReturnType<typeof deriveTrackFolderStateProjectionV12>,
): ReadonlyMap<string, ReturnType<typeof deriveTrackFolderStateProjectionV12>['sequences'][number]['nodes'][number]> {
	return new Map(projection.sequences.flatMap(({ nodes }) => nodes.map((state) => [state.id, state])));
}

function audioState(
	states: ReturnType<typeof stateById>,
	id: string,
): TrackFolderAudioStateV12 {
	const state = states.get(id);
	if (state?.kind !== 'track' || state.type !== 'audio') throw new Error(`Expected audio state for ${id}.`);
	return state;
}

function videoState(
	states: ReturnType<typeof stateById>,
	id: string,
): TrackFolderVideoStateV12 {
	const state = states.get(id);
	if (state?.kind !== 'track' || state.type !== 'video') throw new Error(`Expected video state for ${id}.`);
	return state;
}

test('V12 folder projection derives immutable DFS ancestry, depth, and collapse-only row visibility', () => {
	const trackFolders = createTrackFoldersV12([
		{ id: 'outer', name: 'Outer', collapsed: true, hidden: false, mute: false, solo: false },
		{ id: 'inner', name: 'Inner', collapsed: true, hidden: false, mute: false, solo: false },
		{ id: 'tail', name: 'Tail', collapsed: false, hidden: false, mute: false, solo: false },
	]);
	const tracks = [audio('root'), audio('nested'), label('notes')];
	const hierarchy = exactHierarchy([
		{ kind: 'track', id: 'root', parentFolderId: null },
		{ kind: 'folder', id: 'outer', parentFolderId: null },
		{ kind: 'folder', id: 'inner', parentFolderId: 'outer' },
		{ kind: 'track', id: 'nested', parentFolderId: 'inner' },
		{ kind: 'track', id: 'notes', parentFolderId: 'outer' },
		{ kind: 'folder', id: 'tail', parentFolderId: null },
	], trackFolders, tracks);

	const projection = deriveTrackFolderStateProjectionV12(hierarchy, { trackFolders, tracks });
	const states = stateById(projection);
	assert.deepEqual(projection.sequences.map(({ sequenceId, nodes }) => ({
		sequenceId,
		nodeIds: nodes.map(({ id }) => id),
	})), [{
		sequenceId: 'main',
		nodeIds: ['root', 'outer', 'inner', 'nested', 'notes', 'tail'],
	}]);
	assert.deepEqual(states.get('root'), {
		kind: 'track', type: 'audio', id: 'root', sequenceId: 'main', parentFolderId: null,
		ancestorFolderIds: [], depth: 0, rowHidden: false, laneGroupId: null,
		mute: false, solo: false, effectiveMuted: false, effectiveSoloed: false,
	});
	assert.deepEqual(states.get('outer'), {
		kind: 'folder', id: 'outer', sequenceId: 'main', parentFolderId: null,
		ancestorFolderIds: [], depth: 0, rowHidden: false,
		collapsed: true, hidden: false, mute: false, solo: false, hasAudioDescendant: true,
	});
	assert.deepEqual(states.get('inner'), {
		kind: 'folder', id: 'inner', sequenceId: 'main', parentFolderId: 'outer',
		ancestorFolderIds: ['outer'], depth: 1, rowHidden: true,
		collapsed: true, hidden: false, mute: false, solo: false, hasAudioDescendant: true,
	});
	assert.deepEqual(states.get('nested'), {
		kind: 'track', type: 'audio', id: 'nested', sequenceId: 'main', parentFolderId: 'inner',
		ancestorFolderIds: ['outer', 'inner'], depth: 2, rowHidden: true, laneGroupId: null,
		mute: false, solo: false, effectiveMuted: false, effectiveSoloed: false,
	});
	assert.deepEqual(states.get('notes'), {
		kind: 'track', type: 'label', id: 'notes', sequenceId: 'main', parentFolderId: 'outer',
		ancestorFolderIds: ['outer'], depth: 1, rowHidden: true, laneGroupId: null,
	});
	assert.equal(states.get('tail')?.rowHidden, false);
	assert.equal(projection.structuralSoloActive, false);

	assert.equal(Object.isFrozen(projection), true);
	assert.equal(Object.isFrozen(projection.sequences), true);
	assert.equal(Object.isFrozen(projection.sequences[0]), true);
	assert.equal(Object.isFrozen(projection.sequences[0]?.nodes), true);
	assert.equal(Object.isFrozen(states.get('nested')), true);
	assert.equal(Object.isFrozen(states.get('nested')?.ancestorFolderIds), true);
});

test('nested collapse, hidden, mute, solo, and leaf flags remain independent across every combination', () => {
	for (let matrix = 0; matrix < 4_096; matrix += 1) {
		const outerCollapsed = Boolean(matrix & 1);
		const outerHidden = Boolean(matrix & 2);
		const outerMute = Boolean(matrix & 4);
		const outerSolo = Boolean(matrix & 8);
		const innerCollapsed = Boolean(matrix & 16);
		const innerHidden = Boolean(matrix & 32);
		const innerMute = Boolean(matrix & 64);
		const innerSolo = Boolean(matrix & 128);
		const audioMute = Boolean(matrix & 256);
		const audioSolo = Boolean(matrix & 512);
		const videoHidden = Boolean(matrix & 1_024);
		const unrelatedMute = Boolean(matrix & 2_048);
		const trackFolders = createTrackFoldersV12([
			{
				id: 'outer', name: 'Outer', collapsed: outerCollapsed,
				hidden: outerHidden, mute: outerMute, solo: outerSolo,
			},
			{
				id: 'inner', name: 'Inner', collapsed: innerCollapsed,
				hidden: innerHidden, mute: innerMute, solo: innerSolo,
			},
		]);
		const tracks = [
			video('nested-video', videoHidden),
			audio('nested-audio', audioMute, audioSolo),
			audio('unrelated', unrelatedMute),
		];
		const hierarchy = exactHierarchy([
			{ kind: 'folder', id: 'outer', parentFolderId: null },
			{ kind: 'folder', id: 'inner', parentFolderId: 'outer' },
			{ kind: 'track', id: 'nested-video', parentFolderId: 'inner' },
			{ kind: 'track', id: 'nested-audio', parentFolderId: 'inner' },
			{ kind: 'track', id: 'unrelated', parentFolderId: null },
		], trackFolders, tracks);
		const projection = deriveTrackFolderStateProjectionV12(hierarchy, { trackFolders, tracks });
		const states = stateById(projection);
		const structuralSoloActive = outerSolo || innerSolo || audioSolo;
		const nestedAudio = audioState(states, 'nested-audio');
		const unrelated = audioState(states, 'unrelated');
		const nestedVideo = videoState(states, 'nested-video');

		assert.equal(nestedAudio?.rowHidden, outerCollapsed || innerCollapsed, `audio row matrix ${String(matrix)}`);
		assert.equal(nestedVideo?.rowHidden, outerCollapsed || innerCollapsed, `video row matrix ${String(matrix)}`);
		assert.equal(
			nestedVideo?.effectiveHidden,
			outerHidden || innerHidden || videoHidden,
			`video hidden matrix ${String(matrix)}`,
		);
		assert.equal(nestedAudio?.effectiveSoloed, outerSolo || innerSolo || audioSolo, `audio solo matrix ${String(matrix)}`);
		assert.equal(nestedAudio?.effectiveMuted, outerMute || innerMute || audioMute, `audio mute matrix ${String(matrix)}`);
		assert.equal(
			unrelated?.effectiveMuted,
			unrelatedMute,
			`unrelated mute matrix ${String(matrix)}`,
		);
		assert.equal(
			projection.structuralSoloActive,
			structuralSoloActive,
			`structural solo matrix ${String(matrix)}`,
		);
		assert.equal(unrelated?.rowHidden, false, `unrelated row matrix ${String(matrix)}`);
		assert.equal(unrelated?.mute, unrelatedMute);
		assert.equal(unrelated?.solo, false);
		assert.equal(nestedAudio?.mute, audioMute);
		assert.equal(nestedAudio?.solo, audioSolo);
	}
});

test('only structural solos with audio membership activate project-wide exclusion', () => {
	function projectForSolo(folderId: string): ReturnType<typeof deriveTrackFolderStateProjectionV12> {
		const trackFolders = createTrackFoldersV12([
			{ id: 'empty', name: 'Empty', solo: folderId === 'empty' },
			{ id: 'video-only', name: 'Video', solo: folderId === 'video-only' },
			{ id: 'audio-folder', name: 'Audio', solo: folderId === 'audio-folder' },
		]);
		const tracks = [video('picture'), audio('dialogue'), audio('outside')];
		const hierarchy = exactHierarchy([
			{ kind: 'folder', id: 'empty', parentFolderId: null },
			{ kind: 'folder', id: 'video-only', parentFolderId: null },
			{ kind: 'track', id: 'picture', parentFolderId: 'video-only' },
			{ kind: 'folder', id: 'audio-folder', parentFolderId: null },
			{ kind: 'track', id: 'dialogue', parentFolderId: 'audio-folder' },
			{ kind: 'track', id: 'outside', parentFolderId: null },
		], trackFolders, tracks);
		return deriveTrackFolderStateProjectionV12(hierarchy, { trackFolders, tracks });
	}

	for (const folderId of ['empty', 'video-only']) {
		const projection = projectForSolo(folderId);
		const states = stateById(projection);
		assert.equal(projection.structuralSoloActive, false, folderId);
		assert.equal(audioState(states, 'outside').effectiveMuted, false, folderId);
		assert.equal(audioState(states, 'dialogue').effectiveSoloed, false, folderId);
	}
	const qualifying = projectForSolo('audio-folder');
	const qualifyingStates = stateById(qualifying);
	assert.equal(qualifying.structuralSoloActive, true);
	assert.equal(audioState(qualifyingStates, 'dialogue').effectiveSoloed, true);
	assert.equal(audioState(qualifyingStates, 'dialogue').effectiveMuted, false);
	assert.equal(audioState(qualifyingStates, 'outside').effectiveMuted, false);

	const localTracks = [audio('local-solo', false, true), audio('outside')];
	const localHierarchy = exactHierarchy([
		{ kind: 'track', id: 'local-solo', parentFolderId: null },
		{ kind: 'track', id: 'outside', parentFolderId: null },
	], [], localTracks);
	const local = deriveTrackFolderStateProjectionV12(localHierarchy, { trackFolders: [], tracks: localTracks });
	assert.equal(local.structuralSoloActive, true);
	assert.equal(audioState(stateById(local), 'outside').effectiveMuted, false);
});

test('structural solo is project-wide while effective leaf flags remain sequence-local', () => {
	const trackFolders = createTrackFoldersV12([
		{ id: 'selected-folder', name: 'Selected', solo: true },
		{ id: 'other-folder', name: 'Other', mute: true },
	]);
	const tracks = [audio('selected'), audio('other')];
	const hierarchy = createTrackHierarchyV12([
		{
			id: 'first',
			trackNodes: [
				{ kind: 'folder', id: 'selected-folder', parentFolderId: null },
				{ kind: 'track', id: 'selected', parentFolderId: 'selected-folder' },
			],
		},
		{
			id: 'second',
			trackNodes: [
				{ kind: 'folder', id: 'other-folder', parentFolderId: null },
				{ kind: 'track', id: 'other', parentFolderId: 'other-folder' },
			],
		},
	], {
		trackFolders,
		tracks: tracks.map(({ id, type, laneGroupId }) => ({ id, type, laneGroupId })),
	});
	const projection = deriveTrackFolderStateProjectionV12(hierarchy, { trackFolders, tracks });
	const states = stateById(projection);
	assert.equal(projection.structuralSoloActive, true);
	assert.equal(audioState(states, 'selected').effectiveSoloed, true);
	assert.equal(audioState(states, 'selected').effectiveMuted, false);
	assert.equal(audioState(states, 'other').effectiveSoloed, false);
	assert.equal(audioState(states, 'other').effectiveMuted, true);
	assert.deepEqual(
		projection,
		deriveTrackFolderStateProjectionV12(hierarchy, { trackFolders, tracks }),
	);
});

test('valid adjacent A/V lane pairs inherit only their own media-domain folder state', () => {
	const trackFolders = createTrackFoldersV12([{
		id: 'av', name: 'A/V', collapsed: false, hidden: true, mute: true, solo: true,
	}]);
	const tracks = [
		{ ...video('picture'), laneGroupId: 'lanes' },
		{ ...audio('production-audio'), laneGroupId: 'lanes' },
		audio('outside'),
	];
	const hierarchy = exactHierarchy([
		{ kind: 'folder', id: 'av', parentFolderId: null },
		{ kind: 'track', id: 'picture', parentFolderId: 'av' },
		{ kind: 'track', id: 'production-audio', parentFolderId: 'av' },
		{ kind: 'track', id: 'outside', parentFolderId: null },
	], trackFolders, tracks);
	const projection = deriveTrackFolderStateProjectionV12(hierarchy, { trackFolders, tracks });
	const states = stateById(projection);
	assert.equal(projection.structuralSoloActive, true);
	assert.deepEqual(states.get('picture'), {
		kind: 'track', type: 'video', id: 'picture', sequenceId: 'main', parentFolderId: 'av',
		ancestorFolderIds: ['av'], depth: 1, rowHidden: false, laneGroupId: 'lanes',
		hidden: false, effectiveHidden: true,
	});
	assert.equal(audioState(states, 'production-audio').effectiveMuted, true);
	assert.equal(audioState(states, 'production-audio').effectiveSoloed, true);
	assert.equal(audioState(states, 'outside').effectiveMuted, false);
});

test('projection validates exact V12 hierarchy/context and rejects hostile local state without invoking accessors', () => {
	const tracks = [audio('leaf')];
	const hierarchy = exactHierarchy([
		{ kind: 'track', id: 'leaf', parentFolderId: null },
	], [], tracks);
	const validContext: TrackFolderStateProjectionContextV12 = { trackFolders: [], tracks };
	assert.doesNotThrow(() => deriveTrackFolderStateProjectionV12(hierarchy, validContext));

	for (const [badHierarchy, badContext, pattern] of [
		[[{ id: 'main', trackNodes: hierarchy[0]?.trackNodes }], validContext, /trackIds|missing/iu],
		[[{ ...hierarchy[0], trackIds: ['other'] }], validContext, /derived leaf order/iu],
		[hierarchy, { ...validContext, extension: true }, /context.*unsupported/iu],
		[hierarchy, { trackFolders: [], tracks: [audio('other')] }, /exact hierarchy preorder/iu],
		[hierarchy, { trackFolders: [], tracks: [{ ...audio('leaf'), mute: 1 }] }, /mute.*boolean/iu],
		[hierarchy, { trackFolders: [], tracks: [{ ...audio('leaf'), solo: null }] }, /solo.*boolean/iu],
		[hierarchy, { trackFolders: [], tracks: [{ ...video('leaf'), hidden: 'no' }] }, /hidden.*boolean/iu],
	] as const) {
		assert.throws(
			() => deriveTrackFolderStateProjectionV12(badHierarchy, badContext),
			pattern,
		);
	}

	let getterCalls = 0;
	const hostile = audio('leaf') as DataRecord;
	Object.defineProperty(hostile, 'mute', {
		enumerable: true,
		get() {
			getterCalls += 1;
			return false;
		},
	});
	assert.throws(
		() => deriveTrackFolderStateProjectionV12(hierarchy, { trackFolders: [], tracks: [hostile] }),
		/mute.*data property/iu,
	);
	assert.equal(getterCalls, 0);
	assert.throws(
		() => deriveTrackFolderStateProjectionV12(hierarchy, { trackFolders: [], tracks: new Array(1) }),
		/dense canonical array/iu,
	);
});

test('projection admits the current node ceiling, rejects overflow, and never mutates leaf flags or route extensions', () => {
	const admittedFolderIds = Array.from(
		{ length: TRACK_HIERARCHY_V12_LIMITS.maximumFolderDepth + 1 },
		(_, index) => `folder-${String(index)}`,
	);
	const admittedFolders = createTrackFoldersV12(admittedFolderIds.map((id) => ({ id, name: id })));
	const admittedNodes = admittedFolderIds.map((id, index) => ({
		kind: 'folder',
		id,
		parentFolderId: index === 0 ? null : admittedFolderIds[index - 1],
	}));
	const admittedHierarchy = exactHierarchy(admittedNodes, admittedFolders, []);
	const admittedProjection = deriveTrackFolderStateProjectionV12(admittedHierarchy, {
		trackFolders: admittedFolders,
		tracks: [],
	});
	assert.equal(
		admittedProjection.sequences[0]?.nodes.at(-1)?.depth,
		TRACK_HIERARCHY_V12_LIMITS.maximumFolderDepth,
	);
	const overflowFolderId = 'folder-overflow';
	const overflowFolders = createTrackFoldersV12([
		...admittedFolders,
		{ id: overflowFolderId, name: overflowFolderId },
	]);
	assert.throws(() => deriveTrackFolderStateProjectionV12([{
		id: 'main',
		trackNodes: [
			...admittedNodes,
			{ kind: 'folder', id: overflowFolderId, parentFolderId: admittedFolderIds.at(-1) },
		],
		trackIds: [],
	}], { trackFolders: overflowFolders, tracks: [] }), /depth.*32|maximum.*depth/iu);

	const maximum = TRACK_HIERARCHY_V12_LIMITS.maximumNodes;
	const tracks = Array.from({ length: maximum }, (_, index) => audio(`track-${String(index)}`));
	const nodes = tracks.map(({ id }) => ({ kind: 'track', id, parentFolderId: null }));
	const hierarchy = exactHierarchy(nodes, [], tracks);
	const projection = deriveTrackFolderStateProjectionV12(hierarchy, { trackFolders: [], tracks });
	assert.equal(projection.sequences[0]?.nodes.length, maximum);

	const overflowTrack = audio('overflow');
	assert.throws(() => deriveTrackFolderStateProjectionV12([{
		id: 'main',
		trackNodes: [...nodes, { kind: 'track', id: overflowTrack.id, parentFolderId: null }],
		trackIds: [...tracks.map(({ id }) => id), overflowTrack.id],
	}], { trackFolders: [], tracks: [...tracks, overflowTrack] }), /maximum|exceed|16,?384/iu);

	const route = { groupId: 'dialogue-bus', sends: { reverb: 0.25 } };
	const preservedTracks = [audio('preserved', true, true, { route })];
	const preservedHierarchy = exactHierarchy([
		{ kind: 'track', id: 'preserved', parentFolderId: null },
	], [], preservedTracks);
	const before = structuredClone(preservedTracks);
	const routeReference = preservedTracks[0]?.route;
	deriveTrackFolderStateProjectionV12(preservedHierarchy, { trackFolders: [], tracks: preservedTracks });
	assert.deepEqual(preservedTracks, before);
	assert.strictEqual(preservedTracks[0]?.route, routeReference);
	assert.deepEqual(route, { groupId: 'dialogue-bus', sends: { reverb: 0.25 } });
	assert.equal(Object.isFrozen(route), false);
});
