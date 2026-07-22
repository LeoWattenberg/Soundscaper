import assert from 'node:assert/strict';
import test from 'node:test';

import {
	VIDEO_PREVIEW_MAX_GAUSSIAN_BLUR_KERNEL_SIGMA,
	VIDEO_PREVIEW_PIXELATE_GRID_SIZE,
	videoEffectPasses,
	videoPreviewBlurViewport,
	videoPreviewViewports,
} from '../src/components/tools/audio-editor/video-preview-compositor.js';

function effect(type, params, enabled = true) {
	return { id: `effect-${type}`, type, enabled, params };
}

test('contains the export canvas before fitting each source into the shared viewport', () => {
	const result = videoPreviewViewports(1_000, 1_000, 800, 1_000, 1_920, 1_080);
	assert.deepEqual(result.canvas, { x: 0, y: 275, width: 800, height: 450 });
	assert.deepEqual(result.content, { x: 175, y: 275, width: 450, height: 450 });
	assert.ok(Math.abs(result.pixelScale - 5 / 12) < 1e-12);

	const reused = {
		canvas: { x: 0, y: 0, width: 0, height: 0 },
		content: { x: 0, y: 0, width: 0, height: 0 },
		pixelScale: 0,
	};
	assert.equal(videoPreviewViewports(1_920, 1_080, 800, 1_000, 1_920, 1_080, reused), reused);
	assert.deepEqual(reused.content, reused.canvas);

	assert.deepEqual(
		videoPreviewBlurViewport(result.content, 800, 1_000, 533, 667),
		{ x: 117, y: 183, width: 300, height: 300 },
	);
	const reusedBlur = { x: 0, y: 0, width: 0, height: 0 };
	assert.equal(
		videoPreviewBlurViewport(result.content, 800, 1_000, 533, 667, 1 / 3, reusedBlur),
		reusedBlur,
	);
	assert.deepEqual(reusedBlur, { x: 58, y: 92, width: 150, height: 150 });
	const boundedBlur = videoPreviewBlurViewport(
		{ x: 799.8, y: 999.8, width: 10, height: 10 },
		800,
		1_000,
		533,
		667,
	);
	assert.ok(boundedBlur.x >= 0 && boundedBlur.x + boundedBlur.width <= 533);
	assert.ok(boundedBlur.y >= 0 && boundedBlur.y + boundedBlur.height <= 667);
});

test('maps all supported video effects to bounded preview passes', () => {
	assert.equal(VIDEO_PREVIEW_PIXELATE_GRID_SIZE, 2);
	assert.deepEqual(videoEffectPasses(effect('color-adjust', {
		brightness: 0.2,
		contrast: 1.4,
		saturation: 0.8,
		gamma: 1.2,
		hueDegrees: -30,
	})), [{
		code: 1,
		params0: [0.2, 1.4, 0.8, 1.2],
		params1: [-30, 0, 0, 0],
		direction: [0, 0],
	}]);

	assert.deepEqual(videoEffectPasses(effect('pixelate', { blockSize: 16 }), { x: 0.5, y: 0.25 }), [{
		code: 2,
		params0: [4, 0, 0, 0],
		params1: [0, 0, 0, 0],
		direction: [0, 0],
	}]);
	assert.deepEqual(videoEffectPasses(effect('vignette', { amount: 0.75 })), [{
		code: 3,
		params0: [0.75, 0, 0, 0],
		params1: [0, 0, 0, 0],
		direction: [0, 0],
	}]);
	assert.deepEqual(videoEffectPasses(effect('sharpen', { amount: 1.25 })), [{
		code: 5,
		params0: [1.25, 1, 0, 0],
		params1: [0, 0, 0, 0],
		direction: [0, 0],
	}]);
	assert.deepEqual(videoEffectPasses(effect('rgb-split', { offsetX: 8, offsetY: -6 }), { x: 0.5, y: 0.25 }), [{
		code: 6,
		params0: [2, -1.5, 0, 0],
		params1: [0, 0, 0, 0],
		direction: [0, 0],
	}]);
});

test('expands Gaussian blur into scaled horizontal and vertical passes', () => {
	assert.deepEqual(videoEffectPasses(effect('gaussian-blur', { sigma: 12 }), { x: 0.75, y: 0.5 }), [
		{ code: 4, params0: [6, 0, 0, 0], params1: [2 / 3, 0, 0, 0], direction: [1, 0] },
		{ code: 4, params0: [6, 0, 0, 0], params1: [2 / 3, 0, 0, 0], direction: [0, 1] },
	]);

	const maximumAtFourTimesScale = videoEffectPasses(
		effect('gaussian-blur', { sigma: 20 }),
		{ x: 4, y: 4 },
	);
	assert.equal(maximumAtFourTimesScale[0].params0[0], 80);
	assert.equal(
		maximumAtFourTimesScale[0].params1[0] * 80,
		VIDEO_PREVIEW_MAX_GAUSSIAN_BLUR_KERNEL_SIGMA,
	);
	assert.ok(maximumAtFourTimesScale[0].params1[0] < 2 / 3);

	const deeplyDownsampledPathologicalScale = videoEffectPasses(
		effect('gaussian-blur', { sigma: 20 }),
		{ x: 10, y: 10 },
	);
	assert.equal(deeplyDownsampledPathologicalScale[0].params0[0], 200);
	assert.equal(
		deeplyDownsampledPathologicalScale[0].params1[0] * 200,
		VIDEO_PREVIEW_MAX_GAUSSIAN_BLUR_KERNEL_SIGMA,
	);
	assert.ok(
		deeplyDownsampledPathologicalScale[0].params1[0]
		< maximumAtFourTimesScale[0].params1[0],
	);
});

test('skips disabled, unknown, and neutral preview passes', () => {
	assert.deepEqual(videoEffectPasses(effect('pixelate', { blockSize: 16 }, false)), []);
	assert.deepEqual(videoEffectPasses(effect('missing-effect', {})), []);
	assert.deepEqual(videoEffectPasses(effect('gaussian-blur', { sigma: 0 })), []);
	assert.deepEqual(videoEffectPasses(effect('sharpen', { amount: 0 })), []);
	assert.deepEqual(videoEffectPasses(effect('vignette', { amount: 0 })), []);
	assert.deepEqual(videoEffectPasses(effect('rgb-split', { offsetX: 0, offsetY: 0 })), []);
	assert.deepEqual(videoEffectPasses(effect('color-adjust', {
		brightness: 0,
		contrast: 1,
		saturation: 1,
		gamma: 1,
		hueDegrees: 0,
	})), []);
});
