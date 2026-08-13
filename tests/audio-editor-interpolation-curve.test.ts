/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	compileInterpolationCurve,
	evaluateInterpolationCurve,
	invertInterpolationCurve,
} from '../src/common/editor/interpolation-curve.ts';
import { roundRational } from '../src/common/editor/timeline-time.ts';

const rational = (num: number, den = 1) => ({ num, den });

test('hold, linear, eased, and absolute-handle Bézier segments clamp and own boundaries on the right', () => {
	const input = {
		anchors: [
			{ position: rational(0), value: 10 },
			{ position: rational(10), value: 20 },
			{ position: rational(20), value: 30 },
			{ position: rational(30), value: 40 },
			{ position: rational(40), value: 50 },
		],
		segments: [
			{ kind: 'hold' as const },
			{ kind: 'linear' as const },
			{ kind: 'eased' as const },
			{
				kind: 'bezier' as const,
				control1: { position: rational(100, 3), value: 130 / 3 },
				control2: { position: rational(110, 3), value: 140 / 3 },
			},
		],
	};
	const before = structuredClone(input);
	const curve = compileInterpolationCurve(input);

	assert.deepEqual(input, before, 'compile must snapshot without rewriting caller state');
	assertDeepFrozen(curve);
	assert.equal(evaluateInterpolationCurve(curve, -10), 10);
	assert.equal(evaluateInterpolationCurve(curve, 5), 10);
	assert.equal(evaluateInterpolationCurve(curve, 10), 20, 'the following segment owns a shared anchor');
	assert.equal(evaluateInterpolationCurve(curve, 15), 25);
	assert.equal(evaluateInterpolationCurve(curve, 25), 35);
	assert.ok(Math.abs(evaluateInterpolationCurve(curve, 35) - 45) <= 1e-12);
	assert.equal(evaluateInterpolationCurve(curve, 40), 50, 'the final endpoint belongs to the final segment');
	assert.equal(evaluateInterpolationCurve(curve, 50), 50);

	input.anchors[1] = { position: rational(10), value: 999 };
	assert.equal(evaluateInterpolationCurve(curve, 10), 20);
});

test('fixed smoothstep eased evaluation is continuous and uses exact rational anchors', () => {
	const curve = compileInterpolationCurve({
		anchors: [
			{ position: rational(3, 2), value: -2 },
			{ position: rational(7, 2), value: 6 },
			{ position: rational(11, 2), value: 10 },
		],
		segments: [{ kind: 'eased' }, { kind: 'linear' }],
	});

	assert.equal(evaluateInterpolationCurve(curve, rational(3, 2)), -2);
	assert.equal(evaluateInterpolationCurve(curve, rational(5, 2)), 2);
	assert.equal(evaluateInterpolationCurve(curve, rational(7, 2)), 6);
	assert.ok(Math.abs(evaluateInterpolationCurve(curve, rational(3_500_001, 1_000_000)) - 6.000002) < 1e-12);
});

test('inverse returns exact rational roots, plateau ranges, and enclosing integer brackets', () => {
	const linear = compileInterpolationCurve({
		anchors: [
			{ position: rational(0), value: 0 },
			{ position: rational(10), value: 20 },
		],
		segments: [{ kind: 'linear' }],
	});
	assert.deepEqual(invertInterpolationCurve(linear, 0), [{ kind: 'point', position: rational(0) }]);
	assert.deepEqual(invertInterpolationCurve(linear, 10), [{ kind: 'point', position: rational(5) }]);
	assert.deepEqual(invertInterpolationCurve(linear, 5), [{
		kind: 'point', position: rational(5, 2),
	}]);
	assert.deepEqual(invertInterpolationCurve(linear, 30), []);

	const plateau = compileInterpolationCurve({
		anchors: [
			{ position: rational(2), value: 4 },
			{ position: rational(8), value: 4 },
		],
		segments: [{ kind: 'hold' }],
	});
	assert.deepEqual(invertInterpolationCurve(plateau, 4), [{
		kind: 'range', start: rational(2), end: rational(8),
	}]);
	assertDeepFrozen(invertInterpolationCurve(plateau, 4));

	const eased = compileInterpolationCurve({
		anchors: [
			{ position: rational(0), value: -5 },
			{ position: rational(10), value: 5 },
		],
		segments: [{ kind: 'eased' }],
	});
	assert.deepEqual(invertInterpolationCurve(eased, 0), [{ kind: 'point', position: rational(5) }]);
	assert.deepEqual(invertInterpolationCurve(eased, -4), [{
		kind: 'bracket', lower: rational(1), upper: rational(2),
	}], 'a non-exact smoothstep root remains an authoritative integer-cell bracket');

	const exactEased = compileInterpolationCurve({
		anchors: [
			{ position: rational(0), value: 0 },
			{ position: rational(1), value: 1 },
		],
		segments: [{ kind: 'eased' }],
	});
	assert.deepEqual(invertInterpolationCurve(exactEased, 0.5), [{
		kind: 'point', position: rational(1, 2),
	}]);
});

