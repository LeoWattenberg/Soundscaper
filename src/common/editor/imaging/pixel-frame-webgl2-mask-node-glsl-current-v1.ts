/* SPDX-License-Identifier: AGPL-3.0-only */

/** No CPU-generated coverage input. uImage is the bound stage's genuine
 * incoming RGBA32F image; uBrush is authenticated installed alpha, not RGBA. */
export const PIXEL_FRAME_WEBGL2_MASK_NODE_FRAGMENT_CURRENT_V1 = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uImage;
uniform highp usampler2D uCoverage0;
uniform highp usampler2D uCoverage1;
uniform highp usampler2D uBrush;
uniform ivec2 uExtent;
uniform ivec2 uBrushExtent;
uniform int uNodeKind;
uniform vec4 uParams0;
uniform vec4 uParams1;
layout(location=0) out highp uvec4 outCoverage;
uint byteRound(float value) {
	return uint(floor(clamp(value,0.0,1.0)*255.0+0.5));
}
uint falloffByte(float distance,float falloff) {
	return falloff==0.0 ? 0u : byteRound(1.0-distance/falloff);
}
void main() {
	ivec2 p=ivec2(gl_FragCoord.xy);
	vec2 center=(vec2(p)+vec2(0.5))/vec2(uExtent);
	uint value=0u;
	if(uNodeKind==1) {
		value=center.x>=uParams0.x && center.y>=uParams0.y && center.x<uParams0.z && center.y<uParams0.w ? 255u:0u;
	} else if(uNodeKind==2) {
		vec2 delta=(center-uParams0.xy)/uParams0.zw;
		value=delta.x*delta.x+delta.y*delta.y<=1.0 ? 255u:0u;
	} else if(uNodeKind==3) {
		float projection=((center.x-uParams0.x)*uParams0.z+(center.y-uParams0.y)*uParams0.w)/uParams1.x;
		value=byteRound(projection);
	} else if(uNodeKind==4) {
		vec2 delta=(center-uParams0.xy)/uParams0.zw;
		value=byteRound((1.0-length(delta))/uParams1.x);
	} else if(uNodeKind==5) {
		vec4 sampleValue=texelFetch(uImage,p,0);
		if(sampleValue.a!=0.0) {
			float luminance=sampleValue.r*0.2126+sampleValue.g*0.7152+sampleValue.b*0.0722;
			value=luminance>=uParams0.x && luminance<=uParams0.y ? 255u
				: falloffByte(luminance<uParams0.x ? uParams0.x-luminance:luminance-uParams0.y,uParams0.z);
		}
	} else if(uNodeKind==6) {
		vec4 sampleValue=texelFetch(uImage,p,0);
		if(sampleValue.a!=0.0) {
			float distance=length(sampleValue.rgb-uParams0.rgb)/sqrt(3.0);
			value=distance<=uParams0.w ? 255u:falloffByte(distance-uParams0.w,uParams1.x);
		}
	} else if(uNodeKind==7) {
		// Use uint division, never float center-nearest resampling. This also
		// retains exact products across the broader 65536-side byte bound.
		uvec2 source=(uvec2(p)*uvec2(uBrushExtent))/uvec2(uExtent);
		value=texelFetch(uBrush,ivec2(min(source,uvec2(uBrushExtent)-uvec2(1u))),0).r;
	} else {
		uint a=texelFetch(uCoverage0,p,0).r;
		if(uNodeKind==8) value=255u-a;
		else if(uNodeKind==13) value=a;
		else {
			uint b=texelFetch(uCoverage1,p,0).r;
			if(uNodeKind==9) value=max(a,b);
			else if(uNodeKind==10) value=min(a,b);
			else if(uNodeKind==11) value=min(a,255u-b);
			else if(uNodeKind==12) value=max(a,b)-min(a,b);
		}
	}
	outCoverage=uvec4(value,0u,0u,0u);
}`;
