/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
	normalizeVideoClipComposition,
} from '../src/common/editor/video-clip-composition.ts';
import { resolveVideoRenderDescription } from '../src/common/editor/video-render-description.ts';

function composition(changes: Readonly<Record<string, unknown>> = {}) {
	return normalizeVideoClipComposition({
		...DEFAULT_VIDEO_CLIP_COMPOSITION,
		...changes,
		crop: {
			...DEFAULT_VIDEO_CLIP_COMPOSITION.crop,
			...(changes.crop as Readonly<Record<string, unknown>> | undefined),
		},
		transform: {
			...DEFAULT_VIDEO_CLIP_COMPOSITION.transform,
			...(changes.transform as Readonly<Record<string, unknown>> | undefined),
		},
	});
}

function mappedPoint(
	matrix: readonly [number, number, number, number, number, number],
	x: number,
	y: number,
): Readonly<{ x: number; y: number }> {
	const [a, b, c, d, e, f] = matrix;
	return { x: a * x + c * y + e, y: b * x + d * y + f };
}

function assertClose(actual: number, expected: number, message?: string): void {
	assert.ok(Math.abs(actual - expected) < 1e-12, message ?? `${String(actual)} != ${String(expected)}`);
}

test('the identity description exactly matches the existing rounded contain fit', () => {
	const description = resolveVideoRenderDescription({
		composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		sourceDisplaySize: { width: 1_920, height: 1_080 },
		canvas: { width: 1_000, height: 1_000 },
	});

	assert.deepEqual(description, {
		crop: {
			normalized: { left: 0, top: 0, right: 0, bottom: 0 },
			sourcePixels: { x: 0, y: 0, width: 1_920, height: 1_080 },
		},
		sourceDisplayToCanvas: [1_000 / 1_920, 0, 0, 563 / 1_080, 0, 219],
		opacityStart: 1,
		opacityEnd: 1,
		blendMode: 'normal',
		compositingOrder: 0,
	});
	assert.deepEqual(mappedPoint(description.sourceDisplayToCanvas, 0, 0), { x: 0, y: 219 });
	const fittedEnd = mappedPoint(description.sourceDisplayToCanvas, 1_920, 1_080);
	assertClose(fittedEnd.x, 1_000);
	assertClose(fittedEnd.y, 782);
	assert.equal(JSON.stringify(description).includes('undefined'), false);
	assert.deepEqual(JSON.parse(JSON.stringify(description)), description);
	assert.equal(Object.isFrozen(description), true);
	assert.equal(Object.isFrozen(description.crop), true);
	assert.equal(Object.isFrozen(description.crop.normalized), true);
	assert.equal(Object.isFrozen(description.crop.sourcePixels), true);
	assert.equal(Object.isFrozen(description.sourceDisplayToCanvas), true);
});

test('a crop resolves continuously in displayed-source coordinates without reflowing the aperture', () => {
	const description = resolveVideoRenderDescription({
		composition: composition({ crop: { left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 } }),
		sourceDisplaySize: { width: 1_001, height: 503 },
		canvas: { width: 800, height: 600 },
	});

	assert.deepEqual(description.crop.normalized, { left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 });
	assertClose(description.crop.sourcePixels.x, 100.1);
	assertClose(description.crop.sourcePixels.y, 100.6);
	assertClose(description.crop.sourcePixels.width, 600.6);
	assertClose(description.crop.sourcePixels.height, 201.2);
	assert.deepEqual(
		description.sourceDisplayToCanvas,
		[800 / 1_001, 0, 0, 402 / 503, 0, 99],
		'the cropped content retains the full-aperture contain transform',
	);
});

test('the affine applies scale and flips before clockwise rotation about the authored anchor', () => {
	const description = resolveVideoRenderDescription({
		composition: composition({
			transform: {
				anchorX: 0.25,
				anchorY: 0.5,
				positionX: 0.75,
				positionY: 0.25,
				scaleX: 1.5,
				scaleY: 0.5,
				rotationDegrees: 90,
				flipHorizontal: true,
				flipVertical: false,
			},
		}),
		sourceDisplaySize: { width: 100, height: 50 },
		canvas: { width: 200, height: 200 },
	});

	assert.deepEqual(description.sourceDisplayToCanvas, [0, -3, -1, 0, 125, 125]);
	assert.deepEqual(
		mappedPoint(description.sourceDisplayToCanvas, 25, 25),
		{ x: 100, y: 50 },
		'the neutral-biased position offsets the rounded contain-fit anchor by a canvas extent',
	);
	assert.deepEqual(mappedPoint(description.sourceDisplayToCanvas, 26, 25), { x: 100, y: 47 });
	assert.deepEqual(mappedPoint(description.sourceDisplayToCanvas, 25, 26), { x: 99, y: 50 });
});

