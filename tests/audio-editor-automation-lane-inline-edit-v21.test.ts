/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAutomationLaneAtFrameV21,
	insertAutomationLanePointV21,
	moveAutomationLaneBezierControlV21,
	moveAutomationLanePointV21,
	removeAutomationLanePointV21,
	setAutomationLaneSegmentKindV21,
} from '../src/common/editor/automation-lane-inline-edit-v21.ts';
import {
	AUTOMATION_LANE_MAXIMUM_POINTS_V21,
	evaluateAutomationLaneAtFrameV21,
} from '../src/common/editor/automation-lane-v21.ts';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';

const ADDRESS = Object.freeze({
	kind: 'strip' as const,
	strip: Object.freeze({ kind: 'track' as const, id: 'voice' }),
	parameterId: 'pan' as const,
});
const DESCRIPTOR = stripParameterDescriptor(ADDRESS);
const CONTEXT = Object.freeze({ sampleRate: 48_000, descriptor: DESCRIPTOR });

test('the first edit creates an absolute lane without mutating parameter selection', () => {
	const ids = ['lane-created', 'origin-created', 'edit-created'];
	const lane = createAutomationLaneAtFrameV21({
		address: ADDRESS,
		currentValue: 0,
		frame: 240,
		value: 0.5,
		...CONTEXT,
		createId: () => ids.shift()!,
	});

	assert.equal(lane.id, 'lane-created');
	assert.equal(lane.timebase, 'absolute-samples');
	assert.deepEqual(lane.points, [
		{ id: 'origin-created', position: 0, value: 0 },
		{ id: 'edit-created', position: 240, value: 0.5 },
	]);
	assert.deepEqual(lane.segments, [{ kind: 'linear' }]);
});

test('insert, move, segment conversion, and removal retain stable point identities', () => {
	const base = createAutomationLaneAtFrameV21({
		address: ADDRESS, currentValue: 0, frame: 100, value: 1, ...CONTEXT,
		createId: sequenceIds('lane', 'origin', 'end'),
	});
	const inserted = insertAutomationLanePointV21(base, {
		frame: 50, value: -0.25, pointId: 'middle', ...CONTEXT,
	});
	assert.deepEqual(inserted.points.map(({ id, position, value }) => [id, position, value]), [
		['origin', 0, 0], ['middle', 50, -0.25], ['end', 100, 1],
	]);
	assert.deepEqual(inserted.segments.map(({ kind }) => kind), ['linear', 'linear']);

	const moved = moveAutomationLanePointV21(inserted, {
		pointId: 'middle', frame: 60, value: 0.333, ...CONTEXT,
	});
	assert.deepEqual(moved.points.map(({ id }) => id), ['origin', 'middle', 'end']);
	assert.equal(moved.points[1]?.position, 60);
	assert.equal(moved.points[1]?.value, 0.33);
	assert.throws(() => moveAutomationLanePointV21(moved, {
		pointId: 'middle', frame: 100, value: 0, ...CONTEXT,
	}), /between|ordered|neighbor/iu);

	const eased = setAutomationLaneSegmentKindV21(moved, {
		segmentIndex: 0, kind: 'eased', descriptor: DESCRIPTOR,
	});
	assert.equal(eased.segments[0]?.kind, 'eased');
	const removed = removeAutomationLanePointV21(eased, {
		pointId: 'middle', bridgeKind: 'linear', descriptor: DESCRIPTOR,
	});
	assert.deepEqual(removed.points.map(({ id }) => id), ['origin', 'end']);
	assert.deepEqual(removed.segments, [{ kind: 'linear' }]);
});

test('inserting into an eased curve preserves its evaluated shape with exact Bezier halves', () => {
	const base = setAutomationLaneSegmentKindV21(createAutomationLaneAtFrameV21({
		address: ADDRESS, currentValue: -1, frame: 100, value: 1, ...CONTEXT,
		createId: sequenceIds('lane', 'origin', 'end'),
	}), { segmentIndex: 0, kind: 'eased', descriptor: DESCRIPTOR });
	const expected = evaluateAutomationLaneAtFrameV21(base, 30, { sampleRate: 48_000 });
	const inserted = insertAutomationLanePointV21(base, {
		frame: 30, value: expected, pointId: 'split', ...CONTEXT,
	});

	assert.deepEqual(inserted.segments.map(({ kind }) => kind), ['bezier', 'bezier']);
	for (const frame of [0, 10, 29, 30, 31, 60, 99, 100]) {
		assert.ok(Math.abs(
			evaluateAutomationLaneAtFrameV21(inserted, frame, { sampleRate: 48_000 })
			- evaluateAutomationLaneAtFrameV21(base, frame, { sampleRate: 48_000 }),
		) < 1e-12, String(frame));
	}
});

