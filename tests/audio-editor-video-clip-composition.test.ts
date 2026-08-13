/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
	VIDEO_CLIP_COMPOSITION_BLEND_MODES,
	VIDEO_CLIP_COMPOSITION_DEFAULT,
	VIDEO_CLIP_COMPOSITION_PARAMETER_IDS,
	VIDEO_CLIP_COMPOSITION_SCHEMA_VERSION,
	cloneVideoClipComposition,
	isDefaultVideoClipComposition,
	normalizeVideoClipComposition,
	videoClipCompositionsEqual,
} from '../src/common/editor/video-clip-composition.ts';

const NON_DEFAULT = {
	schemaVersion: 1,
	crop: { left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 },
	transform: {
		anchorX: 0.25,
		anchorY: 0.75,
		positionX: -8,
		positionY: 8,
		scaleX: 0.01,
		scaleY: 100,
		rotationDegrees: 36_000,
		flipHorizontal: true,
		flipVertical: true,
	},
	opacity: 0.5,
	blendMode: 'difference',
	compositingOrder: 32_767,
} as const;

test('the neutral V1 composition is an exact recursively frozen wire value', () => {
	assert.equal(VIDEO_CLIP_COMPOSITION_SCHEMA_VERSION, 1);
	assert.deepEqual(DEFAULT_VIDEO_CLIP_COMPOSITION, {
		schemaVersion: 1,
		crop: { left: 0, top: 0, right: 0, bottom: 0 },
		transform: {
			anchorX: 0.5,
			anchorY: 0.5,
			positionX: 0.5,
			positionY: 0.5,
			scaleX: 1,
			scaleY: 1,
			rotationDegrees: 0,
			flipHorizontal: false,
			flipVertical: false,
		},
		opacity: 1,
		blendMode: 'normal',
		compositingOrder: 0,
	});
	assert.strictEqual(VIDEO_CLIP_COMPOSITION_DEFAULT, DEFAULT_VIDEO_CLIP_COMPOSITION);
	assert.equal(Object.isFrozen(DEFAULT_VIDEO_CLIP_COMPOSITION), true);
	assert.equal(Object.isFrozen(DEFAULT_VIDEO_CLIP_COMPOSITION.crop), true);
	assert.equal(Object.isFrozen(DEFAULT_VIDEO_CLIP_COMPOSITION.transform), true);
});

test('normalization preserves legal boundary values in a detached frozen record', () => {
	const input = structuredClone(NON_DEFAULT) as unknown as {
		crop: { left: number };
		transform: { anchorX: number };
	};
	const composition = normalizeVideoClipComposition(input);
	assert.deepEqual(composition, NON_DEFAULT);
	assert.notStrictEqual(composition, input);
	assert.notStrictEqual(composition.crop, input.crop);
	assert.notStrictEqual(composition.transform, input.transform);
	assert.equal(Object.isFrozen(composition), true);
	assert.equal(Object.isFrozen(composition.crop), true);
	assert.equal(Object.isFrozen(composition.transform), true);

	input.crop.left = 0;
	input.transform.anchorX = 1;
	assert.equal(composition.crop.left, 0.1);
	assert.equal(composition.transform.anchorX, 0.25);
	assert.deepEqual(normalizeVideoClipComposition(composition), composition);
});

test('every record is closed plain data with all fields required', () => {
	assert.throws(
		() => normalizeVideoClipComposition({ ...DEFAULT_VIDEO_CLIP_COMPOSITION, future: true }),
		/unsupported field/iu,
	);
	const missing = structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION) as unknown as Record<string, unknown>;
	delete missing.opacity;
	assert.throws(() => normalizeVideoClipComposition(missing), /opacity is required/iu);
	assert.throws(
		() => normalizeVideoClipComposition(Object.create({ schemaVersion: 1 })),
		/plain object/iu,
	);
	assert.throws(
		() => normalizeVideoClipComposition(Object.assign(Object.create({}), DEFAULT_VIDEO_CLIP_COMPOSITION)),
		/plain object/iu,
	);
	const symbol = structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION) as unknown as Record<PropertyKey, unknown>;
	symbol[Symbol('future')] = true;
	assert.throws(() => normalizeVideoClipComposition(symbol), /unsupported field/iu);

	const accessor = structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION) as unknown as Record<string, unknown>;
	Object.defineProperty(accessor, 'opacity', { enumerable: true, get: () => 1 });
	assert.throws(() => normalizeVideoClipComposition(accessor), /opacity.*data property/iu);
	const nestedAccessor = structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION);
	Object.defineProperty(nestedAccessor.crop, 'left', { enumerable: true, get: () => 0 });
	assert.throws(() => normalizeVideoClipComposition(nestedAccessor), /crop\.left.*data property/iu);
});

