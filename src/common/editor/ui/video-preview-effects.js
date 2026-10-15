/* SPDX-License-Identifier: AGPL-3.0-only */

import { POST_CROP_VIGNETTE_EFFECT_TYPE_V1, POST_CROP_VIGNETTE_EFFECT_CODE_V1, postCropVignettePreviewPassV1 } from '../video-post-crop-vignette-v1.ts';
import { CLARITY_EFFECT_TYPE_V1, CLARITY_EFFECT_CODE_V1, clarityPreviewPassV1 } from '../video-clarity-v1.ts';
import { NOISE_REDUCTION_EFFECT_TYPE_V1, NOISE_REDUCTION_EFFECT_CODE_V1, noiseReductionPreviewPassV1 } from '../video-noise-reduction-v1.ts';
import { GRAIN_EFFECT_TYPE_V1, GRAIN_EFFECT_CODE_V1, grainPreviewPassV1 } from '../video-grain-v1.ts';
import { TEXTURE_EFFECT_TYPE_V1, TEXTURE_EFFECT_CODE_V1, texturePreviewPassV1 } from '../video-texture-v1.ts';
import { DEHAZE_EFFECT_TYPE_V1, DEHAZE_EFFECT_CODE_V1, dehazePreviewPassV1 } from '../video-dehaze-v1.ts';
import { DETAIL_SHARPEN_EFFECT_TYPE_V1, DETAIL_SHARPEN_EFFECT_CODE_V1, detailSharpenPreviewPassV1 } from '../video-sharpen-v1.ts';
import { LENS_DISTORTION_EFFECT_TYPE_V1, LENS_DISTORTION_EFFECT_CODE_V1, lensDistortionPreviewPassV1 } from '../video-lens-distortion-v1.ts';
import { VIDEO_PREVIEW_GEOMETRY_VERTEX_SHADER_SOURCE } from './video-preview-geometry-shader.ts';
import { FRAGMENT_SHADER_SOURCE, MAX_GAUSSIAN_BLUR_PAIR_COUNT } from './video-preview-effects-shader.js';
import { GLOBAL_DEVELOP_EFFECT_CODES_V1, globalDevelopPreviewPassV1, isGlobalDevelopEffectTypeV1 } from '../video-global-develop-v1.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, IMAGE_GEOMETRY_VIDEO_EFFECT_CODE_V1, imageGeometryVideoPreviewPassV1 } from '../video-image-geometry-v1.ts';
import { CHROMA_DEVELOP_EFFECT_TYPE_V1, CHROMA_DEVELOP_EFFECT_CODE_V1, chromaDevelopPreviewPassV1 } from '../video-chroma-develop-v1.ts';
import { BLACK_WHITE_MIX_EFFECT_TYPE_V1, BLACK_WHITE_MIX_EFFECT_CODE_V1, blackWhiteMixPreviewPassV1 } from '../video-black-white-mix-v1.ts';

import { HSL_MIXER_EFFECT_TYPE_V1, HSL_MIXER_EFFECT_CODE_V1, hslMixerPreviewPassV1 } from '../video-hsl-mixer-v1.ts';
import { CURVES_EFFECT_CODES_V1, curvesPreviewPassV1, isCurvesEffectTypeV1 } from '../video-curves-v1.ts';
import { COLOR_WHEELS_EFFECT_TYPE_V1, COLOR_WHEELS_EFFECT_CODE_V1, colorWheelsPreviewPassV1 } from '../video-color-wheels-v1.ts';

export { MAX_GAUSSIAN_BLUR_PAIR_COUNT, VIDEO_PREVIEW_PIXELATE_GRID_SIZE } from './video-preview-effects-shader.js';

export const EFFECT_PROGRAM_COUNT = 35;
// Calibrated default pass scale that retains the strict FFmpeg golden-frame gates.
export const GAUSSIAN_BLUR_RENDER_SCALE = 2 / 3;
const GAUSSIAN_BLUR_SIGMA_CALIBRATION = 0.85;
// Adaptive blur downsampling keeps the complete three-sigma kernel inside this
// bound instead of silently truncating high-sigma previews. Export is unaffected.
export const VIDEO_PREVIEW_MAX_GAUSSIAN_BLUR_KERNEL_SIGMA = (
	MAX_GAUSSIAN_BLUR_PAIR_COUNT * 2 - 1
) / 3 / GAUSSIAN_BLUR_SIGMA_CALIBRATION;
export const BLUR_KERNEL = Symbol('blurKernel');

