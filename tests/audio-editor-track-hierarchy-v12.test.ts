/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTrackFoldersV12 } from '../src/common/editor/track-folder-v12.ts';
import {
	TRACK_HIERARCHY_V12_LIMITS,
	createTrackHierarchyV12,
	createTrackNodeV12,
	createTrackNodesV12,
	deriveTrackFolderIdsV12,
	deriveTrackHierarchyOrderV12,
	deriveTrackIdsV12,
	validateTrackHierarchyV12,
	validateTrackNodeV12,
	validateTrackNodesV12,
	type TrackHierarchyTrackMetadataV12,
} from '../src/common/editor/track-hierarchy-v12.ts';

type DataRecord = Record<string, unknown>;

const FOLDER_ORDER = ['mix', 'dialogue', 'empty', 'tail', 'alternate'] as const;
const TRACK_ORDER = ['picture', 'picture-audio', 'boom', 'notes', 'alternate-track'] as const;

function folders(ids: readonly string[] = FOLDER_ORDER) {
	return createTrackFoldersV12(ids.map((id) => ({ id, name: id })));
}

function track(
	id: string,
	type: TrackHierarchyTrackMetadataV12['type'] = 'audio',
	laneGroupId: string | null = null,
): TrackHierarchyTrackMetadataV12 {
	return { id, type, laneGroupId };
}

function tracks(): readonly TrackHierarchyTrackMetadataV12[] {
	return [
		track('picture', 'video', 'picture-lanes'),
		track('picture-audio', 'audio', 'picture-lanes'),
		track('boom'),
		track('notes', 'label'),
		track('alternate-track'),
	];
}

function sequences(includeTrackIds = true): readonly DataRecord[] {
	const main = {
		id: 'main',
		trackNodes: [
			{ kind: 'folder', id: 'mix', parentFolderId: null },
			{ kind: 'track', id: 'picture', parentFolderId: 'mix' },
			{ kind: 'track', id: 'picture-audio', parentFolderId: 'mix' },
			{ kind: 'folder', id: 'dialogue', parentFolderId: 'mix' },
			{ kind: 'track', id: 'boom', parentFolderId: 'dialogue' },
			{ kind: 'folder', id: 'empty', parentFolderId: 'dialogue' },
			{ kind: 'track', id: 'notes', parentFolderId: 'mix' },
			{ kind: 'folder', id: 'tail', parentFolderId: null },
		],
		...(includeTrackIds ? { trackIds: ['picture', 'picture-audio', 'boom', 'notes'] } : {}),
	};
	const alternate = {
		id: 'alternate-sequence',
		trackNodes: [
			{ kind: 'folder', id: 'alternate', parentFolderId: null },
			{ kind: 'track', id: 'alternate-track', parentFolderId: 'alternate' },
		],
		...(includeTrackIds ? { trackIds: ['alternate-track'] } : {}),
	};
	return [main, alternate];
}

function context(
	trackFolders: unknown = folders(),
	trackMetadata: unknown = tracks(),
): Readonly<{ trackFolders: unknown; tracks: unknown }> {
	return { trackFolders, tracks: trackMetadata };
}

