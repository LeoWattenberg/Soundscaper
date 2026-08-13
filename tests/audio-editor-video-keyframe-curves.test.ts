/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
} from '../src/common/editor/video-clip-composition.ts';
import {
	MAXIMUM_VIDEO_KEYFRAME_ANCHORS,
	MAXIMUM_VIDEO_KEYFRAME_CURVES,
	cloneVideoKeyframeCurves,
	createDefaultVideoKeyframeCurves,
	evaluateVideoKeyframeCurves,
	isDefaultVideoKeyframeCurves,
	joinVideoKeyframeCurves,
	normalizeVideoKeyframeCurves,
	splitVideoKeyframeCurvesAt,
	stretchVideoKeyframeCurves,
	trimVideoKeyframeCurvesToRange,
	videoKeyframeCurvesEqual,
} from '../src/common/editor/video-keyframe-curves.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
const rational = (num: number, den = 1) => ({ num, den });
const timeDomain = (authoredDuration = 10, viewStart = 0, viewDuration = 10) => ({
	authoredDuration: rational(authoredDuration),
	viewStart: rational(viewStart),
	viewDuration: rational(viewDuration),
});
const keyframes = (curves: readonly unknown[], domain: unknown = timeDomain()) => ({
	schemaVersion: 1,
	timeDomain: domain,
	curves,
});
const linearCurve = (startValue: number, endValue: number, start = 0, end = 10) => ({
	anchors: [
		{ position: rational(start), value: startValue },
		{ position: rational(end), value: endValue },
	],
	segments: [{ kind: 'linear' as const }],
});
const holdCurve = (startValue: number, endValue: number, start = 0, end = 10) => ({
	anchors: [
		{ position: rational(start), value: startValue },
		{ position: rational(end), value: endValue },
	],
	segments: [{ kind: 'hold' as const }],
});

function options(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		duration: rational(10),
		composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		videoEffects: [
			createVideoEffect('color-adjust', { id: 'color' }),
			createVideoEffect('pixelate', { id: 'pixels' }),
			createVideoEffect('luma-key', { id: 'luma' }),
		],
		...overrides,
	};
}

test('normalization detaches, freezes, canonicalizes, sorts, and evaluates every shared curve shape', () => {
	const input = {
		schemaVersion: 1,
		timeDomain: timeDomain(),
		curves: [{
			target: { kind: 'video-effect', effectId: 'color', parameterId: 'brightness' },
			curve: linearCurve(-1, 1, 2, 8),
		}, {
			target: { kind: 'composition', parameterId: 'transform.rotationDegrees' },
			curve: {
				anchors: [
					{ position: rational(0), value: 0 },
					{ position: rational(10), value: 90 },
				],
				segments: [{
					kind: 'bezier',
					control1: { position: rational(10, 3), value: 30 },
					control2: { position: rational(20, 3), value: 60 },
				}],
			},
		}, {
			target: { kind: 'composition', parameterId: 'transform.positionX' },
			curve: {
				anchors: [
					{ position: rational(0), value: -1 },
					{ position: rational(10), value: 1 },
				],
				segments: [{ kind: 'eased' }],
			},
		}, {
			target: { kind: 'composition', parameterId: 'opacity' },
			curve: holdCurve(0.25, 0.75),
		}, {
			target: { kind: 'video-effect', effectId: 'pixels', parameterId: 'blockSize' },
			curve: holdCurve(8, 32),
		}],
	};
	const before = structuredClone(input);
	const normalized = normalizeVideoKeyframeCurves(input, options());

	assert.deepEqual(input, before);
	assertDeepFrozen(normalized);
	assert.deepEqual(normalized.curves.map(({ target }) => target), [
		{ kind: 'composition', parameterId: 'opacity' },
		{ kind: 'composition', parameterId: 'transform.positionX' },
		{ kind: 'composition', parameterId: 'transform.rotationDegrees' },
		{ kind: 'video-effect', effectId: 'color', parameterId: 'brightness' },
		{ kind: 'video-effect', effectId: 'pixels', parameterId: 'blockSize' },
	]);
	assert.deepEqual(normalized.curves[3]?.curve.anchors.map(({ position }) => position), [
		rational(2), rational(8),
	]);
	assert.deepEqual(normalizeVideoKeyframeCurves(normalized, options()), normalized);
	assert.notStrictEqual(normalizeVideoKeyframeCurves(normalized, options()), normalized);

	assert.deepEqual(evaluateVideoKeyframeCurves(normalized, rational(1, 2)), [
		{ target: { kind: 'composition', parameterId: 'opacity' }, value: 0.25 },
		{ target: { kind: 'composition', parameterId: 'transform.positionX' }, value: -0.9855 },
		{ target: { kind: 'composition', parameterId: 'transform.rotationDegrees' }, value: 4.5 },
		{ target: { kind: 'video-effect', effectId: 'color', parameterId: 'brightness' }, value: -1 },
		{ target: { kind: 'video-effect', effectId: 'pixels', parameterId: 'blockSize' }, value: 8 },
	]);
	assert.deepEqual(evaluateVideoKeyframeCurves(normalized, rational(5)), [
		{ target: { kind: 'composition', parameterId: 'opacity' }, value: 0.25 },
		{ target: { kind: 'composition', parameterId: 'transform.positionX' }, value: 0 },
		{ target: { kind: 'composition', parameterId: 'transform.rotationDegrees' }, value: 45 },
		{ target: { kind: 'video-effect', effectId: 'color', parameterId: 'brightness' }, value: 0 },
		{ target: { kind: 'video-effect', effectId: 'pixels', parameterId: 'blockSize' }, value: 8 },
	]);
	const atEnd = evaluateVideoKeyframeCurves(normalized, rational(10));
	assert.equal(atEnd[3]?.value, 1, 'evaluation holds the last authored value to the clip end');
	assertDeepFrozen(atEnd);

	input.curves[0]!.curve.anchors[0]!.value = 0;
	assert.equal(evaluateVideoKeyframeCurves(normalized, rational(2))[3]?.value, -1);
});

