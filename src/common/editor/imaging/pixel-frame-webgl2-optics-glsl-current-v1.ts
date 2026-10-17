/* SPDX-License-Identifier: AGPL-3.0-only */

/** Native RGBA32F optics only. Private CPU plans, complete phase admission and
 * whole-plane numerical validation belong to the host. No byte/video shader
 * or encoded intermediate is a native working-frame authority. */
export const PIXEL_FRAME_WEBGL2_OPTICS_FRAGMENT_CURRENT_V1 = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uImage;
uniform int uOpticsKind;
uniform ivec2 uExtent;
uniform vec4 uParams0;
uniform vec4 uParams1;
layout(location = 0) out vec4 outColor;

bool opticsOutsideCurrentV1(ivec2 point) {
	return any(lessThan(point, ivec2(0))) || any(greaterThanEqual(point, uExtent));
}

vec4 opticsLensCurrentV1(ivec2 index) {
	vec2 halfExtent = vec2(uExtent) / 2.0, delta = vec2(index) + vec2(0.5) - halfExtent;
	float radiusSquared = (delta.x * delta.x + delta.y * delta.y) / (halfExtent.x * halfExtent.x + halfExtent.y * halfExtent.y);
	vec2 shift = delta * (uParams0.x * radiusSquared), magnitude = abs(shift);
	ivec2 whole = ivec2(floor(magnitude)), direction = ivec2(shift.x < 0.0 ? -1 : 1, shift.y < 0.0 ? -1 : 1);
	vec2 fraction = magnitude - vec2(whole); ivec2 low = index + direction * whole;
	vec3 rgb = vec3(0.0); float alpha = 0.0;
	for (int dy = 0; dy < 2; dy++) for (int dx = 0; dx < 2; dx++) {
		ivec2 source = low + direction * ivec2(dx, dy); if (opticsOutsideCurrentV1(source)) continue;
		vec4 color = texelFetch(uImage, source, 0);
		float weight = (dx == 1 ? fraction.x : 1.0 - fraction.x) * (dy == 1 ? fraction.y : 1.0 - fraction.y);
		float weightedAlpha = color.a * weight; alpha += weightedAlpha; rgb += color.rgb * weightedAlpha;
	}
	float outputAlpha = clamp(alpha, 0.0, 1.0);
	return outputAlpha == 0.0 ? vec4(0.0) : vec4(rgb / alpha, outputAlpha);
}

float opticsCaChannelCurrentV1(ivec2 index, int channel, float coefficient) {
	vec2 halfExtent = vec2(uExtent) / 2.0, delta = vec2(index) + vec2(0.5) - halfExtent;
	float radiusSquared = (delta.x * delta.x + delta.y * delta.y) / (halfExtent.x * halfExtent.x + halfExtent.y * halfExtent.y);
	vec2 shift = delta * (coefficient * radiusSquared), magnitude = abs(shift);
	ivec2 whole = ivec2(floor(magnitude)), direction = ivec2(shift.x < 0.0 ? -1 : 1, shift.y < 0.0 ? -1 : 1);
	vec2 fraction = magnitude - vec2(whole); ivec2 low = index + direction * whole;
	float value = 0.0, alpha = 0.0;
	for (int dy = 0; dy < 2; dy++) for (int dx = 0; dx < 2; dx++) {
		ivec2 source = low + direction * ivec2(dx, dy); if (opticsOutsideCurrentV1(source)) continue;
		vec4 color = texelFetch(uImage, source, 0);
		float weight = (dx == 1 ? fraction.x : 1.0 - fraction.x) * (dy == 1 ? fraction.y : 1.0 - fraction.y);
		float weightedAlpha = color.a * weight; alpha += weightedAlpha; value += color[channel] * weightedAlpha;
	}
	return alpha == 0.0 ? 0.0 : value / alpha;
}

float opticsEncodedCurrentV1(float value) {
	float magnitude = abs(value);
	return sign(value) * (magnitude <= 0.0031308 ? magnitude * 12.92 : 1.055 * pow(magnitude, 1.0 / 2.4) - 0.055);
}

float opticsLinearCurrentV1(float value) {
	float magnitude = abs(value);
	return sign(value) * (magnitude <= 0.04045 ? magnitude / 12.92 : pow((magnitude + 0.055) / 1.055, 2.4));
}