test('V12 hierarchy factories canonicalize flat DFS nodes and derive mandatory leaf projections', () => {
	assert.deepEqual(TRACK_HIERARCHY_V12_LIMITS, {
		maximumFolders: 4_096,
		maximumNodes: 16_384,
		maximumSequences: 1_024,
		maximumFolderDepth: 32,
		maximumIdCodeUnits: 256,
	});
	assert.deepEqual(createTrackNodeV12({ kind: 'folder', id: 'root' }), {
		kind: 'folder',
		id: 'root',
		parentFolderId: null,
	});

	const hierarchy = createTrackHierarchyV12(sequences(false), context());
	assert.deepEqual(hierarchy.map(({ trackIds }) => trackIds), [
		['picture', 'picture-audio', 'boom', 'notes'],
		['alternate-track'],
	]);
	assert.equal(Object.isFrozen(hierarchy), true);
	assert.equal(Object.isFrozen(hierarchy[0]), true);
	assert.equal(Object.isFrozen(hierarchy[0]?.trackNodes), true);
	assert.equal(Object.isFrozen(hierarchy[0]?.trackNodes[0]), true);
	assert.equal(Object.isFrozen(hierarchy[0]?.trackIds), true);
	assert.equal(validateTrackHierarchyV12(hierarchy, context()), true);

	assert.deepEqual(deriveTrackIdsV12(hierarchy[0]?.trackNodes), [
		'picture', 'picture-audio', 'boom', 'notes',
	]);
	assert.deepEqual(deriveTrackFolderIdsV12(hierarchy[0]?.trackNodes), [
		'mix', 'dialogue', 'empty', 'tail',
	]);
	const order = deriveTrackHierarchyOrderV12(hierarchy);
	assert.deepEqual(order, {
		folderIds: [...FOLDER_ORDER],
		trackIds: [...TRACK_ORDER],
		sequences: [
			{
				sequenceId: 'main',
				folderIds: ['mix', 'dialogue', 'empty', 'tail'],
				trackIds: ['picture', 'picture-audio', 'boom', 'notes'],
			},
			{
				sequenceId: 'alternate-sequence',
				folderIds: ['alternate'],
				trackIds: ['alternate-track'],
			},
		],
	});
	assert.equal(Object.isFrozen(order), true);
	assert.equal(Object.isFrozen(order.folderIds), true);
	assert.equal(Object.isFrozen(order.sequences[0]), true);
});

test('V12 nodes and sequence projections are closed canonical plain data', () => {
	const node = { kind: 'track', id: 'track-a', parentFolderId: null };
	assert.equal(validateTrackNodeV12(node), true);
	assert.equal(validateTrackNodesV12([node]), true);

	for (const value of [
		null,
		[],
		new Date(),
		Object.assign(Object.create({ inherited: true }) as DataRecord, node),
		{ ...node, extension: true },
		{ ...node, [Symbol('extension')]: true },
		{ kind: 'track', id: 'track-a' },
		{ ...node, kind: 'bus' },
		{ ...node, id: '' },
		{ ...node, id: ' track-a ' },
		{ ...node, id: 'x'.repeat(257) },
		{ ...node, parentFolderId: '' },
		{ ...node, parentFolderId: 'folder\nname' },
	]) {
		assert.throws(() => validateTrackNodeV12(value), /node|kind|id|canonical|length|single-line|missing/iu);
	}

	let getterCalls = 0;
	const accessor = { ...node } as DataRecord;
	Object.defineProperty(accessor, 'id', {
		enumerable: true,
		get() {
			getterCalls += 1;
			return 'track-a';
		},
	});
	assert.throws(() => validateTrackNodeV12(accessor), /id.*data|enumerable data/iu);
	assert.equal(getterCalls, 0);

	const sparse = new Array<unknown>(1);
	const expanded = [node] as unknown[] & Record<string, unknown>;
	expanded.extra = true;
	class NodeArray extends Array<unknown> {}
	for (const value of [sparse, expanded, new NodeArray(node)]) {
		assert.throws(() => validateTrackNodesV12(value), /canonical array|dense|unsupported|array/iu);
	}

	assert.throws(
		() => validateTrackHierarchyV12([{ ...sequences()[0], extension: true }], context()),
		/sequence.*unsupported|unknown/iu,
	);
	assert.throws(
		() => validateTrackHierarchyV12([{ id: 'main', trackNodes: [] }], context([], [])),
		/trackIds|missing/iu,
	);
	assert.throws(
		() => validateTrackHierarchyV12(sequences(), { ...context(), extension: true }),
		/context.*unsupported|unknown/iu,
	);

	const expandedSequences = [...sequences()] as unknown[] & Record<string, unknown>;
	expandedSequences.extra = true;
	class SequenceArray extends Array<unknown> {}
	for (const value of [expandedSequences, new SequenceArray(...sequences())]) {
		assert.throws(
			() => validateTrackHierarchyV12(value, context()),
			/canonical array|unsupported/iu,
		);
	}
	assert.throws(() => validateTrackHierarchyV12([
		{ ...sequences()[0], trackIds: new Array<unknown>(4) },
		sequences()[1],
	], context()), /trackIds.*canonical array|dense canonical/iu);
	assert.throws(() => validateTrackHierarchyV12([
		{ id: 'first', trackNodes: [], trackIds: ['orphan'] },
		{ id: 'later', trackNodes: [], trackIds: [42] },
	], context([], [])), /first.*trackIds.*derived|project\.sequences\[0\].*leaf order/iu,
	'projection drift must reject in its owning sequence before later projection work');
});