test('empty is canonical and curve and anchor collections have exact local ceilings', () => {
	const contextualDefault = createDefaultVideoKeyframeCurves(rational(10));
	const empty = normalizeVideoKeyframeCurves(contextualDefault, options());
	assert.deepEqual(empty, keyframes([]));
	assertDeepFrozen(contextualDefault);
	assert.deepEqual(createDefaultVideoKeyframeCurves(rational(7)).timeDomain, timeDomain(7, 0, 7));
	assert.throws(
		() => (createDefaultVideoKeyframeCurves as (duration?: unknown) => unknown)(),
		/duration|rational|record/iu,
		'there is no context-free persisted default',
	);

	const anchors = Array.from({ length: MAXIMUM_VIDEO_KEYFRAME_ANCHORS }, (_, index) => ({
		position: rational(index), value: index % 2,
	}));
	const segments = Array.from({ length: anchors.length - 1 }, () => ({ kind: 'linear' as const }));
	const maximumAnchors = normalizeVideoKeyframeCurves(keyframes([{
		target: { kind: 'composition', parameterId: 'opacity' },
		curve: { anchors, segments },
	}], timeDomain(MAXIMUM_VIDEO_KEYFRAME_ANCHORS - 1, 0, MAXIMUM_VIDEO_KEYFRAME_ANCHORS - 1)), options({ duration: rational(MAXIMUM_VIDEO_KEYFRAME_ANCHORS - 1) }));
	assert.equal(maximumAnchors.curves[0]?.curve.anchors.length, MAXIMUM_VIDEO_KEYFRAME_ANCHORS);
	assert.throws(() => normalizeVideoKeyframeCurves(keyframes([{
		target: { kind: 'composition', parameterId: 'opacity' },
		curve: {
			anchors: [...anchors, { position: rational(MAXIMUM_VIDEO_KEYFRAME_ANCHORS), value: 0 }],
			segments: [...segments, { kind: 'linear' }],
		},
	}], timeDomain(MAXIMUM_VIDEO_KEYFRAME_ANCHORS, 0, MAXIMUM_VIDEO_KEYFRAME_ANCHORS)), options({ duration: rational(MAXIMUM_VIDEO_KEYFRAME_ANCHORS) })), /4096|entries|anchor/iu);

	const effects = Array.from({ length: MAXIMUM_VIDEO_KEYFRAME_CURVES + 1 }, (_, index) => (
		createVideoEffect('color-adjust', { id: `effect-${String(index)}` })
	));
	const curves = effects.map((effect) => ({
		target: { kind: 'video-effect', effectId: effect.id, parameterId: 'brightness' },
		curve: linearCurve(-1, 1),
	}));
	assert.equal(normalizeVideoKeyframeCurves(keyframes(
		curves.slice(0, MAXIMUM_VIDEO_KEYFRAME_CURVES),
	), options({ videoEffects: effects })).curves.length, MAXIMUM_VIDEO_KEYFRAME_CURVES);
	assert.throws(() => normalizeVideoKeyframeCurves(keyframes(curves), options({
		videoEffects: effects,
	})), /256|entries|curve/iu);
});