test('numeric fields reject non-finite values, negative zero, and values outside their bounds', () => {
	for (const [path, value] of [
		['crop.left', -0],
		['crop.top', Number.NaN],
		['crop.right', Number.POSITIVE_INFINITY],
		['crop.bottom', 1.01],
		['transform.anchorX', -0.01],
		['transform.anchorY', 1.01],
		['transform.positionX', -8.01],
		['transform.positionY', 8.01],
		['transform.scaleX', 0],
		['transform.scaleY', 100.01],
		['transform.rotationDegrees', -36_001],
		['opacity', 1.01],
	] as const) {
		assert.throws(
			() => normalizeVideoClipComposition(withValue(path, value)),
			new RegExp(path.replace('.', '\\.'), 'iu'),
		);
	}
	assert.throws(
		() => normalizeVideoClipComposition(withValue('opacity', '1')),
		/opacity must be a finite number/iu,
	);
	assert.throws(
		() => normalizeVideoClipComposition(withValue('transform.rotationDegrees', -0)),
		/rotationDegrees.*negative zero/iu,
	);
});

test('crop edges must retain a positive-width and positive-height rectangle', () => {
	assert.throws(
		() => normalizeVideoClipComposition(withValues({ 'crop.left': 0.5, 'crop.right': 0.5 })),
		/left.*right.*less than 1/iu,
	);
	assert.throws(
		() => normalizeVideoClipComposition(withValues({ 'crop.top': 0.25, 'crop.bottom': 0.75 })),
		/top.*bottom.*less than 1/iu,
	);
	assert.doesNotThrow(
		() => normalizeVideoClipComposition(withValues({ 'crop.left': 0.5, 'crop.right': 0.499 })),
	);
});

test('schema, flags, blend mode, and compositing order are exact closed values', () => {
	assert.deepEqual(VIDEO_CLIP_COMPOSITION_BLEND_MODES, [
		'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference', 'exclusion',
	]);
	assert.equal(Object.isFrozen(VIDEO_CLIP_COMPOSITION_BLEND_MODES), true);
	for (const value of VIDEO_CLIP_COMPOSITION_BLEND_MODES) {
		assert.equal(normalizeVideoClipComposition(withValue('blendMode', value)).blendMode, value);
	}
	assert.throws(() => normalizeVideoClipComposition(withValue('schemaVersion', 2)), /schemaVersion.*1/iu);
	assert.throws(() => normalizeVideoClipComposition(withValue('blendMode', 'add')), /blendMode.*unsupported/iu);
	assert.throws(
		() => normalizeVideoClipComposition(withValue('transform.flipHorizontal', 1)),
		/flipHorizontal must be a boolean/iu,
	);
	assert.throws(
		() => normalizeVideoClipComposition(withValue('compositingOrder', 0.5)),
		/compositingOrder must be a safe integer/iu,
	);
	assert.throws(
		() => normalizeVideoClipComposition(withValue('compositingOrder', -32_769)),
		/compositingOrder.*range/iu,
	);
	assert.throws(
		() => normalizeVideoClipComposition(withValue('compositingOrder', -0)),
		/compositingOrder.*negative zero/iu,
	);
	assert.equal(normalizeVideoClipComposition(withValue('compositingOrder', -32_768)).compositingOrder, -32_768);
});

test('clone, default detection, and equality use exact canonical scalar values', () => {
	const clone = cloneVideoClipComposition(NON_DEFAULT);
	assert.deepEqual(clone, NON_DEFAULT);
	assert.notStrictEqual(clone, NON_DEFAULT);
	assert.equal(isDefaultVideoClipComposition(DEFAULT_VIDEO_CLIP_COMPOSITION), true);
	assert.equal(isDefaultVideoClipComposition(NON_DEFAULT), false);
	assert.equal(videoClipCompositionsEqual(NON_DEFAULT, structuredClone(NON_DEFAULT)), true);
	assert.equal(
		videoClipCompositionsEqual(NON_DEFAULT, withValue('opacity', 0.25, NON_DEFAULT)),
		false,
	);
	assert.throws(() => videoClipCompositionsEqual(NON_DEFAULT, { schemaVersion: 1 }), /crop is required/iu);
});

test('the stable property vocabulary includes numeric and hold-only composition parameters', () => {
	assert.deepEqual(VIDEO_CLIP_COMPOSITION_PARAMETER_IDS, [
		'crop.left',
		'crop.top',
		'crop.right',
		'crop.bottom',
		'transform.anchorX',
		'transform.anchorY',
		'transform.positionX',
		'transform.positionY',
		'transform.scaleX',
		'transform.scaleY',
		'transform.rotationDegrees',
		'opacity',
		'transform.flipHorizontal',
		'transform.flipVertical',
		'blendMode',
		'compositingOrder',
	]);
	assert.equal(Object.isFrozen(VIDEO_CLIP_COMPOSITION_PARAMETER_IDS), true);
	assert.equal(new Set(VIDEO_CLIP_COMPOSITION_PARAMETER_IDS).size, VIDEO_CLIP_COMPOSITION_PARAMETER_IDS.length);
});

function withValues(
	values: Readonly<Record<string, unknown>>,
	base: unknown = DEFAULT_VIDEO_CLIP_COMPOSITION,
): Record<string, unknown> {
	let result = structuredClone(base) as Record<string, unknown>;
	for (const [path, value] of Object.entries(values)) result = withValue(path, value, result);
	return result;
}

function withValue(
	path: string,
	value: unknown,
	base: unknown = DEFAULT_VIDEO_CLIP_COMPOSITION,
): Record<string, unknown> {
	const result = structuredClone(base) as Record<string, unknown>;
	const [parent, child] = path.split('.');
	if (child === undefined) result[parent!] = value;
	else (result[parent!] as Record<string, unknown>)[child] = value;
	return result;
}
