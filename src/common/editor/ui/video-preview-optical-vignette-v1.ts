/* SPDX-License-Identifier: AGPL-3.0-only */

/** Integer incoming-stage texels; only the delivered encoded byte is rounded.
 * Multiplication occurs in continuous linear light, without a byte lookup. */
export const OPTICAL_VIGNETTE_GLSL_V1 = `
float optical_vignette_decode(float value) {
	return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4);
}
float optical_vignette_encode(float value) {
	return value <= 0.0031308 ? 12.92 * value : 1.055 * pow(value, 1.0 / 2.4) - 0.055;
}
vec4 optical_vignette_render(vec2 content_uv) {
	ivec2 size = ivec2(u_source_resolution);
	ivec2 index = clamp(ivec2(floor(vec2(content_uv.x, 1.0 - content_uv.y) * u_source_resolution)), ivec2(0), size - ivec2(1));
	ivec2 origin = ivec2(floor(u_source_rect.xy * vec2(textureSize(u_texture, 0)) + 0.5));
	vec4 color = floor(texelFetch(u_texture, origin + ivec2(index.x, size.y - 1 - index.y), 0) * 255.0 + 0.5) / 255.0;
	if (color.a == 0.0) return color;
	vec2 offset = 2.0 * vec2(index) + 1.0 - u_source_resolution;
	float radius_squared = dot(offset, offset) / dot(u_source_resolution, u_source_resolution);
	float gain = exp2((2.0 * u_params0.x) * radius_squared);
	if (gain == 1.0) return color;
	vec3 output_rgb;
	for (int channel = 0; channel < 3; channel++) {
		float encoded = optical_vignette_encode(optical_vignette_decode(color[channel]) * gain);
		output_rgb[channel] = floor(clamp(encoded, 0.0, 1.0) * 255.0 + 0.5) / 255.0;
	}
	return vec4(output_rgb, color.a);
}
`;
