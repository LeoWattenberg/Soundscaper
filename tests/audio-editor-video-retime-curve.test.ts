/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	compileVideoRetimeCurve,
	evaluateVideoRetimeCurve,
	invertVideoRetimeCurve,
} from '../src/common/editor/video-retime-curve.ts';

const rational = (num: number | bigint, den: number | bigint = 1) => ({
	num: Number(num),
	den: Number(den),
});
const fraction = (numerator: bigint, denominator = 1n) => ({ numerator, denominator });

test('constant forward, freeze, and reverse segments retain the V15 breakpoint semantics', () => {
	const input = {
		version: 2 as const,
		outerFrameCount: 8,
		sourceStartFrame: 0,
		sourceFrameCount: 20,
		points: [
			{ outerFrame: 0, sourceFrame: rational(2n) },
			{ outerFrame: 2, sourceFrame: rational(6n) },
			{ outerFrame: 4, sourceFrame: rational(6n) },
			{ outerFrame: 8, sourceFrame: rational(2n) },
		],
		segments: [
			{ mode: 'constant-forward' as const },
			{ mode: 'freeze' as const },
			{ mode: 'constant-reverse' as const },
		],
	};
	const before = structuredClone(input);
	const compiled = compileVideoRetimeCurve(input);

	assert.deepEqual(input, before, 'compilation must not rewrite caller state');
	assertDeepFrozen(compiled);
	assert.deepEqual(evaluateVideoRetimeCurve(compiled, rational(0n)), fraction(2n));
	assert.deepEqual(evaluateVideoRetimeCurve(compiled, rational(1n)), fraction(4n));
	assert.deepEqual(evaluateVideoRetimeCurve(compiled, rational(5n, 2n)), fraction(6n));
	assert.deepEqual(evaluateVideoRetimeCurve(compiled, rational(6n)), fraction(4n));
	assert.deepEqual(evaluateVideoRetimeCurve(compiled, rational(8n)), fraction(2n));
	assert.throws(
		() => evaluateVideoRetimeCurve(compiled, rational(-1n)),
		/outside|domain|outer/iu,
	);
	assert.throws(
		() => evaluateVideoRetimeCurve(compiled, rational(17n, 2n)),
		/outside|domain|outer/iu,
	);

	input.points[1] = { outerFrame: 2, sourceFrame: rational(20n) };
	assert.deepEqual(
		evaluateVideoRetimeCurve(compiled, rational(1n)),
		fraction(4n),
		'the compiled curve must snapshot its mutable input',
	);
});

test('forward and reverse speed ramps integrate exactly with explicit direction', () => {
	const forward = compileVideoRetimeCurve({
		version: 2,
		outerFrameCount: 4,
		sourceStartFrame: 10,
		sourceFrameCount: 8,
		points: [
			{ outerFrame: 0, sourceFrame: rational(10n) },
			{ outerFrame: 4, sourceFrame: rational(18n) },
		],
		segments: [{
				mode: 'ramp-forward',
				startVelocity: rational(1n),
				endVelocity: rational(3n),
		}],
	});
	const reverse = compileVideoRetimeCurve({
		version: 2,
		outerFrameCount: 4,
		sourceStartFrame: 10,
		sourceFrameCount: 8,
		points: [
			{ outerFrame: 0, sourceFrame: rational(18n) },
			{ outerFrame: 4, sourceFrame: rational(10n) },
		],
		segments: [{
				mode: 'ramp-reverse',
				startVelocity: rational(1n),
				endVelocity: rational(3n),
		}],
	});

	assert.deepEqual(evaluateVideoRetimeCurve(forward, rational(2n)), fraction(13n));
	assert.deepEqual(evaluateVideoRetimeCurve(forward, rational(4n)), fraction(18n));
	assert.deepEqual(evaluateVideoRetimeCurve(reverse, rational(2n)), fraction(15n));
	assert.deepEqual(evaluateVideoRetimeCurve(reverse, rational(4n)), fraction(10n));

	const zeroEndpoint = compileVideoRetimeCurve({
		version: 2,
		outerFrameCount: 4,
		sourceStartFrame: 0,
		sourceFrameCount: 8,
		points: [
			{ outerFrame: 0, sourceFrame: rational(0n) },
			{ outerFrame: 4, sourceFrame: rational(8n) },
		],
		segments: [{
			mode: 'ramp-forward',
			startVelocity: rational(0n),
			endVelocity: rational(4n),
		}],
	});
	assert.deepEqual(evaluateVideoRetimeCurve(zeroEndpoint, rational(2n)), fraction(2n));
});