test('clone, default detection, and semantic equality normalize exact curve values', () => {
	const first = keyframes([{
		target: { kind: 'video-effect', effectId: 'color', parameterId: 'brightness' },
		curve: linearCurve(-1, 1),
	}, {
		target: { kind: 'composition', parameterId: 'opacity' },
		curve: linearCurve(0, 1),
	}]);
	const reordered = { ...first, curves: [...first.curves].reverse() };
	const clone = cloneVideoKeyframeCurves(first, options());

	assert.deepEqual(clone, normalizeVideoKeyframeCurves(first, options()));
	assert.notStrictEqual(clone, first);
	assert.notStrictEqual(clone.curves[0], first.curves[1]);
	assert.equal(isDefaultVideoKeyframeCurves(createDefaultVideoKeyframeCurves(rational(10)), options()), true);
	assert.equal(isDefaultVideoKeyframeCurves(first, options()), false);
	assert.equal(videoKeyframeCurvesEqual(first, reordered, options()), true);
	assert.equal(videoKeyframeCurvesEqual(first, { ...first, curves: [{
		target: { kind: 'video-effect', effectId: 'color', parameterId: 'brightness' },
		curve: linearCurve(-1, 0.5),
	}, first.curves[1]!] }, options()), false);
});

test('persisted times require canonical reduced rational objects', () => {
	const normalized = normalizeVideoKeyframeCurves(keyframes([{
		target: { kind: 'composition', parameterId: 'opacity' },
		curve: {
			anchors: [
				{ position: rational(1, 2), value: 0 },
				{ position: rational(5), value: 1 },
			],
			segments: [{ kind: 'linear' }],
		},
	}]), options());
	assert.deepEqual(normalized.curves[0]?.curve.anchors.map(({ position }) => position), [
		rational(1, 2), rational(5),
	]);

	for (const curve of [{
		anchors: [{ position: 0, value: 0 }, { position: rational(10), value: 1 }],
		segments: [{ kind: 'linear' }],
	}, {
		anchors: [{ position: rational(0), value: 0 }, { position: rational(10), value: 1 }],
		segments: [{
			kind: 'bezier',
			control1: { position: 2, value: 0.25 },
			control2: { position: rational(8), value: 0.75 },
		}],
	}]) assert.throws(() => normalizeVideoKeyframeCurves(keyframes([{
		target: { kind: 'composition', parameterId: 'opacity' }, curve,
	}]), options()), /rational object|position/iu);

	for (const curve of [{
		anchors: [{ position: rational(0), value: 0 }, { position: rational(2, 2), value: 1 }],
		segments: [{ kind: 'linear' }],
	}, {
		anchors: [{ position: rational(0), value: 0 }, { position: rational(2), value: 1 }],
		segments: [{
			kind: 'bezier',
			control1: { position: rational(2, 2), value: 0.25 },
			control2: { position: rational(3, 2), value: 0.75 },
		}],
	}]) assert.throws(() => normalizeVideoKeyframeCurves(keyframes([{
		target: { kind: 'composition', parameterId: 'opacity' }, curve,
	}]), options()), /canonical|reduced|rational/iu);
});

