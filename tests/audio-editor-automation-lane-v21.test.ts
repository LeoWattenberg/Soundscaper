/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUTOMATION_LANE_MAXIMUM_POINTS_V21,
	assertAutomationLaneIdentitiesUniqueV21,
	evaluateAutomationLaneAtFrameV21,
	normalizeAutomationLaneV21,
	resolveAutomationLanePointFramesV21,
} from '../src/common/editor/automation-lane-v21.ts';
import {
	canonicalParameterAddressKey,
	type ParameterAddress,
	type ParameterDescriptor,
} from '../src/common/editor/parameter-address.ts';

const ADDRESS: ParameterAddress = Object.freeze({
	kind: 'strip',
	strip: Object.freeze({ kind: 'track', id: 'track-1' }),
	parameterId: 'gain',
});

const DESCRIPTOR: ParameterDescriptor = Object.freeze({
	id: canonicalParameterAddressKey(ADDRESS),
	address: ADDRESS,
	unit: 'linear',
	minimum: 0,
	maximum: 2,
	defaultValue: 1,
	step: null,
	taper: 'linear',
	automationTolerance: 0.000_1,
	automatable: true,
	latencyFrames: 0,
	tailFrames: 0,
});

const rational = (num: number, den = 1) => ({ num, den });

function sampleLane(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		id: 'gain-lane',
		address: ADDRESS,
		timebase: 'absolute-samples',
		points: [
			{ id: 'point-0', position: 0, value: 0 },
			{ id: 'point-1', position: 100, value: 1 },
			{ id: 'point-2', position: 200, value: 2 },
			{ id: 'point-3', position: 300, value: 0 },
			{ id: 'point-4', position: 400, value: 1 },
		],
		segments: [
			{ kind: 'hold' },
			{ kind: 'linear' },
			{ kind: 'eased' },
			{
				kind: 'bezier',
				control1: { position: rational(1_000, 3), value: 0.25 },
				control2: { position: rational(1_100, 3), value: 0.75 },
			},
		],
		...overrides,
	};
}

test('V21 lane normalization detaches, freezes, and evaluates the shared curve vocabulary deterministically', () => {
	const input = sampleLane();
	const before = structuredClone(input);
	const lane = normalizeAutomationLaneV21(input, { descriptor: DESCRIPTOR });

	assert.deepEqual(input, before);
	assertDeepFrozen(lane);
	assert.deepEqual(normalizeAutomationLaneV21(lane, { descriptor: DESCRIPTOR }), lane);
	assert.notStrictEqual(normalizeAutomationLaneV21(lane, { descriptor: DESCRIPTOR }), lane);
	assert.equal(evaluateAutomationLaneAtFrameV21(lane, 50, { sampleRate: 48_000 }), 0);
	assert.equal(evaluateAutomationLaneAtFrameV21(lane, 150, { sampleRate: 48_000 }), 1.5);
	assert.equal(evaluateAutomationLaneAtFrameV21(lane, 250, { sampleRate: 48_000 }), 1);
	assert.equal(evaluateAutomationLaneAtFrameV21(lane, 350, { sampleRate: 48_000 }), 0.5);
	assert.equal(evaluateAutomationLaneAtFrameV21(lane, 350, { sampleRate: 48_000 }), 0.5);

	(input.points[0] as { value: number }).value = 2;
	assert.equal(evaluateAutomationLaneAtFrameV21(lane, 50, { sampleRate: 48_000 }), 0);
});

test('musical lanes resolve through the authoritative hold tempo map without normalized time', () => {
	const tempoMap = {
		mode: 'musical' as const,
		events: [
			{ beat: rational(0), bpm: rational(120) },
			{ beat: rational(4), bpm: rational(60) },
		],
	};
	const lane = normalizeAutomationLaneV21({
		id: 'musical-gain',
		address: ADDRESS,
		timebase: 'musical-beats',
		points: [
			{ id: 'beat-0', position: rational(0), value: 0 },
			{ id: 'beat-4', position: rational(4), value: 1 },
			{ id: 'beat-5', position: rational(5), value: 0 },
		],
		segments: [{ kind: 'linear' }, { kind: 'linear' }],
	}, { descriptor: DESCRIPTOR });

	assert.deepEqual(resolveAutomationLanePointFramesV21(lane, {
		sampleRate: 100,
		tempoMap,
	}), [
		{ id: 'beat-0', frame: 0, value: 0 },
		{ id: 'beat-4', frame: 200, value: 1 },
		{ id: 'beat-5', frame: 300, value: 0 },
	]);
	assert.equal(evaluateAutomationLaneAtFrameV21(lane, 100, { sampleRate: 100, tempoMap }), 0.5);
	assert.equal(evaluateAutomationLaneAtFrameV21(lane, 250, { sampleRate: 100, tempoMap }), 0.5);
	assert.equal(evaluateAutomationLaneAtFrameV21(lane, 250, { sampleRate: 100, tempoMap }), 0.5);
	assert.throws(() => normalizeAutomationLaneV21({
		...lane,
		timebase: 'normalized',
	}), /timebase|absolute-samples|musical-beats/iu);
	assert.throws(() => normalizeAutomationLaneV21({
		...lane,
		points: [{ ...lane.points[0], normalizedPosition: 0 }, ...lane.points.slice(1)],
	}), /unsupported field/iu);
});