test('NTSC velocity plus a 1/1000 ramp increment reduces before unsafe products are evaluated', () => {
	const compiled = compileVideoRetimeCurve({
		version: 2,
		outerFrameCount: 2_002_000_000,
		sourceStartFrame: 0,
		sourceFrameCount: 60_001_001_000,
		points: [
			{ outerFrame: 0, sourceFrame: rational(0n) },
			{ outerFrame: 2_002_000_000, sourceFrame: rational(60_001_001_000n) },
		],
		segments: [{
			mode: 'ramp-forward',
			startVelocity: rational(30_000n, 1_001n),
			endVelocity: rational(30_001_001n, 1_001_000n),
		}],
	});

	assert.deepEqual(
		evaluateVideoRetimeCurve(compiled, rational(1_001_000_000n)),
		fraction(30_000_250_250n),
	);
	assert.deepEqual(
		invertVideoRetimeCurve(compiled, rational(30_000_250_250n), { policy: 'all' }),
		[{ kind: 'point', outerFrame: 1_001_000_000 }],
		'the inverse must not enumerate the two-billion-frame outer domain',
	);
});

test('evaluation keeps an exact BigInt denominator beyond the persisted rational boundary', () => {
	const maximum = Number.MAX_SAFE_INTEGER;
	const compiled = compileVideoRetimeCurve({
		version: 2,
		outerFrameCount: maximum,
		sourceStartFrame: 0,
		sourceFrameCount: 1,
		points: [
			{ outerFrame: 0, sourceFrame: rational(0n) },
			{ outerFrame: maximum, sourceFrame: rational(1n) },
		],
		segments: [{
			mode: 'ramp-forward',
			startVelocity: rational(0n),
			endVelocity: rational(2n, BigInt(maximum)),
		}],
	});
	const evaluated = evaluateVideoRetimeCurve(compiled, rational(1n));

	assert.deepEqual(evaluated, fraction(1n, BigInt(maximum) ** 2n));
	assertDeepFrozen(evaluated);
	assert.deepEqual(
		evaluateVideoRetimeCurve(compiled, evaluated),
		fraction(1n, BigInt(maximum) ** 6n),
		'exact runtime output composes as another curve outer coordinate without narrowing',
	);
	assert.deepEqual(
		invertVideoRetimeCurve(compiled, evaluated, { policy: 'all' }),
		[{ kind: 'point', outerFrame: 1 }],
		'the inverse accepts exact runtime output without narrowing it to a persisted rational',
	);
});

test('runtime exact queries refuse beyond the bounded BigInt complexity budget', () => {
	const compiled = compileVideoRetimeCurve(baseInput());
	const oversized = fraction(1n, 1n << 4_096n);
	assert.throws(
		() => evaluateVideoRetimeCurve(compiled, oversized),
		/4096|bit|complexity|exact rational/iu,
	);
	assert.throws(
		() => invertVideoRetimeCurve(compiled, oversized, { policy: 'all' }),
		/4096|bit|complexity|exact rational/iu,
	);
});