test('V12 hierarchy track metadata is a strict minimal plain-data projection', () => {
	const hierarchy = [{
		id: 'main',
		trackNodes: [{ kind: 'track', id: 'leaf', parentFolderId: null }],
		trackIds: ['leaf'],
	}];
	assert.equal(validateTrackHierarchyV12(hierarchy, context([], [{ id: 'leaf', type: 'audio' }])), true);

	for (const metadata of [
		[{ id: 'leaf', type: 'audio', laneGroupId: null, name: 'extra' }],
		[{ id: 'leaf', type: 'audio', laneGroupId: undefined }],
		[{ id: 'leaf', type: 'bus', laneGroupId: null }],
		[{ id: ' leaf ', type: 'audio', laneGroupId: null }],
		[{ id: 'leaf', type: 'audio', laneGroupId: null, [Symbol('extra')]: true }],
	]) {
		assert.throws(
			() => validateTrackHierarchyV12(hierarchy, context([], metadata)),
			/track hierarchy context\.tracks|unsupported|type|canonical|laneGroupId/iu,
		);
	}

	let getterCalls = 0;
	const accessor = { type: 'audio', laneGroupId: null } as DataRecord;
	Object.defineProperty(accessor, 'id', {
		enumerable: true,
		get() {
			getterCalls += 1;
			return 'leaf';
		},
	});
	assert.throws(
		() => validateTrackHierarchyV12(hierarchy, context([], [accessor])),
		/id.*enumerable data|id.*data property/iu,
	);
	assert.equal(getterCalls, 0);
});

test('V12 hierarchy rejects cycles, later parents, track parents, cross-sequence parents, and reopened subtrees', () => {
	function invalidHierarchy(trackNodes: readonly unknown[], expectedFolders: readonly string[] = []): void {
		const trackIds = trackNodes
			.filter((node): node is { kind: 'track'; id: string } => (
				typeof node === 'object' && node !== null && (node as { kind?: unknown }).kind === 'track'
			))
			.map(({ id }) => id);
		const metadata = trackIds.map((id) => track(id));
		assert.throws(
			() => validateTrackHierarchyV12(
				[{ id: 'main', trackNodes, trackIds }],
				context(folders(expectedFolders), metadata),
			),
			/parent|cycle|later|missing|track|cross-sequence|reopen|preorder|duplicate/iu,
		);
	}

	invalidHierarchy([
		{ kind: 'folder', id: 'a', parentFolderId: 'b' },
		{ kind: 'folder', id: 'b', parentFolderId: 'a' },
	], ['a', 'b']);
	invalidHierarchy([
		{ kind: 'folder', id: 'self', parentFolderId: 'self' },
	], ['self']);
	invalidHierarchy([
		{ kind: 'track', id: 'leaf', parentFolderId: 'missing' },
	]);
	invalidHierarchy([
		{ kind: 'track', id: 'parent-track', parentFolderId: null },
		{ kind: 'track', id: 'child-track', parentFolderId: 'parent-track' },
	]);
	invalidHierarchy([
		{ kind: 'folder', id: 'a', parentFolderId: null },
		{ kind: 'folder', id: 'b', parentFolderId: 'a' },
		{ kind: 'track', id: 'closes-b', parentFolderId: 'a' },
		{ kind: 'track', id: 'reopens-b', parentFolderId: 'b' },
	], ['a', 'b']);

	assert.throws(() => validateTrackHierarchyV12([
		{
			id: 'one',
			trackNodes: [{ kind: 'folder', id: 'folder', parentFolderId: null }],
			trackIds: [],
		},
		{
			id: 'two',
			trackNodes: [{ kind: 'track', id: 'leaf', parentFolderId: 'folder' }],
			trackIds: ['leaf'],
		},
	], context(folders(['folder']), [track('leaf')])), /cross-sequence|sequence.*parent/iu);
});

