/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-spots-v1.ts';
import { planImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-plan-v1.ts';
import { defaultImageDevelopStateV1, normalizeImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV2, normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';

interface SpotFixture {
	id: string;
	mode: string;
	enabled: boolean;
	target: { x: number; y: number };
	source: { x: number; y: number };
	radius: number;
	feather: number;
	opacity: number;
}
function spot(overrides: Partial<SpotFixture> = {}): SpotFixture {
	return { id: 'repair-1', mode: 'clone', enabled: true, target: { x: 0.7, y: 0.5 },
		source: { x: 0.2, y: 0.5 }, radius: 0.15, feather: 0, opacity: 1, ...overrides };
}
function repairs(spots: readonly unknown[] = [spot()]) { return { schemaVersion: 1, spots }; }

test('repair scalar admission preserves ordered Clone and Heal definitions and deeply detaches every retained spot', () => {
	const input = repairs([spot({ id: 'second', mode: 'heal', feather: 0.25 }), spot({ id: 'first', enabled: false })]);
	const before = structuredClone(input), result = normalizeImageDevelopRepairSpotsV1(input);
	assert.deepEqual(result, before); assert.deepEqual(result.spots.map(value => value.id), ['second', 'first']);
	assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.spots), true);
	for (const value of result.spots) {
		assert.equal(Object.isFrozen(value), true); assert.equal(Object.isFrozen(value.target), true); assert.equal(Object.isFrozen(value.source), true);
	}
	const first = input.spots[0] as SpotFixture;
	first.target.x = 0; first.source.y = 1; first.radius = 1; first.id = 'changed';
	assert.deepEqual(result, before);
	assert.deepEqual(normalizeImageDevelopRepairSpotsV1(result), result);
});

test('empty repair state and the complete64-spot boundary admit while duplicate IDs and a65th inactive spot refuse', () => {
	assert.deepEqual(normalizeImageDevelopRepairSpotsV1(repairs([])), { schemaVersion: 1, spots: [] });
	const values = Array.from({ length: 64 }, (_, index) => spot({ id: `spot-${String(index)}`, enabled: false }));
	assert.equal(normalizeImageDevelopRepairSpotsV1(repairs(values)).spots.length, 64);
	assert.throws(() => normalizeImageDevelopRepairSpotsV1(repairs([...values, spot({ id: 'overflow', enabled: false })])), RangeError);
	assert.throws(() => normalizeImageDevelopRepairSpotsV1(repairs([spot(), spot()])), RangeError);
});

test('canonical repair numbers retain scalar endpoints and convert negative zero without accepting nonfinite values', () => {
	const result = normalizeImageDevelopRepairSpotsV1(repairs([spot({ target: { x: -0, y: 1 }, source: { x: 1, y: -0 },
		radius: 1, feather: -0, opacity: -0 })]));
	const value = result.spots[0]!;
	assert.deepEqual(value.target, { x: 0, y: 1 }); assert.deepEqual(value.source, { x: 1, y: 0 });
	assert.equal(Object.is(value.target.x, -0), false); assert.equal(Object.is(value.source.y, -0), false);
	assert.equal(Object.is(value.feather, -0), false); assert.equal(Object.is(value.opacity, -0), false);
	assert.equal(normalizeImageDevelopRepairSpotsV1(repairs([spot({ radius: Number.MIN_VALUE })])).spots[0]!.radius, Number.MIN_VALUE);
	for (const field of ['radius', 'feather', 'opacity']) for (const scalar of [NaN, Infinity, -Infinity]) {
		assert.throws(() => normalizeImageDevelopRepairSpotsV1(repairs([{ ...spot(), [field]: scalar }])));
	}
});

