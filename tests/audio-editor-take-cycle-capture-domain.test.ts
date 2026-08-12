/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	planExactTakeCycleCapture,
} from '../src/common/editor/take-cycle-capture-domain.ts';

function request(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		groupId: 'group-cycle',
		laneId: 'lane-cycle',
		loopStartSample: 100,
		loopEndSample: 200,
		captureSpans: [
			{ startSample: 100, endSample: 150 },
			{ startSample: 150, endSample: 260 },
			{ startSample: 260, endSample: 330 },
		],
		takeIds: ['take-1', 'take-2', 'take-3'],
		interrupted: true,
		...overrides,
	};
}

test('cycle capture partitions incoming spans at exact loop boundaries and preserves a partial pass', () => {
	const plan = planExactTakeCycleCapture(request());

	assert.deepEqual(plan, {
		kind: 'exact-take-cycle-capture',
		groupId: 'group-cycle', laneId: 'lane-cycle',
		loopStartSample: 100, loopEndSample: 200, loopSampleCount: 100,
		captureStartSample: 100, captureEndSample: 330, interrupted: true,
		passes: [
			{
				passIndex: 0, takeId: 'take-1',
				captureStartSample: 100, captureEndSample: 200,
				timelineStartSample: 100, timelineEndSample: 200,
				complete: true, interrupted: false,
				fragments: [
					{ spanIndex: 0, captureStartSample: 100, captureEndSample: 150, timelineStartSample: 100, timelineEndSample: 150 },
					{ spanIndex: 1, captureStartSample: 150, captureEndSample: 200, timelineStartSample: 150, timelineEndSample: 200 },
				],
			},
			{
				passIndex: 1, takeId: 'take-2',
				captureStartSample: 200, captureEndSample: 300,
				timelineStartSample: 100, timelineEndSample: 200,
				complete: true, interrupted: false,
				fragments: [
					{ spanIndex: 1, captureStartSample: 200, captureEndSample: 260, timelineStartSample: 100, timelineEndSample: 160 },
					{ spanIndex: 2, captureStartSample: 260, captureEndSample: 300, timelineStartSample: 160, timelineEndSample: 200 },
				],
			},
			{
				passIndex: 2, takeId: 'take-3',
				captureStartSample: 300, captureEndSample: 330,
				timelineStartSample: 100, timelineEndSample: 130,
				complete: false, interrupted: true,
				fragments: [
					{ spanIndex: 2, captureStartSample: 300, captureEndSample: 330, timelineStartSample: 100, timelineEndSample: 130 },
				],
			},
		],
	});
	assert.equal(Object.isFrozen(plan), true);
	assert.equal(Object.isFrozen(plan.passes), true);
	assert.equal(Object.isFrozen(plan.passes[0]), true);
	assert.equal(Object.isFrozen(plan.passes[0]?.fragments), true);
	assert.equal(Object.isFrozen(plan.passes[0]?.fragments[0]), true);
});

test('every complete pass reuses the exact loop grid without cumulative drift', () => {
	const loopStartSample = 8_000_000_000_001;
	const loopEndSample = loopStartSample + 48_001;
	const captureEndSample = loopStartSample + 48_001 * 3;
	const plan = planExactTakeCycleCapture(request({
		loopStartSample,
		loopEndSample,
		captureSpans: [
			{ startSample: loopStartSample, endSample: loopStartSample + 17 },
			{ startSample: loopStartSample + 17, endSample: loopStartSample + 96_003 },
			{ startSample: loopStartSample + 96_003, endSample: captureEndSample },
		],
		takeIds: ['take-1', 'take-2', 'take-3'],
		interrupted: false,
	}));

	assert.deepEqual(plan.passes.map((pass) => ({
		captureStartSample: pass.captureStartSample,
		captureEndSample: pass.captureEndSample,
		timelineStartSample: pass.timelineStartSample,
		timelineEndSample: pass.timelineEndSample,
		complete: pass.complete,
	})), [0, 1, 2].map((passIndex) => ({
		captureStartSample: loopStartSample + 48_001 * passIndex,
		captureEndSample: loopStartSample + 48_001 * (passIndex + 1),
		timelineStartSample: loopStartSample,
		timelineEndSample: loopEndSample,
		complete: true,
	})));
	assert.equal(plan.captureEndSample, captureEndSample);
});

test('a partial final pass is accepted only as an explicit interruption', () => {
	assert.throws(
		() => planExactTakeCycleCapture(request({ interrupted: false })),
		/partial cycle pass requires interrupted=true/u,
	);
	const exactInterrupted = planExactTakeCycleCapture(request({
		captureSpans: [{ startSample: 100, endSample: 300 }],
		takeIds: ['take-1', 'take-2'],
		interrupted: true,
	}));
	assert.equal(exactInterrupted.passes.at(-1)?.complete, true);
	assert.equal(exactInterrupted.passes.at(-1)?.interrupted, false);
});

test('caller-supplied group, lane, and take identities are canonical, unique, and exact in count', () => {
	assert.throws(
		() => planExactTakeCycleCapture(request({ groupId: ' group-cycle' })),
		/canonical non-empty string/u,
	);
	assert.throws(
		() => planExactTakeCycleCapture(request({ laneId: 'group-cycle' })),
		/groupId and laneId must be distinct/u,
	);
	assert.throws(
		() => planExactTakeCycleCapture(request({ takeIds: ['take-1', 'take-1', 'take-3'] })),
		/Duplicate cycle take ID take-1/u,
	);
	assert.throws(
		() => planExactTakeCycleCapture(request({ takeIds: ['group-cycle', 'take-2', 'take-3'] })),
		/collides with cycle group or lane identity/u,
	);
	assert.throws(
		() => planExactTakeCycleCapture(request({ takeIds: ['take-1', 'take-2'] })),
		/requires exactly 3 caller-supplied take IDs/u,
	);
	assert.throws(
		() => planExactTakeCycleCapture(request({ takeIds: ['take-1', 'take-2', 'take-3', 'take-4'] })),
		/requires exactly 3 caller-supplied take IDs/u,
	);
});

test('capture spans form one positive contiguous stream beginning at the loop boundary', () => {
	for (const [captureSpans, message] of [
		[[], /at least one incoming capture span/u],
		[[{ startSample: 101, endSample: 150 }], /must begin at loopStartSample/u],
		[[{ startSample: 100, endSample: 100 }], /positive extent/u],
		[[
			{ startSample: 100, endSample: 150 },
			{ startSample: 151, endSample: 200 },
		], /must be contiguous/u],
	] as const) {
		assert.throws(() => planExactTakeCycleCapture(request({ captureSpans })), message);
	}
	assert.throws(
		() => planExactTakeCycleCapture(request({ loopEndSample: 100 })),
		/loop extent must be positive/u,
	);
	assert.throws(
		() => planExactTakeCycleCapture(request({ loopEndSample: Number.MAX_SAFE_INTEGER + 1 })),
		/safe integer/u,
	);
});

test('planning snapshots caller arrays and records without mutation or aliasing', () => {
	const mutable = request();
	const plan = planExactTakeCycleCapture(mutable);
	((mutable.captureSpans as Record<string, unknown>[])[1]!).endSample = 151;
	(mutable.takeIds as string[])[0] = 'changed';
	assert.equal(plan.passes[0]?.fragments[1]?.captureEndSample, 200);
	assert.equal(plan.passes[0]?.takeId, 'take-1');
});
