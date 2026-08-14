/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	replaceAutomationLaneTimelineIntervalV21,
} from '../src/common/editor/automation-lane-interval-edit-v21.ts';
import {
	evaluateAutomationLaneAtFrameV21,
	normalizeAutomationLaneV21,
	type AutomationLaneV21,
} from '../src/common/editor/automation-lane-v21.ts';

const SAMPLE_RATE = 48_000;
const TEMPO_MAP = Object.freeze({
	mode: 'musical' as const,
	events: Object.freeze([Object.freeze({
		beat: Object.freeze({ num: 0, den: 1 }),
		bpm: Object.freeze({ num: 120, den: 1 }),
	})]),
});

test('insert splits a linear sample lane exactly and holds across the opened interval', () => {
	const lane = sampleLane([
		{ id: 'start', position: 0, value: 0 },
		{ id: 'end', position: 100, value: 1 },
	], [{ kind: 'linear' }]);
	const edited = replaceAutomationLaneTimelineIntervalV21(lane, {
		startFrame: 50, endFrame: 50, insertedDurationFrames: 20,
	}, { sampleRate: SAMPLE_RATE, tempoMap: TEMPO_MAP });

	assert.deepEqual(edited.points.map(({ position }) => position), [0, 50, 70, 120]);
	assert.deepEqual(edited.segments.map(({ kind }) => kind), ['linear', 'hold', 'linear']);
	assert.equal(valueAt(edited, 25), valueAt(lane, 25));
	assert.equal(valueAt(edited, 50), valueAt(lane, 50));
	assert.equal(valueAt(edited, 60), valueAt(lane, 50));
	assert.equal(valueAt(edited, 70), valueAt(lane, 50));
	assert.equal(valueAt(edited, 95), valueAt(lane, 75));
	assert.equal(valueAt(edited, 120), valueAt(lane, 100));
});

test('ripple delete evaluates both boundaries and preserves an exactly representable hold splice', () => {
	const lane = sampleLane([
		{ id: 'start', position: 0, value: 0 },
		{ id: 'jump', position: 50, value: 1 },
		{ id: 'end', position: 100, value: 2 },
	], [{ kind: 'hold' }, { kind: 'linear' }]);
	const edited = replaceAutomationLaneTimelineIntervalV21(lane, {
		startFrame: 20, endFrame: 60, insertedDurationFrames: 0,
	}, { sampleRate: SAMPLE_RATE, tempoMap: TEMPO_MAP });

	assert.deepEqual(edited.points.map(({ position }) => position), [0, 20, 60]);
	assert.deepEqual(edited.segments.map(({ kind }) => kind), ['hold', 'linear']);
	assert.equal(valueAt(edited, 19), valueAt(lane, 19));
	assert.equal(valueAt(edited, 20), valueAt(lane, 60));
	assert.equal(valueAt(edited, 40), valueAt(lane, 80));
	assert.equal(valueAt(edited, 60), valueAt(lane, 100));
});

test('a discontinuous delete holds the sample before the splice instead of refusing', () => {
	const lane = sampleLane([
		{ id: 'start', position: 0, value: 0 },
		{ id: 'end', position: 100, value: 1 },
	], [{ kind: 'linear' }]);
	const edited = replaceAutomationLaneTimelineIntervalV21(lane, {
		startFrame: 20, endFrame: 60, insertedDurationFrames: 0,
	}, { sampleRate: SAMPLE_RATE, tempoMap: TEMPO_MAP });

	assert.deepEqual(edited.points.map(({ position }) => position), [0, 19, 20, 60]);
	assert.deepEqual(edited.segments.map(({ kind }) => kind), ['linear', 'hold', 'linear']);
	// The shoulder frame keeps the authored value and the splice carries the surviving
	// right boundary, so the deletion's discontinuity occupies exactly one sample.
	assert.equal(valueAt(edited, 19), valueAt(lane, 19));
	assert.equal(valueAt(edited, 20), valueAt(lane, 60));
	assert.equal(valueAt(edited, 60), valueAt(lane, 100));
	// Re-anchoring the prefix span changes float rounding, so interior frames agree to
	// within a few ULP at this fixture's 0..1 value scale rather than bit-exactly.
	for (const frame of [1, 5, 10, 18]) {
		assert.ok(Math.abs(valueAt(edited, frame) - valueAt(lane, frame)) <= 2e-15);
	}
});