vec3 opticsEncodedRgbCurrentV1(vec3 rgb) {
	return vec3(opticsEncodedCurrentV1(rgb.r), opticsEncodedCurrentV1(rgb.g), opticsEncodedCurrentV1(rgb.b));
}

float opticsLumaCurrentV1(vec3 rgb) { return (54.0 * rgb.r + 183.0 * rgb.g + 19.0 * rgb.b) / 256.0; }
float opticsPurpleCurrentV1(vec3 rgb) { return max(0.0, min(rgb.r, rgb.b) - rgb.g); }
float opticsGreenCurrentV1(vec3 rgb) { return max(0.0, rgb.g - max(rgb.r, rgb.b)); }

vec4 opticsDefringeCurrentV1(ivec2 index, vec4 center) {
	if (center.a == 0.0) return center;
	vec3 encoded = opticsEncodedRgbCurrentV1(center.rgb);
	float centerY = opticsLumaCurrentV1(encoded), centerPurple = opticsPurpleCurrentV1(encoded), centerGreen = opticsGreenCurrentV1(encoded);
	float minimum = centerY, maximum = centerY, alphaSum = 0.0, purpleDifference = 0.0, greenDifference = 0.0;
	for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
		if (dx == 0 && dy == 0) continue;
		ivec2 source = clamp(index + ivec2(dx, dy), ivec2(0), uExtent - ivec2(1));
		vec4 neighbor = texelFetch(uImage, source, 0); if (neighbor.a <= 0.0) continue;
		vec3 encodedNeighbor = opticsEncodedRgbCurrentV1(neighbor.rgb); float neighborY = opticsLumaCurrentV1(encodedNeighbor);
		minimum = min(minimum, neighborY); maximum = max(maximum, neighborY); alphaSum += neighbor.a;
		purpleDifference += neighbor.a * (centerPurple - opticsPurpleCurrentV1(encodedNeighbor));
		greenDifference += neighbor.a * (centerGreen - opticsGreenCurrentV1(encodedNeighbor));
	}
	if (alphaSum == 0.0) return center;
	float edgeGate = clamp(4.0 * ((maximum - minimum) - uParams0.z), 0.0, 1.0);
	float weight = clamp(edgeGate * (uParams0.x * clamp(4.0 * purpleDifference / alphaSum, 0.0, 1.0)
		+ uParams0.y * clamp(4.0 * greenDifference / alphaSum, 0.0, 1.0)), 0.0, 1.0);
	if (weight == 0.0) return center;
	vec3 next = encoded + weight * (vec3(centerY) - encoded);
	return vec4(next.r == encoded.r ? center.r : opticsLinearCurrentV1(next.r),
		next.g == encoded.g ? center.g : opticsLinearCurrentV1(next.g),
		next.b == encoded.b ? center.b : opticsLinearCurrentV1(next.b), center.a);
}

vec4 opticsVignetteCurrentV1(ivec2 index, vec4 center) {
	if (center.a == 0.0) return center;
	vec2 delta = vec2(2 * index + ivec2(1) - uExtent), extent = vec2(uExtent);
	float radiusSquared = (delta.x * delta.x + delta.y * delta.y) / (extent.x * extent.x + extent.y * extent.y);
	float gain = exp2(uParams0.x * radiusSquared); if (gain == 1.0) return center;
	return vec4(center.r == 0.0 ? center.r : center.r * gain, center.g == 0.0 ? center.g : center.g * gain,
		center.b == 0.0 ? center.b : center.b * gain, center.a);
}

void main() {
	ivec2 index = ivec2(gl_FragCoord.xy); vec4 center = texelFetch(uImage, index, 0);
	if (uParams1.w == 0.0 || (uParams1.x == 0.0 && uParams1.y == 0.0)) { outColor = center; return; }
	if (uOpticsKind == 10) outColor = opticsLensCurrentV1(index);
	else if (uOpticsKind == 11) {
		float red = uParams1.x != 0.0 ? opticsCaChannelCurrentV1(index, 0, uParams0.x) : center.r;
		float blue = uParams1.y != 0.0 ? opticsCaChannelCurrentV1(index, 2, uParams0.y) : center.b;
		outColor = vec4(red, center.g, blue, center.a);
	} else if (uOpticsKind == 12) outColor = opticsDefringeCurrentV1(index, center);
	else if (uOpticsKind == 13) outColor = opticsVignetteCurrentV1(index, center);
	else outColor = center;
}
`;
