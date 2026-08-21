/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	WEB_VCR_VIEWPORT_PROFILES,
	clampWebVcrNormalizedCrop,
	constrainWebVcrCropToAspect,
	mapWebVcrCropToEvenFramePixels,
	resolveWebVcrViewportProfile,
	resolveWebVcrVisibleMediaAperture,
	selectWebVcrTarget,
	type WebVcrTargetGeometryCandidate,
} from '../src/common/editor/web-vcr-geometry.ts';

const CENTER = Object.freeze({
	x: Object.freeze({ fraction: 0.5, offsetPixels: 0 }),
	y: Object.freeze({ fraction: 0.5, offsetPixels: 0 }),
});

test('Web VCR viewport profiles describe exact CSS, scale, and capture dimensions', () => {
	assert.deepEqual(resolveWebVcrViewportProfile('720p'), {
		cssWidth: 1_280, cssHeight: 720, deviceScaleFactor: 1,
		captureWidth: 1_280, captureHeight: 720,
	});
	assert.deepEqual(resolveWebVcrViewportProfile('1080p'), {
		cssWidth: 1_920, cssHeight: 1_080, deviceScaleFactor: 1,
		captureWidth: 1_920, captureHeight: 1_080,
	});
	assert.deepEqual(resolveWebVcrViewportProfile('4k'), {
		cssWidth: 1_920, cssHeight: 1_080, deviceScaleFactor: 2,
		captureWidth: 3_840, captureHeight: 2_160,
	});
	assert.equal(Object.isFrozen(WEB_VCR_VIEWPORT_PROFILES), true);
	assert.equal(Object.isFrozen(WEB_VCR_VIEWPORT_PROFILES['4k']), true);
});

test('visible aperture removes contain letterboxing and honors object position', () => {
	const centered = resolveWebVcrVisibleMediaAperture({
		viewport: { width: 1_000, height: 1_000 },
		elementRect: { x: 0, y: 0, width: 1_000, height: 1_000 },
		clipRect: null,
		intrinsicSize: { width: 1_920, height: 1_080 },
		objectFit: 'contain',
		objectPosition: CENTER,
	});
	assert.deepEqual(centered, {
		renderedRect: { x: 0, y: 218.75, width: 1_000, height: 562.5 },
		visibleRect: { x: 0, y: 218.75, width: 1_000, height: 562.5 },
		normalizedAperture: { x: 0, y: 0.21875, width: 1, height: 0.5625 },
	});

	const positioned = resolveWebVcrVisibleMediaAperture({
		viewport: { width: 1_000, height: 1_000 },
		elementRect: { x: 0, y: 0, width: 1_000, height: 1_000 },
		clipRect: null,
		intrinsicSize: { width: 1_920, height: 1_080 },
		objectFit: 'contain',
		objectPosition: {
			x: { fraction: 0.5, offsetPixels: 0 },
			y: { fraction: 0, offsetPixels: 20 },
		},
	});
	assert.deepEqual(positioned?.visibleRect, {
		x: 0, y: 20, width: 1_000, height: 562.5,
	});
});

test('visible aperture handles cover, fill, none, scale-down, and viewport clipping', () => {
	const fits = [
		['cover', { x: 0, y: 0, width: 1_000, height: 500 }],
		['fill', { x: 0, y: 0, width: 1_000, height: 500 }],
		['none', { x: 250, y: 0, width: 500, height: 500 }],
		['scale-down', { x: 250, y: 0, width: 500, height: 500 }],
	] as const;
	for (const [objectFit, expectedVisible] of fits) {
		const aperture = resolveWebVcrVisibleMediaAperture({
			viewport: { width: 1_000, height: 500 },
			elementRect: { x: 0, y: 0, width: 1_000, height: 500 },
			clipRect: null,
			intrinsicSize: { width: 500, height: 500 },
			objectFit,
			objectPosition: CENTER,
		});
		assert.deepEqual(aperture?.visibleRect, expectedVisible);
	}

	const clipped = resolveWebVcrVisibleMediaAperture({
		viewport: { width: 1_280, height: 720 },
		elementRect: { x: -100, y: 100, width: 400, height: 225 },
		clipRect: { x: -20, y: 120, width: 200, height: 180 },
		intrinsicSize: { width: 1_920, height: 1_080 },
		objectFit: 'fill',
		objectPosition: CENTER,
	});
	assert.deepEqual(clipped?.visibleRect, { x: 0, y: 120, width: 180, height: 180 });
	assert.deepEqual(clipped?.normalizedAperture, {
		x: 0, y: 1 / 6, width: 0.140625, height: 0.25,
	});
});

test('target selection chooses the largest visible playing measurable video', () => {
	const candidates = [
		candidate({
			targetId: 'paused-large', mediaState: 'paused',
			elementRect: { x: 0, y: 0, width: 1_000, height: 700 },
		}),
		candidate({
			targetId: 'playing-small', generation: 8,
			elementRect: { x: 100, y: 100, width: 640, height: 360 },
		}),
		candidate({
			targetId: 'canvas-overlay', manualFallbackReason: 'canvas-player',
			elementRect: { x: 0, y: 0, width: 1_200, height: 700 },
		}),
	];
	const result = selectWebVcrTarget({
		viewport: { width: 1_280, height: 720 }, candidates,
	});
	assert.equal(result.kind, 'target');
	if (result.kind !== 'target') return;
	assert.deepEqual(result.target, {
		targetId: 'playing-small',
		generation: 8,
		mediaState: 'playing',
		aperture: { x: 0.078125, y: 5 / 36, width: 0.5, height: 0.5 },
		intrinsicSize: { width: 1_920, height: 1_080 },
	});
	assert.equal(result.visibleArea, 640 * 360);
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.target), true);
});