test('V12 hierarchy enforces global disjoint identity, exact ownership, metadata order, and leaf projections', () => {
	assert.throws(
		() => validateTrackHierarchyV12([
			...sequences().slice(0, 1),
			{ id: 'main', trackNodes: [], trackIds: [] },
		], context()),
		/duplicate.*sequence|sequence.*duplicate/iu,
	);
	assert.throws(
		() => validateTrackHierarchyV12([{ id: 'main', trackNodes: [
			{ kind: 'folder', id: 'same', parentFolderId: null },
			{ kind: 'track', id: 'same', parentFolderId: 'same' },
		], trackIds: ['same'] }], context(folders(['same']), [track('same')])),
		/disjoint|duplicate.*same/iu,
	);
	assert.throws(
		() => validateTrackHierarchyV12(sequences(), context(folders([
			'mix', 'empty', 'dialogue', 'tail', 'alternate',
		]), tracks())),
		/folder.*order|preorder/iu,
	);
	assert.throws(
		() => validateTrackHierarchyV12(sequences(), context(folders(), [
			track('picture-audio', 'audio', 'picture-lanes'),
			track('picture', 'video', 'picture-lanes'),
			...tracks().slice(2),
		])),
		/track.*order|preorder/iu,
	);
	assert.throws(
		() => validateTrackHierarchyV12([
			{ ...sequences()[0], trackIds: ['picture', 'boom', 'picture-audio', 'notes'] },
			sequences()[1],
		], context()),
		/trackIds.*derived|leaf.*order/iu,
	);
	assert.throws(
		() => createTrackHierarchyV12([
			{ ...sequences()[0], trackIds: ['picture'] },
			sequences()[1],
		], context()),
		/trackIds.*derived|leaf.*order/iu,
	);
	assert.throws(
		() => validateTrackHierarchyV12(sequences(), context(folders(FOLDER_ORDER.slice(0, -1)), tracks())),
		/every folder|folder.*order|missing/iu,
	);
	assert.throws(
		() => validateTrackHierarchyV12(sequences(), context(folders(), tracks().slice(0, -1))),
		/every track|track.*order|missing/iu,
	);
});

test('V12 folder depth starts at zero, admits depth 32, and rejects depth 33', () => {
	function nested(depth: number): {
		readonly folderIds: readonly string[];
		readonly nodes: readonly DataRecord[];
	} {
		const folderIds = Array.from({ length: depth + 1 }, (_, index) => `folder-${String(index)}`);
		return {
			folderIds,
			nodes: folderIds.map((id, index) => ({
				kind: 'folder',
				id,
				parentFolderId: index === 0 ? null : folderIds[index - 1],
			})),
		};
	}

	const admitted = nested(32);
	assert.equal(validateTrackHierarchyV12([
		{ id: 'main', trackNodes: admitted.nodes, trackIds: [] },
	], context(folders(admitted.folderIds), [])), true);

	const rejected = nested(33);
	assert.throws(() => validateTrackHierarchyV12([
		{ id: 'main', trackNodes: rejected.nodes, trackIds: [] },
	], context(folders(rejected.folderIds), [])), /depth.*32|maximum.*depth/iu);
});