test('Bézier inversion supports monotone values and rejects nonmonotone value handles without blocking evaluation', () => {
	const monotone = compileInterpolationCurve({
		anchors: [
			{ position: rational(0), value: 0 },
			{ position: rational(10), value: 10 },
		],
		segments: [{
			kind: 'bezier',
			control1: { position: rational(10, 3), value: 10 / 3 },
			control2: { position: rational(20, 3), value: 20 / 3 },
		}],
	});
	assert.ok(Math.abs(evaluateInterpolationCurve(monotone, 5) - 5) <= 1e-12);
	assert.deepEqual(invertInterpolationCurve(monotone, 5), [{ kind: 'point', position: rational(5) }]);
	const identity = compileInterpolationCurve({
		anchors: [
			{ position: rational(0), value: 0 },
			{ position: rational(1), value: 1 },
		],
		segments: [{
			kind: 'bezier',
			control1: { position: rational(1, 3), value: 1 / 3 },
			control2: { position: rational(2, 3), value: 2 / 3 },
		}],
	});
	assert.equal(evaluateInterpolationCurve(identity, rational(1, 2)), 0.5);
	assert.deepEqual(invertInterpolationCurve(identity, 0.5), [{
		kind: 'point', position: rational(1, 2),
	}]);

	const derivativeMonotone = compileInterpolationCurve({
		anchors: [
			{ position: rational(0), value: 0 },
			{ position: rational(1), value: 2 },
		],
		segments: [{
			kind: 'bezier',
			control1: { position: rational(1, 3), value: 1 },
			control2: { position: rational(2, 3), value: 0.9 },
		}],
	});
	const derivativeTarget = evaluateInterpolationCurve(derivativeMonotone, rational(1, 2));
	assert.deepEqual(invertInterpolationCurve(derivativeMonotone, derivativeTarget), [{
		kind: 'point', position: rational(1, 2),
	}], 'actual cubic derivative monotonicity admits an unordered but strictly increasing control polygon');

	const nonmonotone = compileInterpolationCurve({
		anchors: [
			{ position: rational(0), value: 0 },
			{ position: rational(10), value: 10 },
		],
		segments: [{
			kind: 'bezier',
			control1: { position: rational(2), value: 12 },
			control2: { position: rational(8), value: -2 },
		}],
	});
	assert.equal(Number.isFinite(evaluateInterpolationCurve(nonmonotone, 5)), true);
	assert.throws(() => invertInterpolationCurve(nonmonotone, 5), /monotone|invert|control/iu);

	for (const [start, control1, control2, end] of [[
		0, 1e-200, 0, 0.5e-200,
	], [
		9.872123081887626e40,
		1.3355965254117724e41,
		1.040965961248771e41,
		1.2901367475460187e41,
	]] as const) {
		const exactDoubleNonmonotone = compileInterpolationCurve({
			anchors: [
				{ position: rational(0), value: start },
				{ position: rational(1), value: end },
			],
			segments: [{
				kind: 'bezier',
				control1: { position: rational(1, 3), value: control1 },
				control2: { position: rational(2, 3), value: control2 },
			}],
		});
		assert.throws(
			() => invertInterpolationCurve(exactDoubleNonmonotone, (start + end) / 2),
			/monotone|invert|control/iu,
			'exact IEEE-754 derivative products must not underflow or cross a decimal boundary',
		);
		assert.equal(Number.isFinite(evaluateInterpolationCurve(exactDoubleNonmonotone, rational(1, 2))), true);
	}
});