test('direction changes require explicit zero ramp velocities while same-direction jumps remain legal', () => {
	assert.throws(() => compileVideoRetimeCurve({
		version: 2,
		outerFrameCount: 2,
		sourceStartFrame: 0,
		sourceFrameCount: 1,
		points: [
			{ outerFrame: 0, sourceFrame: rational(0n) },
			{ outerFrame: 1, sourceFrame: rational(1n) },
			{ outerFrame: 2, sourceFrame: rational(0n) },
		],
		segments: [{ mode: 'constant-forward' }, { mode: 'constant-reverse' }],
	}), /direction|zero|velocity/iu, 'constant-speed reversal hides a nonzero crossing');

	assert.throws(() => compileVideoRetimeCurve({
		version: 2,
		outerFrameCount: 4,
		sourceStartFrame: 0,
		sourceFrameCount: 2,
		points: [
			{ outerFrame: 0, sourceFrame: rational(0n) },
			{ outerFrame: 2, sourceFrame: rational(2n) },
			{ outerFrame: 4, sourceFrame: rational(0n) },
		],
		segments: [
			{ mode: 'ramp-forward', startVelocity: rational(1n), endVelocity: rational(1n) },
			{ mode: 'ramp-reverse', startVelocity: rational(1n), endVelocity: rational(1n) },
		],
	}), /direction|zero|velocity/iu);

	const zeroCrossing = compileVideoRetimeCurve({
		version: 2,
		outerFrameCount: 4,
		sourceStartFrame: 0,
		sourceFrameCount: 2,
		points: [
			{ outerFrame: 0, sourceFrame: rational(0n) },
			{ outerFrame: 2, sourceFrame: rational(2n) },
			{ outerFrame: 4, sourceFrame: rational(0n) },
		],
		segments: [
			{ mode: 'ramp-forward', startVelocity: rational(2n), endVelocity: rational(0n) },
			{ mode: 'ramp-reverse', startVelocity: rational(0n), endVelocity: rational(2n) },
		],
	});
	assert.deepEqual(evaluateVideoRetimeCurve(zeroCrossing, rational(2n)), fraction(2n));

	const speedJump = compileVideoRetimeCurve({
		version: 2,
		outerFrameCount: 4,
		sourceStartFrame: 0,
		sourceFrameCount: 6,
		points: [
			{ outerFrame: 0, sourceFrame: rational(0n) },
			{ outerFrame: 2, sourceFrame: rational(2n) },
			{ outerFrame: 4, sourceFrame: rational(6n) },
		],
		segments: [
			{ mode: 'ramp-forward', startVelocity: rational(1n), endVelocity: rational(1n) },
			{ mode: 'ramp-forward', startVelocity: rational(2n), endVelocity: rational(2n) },
		],
	});
	assert.deepEqual(evaluateVideoRetimeCurve(speedJump, rational(3n)), fraction(4n));
});

