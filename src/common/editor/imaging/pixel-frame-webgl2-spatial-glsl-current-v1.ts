/* SPDX-License-Identifier: AGPL-3.0-only */

import { PIXEL_FRAME_WEBGL2_SPATIAL_NEIGHBORHOOD_FUNCTIONS_CURRENT_V1 } from './pixel-frame-webgl2-spatial-neighborhood-glsl-current-v1.ts';
import { PIXEL_FRAME_WEBGL2_SPATIAL_LATTICE_FUNCTIONS_CURRENT_V1 } from './pixel-frame-webgl2-spatial-lattice-glsl-current-v1.ts';

/** Immutable-input native RGBA32F spatial program. Exact inherited Q8 controls
 * and discrete lattice/coverage definitions surround continuous odd-sRGB math.
 * The host owns whole-plane numerical validation and joined GL retirement. */
export const PIXEL_FRAME_WEBGL2_SPATIAL_FRAGMENT_CURRENT_V1 = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uImage;
uniform int uSpatialKind;
uniform ivec2 uExtent;
uniform vec4 uParams0;
uniform vec4 uParams1;
layout(location = 0) out vec4 outColor;
${PIXEL_FRAME_WEBGL2_SPATIAL_NEIGHBORHOOD_FUNCTIONS_CURRENT_V1}
${PIXEL_FRAME_WEBGL2_SPATIAL_LATTICE_FUNCTIONS_CURRENT_V1}

vec3 spatialDetailCurrentV1(ivec2 index, vec3 encoded) {
	vec3 next = encoded;
	for (int channel = 0; channel < 3; channel++) {
		float original = encoded[channel], delta = original - spatialMeanCurrentV1(index, 1, channel);
		next[channel] = abs(delta) * 255.0 <= uParams0.y ? original : original + delta * uParams0.x / 256.0;
	}
	return next;
}

vec3 spatialClarityCurrentV1(ivec2 index, vec3 encoded) {
	float luma = spatialLumaCurrentV1(encoded), blur = spatialMeanCurrentV1(index, 3, -1);
	float gate = clamp(2.0 * min(luma, 1.0 - luma) * 255.0 / 254.0, 0.0, 1.0);
	float delta = (luma - blur) * uParams0.x / 256.0 * gate;
	return encoded + vec3(delta);
}

vec3 spatialTextureCurrentV1(ivec2 index, vec3 encoded) {
	float fine = spatialMeanCurrentV1(index, 1, -1), coarse = spatialMeanCurrentV1(index, 2, -1);
	float gate = clamp(1.0 - 4.0 * 255.0 * abs(spatialLumaCurrentV1(encoded) - coarse) / 256.0, 0.0, 1.0);
	float delta = (fine - coarse) * uParams0.x / 256.0 * gate;
	return encoded + vec3(delta);
}

vec3 spatialGrainCurrentV1(ivec2 index, vec3 encoded) {
	float luma = spatialLumaCurrentV1(encoded), response = clamp(2.0 * min(luma, 1.0 - luma), 0.0, 1.0);
	float delta = float(spatialGrainNoiseCurrentV1(index)) * uParams0.x / 256.0 * response / 1024.0;
	return encoded + vec3(delta);
}

vec3 spatialDehazeCurrentV1(ivec2 index, vec3 encoded) {
	if (uParams0.x < 0.0) return encoded + (vec3(1.0) - encoded) * uParams0.y / 256.0;
	float transmission = max(26.0 / 256.0, 1.0 - spatialDarkCurrentV1(index) * uParams0.x / 256.0 * 243.0 / 256.0);
	return vec3(1.0) + (encoded - vec3(1.0)) / transmission;
}

vec3 spatialVignetteCurrentV1(ivec2 index, vec3 encoded) {
	float weight = float(spatialVignetteWeightCurrentV1(index)) / 256.0;
	float protection = uParams0.x < 0.0 ? clamp(max(encoded.r, max(encoded.g, encoded.b)), 0.0, 1.0) * uParams1.x / 256.0 : 0.0;
	float amount = abs(uParams0.x) / 256.0 * weight * (1.0 - protection), destination = uParams0.x < 0.0 ? 0.0 : 1.0;
	return encoded + (vec3(destination) - encoded) * amount;
}

void main() {
	ivec2 index = ivec2(gl_FragCoord.xy); vec4 center = texelFetch(uImage, index, 0);
	// p1.w is enabled&&!quantizedNeutral, never inferred from rounded color.
	// Hidden RGB, alpha/-0 and disabled/neutral frames bypass all transfer math.
	if (uParams1.w == 0.0 || center.a == 0.0) { outColor = center; return; }
	vec3 encoded = spatialEncodedRgbCurrentV1(center.rgb), next = encoded;
	if (uSpatialKind == 14) next = spatialDetailCurrentV1(index, encoded);
	else if (uSpatialKind == 15) next = spatialVignetteCurrentV1(index, encoded);
	else if (uSpatialKind == 16) next = spatialClarityCurrentV1(index, encoded);
	else if (uSpatialKind == 17) next = spatialNoiseCurrentV1(index, encoded);
	else if (uSpatialKind == 18) next = spatialGrainCurrentV1(index, encoded);
	else if (uSpatialKind == 19) next = spatialTextureCurrentV1(index, encoded);
	else if (uSpatialKind == 20) next = spatialDehazeCurrentV1(index, encoded);
	// This is the CPU's encoded-result equality bypass, not a tolerance snap.
	// RGB stays signed/HDR. No clamp belongs at this native stage boundary.
	outColor = vec4(next.r == encoded.r ? center.r : spatialLinearCurrentV1(next.r),
		next.g == encoded.g ? center.g : spatialLinearCurrentV1(next.g),
		next.b == encoded.b ? center.b : spatialLinearCurrentV1(next.b), center.a);
}
`;