test('the exact 4096-point ceiling is accepted and one more point is rejected', () => {
	const points = Array.from({ length: AUTOMATION_LANE_MAXIMUM_POINTS_V21 }, (_, index) => ({
		id: `point-${String(index)}`,
		position: index,
		value: index % 2,
	}));
	const segments = Array.from({ length: points.length - 1 }, () => ({ kind: 'linear' as const }));
	assert.equal(normalizeAutomationLaneV21(sampleLane({ points, segments })).points.length, 4_096);
	assert.throws(() => normalizeAutomationLaneV21(sampleLane({
		points: [...points, { id: 'overflow', position: points.length, value: 0 }],
		segments: [...segments, { kind: 'linear' }],
	})), /4096|entries|points/iu);
});

test('lane and point IDs and canonical parameter addresses have explicit uniqueness support', () => {
	const first = normalizeAutomationLaneV21(sampleLane());
	const second = normalizeAutomationLaneV21(sampleLane({
		id: 'pan-lane',
		address: {
			kind: 'strip', strip: { kind: 'track', id: 'track-1' }, parameterId: 'pan',
		},
	}));
	assert.equal(assertAutomationLaneIdentitiesUniqueV21([first, second]), true);
	assert.throws(
		() => assertAutomationLaneIdentitiesUniqueV21([first, { ...second, id: first.id }]),
		/duplicate lane ID/iu,
	);
	assert.throws(
		() => assertAutomationLaneIdentitiesUniqueV21([first, { ...second, address: first.address }]),
		/duplicate parameter address/iu,
	);
	assert.throws(() => normalizeAutomationLaneV21(sampleLane({
		points: [
			{ id: 'same', position: 0, value: 0 },
			{ id: 'same', position: 1, value: 1 },
		],
		segments: [{ kind: 'linear' }],
	})), /duplicate point ID/iu);
	assert.throws(() => normalizeAutomationLaneV21(sampleLane({ id: 'x'.repeat(257) })), /256/iu);
	assert.throws(() => normalizeAutomationLaneV21(sampleLane({
		points: [{ id: 'bad\u0000point', position: 0, value: 0 }], segments: [],
	})), /control|formatting/iu);
});

test('closed hostile records, noncanonical time, malformed shapes, and descriptor violations reject inertly', () => {
	let reads = 0;
	const hostile = sampleLane();
	Object.defineProperty(hostile, 'id', {
		enumerable: true,
		get() { reads += 1; return 'hostile'; },
	});
	assert.throws(() => normalizeAutomationLaneV21(hostile), /data propert|own data/iu);
	assert.equal(reads, 0);
	const symbolic = sampleLane();
	Object.defineProperty(symbolic, Symbol('hidden'), { enumerable: true, value: true });
	assert.throws(() => normalizeAutomationLaneV21(symbolic), /unsupported field/iu);
	const sparsePoints = new Array<unknown>(2);
	sparsePoints[0] = { id: 'point-0', position: 0, value: 0 };

	for (const candidate of [
		sampleLane({ surprise: true }),
		sampleLane({ points: sparsePoints, segments: [{ kind: 'linear' }] }),
		sampleLane({ points: [{ id: 'p0', position: 0.5, value: 0 }] , segments: [] }),
		sampleLane({ points: [{ id: 'p0', position: -0, value: 0 }] , segments: [] }),
		sampleLane({ points: [{ id: 'p0', position: 0, value: -0 }] , segments: [] }),
		{
			...sampleLane({ timebase: 'musical-beats' }),
			points: [{ id: 'p0', position: rational(2, 2), value: 0 }],
			segments: [],
		},
		sampleLane({
			points: [{ id: 'p0', position: 0, value: 0 }, { id: 'p1', position: 2, value: 1 }],
			segments: [{ kind: 'bezier', control1: { position: rational(3), value: 0 }, control2: { position: rational(1), value: 1 } }],
		}),
		sampleLane({
			points: [{ id: 'p0', position: 0, value: 0 }, { id: 'p1', position: 2, value: 1 }],
			segments: [{ kind: 'linear', normalizedPosition: 0.5 }],
		}),
	]) assert.throws(
		() => normalizeAutomationLaneV21(candidate),
		/unsupported|own data|safe integer|canonical|reduced|negative zero|B.zier|control/iu,
	);

	assert.throws(() => normalizeAutomationLaneV21(sampleLane({
		points: [{ id: 'p0', position: 0, value: 3 }], segments: [],
	}), { descriptor: DESCRIPTOR }), /target range|between|range/iu);
	assert.throws(() => normalizeAutomationLaneV21(sampleLane(), {
		descriptor: { ...DESCRIPTOR, address: { ...ADDRESS, parameterId: 'pan' } },
	}), /descriptor.*address|address.*descriptor/iu);
	assert.throws(() => normalizeAutomationLaneV21(sampleLane({
		points: [{ id: 'p0', position: 0, value: 0 }, { id: 'p1', position: 2, value: 1 }],
		segments: [{
			kind: 'bezier',
			control1: { position: rational(1, 2), value: 3 },
			control2: { position: rational(3, 2), value: 1 },
		}],
	}), { descriptor: DESCRIPTOR }), /control1.*target range/iu);
	assert.throws(() => normalizeAutomationLaneV21(sampleLane({
		points: [{ id: 'p0', position: 0, value: 0 }, { id: 'p1', position: 1, value: 1 }],
		segments: [{ kind: 'linear' }],
	}), { descriptor: { ...DESCRIPTOR, taper: 'discrete', step: 1 } }), /discrete.*hold/iu);
});

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
	if (!value || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);
	assert.equal(Object.isFrozen(value), true);
	for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}
