/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	TAKE_COMP_MAXIMUM_ID_CHARACTERS,
	normalizeTakeCompGroup,
	planCompRegionBoundaryEdit,
	planSharedCompBoundaryEdit,
	planTakeAudition,
	planTakeCompFlatten,
	planTakePromotion,
} from '../src/common/editor/take-comp-domain.ts';

type MutableRecord = Record<string, unknown>;

function fixture(overrides: MutableRecord = {}): MutableRecord {
	return {
		id: 'group-1',
		startSample: 100,
		endSample: 500,
		laneOrder: ['lane-b', 'lane-a'],
		lanes: [{ id: 'lane-a' }, { id: 'lane-b' }],
		takes: [
			{ id: 'take-c', laneId: 'lane-a' },
			{ id: 'take-a', laneId: 'lane-a' },
			{ id: 'take-b', laneId: 'lane-b' },
		],
		compRegions: [
			{ id: 'region-a', takeId: 'take-a', startSample: 100, endSample: 200 },
			{ id: 'region-b', takeId: 'take-b', startSample: 250, endSample: 400 },
			{ id: 'region-c', takeId: 'take-c', startSample: 400, endSample: 500 },
		],
		...overrides,
	};
}

test('normalization captures canonical stable identities and authoritative lane order', () => {
	const source = fixture();
	const group = normalizeTakeCompGroup(source);

	assert.deepEqual(group, {
		id: 'group-1', startSample: 100, endSample: 500,
		laneOrder: ['lane-b', 'lane-a'],
		lanes: [{ id: 'lane-b' }, { id: 'lane-a' }],
		takes: [
			{ id: 'take-b', laneId: 'lane-b' },
			{ id: 'take-a', laneId: 'lane-a' },
			{ id: 'take-c', laneId: 'lane-a' },
		],
		compRegions: [
			{ id: 'region-a', takeId: 'take-a', startSample: 100, endSample: 200 },
			{ id: 'region-b', takeId: 'take-b', startSample: 250, endSample: 400 },
			{ id: 'region-c', takeId: 'take-c', startSample: 400, endSample: 500 },
		],
	});
	assert.equal(Object.isFrozen(group), true);
	assert.equal(Object.isFrozen(group.laneOrder), true);
	assert.equal(Object.isFrozen(group.lanes), true);
	assert.equal(Object.isFrozen(group.lanes[0]), true);
	assert.equal(Object.isFrozen(group.takes), true);
	assert.equal(Object.isFrozen(group.compRegions), true);

	(source.lanes as MutableRecord[])[0]!.id = 'changed-lane';
	(source.takes as MutableRecord[])[0]!.id = 'changed-take';
	assert.equal(group.lanes[1]?.id, 'lane-a');
	assert.equal(group.takes[2]?.id, 'take-c');
});

test('stable IDs are canonical, length-bounded, and unique across the group graph', () => {
	assert.throws(
		() => normalizeTakeCompGroup(fixture({ id: ' group-1' })),
		/canonical non-empty string/u,
	);
	assert.throws(
		() => normalizeTakeCompGroup(fixture({ id: 'x'.repeat(TAKE_COMP_MAXIMUM_ID_CHARACTERS + 1) })),
		/exceed 160 characters/u,
	);
	assert.throws(
		() => normalizeTakeCompGroup(fixture({
			lanes: [{ id: 'lane-a' }, { id: 'lane-a' }],
		})),
		/Duplicate take lane ID lane-a/u,
	);
	assert.throws(
		() => normalizeTakeCompGroup(fixture({
			takes: [{ id: 'lane-a', laneId: 'lane-a' }],
			compRegions: [],
		})),
		/Duplicate domain identity lane-a/u,
	);
	assert.throws(
		() => normalizeTakeCompGroup(fixture({
			compRegions: [
				{ id: 'region-a', takeId: 'take-a', startSample: 100, endSample: 200 },
				{ id: 'region-a', takeId: 'take-b', startSample: 250, endSample: 400 },
			],
		})),
		/Duplicate comp region ID region-a/u,
	);
});

