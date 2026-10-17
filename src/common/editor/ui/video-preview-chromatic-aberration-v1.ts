/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reference-grid G/A stay exact, including hidden green. Each nonzero R/B
 * control reconstructs its own straight channel from zero-extended alpha-
 * weighted taps; reconstructed alpha is a divisor, never an output plane. */
export const CHROMATIC_ABERRATION_GLSL_V1 = `
vec4 chromatic_aberration_sample(vec2 index) {
	if (any(lessThan(index, vec2(0.0))) || any(greaterThanEqual(index, u_source_resolution))) return vec4(0.0);
	// The entry owner rounds its content viewport to integer FBO texels.
	// Fetch exactly: LINEAR center-UV error must not create alpha support.
	ivec2 origin = ivec2(floor(u_source_rect.xy * vec2(textureSize(u_texture, 0)) + 0.5));
	ivec2 pixel = ivec2(index), size = ivec2(u_source_resolution);
	return texelFetch(u_texture, origin + ivec2(pixel.x, size.y - 1 - pixel.y), 0);
}
vec2 chromatic_aberration_tap(vec2 index, bool red) {
	vec4 color = chromatic_aberration_sample(index);
	return vec2((red ? color.r : color.b) * color.a, color.a);
}
float chromatic_aberration_channel(vec2 index, vec2 displacement, bool red) {
	// Keep a tiny supporting weight separate from its integer coordinate.
	// Signed magnitude also avoids deriving that weight as1-(1-tiny).
	vec2 direction = sign(displacement), magnitude = abs(displacement);
	vec2 whole = floor(magnitude), f = magnitude - whole;
	vec2 base = index + direction * whole;
	vec2 sum = chromatic_aberration_tap(base, red) * ((1.0 - f.x) * (1.0 - f.y))
		+ chromatic_aberration_tap(base + vec2(direction.x, 0.0), red) * (f.x * (1.0 - f.y))
		+ chromatic_aberration_tap(base + vec2(0.0, direction.y), red) * ((1.0 - f.x) * f.y)
		+ chromatic_aberration_tap(base + direction, red) * (f.x * f.y);
	return sum.y == 0.0 ? 0.0 : floor(sum.x / sum.y * 255.0 + 0.5) / 255.0;
}
vec4 chromatic_aberration_render(vec2 content_uv) {
	vec2 index = floor(vec2(content_uv.x, 1.0 - content_uv.y) * u_source_resolution);
	vec4 reference = chromatic_aberration_sample(index);
	vec2 center = u_source_resolution * 0.5, delta = index + 0.5 - center;
	float radius_squared = dot(delta, delta) / dot(center, center);
	float red = u_params0.z == 0.0 ? reference.r : chromatic_aberration_channel(index, delta * (u_params0.x * radius_squared), true);
	float blue = u_params0.w == 0.0 ? reference.b : chromatic_aberration_channel(index, delta * (u_params0.y * radius_squared), false);
	return vec4(red, reference.g, blue, reference.a);
}
`;