test('compile rejects malformed curves, nonfinite values, unordered anchors, and invalid absolute handles', () => {
	const valid = baseInput();
	const cases: readonly Readonly<{ name: string; input: unknown; error: RegExp }>[] = [
		{ name: 'top-level field', input: { ...valid, normalized: true }, error: /unsupported|field/iu },
		{ name: 'too few anchors', input: { anchors: [], segments: [] }, error: /anchor|segment|1/iu },
		{ name: 'missing segment', input: { ...valid, segments: [] }, error: /one more|segment|anchor/iu },
		{ name: 'negative clip position', input: { ...valid, anchors: [
			{ position: rational(-1), value: 0 }, valid.anchors[1],
		] }, error: /clip|non-negative|position/iu },
		{ name: 'unordered anchors', input: { ...valid, anchors: [
			valid.anchors[0], { position: rational(0), value: 1 },
		] }, error: /increas|position/iu },
		{ name: 'nonfinite value', input: { ...valid, anchors: [
			valid.anchors[0], { position: rational(10), value: Number.NaN },
		] }, error: /finite|value/iu },
		{ name: 'shape field', input: { ...valid, segments: [{ kind: 'linear', normalizedPosition: 0.5 }] }, error: /unsupported|field/iu },
		{ name: 'unknown shape', input: { ...valid, segments: [{ kind: 'spline' }] }, error: /kind|support/iu },
		{ name: 'control before start', input: { ...valid, segments: [{
			kind: 'bezier',
			control1: { position: rational(-1), value: 0 },
			control2: { position: rational(8), value: 1 },
		}] }, error: /control|position|order/iu },
		{ name: 'control order', input: { ...valid, segments: [{
			kind: 'bezier',
			control1: { position: rational(8), value: 0 },
			control2: { position: rational(2), value: 1 },
		}] }, error: /control|position|order/iu },
		{ name: 'control value', input: { ...valid, segments: [{
			kind: 'bezier',
			control1: { position: rational(2), value: Infinity },
			control2: { position: rational(8), value: 1 },
		}] }, error: /finite|value/iu },
	];
	for (const fixture of cases) assert.throws(
		() => compileInterpolationCurve(fixture.input), fixture.error, fixture.name,
	);
});

test('closed compile boundary refuses accessors and sparse arrays without invoking them', () => {
	let getterCalls = 0;
	const accessor = {} as Record<string, unknown>;
	Object.defineProperty(accessor, 'anchors', {
		enumerable: true,
		get() {
			getterCalls += 1;
			return baseInput().anchors;
		},
	});
	Object.defineProperty(accessor, 'segments', { enumerable: true, value: baseInput().segments });
	assert.throws(() => compileInterpolationCurve(accessor), /data property|accessor|enumerable/iu);
	assert.equal(getterCalls, 0);

	const sparse = new Array<unknown>(2);
	sparse[0] = baseInput().anchors[0];
	assert.throws(
		() => compileInterpolationCurve({ ...baseInput(), anchors: sparse }),
		/dense|enumerable|data property/iu,
	);
});

