/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_PREVIEW_GEOMETRY_VERTEX_SHADER_SOURCE } from './video-preview-geometry-shader.ts';

export const MAX_GAUSSIAN_BLUR_PAIR_COUNT = 30;
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
export const VIDEO_PREVIEW_PIXELATE_GRID_SIZE = 2;

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

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform sampler2D u_aux_texture;
uniform int u_effect;
uniform vec2 u_resolution;
uniform vec2 u_source_resolution;
uniform vec4 u_content_rect;
uniform vec4 u_source_rect;
uniform vec2 u_direction;
uniform vec4 u_params0;
uniform vec4 u_params1;
uniform float u_opacity;
uniform vec2 u_blur_pairs[${MAX_GAUSSIAN_BLUR_PAIR_COUNT}];
uniform int u_blur_pair_count;
uniform float u_blur_weight_sum;

in vec2 v_uv;
out vec4 out_color;

vec4 sample_frame(vec2 uv) {
	return texture(u_texture, clamp(uv, vec2(0.0), vec2(1.0)));
}

vec4 sample_content(vec2 uv) {
	vec2 half_texel = 0.5 / max(u_source_resolution, vec2(1.0));
	vec2 bounded_uv = clamp(uv, half_texel, vec2(1.0) - half_texel);
	return texture(u_texture, u_source_rect.xy + bounded_uv * u_source_rect.zw);
}

vec4 sample_content_transparent(vec2 uv) {
	if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
	return texture(u_texture, u_source_rect.xy + uv * u_source_rect.zw);
}

vec4 sample_aux_content_transparent(vec2 uv) {
	if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
	return texture(u_aux_texture, u_source_rect.xy + uv * u_source_rect.zw);
}

vec3 packed_color(float packed) {
	float red = floor(packed / 65536.0);
	float green = floor(mod(packed, 65536.0) / 256.0);
	float blue = mod(packed, 256.0);
	return vec3(red, green, blue) / 255.0;
}

vec4 underlay(vec4 source, vec3 decoration_rgb, float decoration_alpha) {
	float behind = clamp(decoration_alpha, 0.0, 1.0) * (1.0 - source.a);
	float alpha = source.a + behind;
	vec3 rgb = alpha > 0.00001
		? (source.rgb * source.a + decoration_rgb * behind) / alpha
		: vec3(0.0);
	return vec4(rgb, alpha);
}

vec3 rgb_to_limited_yuv(vec3 rgb) {
	return vec3(
		16.0 / 255.0 + dot(rgb, vec3(65.481, 128.553, 24.966) / 255.0),
		128.0 / 255.0 + dot(rgb, vec3(-37.797, -74.203, 112.0) / 255.0),
		128.0 / 255.0 + dot(rgb, vec3(112.0, -93.786, -18.214) / 255.0)
	);
}

vec3 limited_yuv_to_rgb(vec3 yuv) {
	float luma = 1.164383 * (yuv.x - 16.0 / 255.0);
	float cb = yuv.y - 128.0 / 255.0;
	float cr = yuv.z - 128.0 / 255.0;
	return vec3(
		luma + 1.596027 * cr,
		luma - 0.391762 * cb - 0.812968 * cr,
		luma + 2.017232 * cb
	);
}

