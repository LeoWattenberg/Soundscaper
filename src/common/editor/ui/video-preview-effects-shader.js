/* SPDX-License-Identifier: AGPL-3.0-only */

export const MAX_GAUSSIAN_BLUR_PAIR_COUNT = 30;
export const VIDEO_PREVIEW_PIXELATE_GRID_SIZE = 2;

export const FRAGMENT_SHADER_SOURCE = `#version 300 es
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
		float sample_stride = max(radius / 16.0, 1.0);
		float dilated_alpha = 0.0;
		for (int sample_x = -16; sample_x <= 16; sample_x += 1) {
			float sample_offset = float(sample_x) * sample_stride;
			if (abs(sample_offset) > radius) continue;
			vec2 offset = vec2(sample_offset, 0.0) / max(u_resolution, vec2(1.0));
			dilated_alpha = max(dilated_alpha, sample_content_transparent(content_uv + offset).a);
		}
		color = vec4(0.0, 0.0, 0.0, dilated_alpha);
	} else if (u_effect == 14) {
		color = vec4(0.0, 0.0, 0.0, color.a);
	} else if (u_effect == 15) {
		float radius = max(0.0, u_params0.x);
		float sample_stride = max(radius / 16.0, 1.0);
		float dilated_alpha = 0.0;
		for (int sample_y = -16; sample_y <= 16; sample_y += 1) {
			float sample_offset = float(sample_y) * sample_stride;
			if (abs(sample_offset) > radius) continue;
			vec2 offset = vec2(0.0, sample_offset) / max(u_resolution, vec2(1.0));
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

