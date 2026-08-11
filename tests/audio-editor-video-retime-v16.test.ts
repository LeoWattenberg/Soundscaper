/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	compileVideoRetimeCurve,
	evaluateVideoRetimeCurve,
} from '../src/common/editor/video-retime-curve.ts';
import {
	normalizeVideoRetimeCurveV16,
	type VideoRetimeCurveV16,
} from '../src/common/editor/video-retime-v16.ts';

const BINDING = Object.freeze({
	sequenceFrameCount: 4,
	sourceInFrame: 10,
	sourceFrameCount: 8,
});

function curve(): VideoRetimeCurveV16 {
	return {
		feature: 'video-retime',
		version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 10, den: 1 } },
			{ outerFrame: 4, sourceFrame: { num: 18, den: 1 } },
		],
		segments: [{
			mode: 'ramp-forward',
			startVelocity: { num: 1, den: 1 },
			endVelocity: { num: 3, den: 1 },
		}],
	};
}

test('V16 retime maps snapshot the closed JSON wire and agree with the exact algebra', () => {
	const input = curve();
	const normalized = normalizeVideoRetimeCurveV16(input, BINDING);

	assert.deepEqual(normalized, input);
	assert.notStrictEqual(normalized, input);
	assert.deepEqual(Object.keys(normalized ?? {}).sort(), ['feature', 'points', 'segments', 'version']);
	assertDeepFrozen(normalized);
	assert.equal(Object.hasOwn(normalized ?? {}, 'sequenceFrameCount'), false);
	assert.equal(Object.hasOwn(normalized ?? {}, 'sourceInFrame'), false);
	assert.equal(Object.hasOwn(normalized ?? {}, 'sourceFrameCount'), false);

	const compiled = compileVideoRetimeCurve({
		version: 2,
		outerFrameCount: BINDING.sequenceFrameCount,
		sourceStartFrame: BINDING.sourceInFrame,
		sourceFrameCount: BINDING.sourceFrameCount,
		points: normalized?.points,
		segments: normalized?.segments,
	});
	assert.deepEqual(
		evaluateVideoRetimeCurve(compiled, { num: 2, den: 1 }),
		{ numerator: 13n, denominator: 1n },
	);

	(input.points as { outerFrame: number; sourceFrame: { num: number; den: number } }[])[1] = {
		outerFrame: 4,
		sourceFrame: { num: 14, den: 1 },
	};
	assert.equal(normalized?.points[1]?.sourceFrame.num, 18);
});

test('V16 retime maps retain null as their only unretimed default', () => {
	assert.equal(normalizeVideoRetimeCurveV16(null, BINDING), null);
	assert.throws(() => normalizeVideoRetimeCurveV16(undefined, BINDING), /retime|map|object/iu);
});

test('V16 admits all five segment modes and the exact 1 through 4096 segment bounds', () => {
	for (const [mode, start, end, velocities] of [
		['constant-forward', 0, 2, null],
		['constant-reverse', 2, 0, null],
		['freeze', 1, 1, null],
		['ramp-forward', 0, 2, [{ num: 1, den: 1 }, { num: 1, den: 1 }]],
		['ramp-reverse', 2, 0, [{ num: 1, den: 1 }, { num: 1, den: 1 }]],
	] as const) {
		const segment = velocities === null
			? { mode }
			: { mode, startVelocity: velocities[0], endVelocity: velocities[1] };
		const normalized = normalizeVideoRetimeCurveV16({
			feature: 'video-retime',
			version: 2,
			points: [
				{ outerFrame: 0, sourceFrame: { num: start, den: 1 } },
				{ outerFrame: 2, sourceFrame: { num: end, den: 1 } },
			],
			segments: [segment],
		}, { sequenceFrameCount: 2, sourceInFrame: 0, sourceFrameCount: 2 });
		assert.equal(normalized?.segments[0]?.mode, mode);
	}

	const segments = Array.from({ length: 4_096 }, () => ({ mode: 'constant-forward' as const }));
	const points = Array.from({ length: 4_097 }, (_, outerFrame) => ({
		outerFrame,
		sourceFrame: { num: outerFrame, den: 1 },
	}));
	assert.equal(normalizeVideoRetimeCurveV16({
		feature: 'video-retime', version: 2, points, segments,
	}, { sequenceFrameCount: 4_096, sourceInFrame: 0, sourceFrameCount: 4_096 })?.segments.length, 4_096);
	assert.throws(() => normalizeVideoRetimeCurveV16({
		feature: 'video-retime',
		version: 2,
		points: [...points, { outerFrame: 4_097, sourceFrame: { num: 4_097, den: 1 } }],
		segments: [...segments, { mode: 'constant-forward' }],
	}, { sequenceFrameCount: 4_097, sourceInFrame: 0, sourceFrameCount: 4_097 }), /4096|segments/iu);
	assert.throws(() => normalizeVideoRetimeCurveV16({
		feature: 'video-retime', version: 2, points: [], segments: [],
	}, { sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1 }), /1 through 4096|segments/iu);
});