test('trim, split, stretch, and join preserve arbitrary Bezier paths through exact view windows', () => {
	const source = normalizeVideoKeyframeCurves(keyframes([{
		target: { kind: 'composition', parameterId: 'opacity' },
		curve: {
			anchors: [
				{ position: rational(1), value: 0 },
				{ position: rational(9), value: 1 },
			],
			segments: [{
				kind: 'bezier',
				control1: { position: rational(3), value: 0.25 },
				control2: { position: rational(7), value: 0.75 },
			}],
		},
	}]), options());
	const trimmed = trimVideoKeyframeCurvesToRange(source, options(), {
		start: rational(2), end: rational(8),
	});
	assert.deepEqual(trimmed.timeDomain, timeDomain(10, 2, 6));
	assert.deepEqual(trimmed.curves, source.curves, 'trim retains the complete arbitrary cubic path');
	for (const position of [rational(0), rational(1), rational(3), rational(6)]) {
		assert.equal(
			evaluateVideoKeyframeCurves(trimmed, position)[0]?.value,
			evaluateVideoKeyframeCurves(source, { num: position.num + 2 * position.den, den: position.den })[0]?.value,
		);
	}
	const split = splitVideoKeyframeCurvesAt(source, options(), rational(4));
	assert.deepEqual(split.left.timeDomain, timeDomain(10, 0, 4));
	assert.deepEqual(split.right.timeDomain, timeDomain(10, 4, 6));
	assert.deepEqual(split.left.curves, split.right.curves);
	assert.notStrictEqual(split.left.curves, split.right.curves);
	assert.deepEqual(joinVideoKeyframeCurves(
		split.left, options({ duration: rational(4) }),
		split.right, options({ duration: rational(6) }),
	), source);
	const stretched = stretchVideoKeyframeCurves(source, options(), rational(20));
	assert.deepEqual(stretched.timeDomain, source.timeDomain);
	assert.equal(evaluateVideoKeyframeCurves(stretched, rational(10))[0]?.value,
		evaluateVideoKeyframeCurves(source, rational(5))[0]?.value);
	assertDeepFrozen(trimmed);
});

test('trim extension shifts the whole path exactly and refuses unpersistable rational overflow transactionally', () => {
	const source = normalizeVideoKeyframeCurves(keyframes([{
		target: { kind: 'composition', parameterId: 'opacity' },
		curve: {
			anchors: [
				{ position: rational(1), value: 0 },
				{ position: rational(9), value: 1 },
			],
			segments: [{
				kind: 'bezier',
				control1: { position: rational(3), value: 0.25 },
				control2: { position: rational(7), value: 0.75 },
			}],
		},
	}]), options());
	const extended = trimVideoKeyframeCurvesToRange(source, options(), {
		start: rational(-2), end: rational(12),
	});
	assert.deepEqual(extended.timeDomain, timeDomain(14, 0, 14));
	assert.deepEqual(extended.curves[0]?.curve.anchors.map(({ position }) => position), [
		rational(3), rational(11),
	]);
	assert.deepEqual(extended.curves[0]?.curve.segments[0], {
		kind: 'bezier',
		control1: { position: rational(5), value: 0.25 },
		control2: { position: rational(9), value: 0.75 },
	});
	assert.equal(
		evaluateVideoKeyframeCurves(extended, rational(4))[0]?.value,
		evaluateVideoKeyframeCurves(source, rational(2))[0]?.value,
	);

	const overflowSource = normalizeVideoKeyframeCurves(keyframes([{
		target: { kind: 'composition', parameterId: 'opacity' },
		curve: {
			anchors: [
				{ position: rational(1, 1_000_000), value: 0 },
				{ position: rational(1), value: 1 },
			],
			segments: [{ kind: 'linear' }],
		},
	}], timeDomain(1, 0, 1)), options({ duration: rational(1) }));
	const before = structuredClone(overflowSource);
	assert.throws(() => trimVideoKeyframeCurvesToRange(
		overflowSource,
		options({ duration: rational(1) }),
		{ start: rational(-1, 999_983), end: rational(1) },
	), /persisted|denominator|rational/iu);
	assert.deepEqual(overflowSource, before);
});

test('rejoin refuses a gap, a rate mismatch, or a different authored path', () => {
	const source = normalizeVideoKeyframeCurves(keyframes([{
		target: { kind: 'composition', parameterId: 'opacity' }, curve: linearCurve(0, 1),
	}]), options());
	const left = trimVideoKeyframeCurvesToRange(source, options(), { start: rational(0), end: rational(4) });
	const gap = trimVideoKeyframeCurvesToRange(source, options(), { start: rational(5), end: rational(10) });
	assert.throws(() => joinVideoKeyframeCurves(
		left, options({ duration: rational(4) }), gap, options({ duration: rational(5) }),
	), /adjacent|ordered/iu);
	const right = trimVideoKeyframeCurvesToRange(source, options(), { start: rational(4), end: rational(10) });
	assert.throws(() => joinVideoKeyframeCurves(
		left, options({ duration: rational(4) }), right, options({ duration: rational(12) }),
	), /rate|stretch/iu);
	const different = normalizeVideoKeyframeCurves({ ...right, curves: [{
		target: { kind: 'composition', parameterId: 'opacity' }, curve: linearCurve(0.1, 1),
	}] }, options({ duration: rational(6) }));
	assert.throws(() => joinVideoKeyframeCurves(
		left, options({ duration: rational(4) }), different, options({ duration: rational(6) }),
	), /identical|path/iu);
});