test('V12 hierarchy bounds total node and folder work before graph traversal', () => {
	const maximumNodes = Array.from(
		{ length: TRACK_HIERARCHY_V12_LIMITS.maximumNodes },
		(_, index) => ({ kind: 'track' as const, id: `track-${String(index)}`, parentFolderId: null }),
	);
	assert.equal(createTrackNodesV12(maximumNodes).length, TRACK_HIERARCHY_V12_LIMITS.maximumNodes);
	assert.equal(validateTrackHierarchyV12([
		{ id: 'maximum', trackNodes: maximumNodes, trackIds: maximumNodes.map(({ id }) => id) },
	], context([], maximumNodes.map(({ id }) => track(id)))), true);
	assert.throws(
		() => createTrackNodesV12([...maximumNodes, { kind: 'track', id: 'overflow', parentFolderId: null }]),
		/16,384|16384|maximum/iu,
	);

	const first = maximumNodes.slice(0, 8_193);
	const second = maximumNodes.slice(8_193);
	assert.throws(() => validateTrackHierarchyV12([
		{ id: 'one', trackNodes: first, trackIds: first.map(({ id }) => id) },
		{
			id: 'two',
			trackNodes: [...second, { kind: 'track', id: 'overflow', parentFolderId: null }],
			trackIds: [...second.map(({ id }) => id), 'overflow'],
		},
	], context([], [...maximumNodes.map(({ id }) => track(id)), track('overflow')])), /16,384|16384|maximum/iu);

	const inaccessibleOverflowNode = { kind: 'track', parentFolderId: null } as DataRecord;
	Object.defineProperty(inaccessibleOverflowNode, 'id', {
		enumerable: true,
		get() {
			throw new Error('overflow nodes must not be traversed');
		},
	});
	for (const createOrValidate of [
		() => createTrackHierarchyV12([
			{ id: 'maximum', trackNodes: maximumNodes },
			{ id: 'overflow', trackNodes: [inaccessibleOverflowNode] },
		], context([], [])),
		() => validateTrackHierarchyV12([
			{ id: 'maximum', trackNodes: maximumNodes, trackIds: maximumNodes.map(({ id }) => id) },
			{ id: 'overflow', trackNodes: [inaccessibleOverflowNode], trackIds: ['overflow'] },
		], context([], [])),
	]) {
		assert.throws(createOrValidate, /16,384|16384|total nodes|maximum/iu);
	}
});

test('V12 hierarchy retains the foundation sequence-count boundary', () => {
	for (const createOrValidate of [createTrackHierarchyV12, validateTrackHierarchyV12]) {
		assert.throws(() => createOrValidate([], context([], [])), /sequence|at least one|1/iu);
	}

	const maximum = Array.from(
		{ length: TRACK_HIERARCHY_V12_LIMITS.maximumSequences },
		(_, index) => ({ id: `sequence-${String(index)}`, trackNodes: [], trackIds: [] }),
	);
	assert.equal(validateTrackHierarchyV12(maximum, context([], [])), true);
	assert.throws(
		() => validateTrackHierarchyV12([
			...maximum,
			{ id: 'overflow', trackNodes: [], trackIds: [] },
		], context([], [])),
		/1,024|1024|maximum|sequence/iu,
	);
});

test('V12 lane groups are one adjacent video/audio pair with the same sequence and parent', () => {
	assert.equal(validateTrackHierarchyV12(sequences(), context()), true);

	function laneFailure(
		trackNodes: readonly DataRecord[],
		metadata: readonly TrackHierarchyTrackMetadataV12[],
		folderIds: readonly string[] = ['folder-a', 'folder-b'],
	): void {
		assert.throws(() => validateTrackHierarchyV12([
			{
				id: 'main',
				trackNodes,
				trackIds: trackNodes.filter(({ kind }) => kind === 'track').map(({ id }) => String(id)),
			},
		], context(folders(folderIds), metadata)), /lane group|video.*audio|adjacent|same parent|sequence/iu);
	}

	laneFailure([
		{ kind: 'folder', id: 'folder-a', parentFolderId: null },
		{ kind: 'track', id: 'audio', parentFolderId: 'folder-a' },
		{ kind: 'track', id: 'video', parentFolderId: 'folder-a' },
		{ kind: 'folder', id: 'folder-b', parentFolderId: null },
	], [track('audio', 'audio', 'lanes'), track('video', 'video', 'lanes')]);
	laneFailure([
		{ kind: 'folder', id: 'folder-a', parentFolderId: null },
		{ kind: 'track', id: 'video', parentFolderId: 'folder-a' },
		{ kind: 'folder', id: 'folder-b', parentFolderId: 'folder-a' },
		{ kind: 'track', id: 'audio', parentFolderId: 'folder-a' },
	], [track('video', 'video', 'lanes'), track('audio', 'audio', 'lanes')]);
	laneFailure([
		{ kind: 'folder', id: 'folder-a', parentFolderId: null },
		{ kind: 'track', id: 'video', parentFolderId: 'folder-a' },
		{ kind: 'folder', id: 'folder-b', parentFolderId: null },
		{ kind: 'track', id: 'audio', parentFolderId: 'folder-b' },
	], [track('video', 'video', 'lanes'), track('audio', 'audio', 'lanes')]);
	laneFailure([
		{ kind: 'folder', id: 'folder-a', parentFolderId: null },
		{ kind: 'track', id: 'video', parentFolderId: 'folder-a' },
		{ kind: 'track', id: 'audio-a', parentFolderId: 'folder-a' },
		{ kind: 'track', id: 'audio-b', parentFolderId: 'folder-a' },
		{ kind: 'folder', id: 'folder-b', parentFolderId: null },
	], [
		track('video', 'video', 'lanes'),
		track('audio-a', 'audio', 'lanes'),
		track('audio-b', 'audio', 'lanes'),
	]);
	laneFailure([
		{ kind: 'folder', id: 'folder-a', parentFolderId: null },
		{ kind: 'track', id: 'video', parentFolderId: 'folder-a' },
		{ kind: 'track', id: 'ungrouped-audio', parentFolderId: 'folder-a' },
		{ kind: 'folder', id: 'folder-b', parentFolderId: null },
	], [track('video', 'video', 'lanes'), track('ungrouped-audio')]);

	assert.throws(() => validateTrackHierarchyV12([
		{
			id: 'one',
			trackNodes: [{ kind: 'track', id: 'video', parentFolderId: null }],
			trackIds: ['video'],
		},
		{
			id: 'two',
			trackNodes: [{ kind: 'track', id: 'audio', parentFolderId: null }],
			trackIds: ['audio'],
		},
	], context([], [track('video', 'video', 'lanes'), track('audio', 'audio', 'lanes')])), /lane group.*sequence|same sequence/iu);
});

