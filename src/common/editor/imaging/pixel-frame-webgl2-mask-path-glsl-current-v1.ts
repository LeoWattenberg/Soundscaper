/* SPDX-License-Identifier: AGPL-3.0-only */

/** Each texel holds a.xy/b.xy in CPU path/point order. First and continuation
 * variants differ deliberately: initial does not declare uPrevious, so one
 * scratch texture is enough for <=256 edges without sampler/FBO feedback. */
function pathSum(initial: boolean): string {
	return `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uEdges;
${initial ? '' : 'uniform highp usampler2D uPrevious;'}
uniform ivec2 uExtent;
uniform int uEdgeCount;
layout(location=0) out highp uvec4 outWinding;
void main() {
	ivec2 p=ivec2(gl_FragCoord.xy);
	vec2 center=(vec2(p)+vec2(0.5))/vec2(uExtent);
	int winding=${initial ? '0' : 'int(texelFetch(uPrevious,p,0).r)-16384'};
	for(int index=0;index<256;index++) if(index<uEdgeCount) {
		vec4 edge=texelFetch(uEdges,ivec2(index,0),0);
		vec2 a=edge.xy,b=edge.zw;
		float crossValue=(b.x-a.x)*(center.y-a.y)-(center.x-a.x)*(b.y-a.y);
		if(a.y<=center.y && b.y>center.y && crossValue>0.0) winding++;
		else if(a.y>center.y && b.y<=center.y && crossValue<0.0) winding--;
	}
	outWinding=uvec4(uint(winding+16384),0u,0u,0u);
}`;
}
export const PIXEL_FRAME_WEBGL2_MASK_PATH_INITIAL_CURRENT_V1 = pathSum(true);
export const PIXEL_FRAME_WEBGL2_MASK_PATH_SUM_CURRENT_V1 = pathSum(false);
/** At most16384 edges: biased winding stays [0,32768], without uint overflow. */
export const PIXEL_FRAME_WEBGL2_MASK_PATH_RESOLVE_CURRENT_V1 = `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D uWinding;
uniform int uEvenOdd;
layout(location=0) out highp uvec4 outCoverage;
void main() {
	int winding=int(texelFetch(uWinding,ivec2(gl_FragCoord.xy),0).r)-16384;
	bool inside=uEvenOdd!=0 ? (abs(winding)%2)==1:winding!=0;
	outCoverage=uvec4(inside ? 255u:0u,0u,0u,0u);
}`;
