/* SPDX-License-Identifier: AGPL-3.0-only */

/** Separate natural-extent geometry program. Integer permutations bypass
 * rounded normalized coordinates; all other geometry uses four explicit
 * premultiplied-linear taps. The host owns plans, textures and CPU validation. */
export const PIXEL_FRAME_WEBGL2_GEOMETRY_FRAGMENT_CURRENT_V1 = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uImage;
uniform vec3 uOutputToAperture[2];
uniform vec3 uApertureToSource[3];
uniform ivec4 uCropBounds;
uniform int uIntegerPermutation;
uniform ivec3 uIntegerToSource[2];
layout(location = 0) out vec4 outColor;

void main() {
	if (uIntegerPermutation == 1) {
		ivec2 index = ivec2(gl_FragCoord.xy);
		ivec2 source = ivec2(uIntegerToSource[0].x * index.x + uIntegerToSource[0].y * index.y + uIntegerToSource[0].z,
			uIntegerToSource[1].x * index.x + uIntegerToSource[1].y * index.y + uIntegerToSource[1].z);
		vec4 color = texelFetch(uImage, source, 0);
		if (color.a == 0.0) { outColor = vec4(0.0); return; }
		outColor = vec4(color.r == 0.0 ? 0.0 : color.r, color.g == 0.0 ? 0.0 : color.g,
			color.b == 0.0 ? 0.0 : color.b, color.a);
		return;
	}
	vec3 coordinate = vec3(gl_FragCoord.xy, 1.0);
	vec2 aperture = vec2(uOutputToAperture[0].x * coordinate.x + uOutputToAperture[0].y * coordinate.y + uOutputToAperture[0].z,
		uOutputToAperture[1].x * coordinate.x + uOutputToAperture[1].y * coordinate.y + uOutputToAperture[1].z);
	if (any(isnan(aperture)) || any(isinf(aperture)) || any(lessThan(aperture, vec2(-1e-12)))
		|| any(greaterThan(aperture, vec2(1.0 + 1e-12)))) { outColor = vec4(0.0); return; }
	aperture = clamp(aperture, vec2(0.0), vec2(1.0));
	float denominator = uApertureToSource[2].x * aperture.x + uApertureToSource[2].y * aperture.y + uApertureToSource[2].z;
	vec2 position = vec2(uApertureToSource[0].x * aperture.x + uApertureToSource[0].y * aperture.y + uApertureToSource[0].z,
		uApertureToSource[1].x * aperture.x + uApertureToSource[1].y * aperture.y + uApertureToSource[1].z) / denominator - vec2(0.5);
	if (any(isnan(position)) || any(isinf(position))) { outColor = vec4(0.0); return; }
	ivec2 low = ivec2(floor(position));
	vec2 amount = position - vec2(low);
	float alpha = 0.0;
	vec3 rgb = vec3(0.0);
	for (int dy = 0; dy < 2; dy++) for (int dx = 0; dx < 2; dx++) {
		ivec2 source = clamp(low + ivec2(dx, dy), uCropBounds.xy, uCropBounds.zw);
		vec4 color = texelFetch(uImage, source, 0);
		float weight = (dx == 1 ? amount.x : 1.0 - amount.x) * (dy == 1 ? amount.y : 1.0 - amount.y);
		float weightedAlpha = color.a * weight;
		alpha += weightedAlpha;
		rgb += color.rgb * weightedAlpha;
	}
	float outputAlpha = clamp(alpha, 0.0, 1.0);
	if (outputAlpha == 0.0) { outColor = vec4(0.0); return; }
	outColor = vec4(rgb / alpha, outputAlpha);
}
`;