test('lane order is a unique exact inventory and all takes have valid lane membership', () => {
	for (const [laneOrder, message] of [
		[['lane-a', 'lane-a'], /laneOrder cannot contain duplicate lane ID lane-a/u],
		[['lane-a'], /laneOrder must contain every take lane exactly once/u],
		[['lane-a', 'lane-b', 'missing'], /laneOrder references missing take lane missing/u],
	] as const) {
		assert.throws(() => normalizeTakeCompGroup(fixture({ laneOrder })), message);
	}
	assert.throws(
		() => normalizeTakeCompGroup(fixture({
			takes: [{ id: 'orphan', laneId: 'missing-lane' }],
		})),
		/Take orphan references missing lane missing-lane/u,
	);
	assert.throws(
		() => normalizeTakeCompGroup(fixture({ lanes: [], laneOrder: [] })),
		/at least one take lane/u,
	);
});

test('comp regions reference member takes and remain ordered, positive, non-overlapping, and in extent', () => {
	assert.throws(
		() => normalizeTakeCompGroup(fixture({
			compRegions: [{ id: 'region-x', takeId: 'missing', startSample: 100, endSample: 200 }],
		})),
		/Comp region region-x references missing take missing/u,
	);
	for (const [compRegions, message] of [
		[[
			{ id: 'later', takeId: 'take-a', startSample: 300, endSample: 400 },
			{ id: 'earlier', takeId: 'take-b', startSample: 100, endSample: 200 },
		], /ordered by startSample/u],
		[[
			{ id: 'first', takeId: 'take-a', startSample: 100, endSample: 300 },
			{ id: 'overlap', takeId: 'take-b', startSample: 250, endSample: 400 },
		], /must not overlap/u],
		[[{ id: 'empty', takeId: 'take-a', startSample: 200, endSample: 200 }], /positive extent/u],
		[[{ id: 'before', takeId: 'take-a', startSample: 99, endSample: 200 }], /within take group group-1/u],
		[[{ id: 'after', takeId: 'take-a', startSample: 400, endSample: 501 }], /within take group group-1/u],
	] as const) {
		assert.throws(() => normalizeTakeCompGroup(fixture({ compRegions })), message);
	}
	assert.throws(
		() => normalizeTakeCompGroup(fixture({ endSample: Number.MAX_SAFE_INTEGER + 1 })),
		/safe integer/u,
	);
});

test('audition planning resolves a take and lane without mutating domain state', () => {
	const group = normalizeTakeCompGroup(fixture());
	const plan = planTakeAudition(group, 'take-c');

	assert.deepEqual(plan, {
		kind: 'audition-take', groupId: 'group-1', takeId: 'take-c', laneId: 'lane-a',
		startSample: 100, endSample: 500,
	});
	assert.equal(Object.isFrozen(plan), true);
	assert.deepEqual(group.compRegions.map(({ id }) => id), ['region-a', 'region-b', 'region-c']);
	assert.throws(() => planTakeAudition(group, 'missing'), /does not belong to take group group-1/u);
});

test('promotion deterministically replaces a range and uses an explicit identity for a split remainder', () => {
	const group = normalizeTakeCompGroup(fixture({
		compRegions: [
			{ id: 'original', takeId: 'take-a', startSample: 100, endSample: 500 },
		],
	}));
	const plan = planTakePromotion(group, {
		takeId: 'take-b', regionId: 'promoted', startSample: 200, endSample: 300,
		rightRemainderRegionId: 'original-right',
	});

	assert.equal(plan.kind, 'promote-take');
	assert.equal(plan.laneId, 'lane-b');
	assert.deepEqual(plan.promotedRegion, {
		id: 'promoted', takeId: 'take-b', startSample: 200, endSample: 300,
	});
	assert.deepEqual(plan.nextGroup.compRegions, [
		{ id: 'original', takeId: 'take-a', startSample: 100, endSample: 200 },
		{ id: 'promoted', takeId: 'take-b', startSample: 200, endSample: 300 },
		{ id: 'original-right', takeId: 'take-a', startSample: 300, endSample: 500 },
	]);
	assert.deepEqual(group.compRegions, [
		{ id: 'original', takeId: 'take-a', startSample: 100, endSample: 500 },
	]);
	assert.equal(Object.isFrozen(plan), true);
	assert.equal(Object.isFrozen(plan.nextGroup), true);

	assert.throws(
		() => planTakePromotion(group, {
			takeId: 'take-b', regionId: 'promoted', startSample: 200, endSample: 300,
		}),
		/rightRemainderRegionId is required/u,
	);
	assert.throws(
		() => planTakePromotion(group, { takeId: 'take-b', regionId: 'take-a' }),
		/collides with domain identity take-a/u,
	);

	const wholeGroup = planTakePromotion(group, { takeId: 'take-c', regionId: 'whole' });
	assert.deepEqual(wholeGroup.nextGroup.compRegions, [
		{ id: 'whole', takeId: 'take-c', startSample: 100, endSample: 500 },
	]);
});