test('visible affine mapping keeps derived denominators exact beyond the persisted ceiling', () => {
	const duration = rational(1_000_001);
	const normalized = normalizeVideoKeyframeCurves(keyframes([{
		target: { kind: 'composition', parameterId: 'opacity' },
		curve: {
			anchors: [{ position: rational(0), value: 0 }, { position: rational(1), value: 1 }],
			segments: [{ kind: 'linear' }],
		},
	}], {
		authoredDuration: rational(1),
		viewStart: rational(0),
		viewDuration: rational(1, 1_000_000),
	}), options({ duration }));
	assert.equal(
		evaluateVideoKeyframeCurves(normalized, rational(1))[0]?.value,
		1 / 1_000_001_000_000,
	);

	const cancellation = normalizeVideoKeyframeCurves(keyframes([{
		target: { kind: 'composition', parameterId: 'opacity' },
		curve: linearCurve(0, 1, 0, 1_000_000_000),
	}], timeDomain(1_000_000_000, 0, 1_000_000_000)), options({
		duration: rational(1_000_000_000),
	}));
	assert.equal(evaluateVideoKeyframeCurves(cancellation, rational(1_000_000_000))[0]?.value, 1);

	const before = structuredClone(cancellation);
	assert.throws(() => trimVideoKeyframeCurvesToRange(
		cancellation,
		options({ duration: rational(1) }),
		{ start: rational(0), end: rational(1_000_000_000) },
	), /safe integer domain|rational result/iu);
	assert.deepEqual(cancellation, before, 'a true mapped overflow refuses without mutating source authority');
});

test('composition and registered effect ranges, integer rules, and target existence are contextual', () => {
	const validCompositionTargets = [
		['crop.left', 0, 0.9], ['crop.top', 0, 0.9],
		['crop.right', 0, 0.9], ['crop.bottom', 0, 0.9],
		['transform.anchorX', 0, 1], ['transform.anchorY', 0, 1],
		['transform.positionX', -8, 8], ['transform.positionY', -8, 8],
		['transform.scaleX', 0.01, 100], ['transform.scaleY', 0.01, 100],
		['transform.rotationDegrees', -36_000, 36_000], ['opacity', 0, 1],
	] as const;
	for (const [parameterId, minimum, maximum] of validCompositionTargets) {
		assert.doesNotThrow(() => normalizeVideoKeyframeCurves(keyframes([{
			target: { kind: 'composition', parameterId }, curve: linearCurve(minimum, maximum),
		}]), options()), parameterId);
	}
	for (const fixture of [{
		name: 'unknown composition identity',
		target: { kind: 'composition', parameterId: 'blendMode' }, curve: holdCurve(0, 1),
	}, {
		name: 'discrete composition order',
		target: { kind: 'composition', parameterId: 'compositingOrder' }, curve: holdCurve(0, 1),
	}, {
		name: 'missing effect instance',
		target: { kind: 'video-effect', effectId: 'missing', parameterId: 'brightness' },
		curve: linearCurve(-1, 1),
	}, {
		name: 'unregistered effect parameter',
		target: { kind: 'video-effect', effectId: 'color', parameterId: 'blockSize' },
		curve: linearCurve(0, 1),
	}, {
		name: 'composition outside range',
		target: { kind: 'composition', parameterId: 'opacity' }, curve: linearCurve(0, 1.01),
	}, {
		name: 'effect outside registry range',
		target: { kind: 'video-effect', effectId: 'color', parameterId: 'brightness' },
		curve: linearCurve(-1, 1.01),
	}]) assert.throws(() => normalizeVideoKeyframeCurves(keyframes([
		{ target: fixture.target, curve: fixture.curve },
	]), options()), /target|parameter|range|between|support|missing/iu, fixture.name);

	for (const [target, curve] of [[
		{ kind: 'video-effect', effectId: 'pixels', parameterId: 'blockSize' }, linearCurve(8, 16),
	], [
		{ kind: 'video-effect', effectId: 'pixels', parameterId: 'blockSize' }, holdCurve(8, 16.5),
	]] as const) assert.throws(() => normalizeVideoKeyframeCurves(keyframes([{ target, curve }]), options()), /hold|integer/iu);
});

