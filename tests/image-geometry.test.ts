/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeImageGeometryV1, centeredImageGeometryAspectCropV1 } from '../src/common/editor/imaging/image-geometry-v1.ts';
import { planImageGeometryV1, mapImageGeometryPointV1 } from '../src/common/editor/imaging/image-geometry-plan-v1.ts';

const identity = () => ({ schemaVersion: 1 as const, crop: null, rotationDegrees: 0,
	flipHorizontal: false, flipVertical: false, perspective: null });
const quad = () => ({ topLeft: { x: 0.1, y: 0.1 }, topRight: { x: 0.9, y: 0 },
	bottomRight: { x: 0.8, y: 1 }, bottomLeft: { x: 0.2, y: 0.9 } });
function near(actual: Readonly<{ x: number; y: number }> | null, expected: { x: number; y: number }) {
	assert.ok(actual); assert.ok(Math.abs(actual.x - expected.x) < 1e-9); assert.ok(Math.abs(actual.y - expected.y) < 1e-9);
}

test('geometry is a detached closed successor recipe without changing the four-field photo shape', () => {
	const input = { ...identity(), crop: { x: 0.25, y: 0, width: 0.5, height: 1 }, perspective: quad() };
	const result = normalizeImageGeometryV1(input), json = JSON.stringify(result);
	input.crop.x = 0; input.perspective.topLeft.x = 0;
	assert.equal(JSON.stringify(result), json); assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.crop), true); assert.equal(Object.isFrozen(result.perspective?.topLeft), true);
	assert.deepEqual(JSON.parse(json), { ...identity(), crop: { x: 0.25, y: 0, width: 0.5, height: 1 }, perspective: quad() });
	const { schemaVersion: _schema, perspective: _perspective, ...old } = identity();
	assert.throws(() => normalizeImageGeometryV1(old), /required/u);
});

test('closed geometry refuses future fields, accessors, nonfinite and negative-zero coordinates before processing', () => {
	let calls = 0;
	assert.throws(() => normalizeImageGeometryV1({ ...identity(), get crop() { calls++; return null; } }), /data property/u);
	assert.equal(calls, 0);
	for (const value of [{ ...identity(), schemaVersion: 2 }, { ...identity(), future: true },
		{ ...identity(), rotationDegrees: Infinity }, { ...identity(), rotationDegrees: -0 },
		{ ...identity(), flipHorizontal: 1 }, { ...identity(), crop: { x: 0.8, y: 0, width: 0.3, height: 1 } }]) {
		assert.throws(() => normalizeImageGeometryV1(value));
	}
});

test('manual perspective refuses crossed, reversed, out-of-range, collapsed and near-singular quads', () => {
	for (const perspective of [
		{ ...quad(), topRight: { x: 0.2, y: 0.9 }, bottomLeft: { x: 0.9, y: 0 } },
		{ ...quad(), topLeft: { x: -0.1, y: 0 } },
		{ ...quad(), bottomRight: { x: 0.9, y: 0 } },
		{ topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 }, bottomRight: { x: 1, y: 1e-12 }, bottomLeft: { x: 0, y: 1e-12 } },
	]) assert.throws(() => normalizeImageGeometryV1({ ...identity(), perspective }));
});

test('true crop reflows the output aperture and all quarter turns have exact stable extents', () => {
	const crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
	for (const [rotationDegrees, width, height] of [[0, 4, 3], [90, 3, 4], [-90, 3, 4], [180, 4, 3], [-180, 4, 3]]) {
		const plan = planImageGeometryV1({ ...identity(), crop, rotationDegrees }, 8, 6);
		assert.equal(plan.width, width); assert.equal(plan.height, height); assert.equal(Object.isFrozen(plan), true);
		assert.equal(Object.isFrozen(plan.outputToAperture), true);
		assert.equal(plan.apertureToSource.length, 9);
	}
	const plan = planImageGeometryV1({ ...identity(), crop }, 8, 6);
	near(mapImageGeometryPointV1(plan, 0, 0), { x: 2, y: 1.5 });
	near(mapImageGeometryPointV1(plan, 4, 3), { x: 6, y: 4.5 });
});

test('source quad corners rectify to the crop rectangle rather than pretending an affine transform', () => {
	const perspective = quad(), plan = planImageGeometryV1({ ...identity(), perspective }, 100, 80);
	for (const [x, y, expected] of [[0, 0, perspective.topLeft], [100, 0, perspective.topRight],
		[100, 80, perspective.bottomRight], [0, 80, perspective.bottomLeft]] as const) {
		near(mapImageGeometryPointV1(plan, x, y), { x: expected.x * 100, y: expected.y * 80 });
	}
	// The projective center is the intersection of the two source diagonals.
	near(mapImageGeometryPointV1(plan, 50, 40), { x: 46.111111111111114, y: 45.14285714285715 });
});

test('straightening keeps the whole rotated extent and maps empty bounding corners to transparent space', () => {
	const plan = planImageGeometryV1({ ...identity(), rotationDegrees: 45 }, 2, 2);
	assert.equal(plan.width, 3); assert.equal(plan.height, 3);
	assert.equal(mapImageGeometryPointV1(plan, 0.5, 0.5), null);
	near(mapImageGeometryPointV1(plan, 1.5, 1.5), { x: 1, y: 1 });
});

test('aspect presets select a centered narrower original crop without stretching or changing unrelated recipe state', () => {
	assert.deepEqual(centeredImageGeometryAspectCropV1(8, 4, '1:1'), { x: 0.25, y: 0, width: 0.5, height: 1 });
	assert.deepEqual(centeredImageGeometryAspectCropV1(8, 4, 'source'), { x: 0, y: 0, width: 1, height: 1 });
	assert.deepEqual(centeredImageGeometryAspectCropV1(8, 4, 'free', { x: 0.25, y: 0, width: 0.5, height: 1 }), { x: 0.25, y: 0, width: 0.5, height: 1 });
	const portrait = centeredImageGeometryAspectCropV1(16, 9, '9:16');
	assert.ok(Math.abs(portrait.width * 16 / (portrait.height * 9) - 9 / 16) < 1e-12);
	assert.equal(Object.isFrozen(portrait), true);
	assert.throws(() => centeredImageGeometryAspectCropV1(8, 4, 'future' as 'source'));
	assert.throws(() => planImageGeometryV1(identity(), 0, 1));
});