test('inverse reports exact points, maximal freeze ranges, and irrational-root brackets without approximation', () => {
	const repeated = compileVideoRetimeCurve({
		version: 2,
		outerFrameCount: 8,
		sourceStartFrame: 0,
		sourceFrameCount: 2,
		points: [
			{ outerFrame: 0, sourceFrame: rational(0n) },
			{ outerFrame: 2, sourceFrame: rational(2n) },
			{ outerFrame: 4, sourceFrame: rational(2n) },
			{ outerFrame: 6, sourceFrame: rational(0n) },
			{ outerFrame: 8, sourceFrame: rational(2n) },
		],
		segments: [
			{ mode: 'constant-forward' },
			{ mode: 'freeze' },
			{ mode: 'ramp-reverse', startVelocity: rational(2n), endVelocity: rational(0n) },
			{ mode: 'ramp-forward', startVelocity: rational(0n), endVelocity: rational(2n) },
		],
	});

	assert.deepEqual(invertVideoRetimeCurve(repeated, rational(1n), { policy: 'all' }), [
		{ kind: 'point', outerFrame: 1 },
		{ kind: 'bracket', beforeOuterFrame: 4, afterOuterFrame: 5 },
		{ kind: 'bracket', beforeOuterFrame: 7, afterOuterFrame: 8 },
	]);
	assert.deepEqual(invertVideoRetimeCurve(repeated, rational(2n), { policy: 'all' }), [
		{ kind: 'range', startOuterFrame: 2, endOuterFrame: 4 },
		{ kind: 'point', outerFrame: 8 },
	], 'half-open segment ownership must dedupe shared boundaries and merge the freeze run');
	assert.deepEqual(invertVideoRetimeCurve(repeated, rational(2n), { policy: 'earliest' }), [
		{ kind: 'range', startOuterFrame: 2, endOuterFrame: 4 },
	]);
	assert.deepEqual(invertVideoRetimeCurve(repeated, rational(2n), { policy: 'latest' }), [
		{ kind: 'point', outerFrame: 8 },
	]);
	assert.deepEqual(invertVideoRetimeCurve(repeated, rational(2n), {
		policy: 'nearest-cell', outerHint: 6,
	}), [{ kind: 'range', startOuterFrame: 2, endOuterFrame: 4 }], 'equal cell distance breaks earlier');
	assert.deepEqual(invertVideoRetimeCurve(repeated, rational(2n), {
		policy: 'nearest-cell', outerHint: 7,
	}), [{ kind: 'point', outerFrame: 8 }]);
	assert.deepEqual(invertVideoRetimeCurve(repeated, rational(1n), {
		policy: 'nearest-cell', outerHint: Number.MIN_SAFE_INTEGER,
	}), [{ kind: 'point', outerFrame: 1 }], 'cell distance remains exact beyond safe subtraction');
	assert.throws(
		() => invertVideoRetimeCurve(repeated, rational(1n), { policy: 'nearest-cell' }),
		/hint|outerHint/iu,
	);
	assert.deepEqual(invertVideoRetimeCurve(repeated, rational(3n), { policy: 'all' }), []);

	const ramp = compileVideoRetimeCurve({
		version: 2,
		outerFrameCount: 4,
		sourceStartFrame: 0,
		sourceFrameCount: 8,
		points: [
			{ outerFrame: 0, sourceFrame: rational(0n) },
			{ outerFrame: 4, sourceFrame: rational(8n) },
		],
		segments: [{
			mode: 'ramp-forward',
			startVelocity: rational(1n),
			endVelocity: rational(3n),
		}],
	});
	assert.deepEqual(invertVideoRetimeCurve(ramp, rational(3n), { policy: 'all' }), [
		{ kind: 'point', outerFrame: 2 },
	]);
	assert.deepEqual(invertVideoRetimeCurve(ramp, rational(1n), { policy: 'all' }), [
		{ kind: 'bracket', beforeOuterFrame: 0, afterOuterFrame: 1 },
	]);
	assert.deepEqual(invertVideoRetimeCurve(ramp, rational(9n), { policy: 'all' }), []);
	assertDeepFrozen(invertVideoRetimeCurve(repeated, rational(2n), { policy: 'all' }));

	const turningRamp = compileVideoRetimeCurve({
		version: 2,
		outerFrameCount: 4,
		sourceStartFrame: 0,
		sourceFrameCount: 2,
		points: [
			{ outerFrame: 0, sourceFrame: rational(0n) },
			{ outerFrame: 2, sourceFrame: rational(2n) },
			{ outerFrame: 4, sourceFrame: rational(0n) },
		],
		segments: [
			{ mode: 'ramp-forward', startVelocity: rational(2n), endVelocity: rational(0n) },
			{ mode: 'ramp-reverse', startVelocity: rational(0n), endVelocity: rational(2n) },
		],
	});
	const adjacentBrackets = [
		{ kind: 'bracket', beforeOuterFrame: 1, afterOuterFrame: 2 },
		{ kind: 'bracket', beforeOuterFrame: 2, afterOuterFrame: 3 },
	];
	assert.deepEqual(
		invertVideoRetimeCurve(turningRamp, rational(7n, 4n), { policy: 'all' }),
		adjacentBrackets,
		'distinct occurrence cells that only touch at a shared boundary must not merge',
	);
	assert.deepEqual(invertVideoRetimeCurve(turningRamp, rational(7n, 4n), {
		policy: 'nearest-cell', outerHint: 2,
	}), [adjacentBrackets[0]], 'equal adjacent-cell distance breaks toward the earlier occurrence');
});

