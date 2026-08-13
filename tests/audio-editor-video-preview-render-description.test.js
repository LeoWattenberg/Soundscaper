/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import {
	videoPreviewBlendExpression,
	videoPreviewRenderGeometry,
	videoPreviewRenderQuad,
	videoPreviewRenderQuadUniforms,
} from '../src/common/editor/ui/video-preview-render-description.ts';
import {
	videoPreviewBlendModeCode,
	videoPreviewBlendPixel,
} from '../src/common/editor/ui/video-preview-composition-blend.ts';
import { resolveVideoRenderDescription } from '../src/common/editor/video-render-description.ts';

test('preview consumes the canonical crop and affine without reinterpreting persisted composition', () => {
	const description = resolveVideoRenderDescription({
		composition: {
			...DEFAULT_VIDEO_CLIP_COMPOSITION,
			crop: { left: 0.1, top: 0.2, right: 0.25, bottom: 0.1 },
			transform: {
				...DEFAULT_VIDEO_CLIP_COMPOSITION.transform,
				positionX: 0.7,
				rotationDegrees: 30,
				flipHorizontal: true,
			},
			opacity: 0.4,
			blendMode: 'multiply',
		},
		sourceDisplaySize: { width: 640, height: 360 },
		canvas: { width: 1_280, height: 720 },
	});
	const geometry = videoPreviewRenderGeometry(description, {
		canvasWidth: 1_280,
		canvasHeight: 720,
	});

	assert.deepEqual(geometry.sourceDisplayToCanvas, description.sourceDisplayToCanvas);
	assert.deepEqual(
		{ ...geometry.sourceUv, height: Number(geometry.sourceUv.height.toFixed(12)) },
		{ x: 0.1, y: 0.2, width: 0.65, height: 0.7 },
	);
	assert.equal(geometry.opacity, 0.4);
	assert.equal(geometry.blendMode, 'multiply');
	assert.equal(Object.isFrozen(geometry), true);
	const quad = videoPreviewRenderQuad(geometry, { canvasWidth: 1_280, canvasHeight: 720 });
	assert.equal(quad.positions.length, 8);
	assert.deepEqual(quad.textureCoordinates.map((value) => Number(value.toFixed(12))), [
		0.1, 0.1, 0.75, 0.1, 0.1, 0.8, 0.75, 0.8,
	]);
	const uniforms = videoPreviewRenderQuadUniforms(quad);
	assert.deepEqual(uniforms.positionTransform.length, 9);
	assert.deepEqual(
		uniforms.textureTransform.map((value) => Number(value.toFixed(12))),
		[0.65, 0, 0, 0, 0.7, 0, 0.1, 0.1, 1],
	);
});

test('preview blend formulas are the normalized form of the shared encoded-RGB registry', () => {
	assert.deepEqual({
		normal: videoPreviewBlendExpression('normal'),
		multiply: videoPreviewBlendExpression('multiply'),
		screen: videoPreviewBlendExpression('screen'),
		overlay: videoPreviewBlendExpression('overlay'),
		darken: videoPreviewBlendExpression('darken'),
		lighten: videoPreviewBlendExpression('lighten'),
		difference: videoPreviewBlendExpression('difference'),
		exclusion: videoPreviewBlendExpression('exclusion'),
	}, {
		normal: 'source',
		multiply: 'backdrop * source',
		screen: 'backdrop + source - backdrop * source',
		overlay: 'backdrop <= 0.5 ? 2.0 * backdrop * source : 1.0 - 2.0 * (1.0 - backdrop) * (1.0 - source)',
		darken: 'min(backdrop, source)',
		lighten: 'max(backdrop, source)',
		difference: 'abs(backdrop - source)',
		exclusion: 'backdrop + source - 2.0 * backdrop * source',
	});
	assert.deepEqual([
		'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference', 'exclusion',
	].map(videoPreviewBlendModeCode), [0, 1, 2, 3, 4, 5, 6, 7]);
	assert.deepEqual(
		videoPreviewBlendPixel('multiply', [0.8, 0.5, 0.25, 1], [0.2, 0.1, 0, 0.5])
			.map((value) => Number(value.toFixed(12))),
		[0.56, 0.3, 0.125, 1],
	);
});

test('preview render geometry fails closed on malformed descriptions or canvas dimensions', () => {
	const description = resolveVideoRenderDescription({
		composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		sourceDisplaySize: { width: 320, height: 180 },
		canvas: { width: 640, height: 360 },
	});
	assert.throws(
		() => videoPreviewRenderGeometry({ ...description, injected: true }, {
			canvasWidth: 640, canvasHeight: 360,
		}),
		/unsupported|field|description/iu,
	);
	assert.throws(
		() => videoPreviewRenderGeometry(description, { canvasWidth: 0, canvasHeight: 360 }),
		/canvasWidth/iu,
	);
	assert.throws(() => videoPreviewBlendExpression('unsafe'), /blend mode/iu);
	assert.throws(() => videoPreviewBlendModeCode('unsafe'), /blend mode/iu);
});

test('preview crop pixels must be positive, bounded, and describe the normalized source aperture', () => {
	const description = resolveVideoRenderDescription({
		composition: {
			...DEFAULT_VIDEO_CLIP_COMPOSITION,
			crop: { left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 },
		},
		sourceDisplaySize: { width: 1_000, height: 500 },
		canvas: { width: 1_280, height: 720 },
	});
	const options = {
		canvasWidth: 1_280,
		canvasHeight: 720,
		sourceDisplayWidth: 1_000,
		sourceDisplayHeight: 500,
	};

	assert.ok(
		Math.abs(videoPreviewRenderGeometry(description, options).sourcePixels.width - 600) < 1e-12,
	);
	for (const sourcePixels of [
		{ ...description.crop.sourcePixels, x: -1 },
		{ ...description.crop.sourcePixels, width: 0 },
		{ ...description.crop.sourcePixels, x: 101 },
		{ ...description.crop.sourcePixels, width: 601 },
	]) {
		assert.throws(
			() => videoPreviewRenderGeometry({
				...description,
				crop: { ...description.crop, sourcePixels },
			}, options),
			/crop|source.*pixel|aperture|display/iu,
		);
	}
	assert.throws(
		() => videoPreviewRenderGeometry(description, { ...options, sourceDisplayWidth: 999 }),
		/source.*display|aperture/iu,
	);
});
