/* SPDX-License-Identifier: AGPL-3.0-only */

/** Selected graph coverage is a BYTE image, not native scene alpha. Every
 * suffix draw stores one rounded byte before the following warp samples it.
 * The CPU tagged receipt is mandatory; Float32 coordinate errors can refuse
 * an otherwise completed draw, with no tolerance or readback patching. */
export const PIXEL_FRAME_WEBGL2_MASK_OVERLAY_FRAGMENT_CURRENT_V1 = `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D uCoverage;
uniform int uOverlayKind;
uniform ivec2 uSourceExtent;
uniform vec3 uOutputToAperture[2];
uniform vec3 uApertureToSource[3];
uniform ivec4 uCropBounds;
uniform int uIntegerPermutation;
uniform ivec3 uIntegerToSource[2];
uniform float uLensCoefficient;
layout(location = 0) out uvec4 outCoverage;

bool outsideOverlayCurrentV1(ivec2 point) {
	return any(lessThan(point, ivec2(0))) || any(greaterThanEqual(point, uSourceExtent));
}
uint byteOverlayCurrentV1(float alpha) { return uint(floor(clamp(alpha, 0.0, 255.0) + 0.5)); }
uint geometryOverlayCurrentV1(ivec2 index) {
	if (uIntegerPermutation == 1) {
		ivec2 source = ivec2(uIntegerToSource[0].x * index.x + uIntegerToSource[0].y * index.y + uIntegerToSource[0].z,
			uIntegerToSource[1].x * index.x + uIntegerToSource[1].y * index.y + uIntegerToSource[1].z);
		return texelFetch(uCoverage, source, 0).r;
	}
	vec2 position = vec2(index) + vec2(0.5);
	vec2 aperture = vec2(uOutputToAperture[0].x * position.x + uOutputToAperture[0].y * position.y + uOutputToAperture[0].z,
		uOutputToAperture[1].x * position.x + uOutputToAperture[1].y * position.y + uOutputToAperture[1].z);
	if (any(isnan(aperture)) || any(isinf(aperture)) || any(lessThan(aperture, vec2(-1e-12)))
		|| any(greaterThan(aperture, vec2(1.0 + 1e-12)))) return 0u;
	aperture = clamp(aperture, vec2(0.0), vec2(1.0));
	float denominator = uApertureToSource[2].x * aperture.x + uApertureToSource[2].y * aperture.y + uApertureToSource[2].z;
	position = vec2(uApertureToSource[0].x * aperture.x + uApertureToSource[0].y * aperture.y + uApertureToSource[0].z,
		uApertureToSource[1].x * aperture.x + uApertureToSource[1].y * aperture.y + uApertureToSource[1].z) / denominator - vec2(0.5);
	if (any(isnan(position)) || any(isinf(position))) return 0u;
	ivec2 low = ivec2(floor(position)); vec2 fraction = position - vec2(low); float alpha = 0.0;
	for (int dy = 0; dy < 2; dy++) for (int dx = 0; dx < 2; dx++) {
		ivec2 source = clamp(low + ivec2(dx, dy), uCropBounds.xy, uCropBounds.zw);
		float weight = (dx == 1 ? fraction.x : 1.0 - fraction.x) * (dy == 1 ? fraction.y : 1.0 - fraction.y);
		alpha += float(texelFetch(uCoverage, source, 0).r) * weight;
	}
	return byteOverlayCurrentV1(alpha);
}
uint lensOverlayCurrentV1(ivec2 index) {
	vec2 halfExtent = vec2(uSourceExtent) / 2.0, delta = vec2(index) + vec2(0.5) - halfExtent;
	float radiusSquared = (delta.x * delta.x + delta.y * delta.y) / (halfExtent.x * halfExtent.x + halfExtent.y * halfExtent.y);
	vec2 shift = delta * (uLensCoefficient * radiusSquared), magnitude = abs(shift);
	ivec2 whole = ivec2(floor(magnitude)), direction = ivec2(shift.x < 0.0 ? -1 : 1, shift.y < 0.0 ? -1 : 1);
	vec2 fraction = magnitude - vec2(whole); ivec2 low = index + direction * whole; float alpha = 0.0;
	for (int dy = 0; dy < 2; dy++) for (int dx = 0; dx < 2; dx++) {
		ivec2 source = low + direction * ivec2(dx, dy); if (outsideOverlayCurrentV1(source)) continue;
		float weight = (dx == 1 ? fraction.x : 1.0 - fraction.x) * (dy == 1 ? fraction.y : 1.0 - fraction.y);
		alpha += float(texelFetch(uCoverage, source, 0).r) * weight;
	}
	return byteOverlayCurrentV1(alpha);
}
void main() {
	ivec2 index = ivec2(gl_FragCoord.xy);
	uint alpha = uOverlayKind == 1 ? geometryOverlayCurrentV1(index) : lensOverlayCurrentV1(index);
	outCoverage = uvec4(alpha, 0u, 0u, 1u);
}
`;