test('V16 rejects legacy maps, duplicated bounds, malformed records, and algebra-invalid curves', () => {
	assert.throws(() => normalizeVideoRetimeCurveV16({
		feature: 'video-retime',
		points: [{ outer: 0, source: 10, mode: 'forward' }],
	}, BINDING), /version|keys|unsupported/iu);
	assert.throws(() => normalizeVideoRetimeCurveV16({
		...curve(),
		sequenceFrameCount: 4,
	}, BINDING), /key|unsupported|sequenceFrameCount/iu);
	assert.throws(() => normalizeVideoRetimeCurveV16({ ...curve(), feature: 'audio-warp' }, BINDING), /feature/iu);
	assert.throws(() => normalizeVideoRetimeCurveV16({ ...curve(), version: 3 }, BINDING), /version/iu);
	assert.throws(() => normalizeVideoRetimeCurveV16({
		...curve(),
		points: [
			{ outerFrame: 0, sourceFrame: { num: 10, den: 1 } },
			{ outerFrame: 3, sourceFrame: { num: 18, den: 1 } },
		],
	}, BINDING), /outer|count|last/iu);
	assert.throws(() => normalizeVideoRetimeCurveV16({
		...curve(),
		points: [
			{ outerFrame: 0, sourceFrame: { num: 9, den: 1 } },
			{ outerFrame: 4, sourceFrame: { num: 17, den: 1 } },
		],
	}, BINDING), /source|range/iu);
	assert.throws(() => normalizeVideoRetimeCurveV16({
		...curve(),
		segments: [{
			mode: 'ramp-forward',
			startVelocity: { num: 1, den: 1 },
			endVelocity: { num: 2, den: 1 },
		}],
	}, BINDING), /integral|endpoint|velocity/iu);
});

test('V16 structural admission refuses sparse arrays and accessors without invoking getters', () => {
	const sparse = curve();
	(sparse as unknown as { points: unknown }).points = new Array(2);
	assert.throws(() => normalizeVideoRetimeCurveV16(sparse, BINDING), /dense|sparse|missing/iu);

	let getterCalls = 0;
	const accessor = curve() as unknown as Record<string, unknown>;
	Object.defineProperty(accessor, 'points', {
		enumerable: true,
		get() {
			getterCalls += 1;
			return curve().points;
		},
	});
	assert.throws(() => normalizeVideoRetimeCurveV16(accessor, BINDING), /data property|accessor/iu);
	assert.equal(getterCalls, 0);

	const nonPlain = Object.assign(Object.create({ inherited: true }) as Record<string, unknown>, curve());
	assert.throws(() => normalizeVideoRetimeCurveV16(nonPlain, BINDING), /plain|record|prototype/iu);
});

function assertDeepFrozen(value: unknown): void {
	if (!value || typeof value !== 'object') return;
	assert.equal(Object.isFrozen(value), true);
	for (const child of Object.values(value)) assertDeepFrozen(child);
}