test('region-edge and shared-boundary planners preserve the comp ordering invariants', () => {
	const group = normalizeTakeCompGroup(fixture({
		compRegions: [
			{ id: 'left', takeId: 'take-a', startSample: 100, endSample: 250 },
			{ id: 'right', takeId: 'take-b', startSample: 250, endSample: 500 },
		],
	}));
	const shared = planSharedCompBoundaryEdit(group, {
		leftRegionId: 'left', rightRegionId: 'right', boundarySample: 300,
	});
	assert.deepEqual(shared.nextGroup.compRegions, [
		{ id: 'left', takeId: 'take-a', startSample: 100, endSample: 300 },
		{ id: 'right', takeId: 'take-b', startSample: 300, endSample: 500 },
	]);
	assert.deepEqual(
		{ previousBoundarySample: shared.previousBoundarySample, boundarySample: shared.boundarySample },
		{ previousBoundarySample: 250, boundarySample: 300 },
	);

	const edge = planCompRegionBoundaryEdit(group, {
		regionId: 'left', edge: 'end', boundarySample: 225,
	});
	assert.deepEqual(edge.nextGroup.compRegions, [
		{ id: 'left', takeId: 'take-a', startSample: 100, endSample: 225 },
		{ id: 'right', takeId: 'take-b', startSample: 250, endSample: 500 },
	]);
	assert.throws(
		() => planCompRegionBoundaryEdit(group, {
			regionId: 'left', edge: 'end', boundarySample: 300,
		}),
		/must not overlap/u,
	);
	assert.throws(
		() => planSharedCompBoundaryEdit(normalizeTakeCompGroup(fixture()), {
			leftRegionId: 'region-a', rightRegionId: 'region-b', boundarySample: 225,
		}),
		/must share one boundary/u,
	);
});

test('flatten planning is explicit, deterministic, exact over the group extent, and reversibly snapshotted', () => {
	const mutable = fixture();
	const first = planTakeCompFlatten(mutable, { operationId: 'flatten-1', outputId: 'output-1' });
	const second = planTakeCompFlatten(fixture(), { operationId: 'flatten-1', outputId: 'output-1' });

	assert.deepEqual(first, second);
	assert.deepEqual(first, {
		kind: 'flatten-take-comp',
		operationId: 'flatten-1', outputId: 'output-1', groupId: 'group-1',
		startSample: 100, endSample: 500,
		segments: [
			{ kind: 'take', compRegionId: 'region-a', takeId: 'take-a', laneId: 'lane-a', startSample: 100, endSample: 200 },
			{ kind: 'silence', startSample: 200, endSample: 250 },
			{ kind: 'take', compRegionId: 'region-b', takeId: 'take-b', laneId: 'lane-b', startSample: 250, endSample: 400 },
			{ kind: 'take', compRegionId: 'region-c', takeId: 'take-c', laneId: 'lane-a', startSample: 400, endSample: 500 },
		],
		preFlattenSnapshot: normalizeTakeCompGroup(fixture()),
	});
	assert.equal(Object.isFrozen(first), true);
	assert.equal(Object.isFrozen(first.segments), true);
	assert.equal(Object.isFrozen(first.segments[0]), true);
	assert.equal(Object.isFrozen(first.preFlattenSnapshot), true);

	(mutable.takes as MutableRecord[])[0]!.id = 'mutated-after-plan';
	(mutable.compRegions as MutableRecord[])[0]!.endSample = 150;
	assert.equal(first.preFlattenSnapshot.takes[2]?.id, 'take-c');
	assert.equal(first.preFlattenSnapshot.compRegions[0]?.endSample, 200);

	assert.throws(
		() => planTakeCompFlatten(fixture(), { operationId: 'group-1', outputId: 'output-1' }),
		/collides with domain identity group-1/u,
	);
	assert.throws(
		() => planTakeCompFlatten(fixture(), { operationId: 'same', outputId: 'same' }),
		/operationId and outputId must be distinct/u,
	);
});