test('crop pairs share interpolation geometry and remain valid across the complete path', () => {
	const bezier = (first: number, second: number, control1: number, control2: number) => ({
		anchors: [
			{ position: rational(0), value: first },
			{ position: rational(10), value: second },
		],
		segments: [{
			kind: 'bezier' as const,
			control1: { position: rational(3), value: control1 },
			control2: { position: rational(7), value: control2 },
		}],
	});
	const pair = (left: unknown, right: unknown) => keyframes([{
		target: { kind: 'composition', parameterId: 'crop.left' }, curve: left,
	}, {
		target: { kind: 'composition', parameterId: 'crop.right' }, curve: right,
	}]);
	assert.doesNotThrow(() => normalizeVideoKeyframeCurves(
		pair(bezier(0.1, 0.3, 0.2, 0.4), bezier(0.2, 0.1, 0.3, 0.2)), options(),
	));

	for (const [name, left, right] of [[
		'anchor position', linearCurve(0.1, 0.2), linearCurve(0.2, 0.1, 0, 9),
	], [
		'segment kind', linearCurve(0.1, 0.2), holdCurve(0.2, 0.1),
	], [
		'control position', bezier(0.1, 0.2, 0.2, 0.2), {
			...bezier(0.2, 0.1, 0.2, 0.2),
			segments: [{
				kind: 'bezier',
				control1: { position: rational(4), value: 0.2 },
				control2: { position: rational(7), value: 0.2 },
			}],
		},
	], [
		'anchor sum', linearCurve(0.6, 0.2), linearCurve(0.4, 0.3),
	], [
		'control sum', bezier(0.1, 0.2, 0.7, 0.2), bezier(0.1, 0.2, 0.3, 0.2),
	]] as const) assert.throws(
		() => normalizeVideoKeyframeCurves(pair(left, right), options()),
		/crop|pair|position|segment|sum|less than 1/iu,
		name,
	);

	const base = {
		...DEFAULT_VIDEO_CLIP_COMPOSITION,
		crop: { ...DEFAULT_VIDEO_CLIP_COMPOSITION.crop, right: 0.2 },
	};
	assert.doesNotThrow(() => normalizeVideoKeyframeCurves(keyframes([{
		target: { kind: 'composition', parameterId: 'crop.left' }, curve: linearCurve(0, 0.79),
	}]), options({ composition: base })));
	assert.throws(() => normalizeVideoKeyframeCurves(keyframes([{
		target: { kind: 'composition', parameterId: 'crop.left' }, curve: linearCurve(0, 0.8),
	}]), options({ composition: base })), /crop|sum|less than 1/iu);

	assert.throws(() => normalizeVideoKeyframeCurves(pair(
		linearCurve(0.20528240002515652, 0.8082705912463747),
		linearCurve(0.7947175999748434, 0.1917294087536252),
	), options()), /aperture|crop/iu,
	'endpoint values that separately round to a closed midpoint must be rejected conservatively');
});