test('Bezier controls move within their segment and retain canonical values', () => {
	const bezier = setAutomationLaneSegmentKindV21(createAutomationLaneAtFrameV21({
		address: ADDRESS, currentValue: -1, frame: 120, value: 1, ...CONTEXT,
		createId: sequenceIds('lane', 'origin', 'end'),
	}), { segmentIndex: 0, kind: 'bezier', descriptor: DESCRIPTOR });
	const first = moveAutomationLaneBezierControlV21(bezier, {
		segmentIndex: 0, control: 'control1', frame: 80, value: 0.337, ...CONTEXT,
	});
	assert.deepEqual(first.segments[0], {
		kind: 'bezier',
		control1: { position: { num: 80, den: 1 }, value: 0.34 },
		control2: { position: { num: 80, den: 1 }, value: 1 },
	});
	const second = moveAutomationLaneBezierControlV21(first, {
		segmentIndex: 0, control: 'control2', frame: 10, value: -2, ...CONTEXT,
	});
	assert.deepEqual(second.segments[0], {
		kind: 'bezier',
		control1: { position: { num: 80, den: 1 }, value: 0.34 },
		control2: { position: { num: 80, den: 1 }, value: -1 },
	});
});

test('discrete lanes remain held and a sole point requires explicit lane deletion', () => {
	const muteAddress = Object.freeze({
		kind: 'strip' as const,
		strip: Object.freeze({ kind: 'track' as const, id: 'voice' }),
		parameterId: 'mute' as const,
	});
	const descriptor = stripParameterDescriptor(muteAddress);
	const lane = createAutomationLaneAtFrameV21({
		address: muteAddress, currentValue: 0, frame: 10, value: 0.8,
		sampleRate: 48_000, descriptor,
		createId: sequenceIds('mute-lane', 'mute-origin', 'mute-edit'),
	});
	assert.deepEqual(lane.points.map(({ value }) => value), [0, 1]);
	assert.deepEqual(lane.segments, [{ kind: 'hold' }]);
	assert.throws(() => setAutomationLaneSegmentKindV21(lane, {
		segmentIndex: 0, kind: 'linear', descriptor,
	}), /discrete|hold/iu);
	const endpointRemoved = removeAutomationLanePointV21(lane, {
		pointId: 'mute-edit', descriptor,
	});
	assert.equal(endpointRemoved.points.length, 1);
	assert.throws(() => removeAutomationLanePointV21(endpointRemoved, {
		pointId: 'mute-origin', descriptor,
	}), /sole|lane|one point/iu);
});

test('inserting beyond the 4096-point cap fails without partially mutating the lane', () => {
	const lane = {
		id: 'full-lane',
		address: ADDRESS,
		timebase: 'absolute-samples' as const,
		points: Array.from({ length: AUTOMATION_LANE_MAXIMUM_POINTS_V21 }, (_value, index) => ({
			id: `point-${String(index)}`,
			position: index * 2,
			value: index % 2 === 0 ? -1 : 1,
		})),
		segments: Array.from(
			{ length: AUTOMATION_LANE_MAXIMUM_POINTS_V21 - 1 },
			() => ({ kind: 'linear' as const }),
		),
	};
	const original = structuredClone(lane);
	assert.throws(() => insertAutomationLanePointV21(lane, {
		frame: 1,
		value: 0,
		pointId: 'overflow',
		...CONTEXT,
	}), /4096|4,096|cap|points/iu);
	assert.deepEqual(lane, original);
	assert.equal(lane.points.some(({ id }) => id === 'overflow'), false);
});

function sequenceIds(...ids: string[]): () => string {
	return () => ids.shift()!;
}