test('arbitrary rotations produce canonical finite matrix coefficients', () => {
	const description = resolveVideoRenderDescription({
		composition: composition({
			transform: {
				rotationDegrees: 450,
				flipHorizontal: false,
				flipVertical: true,
			},
		}),
		sourceDisplaySize: { width: 100, height: 100 },
		canvas: { width: 200, height: 200 },
	});

	assert.deepEqual(description.sourceDisplayToCanvas, [0, 2, 2, 0, 0, 0]);
	assert.ok(description.sourceDisplayToCanvas.every(Number.isFinite));
	assert.ok(description.sourceDisplayToCanvas.every((value) => !Object.is(value, -0)));
	assert.deepEqual(resolveVideoRenderDescription({
		composition: composition({ transform: { rotationDegrees: 36_000 } }),
		sourceDisplaySize: { width: 100, height: 100 },
		canvas: { width: 200, height: 200 },
	}).sourceDisplayToCanvas, [2, 0, 0, 2, 0, 0]);
	const arbitrary = resolveVideoRenderDescription({
		composition: composition({ transform: { rotationDegrees: -17.25 } }),
		sourceDisplaySize: { width: 100, height: 100 },
		canvas: { width: 200, height: 200 },
	});
	assert.ok(arbitrary.sourceDisplayToCanvas.every(Number.isFinite));
	const arbitraryAnchor = mappedPoint(arbitrary.sourceDisplayToCanvas, 50, 50);
	assertClose(arbitraryAnchor.x, 100);
	assertClose(arbitraryAnchor.y, 100);
});

test('authored opacity multiplies transition endpoints while blend and order pass through', () => {
	const description = resolveVideoRenderDescription({
		composition: composition({ opacity: 0.4, blendMode: 'screen', compositingOrder: -17 }),
		sourceDisplaySize: { width: 320, height: 180 },
		canvas: { width: 640, height: 360 },
		opacityStart: 0.25,
		opacityEnd: 0.75,
	});

	assertClose(description.opacityStart, 0.1);
	assertClose(description.opacityEnd, 0.3);
	assert.equal(description.blendMode, 'screen');
	assert.equal(description.compositingOrder, -17);
	assert.equal(Object.isFrozen(description), true);
});

test('the resolver normalizes its composition input rather than trusting mutable records', () => {
	const mutable = structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION) as unknown as Record<string, unknown>;
	const description = resolveVideoRenderDescription({
		composition: mutable,
		sourceDisplaySize: { width: 320, height: 180 },
		canvas: { width: 640, height: 360 },
	});
	mutable.opacity = 0;

	assert.equal(description.opacityStart, 1);
	assert.equal(description.opacityEnd, 1);
	assert.throws(() => resolveVideoRenderDescription({
		composition: { ...mutable, unknown: true },
		sourceDisplaySize: { width: 320, height: 180 },
		canvas: { width: 640, height: 360 },
	}), /composition|property|field|key/iu);
});

test('noncanonical geometry and transition weights are refused', () => {
	const valid = {
		composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		sourceDisplaySize: { width: 320, height: 180 },
		canvas: { width: 640, height: 360 },
	};
	for (const sourceDisplaySize of [
		{ width: 0, height: 180 },
		{ width: 320.5, height: 180 },
		{ width: Number.NaN, height: 180 },
	]) {
		assert.throws(() => resolveVideoRenderDescription({ ...valid, sourceDisplaySize }), /source.*width/iu);
	}
	for (const canvas of [
		{ width: 640, height: 0 },
		{ width: Number.POSITIVE_INFINITY, height: 360 },
	]) {
		assert.throws(() => resolveVideoRenderDescription({ ...valid, canvas }), /canvas.*(?:width|height)/iu);
	}
	for (const opacityStart of [-0.01, 1.01, Number.NaN]) {
		assert.throws(() => resolveVideoRenderDescription({ ...valid, opacityStart }), /opacityStart/iu);
	}
	assert.throws(() => resolveVideoRenderDescription({ ...valid, opacityEnd: Number.POSITIVE_INFINITY }), /opacityEnd/iu);
	assert.throws(() => resolveVideoRenderDescription(null as never), /description|input|request/iu);
	assert.throws(() => resolveVideoRenderDescription([] as never), /description|input|request/iu);
});
