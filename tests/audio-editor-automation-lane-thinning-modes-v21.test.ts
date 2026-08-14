/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	commitAutomationWriteModeV21,
	resolveAutomationWriteModeV21,
	type AutomationWriteModeV21,
	type AutomationWritePhaseV21,
} from '../src/common/editor/automation-write-mode-v21.ts';
import { thinAutomationLaneCaptureV21 } from '../src/common/editor/automation-lane-thinning-v21.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import type { InterpolationShape } from '../src/common/editor/interpolation-curve.ts';

const ADDRESS = {
	kind: 'strip' as const,
	strip: { kind: 'track' as const, id: 'track-1' },
	parameterId: 'gain' as const,
};

function capture(
	values: readonly number[],
	segments: readonly InterpolationShape[] = Array.from(
		{ length: Math.max(0, values.length - 1) },
		() => ({ kind: 'linear' as const }),
	),
) {
	return {
		id: 'gain-lane',
		address: ADDRESS,
		timebase: 'absolute-samples' as const,
		points: values.map((value, index) => ({ id: `point-${String(index)}`, position: index, value })),
		segments,
	};
}

test('adaptive commit thinning is deterministic and retains endpoints and the highest-error extremum', () => {
	const values = Array.from({ length: 5_000 }, (_, index) => (
		index === 2_501 ? 1 : Math.sin(index / 200) * 0.01
	));
	const options = { maximumPoints: 16, automationTolerance: 0.01 };
	const first = thinAutomationLaneCaptureV21(capture(values), options);
	const second = thinAutomationLaneCaptureV21(capture(values), options);

	assert.deepEqual(second, first);
	assert.ok(first.points.length <= 16);
	assert.equal(first.points[0]?.id, 'point-0');
	assert.equal(first.points.at(-1)?.id, 'point-4999');
	assert.ok(first.points.some(({ id }) => id === 'point-2501'));
	assert.ok(first.points.every((point) => Object.isFrozen(point)));
});

test('thinning preserves discontinuities and shape-mode boundaries and refuses an irreducible cap', () => {
	const segments = [
		{ kind: 'linear' as const },
		{ kind: 'linear' as const },
		{ kind: 'hold' as const },
		{ kind: 'eased' as const },
		{ kind: 'eased' as const },
	];
	const thinned = thinAutomationLaneCaptureV21(capture([0, 0.1, 0.2, 0.9, 0.8, 1], segments), {
		maximumPoints: 5,
		automationTolerance: 0.2,
	});
	const ids = thinned.points.map(({ id }) => id);
	assert.ok(ids.includes('point-2'), 'the left side of a held discontinuity is retained');
	assert.ok(ids.includes('point-3'), 'the jump and hold/eased boundary is retained');
	assert.deepEqual(normalizeAutomationLaneV21(thinned), thinned);
	assert.throws(
		() => thinAutomationLaneCaptureV21(capture([0, 1, 0, 1], [
			{ kind: 'hold' }, { kind: 'hold' }, { kind: 'hold' },
		]), { maximumPoints: 3 }),
		/irreducible|discontinuit|cap/iu,
	);
});

test('thinning breaks equal-error ties by earlier capture order and refuses unmet tolerance', () => {
	const tied = thinAutomationLaneCaptureV21(capture([0, 1, 0, 1, 0]), {
		maximumPoints: 3,
		automationTolerance: 0.8,
	});
	assert.deepEqual(tied.points.map(({ id }) => id), ['point-0', 'point-1', 'point-4']);
	assert.throws(() => thinAutomationLaneCaptureV21(capture([0, 1, 0]), {
		maximumPoints: 2,
		automationTolerance: 0.1,
	}), /tolerance.*cap|cap.*tolerance/iu);
});

test('the read/trim/touch/latch/write matrix has explicit pure playback ownership', () => {
	const modes: readonly AutomationWriteModeV21[] = ['read', 'trim', 'touch', 'latch', 'write'];
	const phases: readonly AutomationWritePhaseV21[] = ['readback', 'gesture', 'after-gesture'];
	const actual = Object.fromEntries(modes.map((mode) => [mode, Object.fromEntries(phases.map((phase) => {
		const decision = resolveAutomationWriteModeV21(mode, phase);
		assert.ok(Object.isFrozen(decision));
		return [phase, `${decision.owner}:${String(decision.capture)}`];
	}))]));
	assert.deepEqual(actual, {
		read: { readback: 'lane:false', gesture: 'lane:false', 'after-gesture': 'lane:false' },
		trim: { readback: 'lane:false', gesture: 'trimmed-lane:true', 'after-gesture': 'lane:false' },
		touch: { readback: 'lane:false', gesture: 'control:true', 'after-gesture': 'lane:false' },
		latch: { readback: 'lane:false', gesture: 'control:true', 'after-gesture': 'control:true' },
		write: { readback: 'control:true', gesture: 'control:true', 'after-gesture': 'control:true' },
	});
});