test('compile rejects malformed, noncanonical, out-of-domain, and direction-inconsistent curves', () => {
	const valid = baseInput();
	const cases: readonly Readonly<{ name: string; input: unknown; error: RegExp }>[] = [
		{ name: 'version', input: { ...valid, version: 1 }, error: /version/iu },
		{ name: 'extra top-level key', input: { ...valid, derivedCache: [] }, error: /unsupported|key|field/iu },
		{ name: 'missing segment', input: { ...valid, segments: [] }, error: /segment|point/iu },
		{ name: 'first outer', input: { ...valid, points: [
			{ outerFrame: 1, sourceFrame: rational(0n) }, valid.points[1],
		] }, error: /first|zero|outer/iu },
		{ name: 'last outer', input: { ...valid, points: [
			valid.points[0], { outerFrame: 3, sourceFrame: rational(4n) },
		] }, error: /last|count|outer/iu },
		{ name: 'unordered outer', input: { ...valid, points: [
			valid.points[0], { outerFrame: 0, sourceFrame: rational(4n) },
		] }, error: /increas|outer/iu },
		{ name: 'source below bound', input: { ...valid, points: [
			{ outerFrame: 0, sourceFrame: rational(-1n) }, valid.points[1],
		] }, error: /source|bound|range/iu },
		{ name: 'source above bound', input: { ...valid, points: [
			valid.points[0], { outerFrame: 4, sourceFrame: rational(5n) },
		] }, error: /source|bound|range/iu },
		{ name: 'noncanonical rational', input: { ...valid, points: [
			{ outerFrame: 0, sourceFrame: rational(0n, 2n) }, valid.points[1],
		] }, error: /canonical|reduc/iu },
		{ name: 'point extra key', input: { ...valid, points: [
			{ ...valid.points[0], cache: 0 }, valid.points[1],
		] }, error: /unsupported|key|field/iu },
		{ name: 'forward decreases', input: { ...valid, points: [...valid.points].reverse().map(
			(point, index) => ({ ...point, outerFrame: index * 4 }),
		) }, error: /forward|direction|source/iu },
		{ name: 'reverse increases', input: { ...valid, segments: [{ mode: 'constant-reverse' }] }, error: /reverse|direction|source/iu },
		{ name: 'freeze moves', input: { ...valid, segments: [{ mode: 'freeze' }] }, error: /freeze|source/iu },
		{ name: 'constant speed payload', input: { ...valid, segments: [{
			mode: 'constant-forward', startVelocity: rational(1n),
		}] }, error: /unsupported|velocity|field/iu },
		{ name: 'negative ramp speed', input: { ...valid, segments: [{
			mode: 'ramp-forward', startVelocity: rational(-1n), endVelocity: rational(3n),
		}] }, error: /velocity|non-negative|direction/iu },
		{ name: 'ramp integral mismatch', input: { ...valid, segments: [{
			mode: 'ramp-forward', startVelocity: rational(2n), endVelocity: rational(2n),
		}] }, error: /integral|endpoint|source/iu },
		{ name: 'ramp extra key', input: { ...valid, segments: [{
			mode: 'ramp-forward', startVelocity: rational(0n), endVelocity: rational(2n), curve: 'quadratic',
		}] }, error: /unsupported|key|field/iu },
	];

	for (const fixture of cases) {
		assert.throws(
			() => compileVideoRetimeCurve(fixture.input),
			fixture.error,
			fixture.name,
		);
	}
});

