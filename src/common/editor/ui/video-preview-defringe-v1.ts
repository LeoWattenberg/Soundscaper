/* SPDX-License-Identifier: AGPL-3.0-only */

/** Integer FBO taps, clamped radius-one neighbors and difference-form excess
 * keep flat colored regions neutral. Alpha-zero centers bypass all algebra. */
export const DEFRINGE_GLSL_V1 = `
vec4 defringe_sample(ivec2 index) {
	ivec2 size = ivec2(u_source_resolution);
	ivec2 origin = ivec2(floor(u_source_rect.xy * vec2(textureSize(u_texture, 0)) + 0.5));
	ivec2 pixel = clamp(index, ivec2(0), size - ivec2(1));
	return floor(texelFetch(u_texture, origin + ivec2(pixel.x, size.y - 1 - pixel.y), 0) * 255.0 + 0.5);
}
float defringe_luma(vec3 color) { return dot(color, vec3(54.0, 183.0, 19.0)) / 65280.0; }
vec2 defringe_excess(vec3 color) {
	return max(vec2(0.0), vec2(min(color.r, color.b) - color.g, color.g - max(color.r, color.b))) / 255.0;
}
vec4 defringe_render(vec2 content_uv) {
	ivec2 index = ivec2(floor(vec2(content_uv.x, 1.0 - content_uv.y) * u_source_resolution));
	vec4 color = defringe_sample(index);
	if (color.a == 0.0) return color / 255.0;
	float luma = defringe_luma(color.rgb), low = luma, high = luma, neighbor_alpha = 0.0;
	vec2 excess = defringe_excess(color.rgb), difference = vec2(0.0);
	for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
		if (x == 0 && y == 0) continue;
		vec4 neighbor = defringe_sample(index + ivec2(x, y));
		if (neighbor.a == 0.0) continue;
		float neighbor_luma = defringe_luma(neighbor.rgb);
		low = min(low, neighbor_luma); high = max(high, neighbor_luma);
		neighbor_alpha += neighbor.a;
		difference += neighbor.a * (excess - defringe_excess(neighbor.rgb));
	}
	vec2 gates = neighbor_alpha == 0.0 ? vec2(0.0) : clamp(4.0 * difference / neighbor_alpha, vec2(0.0), vec2(1.0));
	float edge = clamp(4.0 * ((high - low) - u_params0.z), 0.0, 1.0);
	float weight = clamp(edge * dot(u_params0.xy, gates), 0.0, 1.0);
	if (weight == 0.0) return color / 255.0;
	vec3 encoded = color.rgb / 255.0;
	return vec4(floor((encoded + weight * (vec3(luma) - encoded)) * 255.0 + 0.5) / 255.0, color.a / 255.0);
}
`;
