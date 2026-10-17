/* SPDX-License-Identifier: AGPL-3.0-only */

const HEADER = `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D uCoverage;
uniform ivec2 uExtent;
uniform int uRadius;
layout(location=0) out highp uvec4 outCoverage;
`;
/** R8UI -> R32UI. Store raw integer sums, NEVER byte/F32 horizontal means. */
export const PIXEL_FRAME_WEBGL2_MASK_FEATHER_HORIZONTAL_CURRENT_V1 = HEADER + `
void main() {
	ivec2 p=ivec2(gl_FragCoord.xy);
	uint sum=0u;
	for(int step=-64;step<=64;step++) if(step>=-uRadius && step<=uRadius) {
		ivec2 source=ivec2(clamp(p.x+step,0,uExtent.x-1),p.y);
		sum+=texelFetch(uCoverage,source,0).r;
	}
	outCoverage=uvec4(sum,0u,0u,0u);
}`;
/** R32UI -> R8UI. Maximum S=255*129²=4243455. Odd denominator has no half ties. */
export const PIXEL_FRAME_WEBGL2_MASK_FEATHER_VERTICAL_CURRENT_V1 = HEADER + `
void main() {
	ivec2 p=ivec2(gl_FragCoord.xy);
	uint sum=0u;
	for(int step=-64;step<=64;step++) if(step>=-uRadius && step<=uRadius) {
		ivec2 source=ivec2(p.x,clamp(p.y+step,0,uExtent.y-1));
		sum+=texelFetch(uCoverage,source,0).r;
	}
	uint side=uint(2*uRadius+1),divisor=side*side;
	outCoverage=uvec4((sum+divisor/2u)/divisor,0u,0u,0u);
}`;