test('compile rejects accessors, sparse arrays, and non-plain records without invoking getters', () => {
	let getterCalls = 0;
	const accessor = { ...baseInput() } as Record<string, unknown>;
	Object.defineProperty(accessor, 'points', {
		enumerable: true,
		get() {
			getterCalls += 1;
			return baseInput().points;
		},
	});
	assert.throws(
		() => compileVideoRetimeCurve(accessor),
		/accessor|data property|plain/iu,
	);
	assert.equal(getterCalls, 0);
	const hiddenAccessor = { ...baseInput() } as Record<string, unknown>;
	Object.defineProperty(hiddenAccessor, 'version', {
		get() {
			getterCalls += 1;
			return 2;
		},
	});
	assert.throws(() => compileVideoRetimeCurve(hiddenAccessor), /accessor|data property|enumerable/iu);
	assert.equal(getterCalls, 0);
	let pointGetterCalls = 0;
	const accessorPoint = { outerFrame: 0 } as Record<string, unknown>;
	Object.defineProperty(accessorPoint, 'sourceFrame', {
		enumerable: true,
		get() {
			pointGetterCalls += 1;
			return rational(0n);
		},
	});
	assert.throws(
		() => compileVideoRetimeCurve({ ...baseInput(), points: [accessorPoint, baseInput().points[1]] }),
		/accessor|data property|plain/iu,
	);
	assert.equal(pointGetterCalls, 0);

	const sparsePoints = new Array<unknown>(2);
	sparsePoints[0] = baseInput().points[0];
	assert.throws(
		() => compileVideoRetimeCurve({ ...baseInput(), points: sparsePoints }),
		/dense|sparse|point/iu,
	);
	const sparseSegments = new Array<unknown>(1);
	assert.throws(
		() => compileVideoRetimeCurve({ ...baseInput(), segments: sparseSegments }),
		/dense|sparse|segment/iu,
	);

	const inherited = Object.assign(Object.create({ inherited: true }) as object, baseInput());
	assert.throws(
		() => compileVideoRetimeCurve(inherited),
		/plain|prototype|record/iu,
	);
});

test('public boundaries refuse hostile coercion, inherited array methods, and oversized raw BigInts', () => {
	const compiled = compileVideoRetimeCurve(baseInput());
	let policyCoercions = 0;
	assert.throws(
		() => invertVideoRetimeCurve(compiled, rational(1n), {
			policy: {
				toString() {
					policyCoercions += 1;
					return 'all';
				},
			},
		}),
		/policy|string/iu,
	);
	assert.equal(policyCoercions, 0);

	let inheritedMapCalls = 0;
	const points = [...baseInput().points];
	Object.setPrototypeOf(points, Object.assign(Object.create(Array.prototype) as object, {
		map() {
			inheritedMapCalls += 1;
			return baseInput().points;
		},
	}));
	assert.throws(
		() => compileVideoRetimeCurve({ ...baseInput(), points }),
		/array|prototype/iu,
	);
	assert.equal(inheritedMapCalls, 0);

	const oversizedReducible = 1n << 4_096n;
	assert.throws(
		() => evaluateVideoRetimeCurve(compiled, fraction(oversizedReducible, oversizedReducible)),
		/4096|bit|complexity/iu,
		'raw exact operands must be bounded before normalization or GCD',
	);
});

test('compile admits at most 4096 segments and inverse stays bounded by segments rather than outer frames', () => {
	const maximum = linearInput(4_096);
	const compiled = compileVideoRetimeCurve(maximum);
	assert.deepEqual(invertVideoRetimeCurve(compiled, rational(2_048n), { policy: 'all' }), [
		{ kind: 'point', outerFrame: 2_048 },
	]);
	assert.throws(() => compileVideoRetimeCurve(linearInput(4_097)), /4096|segment|maximum/iu);
});

function baseInput() {
	return {
		version: 2 as const,
		outerFrameCount: 4,
		sourceStartFrame: 0,
		sourceFrameCount: 4,
		points: [
			{ outerFrame: 0, sourceFrame: rational(0n) },
			{ outerFrame: 4, sourceFrame: rational(4n) },
		],
		segments: [{ mode: 'constant-forward' as const }],
	};
}

function linearInput(segmentCount: number) {
	return {
		version: 2 as const,
		outerFrameCount: segmentCount,
		sourceStartFrame: 0,
		sourceFrameCount: segmentCount,
		points: Array.from({ length: segmentCount + 1 }, (_, outerFrame) => ({
			outerFrame,
			sourceFrame: rational(BigInt(outerFrame)),
		})),
		segments: Array.from({ length: segmentCount }, () => ({ mode: 'constant-forward' as const })),
	};
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
	if (value === null || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);
	assert.equal(Object.isFrozen(value), true);
	for (const nested of Object.values(value)) assertDeepFrozen(nested, seen);
}