test('repair coordinate and weight bounds refuse even on disabled definitions', () => {
	const invalid = [
		{ ...spot(), radius: 0 }, { ...spot(), radius: -0 }, { ...spot(), radius: -0.1 }, { ...spot(), radius: 1.0001 },
		{ ...spot(), feather: -0.1 }, { ...spot(), feather: 1.0001 }, { ...spot(), opacity: -0.1 }, { ...spot(), opacity: 1.0001 },
		{ ...spot(), target: { x: -0.1, y: 0 } }, { ...spot(), target: { x: 1.0001, y: 0 } },
		{ ...spot(), source: { x: 0, y: NaN } }, { ...spot(), source: { x: 0, y: 1.0001 } },
		{ ...spot(), id: 'not stable' }, { ...spot(), mode: 'content-aware' },
	];
	for (const value of invalid) {
		assert.throws(() => normalizeImageDevelopRepairSpotsV1(repairs([value])));
		assert.throws(() => normalizeImageDevelopRepairSpotsV1(repairs([{ ...value, enabled: false }])));
	}
	assert.throws(() => normalizeImageDevelopRepairSpotsV1(repairs([{ ...spot(), enabled: 1 }])));
});

test('closed repair records reject future, missing, inherited and extra fields without running accessors or coercion', () => {
	let calls = 0;
	const missing = { ...spot() }; Reflect.deleteProperty(missing, 'source');
	const radius = spot(); Object.defineProperty(radius, 'radius', { enumerable: true, get() { calls++; return 0.1; } });
	const coordinate = { x: 0, get y() { calls++; return 0.5; } };
	const coercion = { valueOf() { calls++; return 0.1; }, toString() { calls++; return 'clone'; } };
	const candidates: unknown[] = [
		{ ...repairs(), schemaVersion: 2 }, { ...repairs(), bytes: new Uint8Array(1) }, { schemaVersion: 1 },
		Object.create(repairs()) as unknown, { ...repairs(), [Symbol('unknown')]: true },
		{ schemaVersion: 1, get spots() { calls++; return [spot()]; } },
		repairs([missing]), repairs([radius]), repairs([{ ...spot(), target: coordinate }]),
		repairs([{ ...spot(), mode: coercion }]), repairs([{ ...spot(), opacity: coercion }]),
		repairs([{ ...spot(), source: { x: 0, y: 1, original: 'body-ref' } }]),
		repairs([{ ...spot(), sourceRef: 'hidden-body-owner' }]), repairs([Object.create(spot()) as unknown]),
	];
	for (const value of candidates) assert.throws(() => normalizeImageDevelopRepairSpotsV1(value));
	assert.equal(calls, 0);
});

test('repair arrays require dense own entries and reject custom iterator or array fields before callbacks', () => {
	let calls = 0;
	const sparse: unknown[] = []; sparse.length = 1;
	const accessor: unknown[] = [spot()]; Object.defineProperty(accessor, '0', { enumerable: true, get() { calls++; return spot(); } });
	const custom = [spot()]; Object.defineProperty(custom, Symbol.iterator, { value() { calls++; return [spot()].values(); } });
	const extra = [spot()]; Object.defineProperty(extra, 'resource', { value: 'body', enumerable: true });
	for (const value of [sparse, accessor, custom, extra]) assert.throws(() => normalizeImageDevelopRepairSpotsV1(repairs(value)));
	assert.equal(calls, 0);
});

test('the Clone planner uses original pixel centers, shorter-side radius and an independent clipped rectangle', () => {
	const result = planImageDevelopRepairSpotsV1(repairs(), 10, 5);
	assert.deepEqual(result.spots[0], { spot: normalizeImageDevelopRepairSpotsV1(repairs()).spots[0], target: { x: 7, y: 2.5 },
		sourceDelta: { x: -5, y: 0 }, radius: 0.75, rectangle: { x: 6, y: 2, width: 2, height: 1 }, halo: null });
	assert.equal(result.width, 10); assert.equal(result.height, 5);
	assert.equal(result.cloneVisits, 2); assert.equal(result.healRelaxations, 0); assert.equal(result.maximumScratchBytes, 0);
	assert.equal(result.kernelWorkingBytes, 400); assert.equal(result.stageWorkingBytes, 800);
	assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.spots), true);
	assert.equal(Object.isFrozen(result.spots[0]), true); assert.equal(Object.isFrozen(result.spots[0]!.rectangle), true);
	assert.equal(Object.isFrozen(result.spots[0]!.target), true); assert.equal(Object.isFrozen(result.spots[0]!.sourceDelta), true);
});