void main() {
	vec2 content_uv = (v_uv - u_content_rect.xy) / max(u_content_rect.zw, vec2(0.00001));
	if (u_effect != 0 && (
		content_uv.x < 0.0 || content_uv.y < 0.0
		|| content_uv.x > 1.0 || content_uv.y > 1.0
	)) {
		out_color = vec4(0.0);
		return;
	}
	vec4 color = u_effect == 0 ? sample_frame(v_uv) : sample_content(content_uv);

	if (u_effect == 7) {
		// Match export's final yuv420p chroma negotiation before RGBA display.
		vec2 output_pixel = floor(content_uv * u_resolution);
		// With LINEAR filtering, the center of each 2x2 block averages all
		// four source texels before the linear RGB-to-chroma conversion.
		vec2 chroma_pixel = floor(output_pixel * 0.5) * 2.0 + 1.0;
		vec3 chroma_rgb = sample_content(chroma_pixel / max(u_resolution, vec2(1.0))).rgb;
		float y = 16.0 / 255.0 + dot(color.rgb, vec3(65.481, 128.553, 24.966) / 255.0);
		float cb = 128.0 / 255.0 + dot(chroma_rgb, vec3(-37.797, -74.203, 112.0) / 255.0);
		float cr = 128.0 / 255.0 + dot(chroma_rgb, vec3(112.0, -93.786, -18.214) / 255.0);
		float luma = 1.164383 * (y - 16.0 / 255.0);
		color.rgb = vec3(
			luma + 1.596027 * (cr - 128.0 / 255.0),
			luma - 0.391762 * (cb - 128.0 / 255.0) - 0.812968 * (cr - 128.0 / 255.0),
			luma + 2.017232 * (cb - 128.0 / 255.0)
		);
	} else if (u_effect == 1) {
		float brightness = u_params0.x;
		float contrast = u_params0.y;
		float saturation = u_params0.z;
		float gamma = max(0.01, u_params0.w);
		vec3 yuv = rgb_to_limited_yuv(color.rgb);
		yuv.x = clamp(pow(max((yuv.x - 0.5) * contrast + 0.5 + brightness, 0.0), 1.0 / gamma), 0.0, 1.0);
		yuv.yz = clamp((yuv.yz - 0.5) * saturation + 0.5, 0.0, 1.0);
		float hue = radians(u_params1.x);
		vec2 chroma = yuv.yz - 128.0 / 255.0;
		yuv.yz = clamp(vec2(
			chroma.x * cos(hue) - chroma.y * sin(hue),
			chroma.x * sin(hue) + chroma.y * cos(hue)
		) + 128.0 / 255.0, 0.0, 1.0);
		// These are the same legal-range guards serialized after eq/hue for export.
		yuv.x = clamp(yuv.x, 16.0 / 255.0, 235.0 / 255.0);
		yuv.yz = clamp(yuv.yz, vec2(16.0 / 255.0), vec2(240.0 / 255.0));
		color.rgb = limited_yuv_to_rgb(yuv);
	} else if (u_effect == 2) {
		float block_size = max(1.0, u_params0.x);
		vec2 pixel_size = vec2(block_size) / max(u_resolution, vec2(1.0));
		vec2 top_origin_uv = vec2(content_uv.x, 1.0 - content_uv.y);
		vec2 block_origin = floor(top_origin_uv / pixel_size) * pixel_size;
		vec2 block_extent = min(pixel_size, vec2(1.0) - block_origin);
		vec4 block_average = vec4(0.0);
		for (int sample_y = 0; sample_y < ${VIDEO_PREVIEW_PIXELATE_GRID_SIZE}; sample_y += 1) {
			for (int sample_x = 0; sample_x < ${VIDEO_PREVIEW_PIXELATE_GRID_SIZE}; sample_x += 1) {
				vec2 sample_position = (vec2(float(sample_x), float(sample_y)) + 0.5)
					/ float(${VIDEO_PREVIEW_PIXELATE_GRID_SIZE});
				vec2 top_origin_sample = block_origin + sample_position * block_extent;
				block_average += sample_content(vec2(top_origin_sample.x, 1.0 - top_origin_sample.y));
			}
		}
		color = block_average / float(${VIDEO_PREVIEW_PIXELATE_GRID_SIZE * VIDEO_PREVIEW_PIXELATE_GRID_SIZE});
	} else if (u_effect == 3) {
		float amount = clamp(u_params0.x, 0.0, 1.0);
		float angle = amount * (1.57079632679 - 0.001);
		vec2 render_pixel = floor(content_uv * u_resolution);
		vec2 ffmpeg_pixel = vec2(render_pixel.x, u_resolution.y - 1.0 - render_pixel.y);
		vec2 centered_pixels = ffmpeg_pixel - u_resolution * 0.5;
		float maximum_distance = max(0.00001, length(u_resolution * 0.5));
		float normalized_distance = clamp(length(centered_pixels) / maximum_distance, 0.0, 1.0);
		float cosine = cos(angle * normalized_distance);
		float attenuation = cosine * cosine * cosine * cosine;
		color.rgb = floor(color.rgb * attenuation * 255.0) / 255.0;
	} else if (u_effect == 4) {
		vec4 blurred = sample_content(content_uv);
		for (int pair_index = 0; pair_index < ${MAX_GAUSSIAN_BLUR_PAIR_COUNT}; pair_index += 1) {
			if (pair_index >= u_blur_pair_count) break;
			vec2 pair = u_blur_pairs[pair_index];
			vec2 offset = u_direction * pair.x / max(u_resolution, vec2(1.0));
			blurred += sample_content(content_uv + offset) * pair.y;
			blurred += sample_content(content_uv - offset) * pair.y;
		}
		color = blurred / max(u_blur_weight_sum, 0.00001);
	} else if (u_effect == 5) {
		float amount = max(0.0, u_params0.x);
		float pixel_scale = max(0.0001, u_params0.y);
		vec2 texel = vec2(pixel_scale) / max(u_resolution, vec2(1.0));
		float blurred_luminance = 0.0;
		// Linear sampling combines the [1, 4] side pairs of the exact
		// [1, 4, 6, 4, 1] binomial kernel into one sample at +/- 1.2 texels.
		// The resulting separable [5, 6, 5] weights retain the original 5x5
		// convolution while reducing its 25 texture reads to nine.
		for (int offset_y = -1; offset_y <= 1; offset_y += 1) {
			float weight_y = offset_y == 0 ? 6.0 : 5.0;
			for (int offset_x = -1; offset_x <= 1; offset_x += 1) {
				float weight_x = offset_x == 0 ? 6.0 : 5.0;
				vec3 sample_rgb = sample_content(
					content_uv + vec2(float(offset_x), float(offset_y)) * texel * 1.2
				).rgb;
				blurred_luminance += dot(sample_rgb, vec3(0.299, 0.587, 0.114))
					* weight_x * weight_y;
			}
		}
		blurred_luminance /= 256.0;
		float source_luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
		color.rgb += vec3(amount * (source_luminance - blurred_luminance));
		// Preserve FFmpeg's luma-only unsharp and its YUV420 chroma siting.
		vec2 output_pixel = floor(content_uv * u_resolution);
		vec2 chroma_pixel = floor(output_pixel * 0.5) * 2.0 + 1.99;
		vec3 chroma_rgb = sample_content(chroma_pixel / max(u_resolution, vec2(1.0))).rgb;
		vec3 yuv = rgb_to_limited_yuv(color.rgb);
		yuv.yz = rgb_to_limited_yuv(chroma_rgb).yz;
		color.rgb = limited_yuv_to_rgb(yuv);
	} else if (u_effect == 6) {
		vec2 red_offset = vec2(-u_params0.x, u_params0.y)
			/ max(u_resolution, vec2(1.0));
		color.r = sample_content(content_uv + red_offset).r;
		color.b = sample_content(content_uv - red_offset).b;
	} else if (u_effect == 9) {
		vec3 key_rgb = packed_color(u_params0.x) * 255.0;
		vec2 key_chroma = vec2(
			floor((-173.0 * key_rgb.r - 339.0 * key_rgb.g + 512.0 * key_rgb.b + 511.0) / 1024.0) + 128.0,
			floor((512.0 * key_rgb.r - 429.0 * key_rgb.g - 83.0 * key_rgb.b + 511.0) / 1024.0) + 128.0
		) / 255.0;
		float similarity = max(0.00001, u_params0.y);
		float softness = u_params0.z;
		float distance_from_key = 0.0;
		// FFmpeg's chromakey neighborhood is expressed in export pixels. A
		// physical preview pixel may represent more or less than one of those.
		float sample_scale = max(u_params1.x, 0.0001);
		vec2 texel = vec2(sample_scale) / max(u_resolution, vec2(1.0));
		for (int sample_y = -1; sample_y <= 1; sample_y += 1) {
			for (int sample_x = -1; sample_x <= 1; sample_x += 1) {
				vec2 sample_uv = content_uv + vec2(float(sample_x), float(sample_y)) * texel;
				vec2 boundary_uv = sample_uv;
				bool missing_uses_key = sample_uv.y > 1.0;
				if (sample_uv.y < 0.0) {
					float stale_x = sample_x < 0
						? 1.0 - 1.5 * texel.x
						: 1.0 - 0.5 * texel.x;
					boundary_uv = vec2(max(stale_x, 0.5 * texel.x), 0.5 * texel.y);
				} else if (sample_uv.x < 0.0) {
					missing_uses_key = content_uv.y > 1.0 - texel.y;
					boundary_uv = vec2(
						max(1.0 - 1.5 * texel.x, 0.5 * texel.x),
						clamp(content_uv.y + (1.0 - float(sample_y)) * texel.y, 0.5 * texel.y, 1.0 - 0.5 * texel.y)
					);
				}
				vec2 sample_chroma = missing_uses_key
					? key_chroma
					: floor(rgb_to_limited_yuv(sample_content(boundary_uv).rgb).yz * 255.0 + 0.5) / 255.0;
				distance_from_key += distance(sample_chroma, key_chroma) / 1.41421356237;
			}
		}
		distance_from_key /= 9.0;
		float matte = softness <= 0.0
			? step(similarity, distance_from_key)
			: clamp((distance_from_key - similarity) / softness, 0.0, 1.0);
		vec3 encoded_yuv = floor(rgb_to_limited_yuv(color.rgb) * 255.0 + 0.5) / 255.0;
		color.rgb = limited_yuv_to_rgb(encoded_yuv);
		color.a *= matte;
	} else if (u_effect == 10) {
		vec3 encoded_yuv = floor(rgb_to_limited_yuv(color.rgb) * 255.0 + 0.5) / 255.0;
		float luma = encoded_yuv.x * 255.0;
		float center = u_params0.x < 0.5 ? 0.0 : 1.0;
		float tolerance = u_params0.x < 0.5 ? u_params0.y : 1.0 - u_params0.y;
		float black = clamp(floor((center - tolerance) * 255.0), 0.0, 255.0);
		float white = clamp(floor((center + tolerance) * 255.0), 0.0, 255.0);
		float softness = floor(u_params0.z * 255.0);
		float matte = 1.0;
		if (luma >= black && luma <= white) {
			matte = 0.0;
		} else if (softness > 0.0 && luma > black - softness && luma < white + softness) {
			matte = luma < black
				? 1.0 - (luma - black + softness) / softness
				: (luma - white) / softness;
			matte = floor(clamp(matte, 0.0, 1.0) * 255.0) / 255.0;
		}
		color.rgb = limited_yuv_to_rgb(encoded_yuv);
		color.a *= matte;
	} else if (u_effect == 11) {
		float strength = clamp(u_params0.y, 0.0, 1.0);
		if (u_params0.x < 0.5) {
			float spill = max(color.g - 0.5 * (color.r + color.b), 0.0);
			color.g = max(0.0, color.g - spill * strength);
		} else {
			float spill = max(color.b - 0.5 * (color.r + color.g), 0.0);
			color.b = max(0.0, color.b - spill * strength);
		}
	} else if (u_effect == 12) {
		float threshold = clamp(u_params0.x, 0.0, 1.0);
		float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
		float bright = max((luma - threshold) / max(1.0 - threshold, 0.00001), 0.0) * color.a;
		color.rgb *= bright;
	} else if (u_effect == 13) {
		float radius = max(0.0, u_params0.x);
		float dilated_alpha = 0.0;
		for (int sample_x = -16; sample_x <= 16; sample_x += 1) {
			if (abs(float(sample_x)) > radius) continue;
			vec2 offset = vec2(float(sample_x), 0.0) / max(u_resolution, vec2(1.0));
			dilated_alpha = max(dilated_alpha, sample_content_transparent(content_uv + offset).a);
		}
		color = vec4(0.0, 0.0, 0.0, dilated_alpha);
	} else if (u_effect == 14) {
		color = vec4(0.0, 0.0, 0.0, color.a);
	} else if (u_effect == 15) {
		float radius = max(0.0, u_params0.x);
		float dilated_alpha = 0.0;
		for (int sample_y = -16; sample_y <= 16; sample_y += 1) {
			if (abs(float(sample_y)) > radius) continue;
			vec2 offset = vec2(0.0, float(sample_y)) / max(u_resolution, vec2(1.0));
			dilated_alpha = max(dilated_alpha, sample_content_transparent(content_uv + offset).a);
		}
		vec4 original = sample_aux_content_transparent(content_uv);
		float decoration_alpha = max(dilated_alpha - original.a, 0.0) * u_params0.z;
		color = underlay(original, packed_color(u_params0.y), decoration_alpha);
	} else if (u_effect == 16) {
		vec4 original = sample_aux_content_transparent(content_uv);
		float intensity = clamp(u_params0.x, 0.0, 1.0);
		color.rgb = 1.0 - (1.0 - original.rgb) * (1.0 - color.rgb * intensity);
		color.a = original.a;
	} else if (u_effect == 17) {
		vec2 offset = vec2(-u_params0.x, u_params0.y) / max(u_resolution, vec2(1.0));
		float decoration_alpha = sample_content_transparent(content_uv + offset).a * u_params1.x;
		vec4 original = sample_aux_content_transparent(content_uv);
		color = underlay(original, packed_color(u_params0.w), decoration_alpha);
	}

	color.a *= clamp(u_opacity, 0.0, 1.0);
	out_color = color;
}`;

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