test('bounded generated curves stay continuous and invert every sampled monotone point', () => {
	let state = 0x6d_34_21_09;
	const random = () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state / 0x1_00_00_00_00;
	};
	for (let fixture = 0; fixture < 128; fixture += 1) {
		const end = 4 + Math.floor(random() * 60);
		const endValue = 1 + random() * 20;
		const firstControlPosition = Math.floor(random() * (end + 1));
		const secondControlPosition = firstControlPosition
			+ Math.floor(random() * (end - firstControlPosition + 1));
		const firstControlValue = random() * endValue;
		const secondControlValue = firstControlValue + random() * (endValue - firstControlValue);
		const curve = compileInterpolationCurve({
			anchors: [
				{ position: rational(0), value: 0 },
				{ position: rational(end), value: endValue },
			],
			segments: [{
				kind: 'bezier',
				control1: { position: rational(firstControlPosition), value: firstControlValue },
				control2: { position: rational(secondControlPosition), value: secondControlValue },
			}],
		});
		for (let position = 0; position <= end; position += Math.max(1, Math.floor(end / 7))) {
			const value = evaluateInterpolationCurve(curve, position);
			assert.deepEqual(invertInterpolationCurve(curve, value), [{
				kind: 'point', position: rational(position),
			}]);
		}
	}
});

test('generated exact rational linear roots remain points instead of integer-cell brackets', () => {
	for (let exponent = 1; exponent <= 8; exponent += 1) {
		const span = 2 ** exponent;
		const curve = compileInterpolationCurve({
			anchors: [
				{ position: rational(0), value: 0 },
				{ position: rational(span), value: span },
			],
			segments: [{ kind: 'linear' }],
		});
		for (let lower = 0; lower < span; lower += 1) {
			assert.deepEqual(invertInterpolationCurve(curve, lower + 0.5), [{
				kind: 'point', position: rational(lower * 2 + 1, 2),
			}]);
		}
	}

	const roundedEvaluation = compileInterpolationCurve({
		anchors: [
			{ position: rational(0), value: 0 },
			{ position: rational(11), value: 22 },
		],
		segments: [{ kind: 'linear' }],
	});
	assert.deepEqual(invertInterpolationCurve(roundedEvaluation, 15), [{
		kind: 'bracket', lower: rational(7), upper: rational(8),
	}], 'a rational algebra candidate is not promoted when evaluator rechecking differs');
});

test('generated eased and Bézier rational roots are recovered before irrational brackets', () => {
	const shapes = [{ kind: 'eased' as const }, {
		kind: 'bezier' as const,
		control1: { position: rational(1, 3), value: 1 / 3 },
		control2: { position: rational(2, 3), value: 2 / 3 },
	}];
	for (const shape of shapes) {
		const curve = compileInterpolationCurve({
			anchors: [
				{ position: rational(0), value: 0 },
				{ position: rational(1), value: 1 },
			],
			segments: [shape],
		});
		for (const denominator of [3, 5, 7, 11]) {
			for (let numerator = 1; numerator < denominator; numerator += 1) {
				const position = rational(numerator, denominator);
				const target = evaluateInterpolationCurve(curve, position);
				assert.deepEqual(invertInterpolationCurve(curve, target), [{ kind: 'point', position }]);
			}
		}
	}
});

test('compiler admits legacy synthetic segments while retaining a hostile-input ceiling', () => {
	const maximum = linearInput(4_096);
	const compiled = compileInterpolationCurve(maximum);
	assert.deepEqual(invertInterpolationCurve(compiled, 2_048), [{
		kind: 'point', position: rational(2_048),
	}]);
	assert.doesNotThrow(() => compileInterpolationCurve(linearInput(4_097)),
		'legacy envelope adapters may add two synthetic endpoints around 4096 admitted points');
	assert.throws(() => compileInterpolationCurve({
		anchors: baseInput().anchors,
		segments: Array.from({ length: 100_001 }, () => ({ kind: 'linear' })),
	}), /100000|segment|maximum|through/iu);
	assert.throws(() => compileInterpolationCurve({
		...baseInput(),
		anchors: [
			{ position: rational(0), value: 0 },
			{ position: rational(1, 1_000_001), value: 1 },
		],
	}), /1000000|denominator|rational/iu);
	assert.throws(() => evaluateInterpolationCurve(compiled, {
		num: Number.MAX_SAFE_INTEGER,
		den: Number.MAX_SAFE_INTEGER - 1,
	}), /1000000|denominator|rational/iu);
});