test('Heal planning includes its actual clipped one-pixel halo and charges64 sweeps and all scratch planes', () => {
	const input = repairs([spot({ mode: 'heal' })]), before = structuredClone(input);
	const result = planImageDevelopRepairSpotsV1(input, 10, 5);
	assert.deepEqual(result.repairs, before);
	assert.deepEqual(result.spots[0]!.rectangle, { x: 6, y: 2, width: 2, height: 1 });
	assert.deepEqual(result.spots[0]!.halo, { x: 5, y: 1, width: 4, height: 3 });
	assert.equal(result.cloneVisits, 0); assert.equal(result.healRelaxations, 768);
	assert.equal(result.maximumScratchBytes, 5356); assert.equal(result.kernelWorkingBytes, 5756); assert.equal(result.stageWorkingBytes, 6156);
	assert.equal(Object.isFrozen(result.spots[0]!.halo), true); assert.equal(Object.isFrozen(result.repairs), true);
	assert.deepEqual(input, before);
});

test('clipped image-edge rectangles and the inclusive circle-center boundary have exact deterministic planning', () => {
	const edge = planImageDevelopRepairSpotsV1(repairs([spot({ mode: 'heal', target: { x: 0, y: 0 }, radius: 0.5 })]), 8, 4);
	assert.deepEqual(edge.spots[0]!.rectangle, { x: 0, y: 0, width: 2, height: 2 });
	assert.deepEqual(edge.spots[0]!.halo, { x: 0, y: 0, width: 3, height: 3 });
	assert.equal(edge.healRelaxations, 576); assert.equal(edge.maximumScratchBytes, 5041);
	const exact = planImageDevelopRepairSpotsV1(repairs([spot({ target: { x: 0.5, y: 0.5 }, radius: 0.125 })]), 8, 4);
	assert.deepEqual(exact.spots[0]!.rectangle, { x: 3, y: 1, width: 2, height: 2 });
	assert.equal(exact.cloneVisits, 4);
});

test('serial repair planning sums work but reserves only the largest live Heal scratch span', () => {
	const input = repairs([spot({ mode: 'heal', id: 'a' }), spot({ mode: 'heal', id: 'b', radius: 0.05 }), spot({ id: 'c' })]);
	const result = planImageDevelopRepairSpotsV1(input, 10, 5);
	assert.equal(result.spots.length, 3); assert.deepEqual(result.spots.map(value => value.spot.id), ['a', 'b', 'c']);
	assert.equal(result.spots[1]!.rectangle.width, 0); assert.equal(result.spots[1]!.halo, null);
	assert.equal(result.healRelaxations, 768); assert.equal(result.cloneVisits, 2);
	assert.equal(result.maximumScratchBytes, 5356); assert.equal(result.kernelWorkingBytes, 5756); assert.equal(result.stageWorkingBytes, 6156);
});

test('disabled and opacity-zero definitions remain validated and retained without charging physical work', () => {
	const result = planImageDevelopRepairSpotsV1(repairs([spot({ mode: 'heal', enabled: false, radius: 1 }),
		spot({ id: 'zero', mode: 'heal', opacity: 0, radius: 1 })]), 4096, 4096);
	assert.equal(result.repairs.spots.length, 2); assert.equal(result.spots[0]!.rectangle.width, 4096);
	assert.equal(result.cloneVisits, 0); assert.equal(result.healRelaxations, 0); assert.equal(result.maximumScratchBytes, 0);
	assert.equal(result.kernelWorkingBytes, 134217728); assert.equal(result.stageWorkingBytes, 268435456);
	assert.throws(() => planImageDevelopRepairSpotsV1(repairs([{ ...spot(), enabled: false, radius: 0 }]), 4096, 4096));
});