export const EFFECT_CODES = Object.freeze({
	[LENS_DISTORTION_EFFECT_TYPE_V1]: LENS_DISTORTION_EFFECT_CODE_V1,
	[GRAIN_EFFECT_TYPE_V1]: GRAIN_EFFECT_CODE_V1,
	[TEXTURE_EFFECT_TYPE_V1]: TEXTURE_EFFECT_CODE_V1,
	[DEHAZE_EFFECT_TYPE_V1]: DEHAZE_EFFECT_CODE_V1,
	[NOISE_REDUCTION_EFFECT_TYPE_V1]: NOISE_REDUCTION_EFFECT_CODE_V1,
	[CLARITY_EFFECT_TYPE_V1]: CLARITY_EFFECT_CODE_V1,
	[COLOR_WHEELS_EFFECT_TYPE_V1]: COLOR_WHEELS_EFFECT_CODE_V1,
	[DETAIL_SHARPEN_EFFECT_TYPE_V1]: DETAIL_SHARPEN_EFFECT_CODE_V1,
	[POST_CROP_VIGNETTE_EFFECT_TYPE_V1]: POST_CROP_VIGNETTE_EFFECT_CODE_V1,
	[IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1]: IMAGE_GEOMETRY_VIDEO_EFFECT_CODE_V1,
	[CHROMA_DEVELOP_EFFECT_TYPE_V1]: CHROMA_DEVELOP_EFFECT_CODE_V1,
	[BLACK_WHITE_MIX_EFFECT_TYPE_V1]: BLACK_WHITE_MIX_EFFECT_CODE_V1,
	[HSL_MIXER_EFFECT_TYPE_V1]: HSL_MIXER_EFFECT_CODE_V1,
	'color-adjust': 1,
	pixelate: 2,
	vignette: 3,
	'gaussian-blur': 4,
	sharpen: 5,
	'rgb-split': 6,
	'chroma-key': 9,
	'luma-key': 10,
	'spill-suppression': 11,
	glow: 12,
	outline: 13,
	'drop-shadow': 14,
	...GLOBAL_DEVELOP_EFFECT_CODES_V1,
	...CURVES_EFFECT_CODES_V1,
});