test('non-exact inversion at the maximum-safe endpoint never creates an unsafe sentinel', () => {
	const maximum = Number.MAX_SAFE_INTEGER;
	const curve = compileInterpolationCurve({
		anchors: [
			{ position: rational(0), value: 0 },
			{ position: rational(maximum), value: 1 },
		],
		segments: [{ kind: 'eased' }],
	});
	const occurrences = invertInterpolationCurve(curve, 0.25);
	assert.equal(occurrences.length, 1);
	const occurrence = occurrences[0];
	assert.equal(occurrence?.kind, 'bracket');
	if (occurrence?.kind !== 'bracket') return;
	assert.equal(Number.isSafeInteger(occurrence.lower.num), true);
	assert.equal(Number.isSafeInteger(occurrence.upper.num), true);
	assert.equal(occurrence.upper.num <= maximum, true);
	assert.equal(occurrence.upper.num - occurrence.lower.num, 1);
});

test('irrational inversion brackets enclose roots inside sub-integer segments', () => {
	for (const [start, end, expected] of [
		[rational(0), rational(1, 2), { lower: rational(0), upper: rational(1) }],
		[rational(1), rational(3, 2), { lower: rational(1), upper: rational(2) }],
	] as const) {
		const curve = compileInterpolationCurve({
			anchors: [{ position: start, value: 0 }, { position: end, value: 1 }],
			segments: [{ kind: 'eased' }],
		});
		assert.deepEqual(invertInterpolationCurve(curve, 0.25), [{ kind: 'bracket', ...expected }]);
	}
});

test('44.1 kHz by 24 fps half-frame ties remain exact until one named rounding policy is chosen', () => {
	const halfVideoFrameInSamples = rational(3_675, 2);
	const curve = compileInterpolationCurve({
		anchors: [
			{ position: rational(0), value: 0 },
			{ position: halfVideoFrameInSamples, value: 1 },
		],
		segments: [{ kind: 'linear' }],
	});
	assert.equal(evaluateInterpolationCurve(curve, halfVideoFrameInSamples), 1);
	assert.deepEqual(invertInterpolationCurve(curve, 1), [{
		kind: 'point', position: halfVideoFrameInSamples,
	}]);
	assert.equal(roundRational(3_675, 2, 'point'), 1_838);
	assert.equal(roundRational(3_675, 2, 'enclosingStart'), 1_837);
	assert.equal(roundRational(3_675, 2, 'enclosingEnd'), 1_838);
});

test('finite extreme values evaluate finitely for every interpolation shape', () => {
	const maximum = Number.MAX_VALUE;
	const shapes = [{ kind: 'linear' as const }, { kind: 'eased' as const }, {
		kind: 'bezier' as const,
		control1: { position: rational(1, 3), value: maximum },
		control2: { position: rational(2, 3), value: -maximum },
	}];
	for (const shape of shapes) {
		const curve = compileInterpolationCurve({
			anchors: [
				{ position: rational(0), value: maximum },
				{ position: rational(1), value: -maximum },
			],
			segments: [shape],
		});
		for (let step = 0; step <= 64; step += 1) {
			const value = evaluateInterpolationCurve(curve, rational(step, 64));
			assert.equal(Number.isFinite(value), true, `${shape.kind} step ${String(step)}`);
			assert.ok(value <= maximum && value >= -maximum);
		}
		assert.equal(evaluateInterpolationCurve(curve, rational(1, 2)), 0);
	}
});

function baseInput() {
	return {
		anchors: [
			{ position: rational(0), value: 0 },
			{ position: rational(10), value: 1 },
		],
		segments: [{ kind: 'linear' as const }],
	};
}

function linearInput(segmentCount: number) {
	return {
		anchors: Array.from({ length: segmentCount + 1 }, (_, position) => ({
			position: rational(position), value: position,
		})),
		segments: Array.from({ length: segmentCount }, () => ({ kind: 'linear' as const })),
	};
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
	if (value === null || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);
	assert.equal(Object.isFrozen(value), true);
	for (const nested of Object.values(value)) assertDeepFrozen(nested, seen);
}