test('an eased discontinuous delete keeps exact Bezier subcurves either side of the held sample', () => {
	const lane = sampleLane([
		{ id: 'start', position: 0, value: 0 },
		{ id: 'end', position: 100, value: 1 },
	], [{ kind: 'eased' }]);
	const edited = replaceAutomationLaneTimelineIntervalV21(lane, {
		startFrame: 20, endFrame: 60, insertedDurationFrames: 0,
	}, { sampleRate: SAMPLE_RATE, tempoMap: TEMPO_MAP });

	assert.deepEqual(edited.points.map(({ position }) => position), [0, 19, 20, 60]);
	assert.deepEqual(edited.segments.map(({ kind }) => kind), ['bezier', 'hold', 'bezier']);
	assert.equal(valueAt(edited, 19), valueAt(lane, 19));
	assert.equal(valueAt(edited, 20), valueAt(lane, 60));
});

test('a delete that cannot represent its shoulder position refuses transactionally', () => {
	// At 137 bpm over 96 kHz the splice beat is canonical but the preceding sample
	// resolves to 6575863/5760000, outside the shared rational denominator domain.
	const tempoMap = Object.freeze({
		mode: 'musical' as const,
		events: Object.freeze([Object.freeze({
			beat: Object.freeze({ num: 0, den: 1 }),
			bpm: Object.freeze({ num: 137, den: 1 }),
		})]),
	});
	const lane = normalizeAutomationLaneV21({
		id: 'lane',
		address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
		timebase: 'musical-beats',
		points: [
			{ id: 'start', position: { num: 0, den: 1 }, value: 0 },
			{ id: 'end', position: { num: 8, den: 1 }, value: 1 },
		],
		segments: [{ kind: 'linear' }],
	});
	const before = structuredClone(lane);
	assert.throws(() => replaceAutomationLaneTimelineIntervalV21(lane, {
		startFrame: 48_000, endFrame: 96_000, insertedDurationFrames: 0,
	}, { sampleRate: 96_000, tempoMap }), /canonical|discontin|splice/iu);
	assert.deepEqual(lane, before);
});

test('deletes that already splice canonically are unchanged by the shoulder path', () => {
	// Equal boundary values need no discontinuity, and startFrame 0 has no preceding
	// sample; both must keep producing exactly the curve they produced before.
	const symmetric = sampleLane([
		{ id: 'start', position: 0, value: 0 },
		{ id: 'peak', position: 40, value: 1 },
		{ id: 'end', position: 80, value: 0 },
	], [{ kind: 'linear' }, { kind: 'linear' }]);
	const equalBoundaries = replaceAutomationLaneTimelineIntervalV21(symmetric, {
		startFrame: 20, endFrame: 60, insertedDurationFrames: 0,
	}, { sampleRate: SAMPLE_RATE, tempoMap: TEMPO_MAP });
	assert.deepEqual(equalBoundaries.points.map(({ position }) => position), [0, 20, 40]);
	assert.deepEqual(equalBoundaries.segments.map(({ kind }) => kind), ['linear', 'linear']);

	const ramp = sampleLane([
		{ id: 'start', position: 0, value: 0 },
		{ id: 'end', position: 100, value: 1 },
	], [{ kind: 'linear' }]);
	const fromOrigin = replaceAutomationLaneTimelineIntervalV21(ramp, {
		startFrame: 0, endFrame: 40, insertedDurationFrames: 0,
	}, { sampleRate: SAMPLE_RATE, tempoMap: TEMPO_MAP });
	assert.deepEqual(fromOrigin.points.map(({ position }) => position), [0, 60]);
	assert.deepEqual(fromOrigin.segments.map(({ kind }) => kind), ['linear']);
});

test('musical lanes derive exact edit coordinates from the authoritative tempo map', () => {
	const lane = normalizeAutomationLaneV21({
		id: 'musical',
		address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
		timebase: 'musical-beats',
		points: [
			{ id: 'start', position: { num: 0, den: 1 }, value: 0 },
			{ id: 'end', position: { num: 4, den: 1 }, value: 1 },
		],
		segments: [{ kind: 'linear' }],
	});
	const edited = replaceAutomationLaneTimelineIntervalV21(lane, {
		startFrame: 48_000, endFrame: 48_000, insertedDurationFrames: 24_000,
	}, { sampleRate: SAMPLE_RATE, tempoMap: TEMPO_MAP });

	assert.deepEqual(edited.points.map(({ position }) => position), [
		{ num: 0, den: 1 }, { num: 2, den: 1 },
		{ num: 3, den: 1 }, { num: 5, den: 1 },
	]);
	assert.equal(evaluateAutomationLaneAtFrameV21(edited, 60_000, {
		sampleRate: SAMPLE_RATE, tempoMap: TEMPO_MAP,
	}), evaluateAutomationLaneAtFrameV21(lane, 48_000, {
		sampleRate: SAMPLE_RATE, tempoMap: TEMPO_MAP,
	}));
});