export function finiteNumber(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function gaussianBlurKernel(sigma) {
	// This scale calibrates the finite kernel to gblur's single-step IIR response.
	const calibratedSigma = Math.max(0.01, sigma * GAUSSIAN_BLUR_SIGMA_CALIBRATION);
	const radius = Math.ceil(calibratedSigma * 3);
	const pairs = new Float32Array(MAX_GAUSSIAN_BLUR_PAIR_COUNT * 2);
	let pairCount = 0;
	let weightSum = 1;
	for (let pairIndex = 0; pairIndex < MAX_GAUSSIAN_BLUR_PAIR_COUNT; pairIndex += 1) {
		const nearIndex = 1 + pairIndex * 2;
		const farIndex = nearIndex + 1;
		const nearWeight = nearIndex <= radius
			? Math.exp(-0.5 * nearIndex * nearIndex / (calibratedSigma * calibratedSigma))
			: 0;
		const farWeight = farIndex <= radius
			? Math.exp(-0.5 * farIndex * farIndex / (calibratedSigma * calibratedSigma))
			: 0;
		const pairWeight = nearWeight + farWeight;
		if (pairWeight <= 0) break;
		pairs[pairCount * 2] = (nearIndex * nearWeight + farIndex * farWeight) / pairWeight;
		pairs[pairCount * 2 + 1] = pairWeight;
		weightSum += 2 * pairWeight;
		pairCount += 1;
	}
	return { pairCount, pairs, weightSum };
}

function gaussianBlurPass(sigma, renderScale, direction, kernel) {
	const pass = {
		code: EFFECT_CODES['gaussian-blur'],
		params0: [sigma, 0, 0, 0],
		params1: [renderScale, 0, 0, 0],
		direction,
	};
	Object.defineProperty(pass, BLUR_KERNEL, { value: kernel });
	return pass;
}

/**
 * Convert one canonical video-effect record into one or more GPU passes.
 * Gaussian blur expands to two convolution passes.
 */
export function videoEffectPasses(effect, previewScale = {}) {
	if (!effect) return [];
	if (effect.type === LENS_DISTORTION_EFFECT_TYPE_V1) { const pass = lensDistortionPreviewPassV1(effect); return pass ? [pass] : []; }
	if (effect.type === TEXTURE_EFFECT_TYPE_V1) { const pass = texturePreviewPassV1(effect); return pass ? [pass] : []; }
	if (effect.type === DEHAZE_EFFECT_TYPE_V1) { const pass = dehazePreviewPassV1(effect); return pass ? [pass] : []; }
	if (effect.type === GRAIN_EFFECT_TYPE_V1) { const pass = grainPreviewPassV1(effect); return pass ? [pass] : []; }
	if (effect.type === NOISE_REDUCTION_EFFECT_TYPE_V1) { const pass = noiseReductionPreviewPassV1(effect); return pass ? [pass] : []; }
	if (effect.type === POST_CROP_VIGNETTE_EFFECT_TYPE_V1) { const pass = postCropVignettePreviewPassV1(effect); return pass ? [pass] : []; }
	if (effect.type === CLARITY_EFFECT_TYPE_V1) { const pass = clarityPreviewPassV1(effect); return pass ? [pass] : []; }
	if (effect.type === COLOR_WHEELS_EFFECT_TYPE_V1) { const pass = colorWheelsPreviewPassV1(effect); return pass ? [pass] : []; }
	if (effect.type === DETAIL_SHARPEN_EFFECT_TYPE_V1) { const pass = detailSharpenPreviewPassV1(effect); return pass ? [pass] : []; }
	if (isCurvesEffectTypeV1(effect.type)) { const pass = curvesPreviewPassV1(effect); return pass ? [pass] : []; }
	if (effect.type === HSL_MIXER_EFFECT_TYPE_V1) { const pass = hslMixerPreviewPassV1(effect); return pass ? [pass] : []; }
	if (effect.type === BLACK_WHITE_MIX_EFFECT_TYPE_V1) { const pass = blackWhiteMixPreviewPassV1(effect); return pass ? [pass] : []; }
	if (effect.type === CHROMA_DEVELOP_EFFECT_TYPE_V1) { const pass = chromaDevelopPreviewPassV1(effect); return pass ? [pass] : []; }
	if (effect.type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) { const pass = imageGeometryVideoPreviewPassV1(effect); return pass ? [pass] : []; }
	if (isGlobalDevelopEffectTypeV1(effect.type)) { const pass = globalDevelopPreviewPassV1(effect); return pass ? [pass] : []; }
	if (effect.enabled === false) return [];
	const code = EFFECT_CODES[effect.type];
	if (!code) return [];
	const params = effect.params || {};
	const scaleX = Math.max(0.0001, finiteNumber(previewScale.x, 1));
	const scaleY = Math.max(0.0001, finiteNumber(previewScale.y, 1));
	const pixelScale = Math.min(scaleX, scaleY);
	if (effect.type === 'color-adjust') {
		const brightness = finiteNumber(params.brightness, 0);
		const contrast = finiteNumber(params.contrast, 1);
		const saturation = finiteNumber(params.saturation, 1);
		const gamma = finiteNumber(params.gamma, 1);
		const hueDegrees = finiteNumber(params.hueDegrees, 0);
		if (
			brightness === 0
			&& contrast === 1
			&& saturation === 1
			&& gamma === 1
			&& hueDegrees === 0
		) return [];
		return [{
			code,
			params0: [brightness, contrast, saturation, gamma],
			params1: [hueDegrees, 0, 0, 0],
			direction: [0, 0],
		}];
	}
	if (effect.type === 'gaussian-blur') {
		const sigma = finiteNumber(params.sigma, 0) * pixelScale;
		if (sigma <= 0) return [];
		const renderScale = Math.min(
			GAUSSIAN_BLUR_RENDER_SCALE,
			VIDEO_PREVIEW_MAX_GAUSSIAN_BLUR_KERNEL_SIGMA / sigma,
		);
		const kernel = gaussianBlurKernel(sigma * renderScale);
		return [
			gaussianBlurPass(sigma, renderScale, [1, 0], kernel),
			gaussianBlurPass(sigma, renderScale, [0, 1], kernel),
		];
	}
	if (effect.type === 'rgb-split') {
		const offsetX = finiteNumber(params.offsetX, 0) * pixelScale;
		const offsetY = finiteNumber(params.offsetY, 0) * pixelScale;
		if (offsetX === 0 && offsetY === 0) return [];
		return [{
			code,
			params0: [offsetX, offsetY, 0, 0],
			params1: [0, 0, 0, 0],
			direction: [0, 0],
		}];
	}
	if (effect.type === 'sharpen') {
		const amount = finiteNumber(params.amount, 0);
		if (amount <= 0) return [];
		return [{
			code,
			params0: [amount, pixelScale, 0, 0],
			params1: [0, 0, 0, 0],
			direction: [0, 0],
		}];
	}
	if (effect.type === 'chroma-key') {
		return [{ code, params0: [finiteNumber(params.keyColor, 0x00ff00), finiteNumber(params.similarity, 0.1), finiteNumber(params.softness, 0.1), 0], params1: [pixelScale, 0, 0, 0], direction: [0, 0] }];
	}
	if (effect.type === 'luma-key') {
		return [{ code, params0: [finiteNumber(params.mode, 0), finiteNumber(params.cutoff, 0.2), finiteNumber(params.softness, 0.1), 0], params1: [0, 0, 0, 0], direction: [0, 0] }];
	}
	if (effect.type === 'spill-suppression') {
		const strength = finiteNumber(params.strength, 0);
		if (strength <= 0) return [];
		return [{ code, params0: [finiteNumber(params.screen, 0), strength, 0, 0], params1: [0, 0, 0, 0], direction: [0, 0] }];
	}
	if (effect.type === 'glow') {
		const threshold = finiteNumber(params.threshold, 0.7);
		const sigma = finiteNumber(params.sigma, 0) * pixelScale;
		const intensity = finiteNumber(params.intensity, 0);
		if (intensity <= 0 || threshold >= 1) return [];
		const passes = [{ code, params0: [threshold, 0, 0, 0], params1: [0, 0, 0, 0], direction: [0, 0], preserveSource: true }];
		if (sigma > 0) {
			const renderScale = Math.min(
				GAUSSIAN_BLUR_RENDER_SCALE,
				VIDEO_PREVIEW_MAX_GAUSSIAN_BLUR_KERNEL_SIGMA / sigma,
			);
			const kernel = gaussianBlurKernel(sigma * renderScale);
			passes.push(
				gaussianBlurPass(sigma, renderScale, [1, 0], kernel),
				gaussianBlurPass(sigma, renderScale, [0, 1], kernel),
			);
		}
		passes.push({ code: 16, params0: [intensity, 0, 0, 0], params1: [0, 0, 0, 0], direction: [0, 0], auxiliary: true });
		return passes;
	}
	if (effect.type === 'outline') {
		const width = finiteNumber(params.width, 0) * pixelScale;
		const opacity = finiteNumber(params.opacity, 0);
		if (width <= 0 || opacity <= 0) return [];
		const values = [width, finiteNumber(params.color, 0xffffff), opacity, 0];
		return [
			{ code, params0: values, params1: [0, 0, 0, 0], direction: [0, 0], preserveSource: true },
			{ code: 15, params0: values, params1: [0, 0, 0, 0], direction: [0, 0], auxiliary: true },
		];
	}
	if (effect.type === 'drop-shadow') {
		const opacity = finiteNumber(params.opacity, 0);
		if (opacity <= 0) return [];
		const offsetX = finiteNumber(params.offsetX, 0) * pixelScale;
		const offsetY = finiteNumber(params.offsetY, 0) * pixelScale;
		const sigma = finiteNumber(params.sigma, 0) * pixelScale;
		const color = finiteNumber(params.color, 0);
		const passes = [{
			code,
			params0: [
				offsetX,
				offsetY,
				sigma,
				color,
			],
			params1: [0, 0, 0, 0],
			direction: [0, 0],
			preserveSource: true,
		}];
		if (sigma > 0) {
			const renderScale = Math.min(
				GAUSSIAN_BLUR_RENDER_SCALE,
				VIDEO_PREVIEW_MAX_GAUSSIAN_BLUR_KERNEL_SIGMA / sigma,
			);
			const kernel = gaussianBlurKernel(sigma * renderScale);
			passes.push(
				gaussianBlurPass(sigma, renderScale, [1, 0], kernel),
				gaussianBlurPass(sigma, renderScale, [0, 1], kernel),
			);
		}
		passes.push({
			code: 17,
			params0: [offsetX, offsetY, sigma, color],
			params1: [opacity, 0, 0, 0],
			direction: [0, 0],
			auxiliary: true,
		});
		return passes;
	}
	const value = effect.type === 'pixelate'
		? finiteNumber(params.blockSize, 1) * pixelScale
		: effect.type === 'vignette'
			? finiteNumber(params.amount, 0)
			: finiteNumber(params.amount, 0);
	if (effect.type === 'vignette' && value <= 0) return [];
	return [{
		code,
		params0: [value, 0, 0, 0],
		params1: [0, 0, 0, 0],
		direction: [0, 0],
	}];
}

function compileShader(gl, type, source) {
	const shader = gl.createShader(type);
	if (!shader) throw new Error('Unable to allocate a WebGL shader.');
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
	const message = gl.getShaderInfoLog(shader) || 'Unknown shader compilation failure.';
	gl.deleteShader(shader);
	throw new Error(message);
}

export function createProgram(gl, effectCode) {
	const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VIDEO_PREVIEW_GEOMETRY_VERTEX_SHADER_SOURCE);
	const fragmentSource = FRAGMENT_SHADER_SOURCE.replace(
		'uniform int u_effect;',
		`const int u_effect = ${effectCode};`,
	);
	const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
	const program = gl.createProgram();
	if (!program) throw new Error('Unable to allocate a WebGL program.');
	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);
	if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
	const message = gl.getProgramInfoLog(program) || 'Unknown WebGL program link failure.';
	gl.deleteProgram(program);
	throw new Error(message);
}

