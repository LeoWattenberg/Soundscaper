/* SPDX-License-Identifier: AGPL-3.0-only */

/** Integer texel centers and zero-extended, premultiplied bilinear taps match
 * the encoded byte kernel. Only the delivered byte stage is quantized. */
export const LENS_DISTORTION_GLSL_V1 = `
vec4 lens_distortion_sample(vec2 index) {
	if (any(lessThan(index, vec2(0.0))) || any(greaterThanEqual(index, u_source_resolution))) return vec4(0.0);
	vec2 uv = (index + 0.5) / u_source_resolution;
	vec4 texel = texture(u_texture, u_source_rect.xy + vec2(uv.x, 1.0 - uv.y) * u_source_rect.zw);
	return vec4(texel.rgb * texel.a, texel.a);
}
vec4 lens_distortion_render(vec2 content_uv) {
	vec2 center = u_source_resolution * 0.5;
	vec2 delta = vec2(content_uv.x, 1.0 - content_uv.y) * u_source_resolution - center;
	float radius_squared = dot(delta, delta) / dot(center, center);
	vec2 xy = center + delta * (1.0 + u_params0.x * radius_squared) - 0.5;
	vec2 base = floor(xy), f = xy - base;
	vec4 color = lens_distortion_sample(base) * ((1.0 - f.x) * (1.0 - f.y))
		+ lens_distortion_sample(base + vec2(1.0, 0.0)) * (f.x * (1.0 - f.y))
		+ lens_distortion_sample(base + vec2(0.0, 1.0)) * ((1.0 - f.x) * f.y)
		+ lens_distortion_sample(base + vec2(1.0, 1.0)) * (f.x * f.y);
	float alpha = floor(color.a * 255.0 + 0.5) / 255.0;
	return alpha == 0.0 ? vec4(0.0) : vec4(floor(color.rgb / color.a * 255.0 + 0.5) / 255.0, alpha);
}
`;