test('each mode produces at most one deeply immutable capture commit', () => {
	const lane = normalizeAutomationLaneV21(capture([0, 0.5, 1]));
	const samples = [
		{ id: 'capture-0', position: 10, phase: 'readback' as const, laneValue: 0.1, controlValue: 0.9, trimDelta: 0.2 },
		{ id: 'capture-1', position: 20, phase: 'gesture' as const, laneValue: 0.2, controlValue: 0.8, trimDelta: 0.2 },
		{ id: 'capture-2', position: 30, phase: 'after-gesture' as const, laneValue: 0.3, controlValue: 0.7, trimDelta: 0.2 },
	];
	const expected = {
		read: [] as number[],
		trim: [0, 0.5, 1, 0.4],
		touch: [0, 0.5, 1, 0.8],
		latch: [0, 0.5, 1, 0.8, 0.7],
		write: [0, 0.5, 1, 0.9, 0.7],
	};
	for (const mode of Object.keys(expected) as AutomationWriteModeV21[]) {
		const result = commitAutomationWriteModeV21(lane, mode, samples);
		assert.equal(result.type, 'automation-write-commit-v21');
		assert.equal(result.mode, mode);
		assert.equal(result.changed, expected[mode].length > 0);
		assert.deepEqual(result.capture?.points.map(({ value }) => value) ?? [], expected[mode]);
		assertDeepFrozen(result);
	}
});

test('partial trim, touch, latch, and write commits preserve every anchor outside the capture interval', () => {
	const lane = normalizeAutomationLaneV21({
		id: 'partial-lane',
		address: ADDRESS,
		timebase: 'absolute-samples',
		points: [
			{ id: 'outside-before-0', position: 0, value: 0 },
			{ id: 'outside-before-1', position: 100, value: 0.25 },
			{ id: 'outside-after-0', position: 200, value: 0.75 },
			{ id: 'outside-after-1', position: 300, value: 1 },
		],
		segments: [{ kind: 'hold' }, { kind: 'eased' }, { kind: 'linear' }],
	});
	for (const mode of ['trim', 'touch', 'latch', 'write'] as const) {
		const result = commitAutomationWriteModeV21(lane, mode, [
			{
				id: `${mode}-start`, position: 120, phase: 'gesture',
				laneValue: 0.35, controlValue: 0.6, trimDelta: 0.2,
			},
			{
				id: `${mode}-end`, position: 180,
				phase: mode === 'trim' || mode === 'touch' ? 'gesture' : 'after-gesture',
				laneValue: 0.65, controlValue: 0.4, trimDelta: 0.2,
			},
		]);
		assert.equal(result.changed, true, mode);
		assert.deepEqual(result.capture?.points.map(({ id }) => id), [
			'outside-before-0', 'outside-before-1', `${mode}-start`, `${mode}-end`,
			'outside-after-0', 'outside-after-1',
		], mode);
		assert.deepEqual(
			result.capture?.segments.slice(0, 1),
			lane.segments.slice(0, 1),
			`${mode} keeps the untouched prefix curve`,
		);
		assert.deepEqual(
			result.capture?.segments.slice(-1),
			lane.segments.slice(-1),
			`${mode} keeps the untouched suffix curve`,
		);
	}
});

test('write-mode commit refuses non-monotonic capture instead of sorting across a seek or loop', () => {
	const lane = normalizeAutomationLaneV21(capture([0, 0.5, 1]));
	assert.throws(() => commitAutomationWriteModeV21(lane, 'write', [
		{ id: 'before-seek', position: 200, phase: 'gesture', laneValue: 1, controlValue: 0.5, trimDelta: 0 },
		{ id: 'after-seek', position: 100, phase: 'gesture', laneValue: 1, controlValue: 0.25, trimDelta: 0 },
	]), /non-monotonic|seek|loop|backward/iu);
});

test('discrete parameter capture retains canonical held segments', () => {
	const address = {
		kind: 'strip' as const,
		strip: { kind: 'track' as const, id: 'track-1' },
		parameterId: 'mute' as const,
	};
	const descriptor = stripParameterDescriptor(address);
	const lane = normalizeAutomationLaneV21({
		id: 'mute-lane', address, timebase: 'absolute-samples',
		points: [{ id: 'mute-start', position: 0, value: 0 }], segments: [],
	}, { descriptor });
	const result = commitAutomationWriteModeV21(lane, 'write', [
		{ id: 'capture-0', position: 10, phase: 'gesture', laneValue: 0, controlValue: 1, trimDelta: 0 },
		{ id: 'capture-1', position: 20, phase: 'after-gesture', laneValue: 0, controlValue: 0, trimDelta: 0 },
	], { descriptor });
	assert.deepEqual(result.capture?.segments, [{ kind: 'hold' }, { kind: 'hold' }]);
});

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
	if (!value || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);
	assert.equal(Object.isFrozen(value), true);
	for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}