export function programLocations(gl, program) {
	return {
		position: gl.getAttribLocation(program, 'a_position'),
		positionTransform: gl.getUniformLocation(program, 'u_position_transform'),
		textureTransform: gl.getUniformLocation(program, 'u_texture_transform'),
		texture: gl.getUniformLocation(program, 'u_texture'),
		auxTexture: gl.getUniformLocation(program, 'u_aux_texture'),
		globalLookup: gl.getUniformLocation(program, 'u_global_lookup'),
		resolution: gl.getUniformLocation(program, 'u_resolution'),
		sourceResolution: gl.getUniformLocation(program, 'u_source_resolution'),
		contentRect: gl.getUniformLocation(program, 'u_content_rect'),
		sourceRect: gl.getUniformLocation(program, 'u_source_rect'),
		direction: gl.getUniformLocation(program, 'u_direction'),
		params0: gl.getUniformLocation(program, 'u_params0'),
		params1: gl.getUniformLocation(program, 'u_params1'),
		params2: gl.getUniformLocation(program, 'u_params2'), params3: gl.getUniformLocation(program, 'u_params3'),
		params4: gl.getUniformLocation(program, 'u_params4'), params5: gl.getUniformLocation(program, 'u_params5'),
		geometryOutput: gl.getUniformLocation(program, 'u_geometry_output'),
		geometrySource: gl.getUniformLocation(program, 'u_geometry_source'),
		geometryBounds: gl.getUniformLocation(program, 'u_geometry_bounds'),
		opacity: gl.getUniformLocation(program, 'u_opacity'),
		blurPairs: gl.getUniformLocation(program, 'u_blur_pairs[0]'),
		blurPairCount: gl.getUniformLocation(program, 'u_blur_pair_count'),
		blurWeightSum: gl.getUniformLocation(program, 'u_blur_weight_sum'),
	};
}