test('exact linear-time Bezier handles survive interval splitting without sampling', () => {
	const lane = sampleLane([
		{ id: 'start', position: 0, value: 0 },
		{ id: 'end', position: 120, value: 1 },
	], [{
		kind: 'bezier',
		control1: { position: { num: 40, den: 1 }, value: 0.1 },
		control2: { position: { num: 80, den: 1 }, value: 0.8 },
	}]);
	const edited = replaceAutomationLaneTimelineIntervalV21(lane, {
		startFrame: 60, endFrame: 60, insertedDurationFrames: 30,
	}, { sampleRate: SAMPLE_RATE, tempoMap: TEMPO_MAP });

	for (const frame of [0, 15, 30, 45, 60]) {
		assert.ok(Math.abs(valueAt(edited, frame) - valueAt(lane, frame)) <= 1e-15);
	}
	for (const frame of [90, 105, 120, 135, 150]) {
		assert.ok(Math.abs(valueAt(edited, frame) - valueAt(lane, frame - 30)) <= 1e-15);
	}
	assert.equal(edited.segments[0]?.kind, 'bezier');
	assert.equal(edited.segments[2]?.kind, 'bezier');
});

test('eased segments split to exact-position Bezier subcurves at a non-symmetric boundary', () => {
	const lane = sampleLane([
		{ id: 'start', position: 0, value: 0.1 },
		{ id: 'end', position: 100, value: 0.9 },
	], [{ kind: 'eased' }]);
	const edited = replaceAutomationLaneTimelineIntervalV21(lane, {
		startFrame: 30, endFrame: 30, insertedDurationFrames: 10,
	}, { sampleRate: SAMPLE_RATE, tempoMap: TEMPO_MAP });

	assert.deepEqual(edited.points.map(({ position }) => position), [0, 30, 40, 110]);
	assert.deepEqual(edited.segments.map(({ kind }) => kind), ['bezier', 'hold', 'bezier']);
	assert.equal(valueAt(edited, 30), valueAt(lane, 30));
	assert.equal(valueAt(edited, 40), valueAt(lane, 30));
	for (const frame of [1, 10, 20, 50, 75, 100]) {
		const editedFrame = frame <= 30 ? frame : frame + 10;
		assert.ok(Math.abs(valueAt(edited, editedFrame) - valueAt(lane, frame)) <= 2e-15);
	}
});

test('repeating an identical ripple does not remint a boundary ID that is still live', () => {
	// Boundary IDs derive from the edit alone, so an identical range deleted twice with
	// an intervening earlier delete would otherwise collide with its own earlier point.
	let lane = sampleLane([
		{ id: 'start', position: 0, value: 0 },
		{ id: 'end', position: 200_000, value: 1 },
	], [{ kind: 'linear' }]);
	for (const [startFrame, endFrame] of [[100, 200], [10, 20], [100, 200], [10, 20], [100, 200]]) {
		lane = replaceAutomationLaneTimelineIntervalV21(lane, {
			startFrame: startFrame!, endFrame: endFrame!, insertedDurationFrames: 0,
		}, { sampleRate: SAMPLE_RATE, tempoMap: TEMPO_MAP });
	}
	const ids = lane.points.map(({ id }) => id);
	assert.equal(new Set(ids).size, ids.length);
});

test('a boundary split that would exceed the 4096-point wire cap refuses transactionally', () => {
	const lane = sampleLane(Array.from({ length: 4_096 }, (_value, index) => ({
		id: `point-${String(index)}`, position: index * 2, value: index % 2,
	})), Array.from({ length: 4_095 }, () => ({ kind: 'hold' as const })));
	const before = structuredClone(lane);
	assert.throws(() => replaceAutomationLaneTimelineIntervalV21(lane, {
		startFrame: 1, endFrame: 1, insertedDurationFrames: 1,
	}, { sampleRate: SAMPLE_RATE, tempoMap: TEMPO_MAP }), /4096|4,096|cap|points/iu);
	assert.deepEqual(lane, before);
});

function sampleLane(
	points: readonly Readonly<{ id: string; position: number; value: number }>[],
	segments: readonly Readonly<Record<string, unknown>>[],
): AutomationLaneV21 {
	return normalizeAutomationLaneV21({
		id: 'lane',
		address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
		timebase: 'absolute-samples', points, segments,
	});
}

function valueAt(lane: AutomationLaneV21, frame: number): number {
	return evaluateAutomationLaneAtFrameV21(lane, frame, {
		sampleRate: SAMPLE_RATE, tempoMap: TEMPO_MAP,
	});
}