test('deterministic randomized DFS trees preserve exact derived order and reject closed-folder backrefs', () => {
	let state = 0x51_0d_f0_1d;
	const random = (): number => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state / 0x1_0000_0000;
	};

	for (let round = 0; round < 64; round += 1) {
		const nodes: DataRecord[] = [];
		const folderIds: string[] = [];
		const trackIds: string[] = [];
		let serial = 0;
		const append = (parentFolderId: string | null, depth: number): void => {
			const children = 1 + Math.floor(random() * 4);
			for (let index = 0; index < children; index += 1) {
				const useFolder = depth < 5 && random() < 0.42;
				const id = `${useFolder ? 'folder' : 'track'}-${String(round)}-${String(serial)}`;
				serial += 1;
				nodes.push({ kind: useFolder ? 'folder' : 'track', id, parentFolderId });
				if (useFolder) {
					folderIds.push(id);
					if (random() < 0.8) append(id, depth + 1);
				} else {
					trackIds.push(id);
				}
			}
		};
		append(null, 0);
		const hierarchy = [{ id: `sequence-${String(round)}`, trackNodes: nodes, trackIds }];
		const metadata = trackIds.map((id) => track(id));
		assert.equal(validateTrackHierarchyV12(hierarchy, context(folders(folderIds), metadata)), true);
		assert.deepEqual(deriveTrackHierarchyOrderV12(hierarchy).folderIds, folderIds);
		assert.deepEqual(deriveTrackHierarchyOrderV12(hierarchy).trackIds, trackIds);

		const firstFolderIndex = nodes.findIndex(({ kind }) => kind === 'folder');
		if (firstFolderIndex < 0) continue;
		const firstFolderId = String(nodes[firstFolderIndex]?.id);
		const rootCloserId = `root-closer-${String(round)}`;
		const backrefId = `backref-${String(round)}`;
		const closed = [
			...nodes,
			{ kind: 'track', id: rootCloserId, parentFolderId: null },
			{ kind: 'track', id: backrefId, parentFolderId: firstFolderId },
		];
		assert.throws(() => validateTrackHierarchyV12([
			{
				id: `sequence-${String(round)}`,
				trackNodes: closed,
				trackIds: [...trackIds, rootCloserId, backrefId],
			},
		], context(folders(folderIds), [
			...metadata,
			track(rootCloserId),
			track(backrefId),
		])), /back|reopen|preorder|active parent/iu);
	}
});