test('one exact512-square Heal halo reaches the work boundary while another active patch or larger halo refuses', () => {
	const bounded = spot({ mode: 'heal', target: { x: 0.5, y: 0.5 }, radius: 0.249 });
	const result = planImageDevelopRepairSpotsV1(repairs([bounded]), 1024, 1024);
	assert.deepEqual(result.spots[0]!.rectangle, { x: 257, y: 257, width: 510, height: 510 });
	assert.deepEqual(result.spots[0]!.halo, { x: 256, y: 256, width: 512, height: 512 });
	assert.equal(result.healRelaxations, 16777216); assert.equal(result.maximumScratchBytes, 27529216);
	assert.equal(result.kernelWorkingBytes, 35917824); assert.equal(result.stageWorkingBytes, 44306432);
	assert.throws(() => planImageDevelopRepairSpotsV1(repairs([bounded, { ...bounded, id: 'overflow' }]), 1024, 1024), RangeError);
	assert.throws(() => planImageDevelopRepairSpotsV1(repairs([{ ...bounded, radius: 0.25 }]), 1024, 1024), RangeError);
});

test('the Clone visit boundary and source64MiB bound are independent from per-spot IDs and active spot count', () => {
	const full = spot({ target: { x: 0.5, y: 0.5 }, radius: 1 });
	const result = planImageDevelopRepairSpotsV1(repairs([full]), 4096, 4096);
	assert.equal(result.cloneVisits, 16777216); assert.equal(result.maximumScratchBytes, 0);
	assert.equal(result.stageWorkingBytes, 268435456);
	assert.throws(() => planImageDevelopRepairSpotsV1(repairs([full, { ...full, id: 'overflow' }]), 4096, 4096), RangeError);
	assert.throws(() => planImageDevelopRepairSpotsV1(repairs([]), 4096, 4097), RangeError);
	assert.throws(() => planImageDevelopRepairSpotsV1(repairs([]), Number.MAX_SAFE_INTEGER, 1), RangeError);
});

test('planner rejects invalid dimensions without conversion hooks and remains scalar-only for no-op frames', () => {
	let calls = 0;
	const width = { valueOf() { calls++; return 10; } };
	for (const value of [0, -1, 1.5, NaN, Infinity, width]) {
		assert.throws(() => planImageDevelopRepairSpotsV1(repairs([]), value as number, 5));
		assert.throws(() => planImageDevelopRepairSpotsV1(repairs([]), 5, value as number));
	}
	assert.equal(calls, 0);
	const result = planImageDevelopRepairSpotsV1(repairs([]), 1, 1);
	assert.deepEqual(result.spots, []); assert.equal(result.kernelWorkingBytes, 8); assert.equal(result.stageWorkingBytes, 16);
});

test('this foundation never expands strict process1, process2 or their existing current dispatcher', () => {
	const legacy = defaultImageDevelopStateV1(), json = JSON.stringify(legacy), repair = repairs();
	assert.throws(() => normalizeImageDevelopStateV1({ ...legacy, repairs: repair }));
	assert.throws(() => normalizeImageDevelopStateV2({ ...legacy, processVersion: 2, repairs: repair }));
	assert.throws(() => normalizeImageDevelopStateV1OrV2({ ...legacy, processVersion: 3, repairs: repair }));
	assert.throws(() => normalizeImageDevelopStateV1OrV2({ ...legacy, processVersion: 3 }));
	assert.equal(JSON.stringify(normalizeImageDevelopStateV1(legacy)), json);
	assert.equal(JSON.stringify(normalizeImageDevelopStateV1OrV2(legacy)), json);
	assert.equal(Object.hasOwn(normalizeImageDevelopStateV2({ ...legacy, processVersion: 2 }), 'repairs'), false);
});