test('target selection fails to manual crop for ambiguous and unsupported observations', () => {
	const tied = selectWebVcrTarget({
		viewport: { width: 1_280, height: 720 },
		candidates: [candidate({ targetId: 'one' }), candidate({ targetId: 'two' })],
	});
	assert.deepEqual(tied, { kind: 'manual', reason: 'ambiguous-targets' });

	const transformed = selectWebVcrTarget({
		viewport: { width: 1_280, height: 720 },
		candidates: [candidate({ manualFallbackReason: 'unsupported-transform' })],
	});
	assert.deepEqual(transformed, { kind: 'manual', reason: 'unsupported-transform' });
	const canvas = selectWebVcrTarget({
		viewport: { width: 1_280, height: 720 },
		candidates: [candidate({ manualFallbackReason: 'canvas-player' })],
	});
	assert.deepEqual(canvas, { kind: 'manual', reason: 'canvas-player' });
	const inaccessible = selectWebVcrTarget({
		viewport: { width: 1_280, height: 720 },
		candidates: [candidate({ manualFallbackReason: 'inaccessible-shadow-dom' })],
	});
	assert.deepEqual(inaccessible, { kind: 'manual', reason: 'inaccessible-shadow-dom' });
	const paused = selectWebVcrTarget({
		viewport: { width: 1_280, height: 720 },
		candidates: [candidate({ mediaState: 'paused' })],
	});
	assert.deepEqual(paused, { kind: 'manual', reason: 'no-playing-video' });
});

test('manual crops clamp, constrain to output aspect, and map to even frame pixels', () => {
	assert.deepEqual(
		clampWebVcrNormalizedCrop({ x: -0.1, y: 0.9, width: 0.8, height: 0.5 }),
		{ x: 0, y: 0.9, width: 0.7, height: 0.1 },
	);
	assert.deepEqual(
		constrainWebVcrCropToAspect(
			{ x: 0, y: 0, width: 1, height: 1 }, '1:1', { width: 1_920, height: 1_080 },
		),
		{ x: 0.21875, y: 0, width: 0.5625, height: 1 },
	);
	assert.deepEqual(
		constrainWebVcrCropToAspect(
			{ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, 'free', { width: 1_920, height: 1_080 },
		),
		{ x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
	);
	assert.deepEqual(
		constrainWebVcrCropToAspect(
			{ x: 0, y: 0, width: 1, height: 1 }, '16:9', { width: 1_920, height: 1_080 },
		),
		{ x: 0, y: 0, width: 1, height: 1 },
	);
	assert.deepEqual(
		constrainWebVcrCropToAspect(
			{ x: 0, y: 0, width: 1, height: 1 }, '9:16', { width: 1_920, height: 1_080 },
		),
		{ x: 0.341796875, y: 0, width: 0.31640625, height: 1 },
	);
	assert.deepEqual(
		mapWebVcrCropToEvenFramePixels(
			{ x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, { width: 1_920, height: 1_080 },
		),
		{
			frameSize: { width: 1_920, height: 1_080 },
			normalizedCrop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
			pixelCrop: { x: 192, y: 108, width: 960, height: 540 },
		},
	);
	assert.deepEqual(
		mapWebVcrCropToEvenFramePixels(
			{ x: 0.999, y: 0.999, width: 0.001, height: 0.001 },
			{ width: 1_919, height: 1_079 },
		).pixelCrop,
		{ x: 1_916, y: 1_076, width: 2, height: 2 },
	);
	assert.throws(
		() => mapWebVcrCropToEvenFramePixels(
			{ x: 0, y: 0, width: 1, height: 1 }, { width: 1, height: 1 },
		),
		/at least 2.*encoder-compatible/iu,
	);
	assert.throws(
		() => resolveWebVcrVisibleMediaAperture({
			viewport: { width: 1_280, height: 720 },
			elementRect: { x: 0, y: 0, width: Number.MAX_VALUE, height: 360 },
			clipRect: null,
			intrinsicSize: { width: 1, height: Number.MAX_SAFE_INTEGER },
			objectFit: 'cover',
			objectPosition: {
				x: { fraction: Number.MAX_VALUE, offsetPixels: 0 },
				y: { fraction: 0.5, offsetPixels: 0 },
			},
		}),
		/finite number/iu,
	);
});

function candidate(
	overrides: Partial<WebVcrTargetGeometryCandidate>,
): WebVcrTargetGeometryCandidate {
	return {
		targetId: 'video-1',
		generation: 1,
		mediaState: 'playing',
		elementRect: { x: 0, y: 0, width: 640, height: 360 },
		clipRect: null,
		intrinsicSize: { width: 1_920, height: 1_080 },
		objectFit: 'fill',
		objectPosition: CENTER,
		manualFallbackReason: null,
		...overrides,
	};
}
