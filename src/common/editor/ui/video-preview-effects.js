/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_PREVIEW_GEOMETRY_VERTEX_SHADER_SOURCE } from './video-preview-geometry-shader.ts';
import { FRAGMENT_SHADER_SOURCE, MAX_GAUSSIAN_BLUR_PAIR_COUNT } from './video-preview-effects-shader.js';

export { MAX_GAUSSIAN_BLUR_PAIR_COUNT, VIDEO_PREVIEW_PIXELATE_GRID_SIZE } from './video-preview-effects-shader.js';

export const EFFECT_PROGRAM_COUNT = 18;
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
	if (!effect || effect.enabled === false) return [];
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
		resolution: gl.getUniformLocation(program, 'u_resolution'),
		sourceResolution: gl.getUniformLocation(program, 'u_source_resolution'),
		contentRect: gl.getUniformLocation(program, 'u_content_rect'),
		sourceRect: gl.getUniformLocation(program, 'u_source_rect'),
		direction: gl.getUniformLocation(program, 'u_direction'),
		params0: gl.getUniformLocation(program, 'u_params0'),
		params1: gl.getUniformLocation(program, 'u_params1'),
		opacity: gl.getUniformLocation(program, 'u_opacity'),
		blurPairs: gl.getUniformLocation(program, 'u_blur_pairs[0]'),
		blurPairCount: gl.getUniformLocation(program, 'u_blur_pair_count'),
		blurWeightSum: gl.getUniformLocation(program, 'u_blur_weight_sum'),
	};
}
