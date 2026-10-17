/* SPDX-License-Identifier: AGPL-3.0-only */
import { PIXEL_FRAME_WEBGL2_REPAIR_FUNCTIONS_CURRENT_V1 } from './pixel-frame-webgl2-repair-glsl-current-v1.ts';
const HEADER = `#version 300 es
precision highp float;precision highp int;precision highp usampler2D;
`;
const NEIGHBORS = `const ivec2 STEP[4]=ivec2[4](ivec2(-1,0),ivec2(1,0),ivec2(0,-1),ivec2(0,1));
bool inside(ivec2 at){return all(greaterThanEqual(at,ivec2(0)))&&all(lessThan(at,uHaloExtent));}
`;
export const PIXEL_FRAME_WEBGL2_HEAL_DONOR_CURRENT_V1 = HEADER+`
uniform highp sampler2D uOriginal;uniform ivec2 uExtent;uniform ivec2 uHaloOrigin;
uniform vec2 uTarget;uniform vec2 uDelta;uniform float uRadius;uniform float uFeather;
out vec4 outputColor;
`+PIXEL_FRAME_WEBGL2_REPAIR_FUNCTIONS_CURRENT_V1+`
void main(){outputColor=repairDonor(vec2(ivec2(gl_FragCoord.xy)+uHaloOrigin)+vec2(.5));}`;
export const PIXEL_FRAME_WEBGL2_HEAL_MEMBER_CURRENT_V1 = HEADER+`
uniform highp sampler2D uOriginal;uniform highp sampler2D uDonor;uniform ivec2 uHaloOrigin;
uniform vec2 uTarget;uniform float uRadius;layout(location=0)out uvec4 outputColor;
void main(){ivec2 cell=ivec2(gl_FragCoord.xy),at=cell+uHaloOrigin;
	bool member=texelFetch(uOriginal,at,0).a!=0.0&&texelFetch(uDonor,cell,0).a>0.0&&length(vec2(at)+vec2(.5)-uTarget)<=uRadius;
	outputColor=uvec4(member?1u:0u,0u,0u,0u);}`;
export const PIXEL_FRAME_WEBGL2_HEAL_BOUNDARY_CURRENT_V1 = HEADER+`
uniform highp sampler2D uOriginal;uniform highp sampler2D uDonor;uniform highp usampler2D uMember;
uniform ivec2 uHaloOrigin;uniform ivec2 uHaloExtent;uniform int uBoundaryMode;out vec4 outputColor;
`+NEIGHBORS+`
void main(){ivec2 cell=ivec2(gl_FragCoord.xy);vec3 sum=vec3(0.0);float weightSum=0.0;
	bool member=texelFetch(uMember,cell,0).r!=0u;
	if(member)for(int k=0;k<4;k++){ivec2 q=cell+STEP[k];if(!inside(q)||texelFetch(uMember,q,0).r!=0u)continue;
		vec4 boundary=texelFetch(uOriginal,q+uHaloOrigin,0),donor=texelFetch(uDonor,q,0);float weight=boundary.a*donor.a;
		if(weight==0.0)continue;weightSum+=weight;sum+=(uBoundaryMode==0?boundary.rgb:donor.rgb)*weight;
	}outputColor=vec4(sum,uBoundaryMode==0?weightSum:(member?1.0:0.0));}`;
export const PIXEL_FRAME_WEBGL2_HEAL_REDUCE_CURRENT_V1 = HEADER+`
uniform highp sampler2D uReduction;uniform ivec2 uReductionExtent;out vec4 outputColor;
void main(){ivec2 base=2*ivec2(gl_FragCoord.xy);vec4 sum=vec4(0.0);
	for(int dy=0;dy<2;dy++)for(int dx=0;dx<2;dx++){ivec2 at=base+ivec2(dx,dy);if(all(lessThan(at,uReductionExtent)))sum+=texelFetch(uReduction,at,0);}
	outputColor=sum;}`;
export const PIXEL_FRAME_WEBGL2_HEAL_DELTA_CURRENT_V1 = HEADER+`
uniform highp sampler2D uBoundaryTarget;uniform highp sampler2D uBoundaryDonor;out vec4 outputColor;
void main(){vec4 target=texelFetch(uBoundaryTarget,ivec2(0),0),donor=texelFetch(uBoundaryDonor,ivec2(0),0);
	if(donor.a==0.0){outputColor=vec4(0.0);return;}
	if(!(target.a>0.0)||isinf(target.a)||isnan(target.a)){outputColor=vec4(0.0,0.0,0.0,-1.0);return;}
	outputColor=vec4((target.rgb-donor.rgb)/target.a,1.0);}`;
export const PIXEL_FRAME_WEBGL2_HEAL_INITIAL_CURRENT_V1 = HEADER+`
uniform highp sampler2D uDonor;uniform highp usampler2D uMember;uniform highp sampler2D uDeltaImage;out vec4 outputColor;
void main(){ivec2 cell=ivec2(gl_FragCoord.xy);outputColor=texelFetch(uMember,cell,0).r==0u?vec4(0.0):vec4(texelFetch(uDonor,cell,0).rgb+texelFetch(uDeltaImage,ivec2(0),0).rgb,0.0);}`;
export const PIXEL_FRAME_WEBGL2_HEAL_RHS_CURRENT_V1 = HEADER+`
uniform highp sampler2D uOriginal;uniform highp sampler2D uDonor;uniform highp usampler2D uMember;uniform highp sampler2D uDeltaImage;
uniform ivec2 uHaloOrigin;uniform ivec2 uHaloExtent;out vec4 outputColor;
`+NEIGHBORS+`
void main(){ivec2 cell=ivec2(gl_FragCoord.xy);if(texelFetch(uMember,cell,0).r==0u){outputColor=vec4(0.0);return;}
	vec3 donor=texelFetch(uDonor,cell,0).rgb;vec4 center=texelFetch(uOriginal,cell+uHaloOrigin,0);
	vec3 rhs=donor+texelFetch(uDeltaImage,ivec2(0),0).rgb+4.0*donor;
	for(int k=0;k<4;k++){ivec2 q=cell+STEP[k];bool valid=inside(q);
		vec4 neighbor=valid?texelFetch(uDonor,q,0):vec4(0.0);rhs-=valid&&neighbor.a>0.0?neighbor.rgb:donor;
		if(valid&&texelFetch(uMember,q,0).r!=0u)continue;vec4 boundary=valid?texelFetch(uOriginal,q+uHaloOrigin,0):center;
		rhs+=boundary.a>0.0?boundary.rgb:center.rgb;
	}outputColor=vec4(rhs,0.0);}`;
export const PIXEL_FRAME_WEBGL2_HEAL_JACOBI_CURRENT_V1 = HEADER+`
uniform highp usampler2D uMember;uniform highp sampler2D uRhs;uniform highp sampler2D uPrevious;
uniform ivec2 uHaloExtent;out vec4 outputColor;
`+NEIGHBORS+`
void main(){ivec2 cell=ivec2(gl_FragCoord.xy);if(texelFetch(uMember,cell,0).r==0u){outputColor=vec4(0.0);return;}
	vec3 value=texelFetch(uRhs,cell,0).rgb;for(int k=0;k<4;k++){ivec2 q=cell+STEP[k];if(inside(q)&&texelFetch(uMember,q,0).r!=0u)value+=texelFetch(uPrevious,q,0).rgb;}
	outputColor=vec4(value/5.0,0.0);}`;
