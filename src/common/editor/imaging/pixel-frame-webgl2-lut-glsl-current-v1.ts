/* SPDX-License-Identifier: AGPL-3.0-only */

import { buildPixelFrameWebGl2ColorFragmentCurrentV1 } from './pixel-frame-webgl2-color-glsl-current-v1.ts';

/** The native owner authenticates and uploads a red-fastest lattice with
 * NEAREST storage. A pass uses its declared size, even when the reusable 3D
 * backing is larger. Only input-domain coordinates clamp; results stay signed
 * and retain headroom. Difference lerps preserve the native B→G→R ordering. */
export const PIXEL_FRAME_WEBGL2_LUT_FUNCTIONS_CURRENT_V1 = `
vec3 cubeLerpCurrentV1(vec3 a, vec3 b, float amount) {
	return a + (b - a) * amount;
}

vec3 cubeColorCurrentV1(vec3 rgb) {
	int size = int(uParams0.w);
	vec3 position = clamp((rgb - uParams0.xyz) / (uParams1.xyz - uParams0.xyz), vec3(0.0), vec3(1.0)) * float(size - 1);
	ivec3 low = ivec3(floor(position)), high = min(low + ivec3(1), ivec3(size - 1));
	vec3 amount = position - vec3(low);
	vec3 c000 = texelFetch(uCube, ivec3(low.x, low.y, low.z), 0).rgb;
	vec3 c001 = texelFetch(uCube, ivec3(low.x, low.y, high.z), 0).rgb;
	vec3 c010 = texelFetch(uCube, ivec3(low.x, high.y, low.z), 0).rgb;
	vec3 c011 = texelFetch(uCube, ivec3(low.x, high.y, high.z), 0).rgb;
	vec3 c100 = texelFetch(uCube, ivec3(high.x, low.y, low.z), 0).rgb;
	vec3 c101 = texelFetch(uCube, ivec3(high.x, low.y, high.z), 0).rgb;
	vec3 c110 = texelFetch(uCube, ivec3(high.x, high.y, low.z), 0).rgb;
	vec3 c111 = texelFetch(uCube, ivec3(high.x, high.y, high.z), 0).rgb;
	vec3 z00 = cubeLerpCurrentV1(c000, c001, amount.z);
	vec3 z01 = cubeLerpCurrentV1(c010, c011, amount.z);
	vec3 z10 = cubeLerpCurrentV1(c100, c101, amount.z);
	vec3 z11 = cubeLerpCurrentV1(c110, c111, amount.z);
	return cubeLerpCurrentV1(cubeLerpCurrentV1(z00, z01, amount.y), cubeLerpCurrentV1(z10, z11, amount.y), amount.x);
}
`;

/** Adds only the dedicated sampler and kind8 branch to the existing fragment.
 * Source/cube ownership, capacity and numerical conformance stay with its host. */
export const PIXEL_FRAME_WEBGL2_LUT_FRAGMENT_CURRENT_V1 = buildPixelFrameWebGl2ColorFragmentCurrentV1(
	'precision highp sampler3D;\nuniform sampler3D uCube;', PIXEL_FRAME_WEBGL2_LUT_FUNCTIONS_CURRENT_V1, 'if (uKind == 8) rgb = cubeColorCurrentV1(rgb);');