test('domain, duplicates, values, and persisted wire reject malformed or hostile input without repair', () => {
	const duplicate = keyframes([{
		target: { kind: 'composition', parameterId: 'opacity' }, curve: linearCurve(0, 1),
	}, {
		target: { kind: 'composition', parameterId: 'opacity' }, curve: linearCurve(0.25, 0.75),
	}]);
	assert.throws(() => normalizeVideoKeyframeCurves(duplicate, options()), /duplicate|target/iu);

	for (const [name, curve] of [[
		'before domain', linearCurve(0, 1, -1, 10),
	], [
		'after domain', linearCurve(0, 1, 0, 11),
	], [
		'unordered', {
			anchors: [{ position: rational(1), value: 0 }, { position: rational(1), value: 1 }],
			segments: [{ kind: 'linear' }],
		},
	], [
		'negative zero value', linearCurve(-0, 1),
	], [
		'negative zero time', {
			anchors: [{ position: rational(-0), value: 0 }, { position: rational(1), value: 1 }],
			segments: [{ kind: 'linear' }],
		},
	], [
		'negative zero control', {
			anchors: [{ position: rational(0), value: 0 }, { position: rational(10), value: 1 }],
			segments: [{
				kind: 'bezier',
				control1: { position: rational(2), value: -0 },
				control2: { position: rational(8), value: 1 },
			}],
		},
	], [
		'nonfinite value', linearCurve(0, Number.NaN),
	]] as const) assert.throws(() => normalizeVideoKeyframeCurves(keyframes([{
		target: { kind: 'composition', parameterId: 'opacity' }, curve,
	}]), options()), /domain|duration|increas|negative zero|finite|position|value/iu, name);

	const malformedValues: readonly unknown[] = [
		{ ...keyframes([]), schemaVersion: 2 },
		keyframes([], { authoredDuration: 10, viewStart: rational(0), viewDuration: rational(10) }),
		keyframes([], { authoredDuration: rational(20, 2), viewStart: rational(0), viewDuration: rational(10) }),
		keyframes([], { authoredDuration: rational(10), viewStart: 0, viewDuration: rational(10) }),
		keyframes([], { authoredDuration: rational(10), viewStart: rational(0), viewDuration: 10 }),
		keyframes([], { authoredDuration: rational(10), viewStart: rational(-1), viewDuration: rational(1) }),
		keyframes([], { authoredDuration: rational(10), viewStart: rational(0), viewDuration: rational(0) }),
		keyframes([], { authoredDuration: rational(10), viewStart: rational(9), viewDuration: rational(2) }),
		keyframes([], { ...timeDomain(), cachedViewEnd: rational(10) }),
		{ ...keyframes([]), derivedSamples: [] },
		keyframes([{
			target: { kind: 'composition', parameterId: 'opacity', scope: 'clip' },
			curve: linearCurve(0, 1),
		}]),
		keyframes([{
			target: { kind: 'composition', parameterId: 'opacity' },
			curve: { ...linearCurve(0, 1), normalized: true },
		}]),
	];
	for (const malformed of malformedValues) assert.throws(
		() => normalizeVideoKeyframeCurves(malformed, options()),
		/schema|unsupported|field|rational object|canonical|non-negative|positive|inside/iu,
	);

	let calls = 0;
	const accessor = { schemaVersion: 1, timeDomain: timeDomain() } as Record<string, unknown>;
	Object.defineProperty(accessor, 'curves', { enumerable: true, get() {
		calls += 1;
		return [];
	} });
	assert.throws(() => normalizeVideoKeyframeCurves(accessor, options()), /data property|enumerable/iu);
	assert.equal(calls, 0);
	const symbol = keyframes([]) as Record<PropertyKey, unknown>;
	Object.defineProperty(symbol, Symbol('derived'), { enumerable: true, value: [] });
	assert.throws(() => normalizeVideoKeyframeCurves(symbol, options()), /unsupported field/iu);
	const sparse = new Array<unknown>(1);
	assert.throws(() => normalizeVideoKeyframeCurves({ schemaVersion: 1, timeDomain: timeDomain(), curves: sparse }, options()), /data property|enumerable/iu);
});

test('evaluation accepts only normalized collections and exact in-domain positions', () => {
	const normalized = normalizeVideoKeyframeCurves(keyframes([{
		target: { kind: 'composition', parameterId: 'opacity' }, curve: linearCurve(0, 1),
	}]), options());
	assert.throws(() => evaluateVideoKeyframeCurves(structuredClone(normalized), rational(5)), /normalized|produced/iu);
	assert.throws(() => evaluateVideoKeyframeCurves(normalized, rational(-1)), /domain|position/iu);
	assert.throws(() => evaluateVideoKeyframeCurves(normalized, rational(11)), /domain|position/iu);
	assert.throws(() => evaluateVideoKeyframeCurves(normalized, rational(-0)), /negative zero/iu);
});
function assertDeepFrozen(value: unknown): void {
	if (!value || typeof value !== 'object') return;
	assert.equal(Object.isFrozen(value), true);
	for (const child of Object.values(value)) assertDeepFrozen(child);
}
