/* SPDX-License-Identifier: AGPL-3.0-only */
export const PIXEL_FRAME_WEBGL2_REPAIR_FUNCTIONS_CURRENT_V1 = `
float repairCoverage(vec2 center){
	float distance=length(center-uTarget);if(distance>uRadius)return 0.0;
	if(uFeather==0.0)return 1.0;float core=(1.0-uFeather)*uRadius;
	if(distance<=core)return 1.0;return max(0.0,(uRadius-distance)/(uRadius-core));
}
vec4 repairDonor(vec2 center){
	vec2 position=center+uDelta-vec2(.5);ivec2 left=ivec2(floor(position));vec2 fraction=position-vec2(left);
	float alpha=0.0;vec3 rgb=vec3(0.0);
	for(int dy=0;dy<2;dy++)for(int dx=0;dx<2;dx++){
		ivec2 at=left+ivec2(dx,dy);if(any(lessThan(at,ivec2(0)))||any(greaterThanEqual(at,uExtent)))continue;
		vec4 donorSample=texelFetch(uOriginal,at,0);float weight=(dx==0?1.0-fraction.x:fraction.x)*(dy==0?1.0-fraction.y:fraction.y)*donorSample.a;
		if(weight==0.0)continue;alpha+=weight;rgb+=donorSample.rgb*weight;
	}return vec4(alpha==0.0?vec3(0.0):rgb/alpha,alpha);
}
vec4 repairBlend(vec4 before,vec4 donorSample,float amount){
	if(before.a==0.0||donorSample.a==0.0||amount==0.0)return before;
	float weight=clamp(amount*donorSample.a,0.0,1.0);if(weight==0.0)return before;
	if(weight==1.0)return vec4(donorSample.rgb,before.a);
	return vec4((1.0-weight)*before.rgb+weight*donorSample.rgb,before.a);
}
`;
export const PIXEL_FRAME_WEBGL2_REPAIR_CLONE_CURRENT_V1 = `#version 300 es
precision highp float;precision highp int;
uniform highp sampler2D uOriginal;uniform highp sampler2D uCurrent;
uniform ivec2 uExtent;uniform vec2 uTarget;uniform vec2 uDelta;
uniform float uRadius;uniform float uFeather;uniform float uOpacity;
out vec4 outputColor;
${PIXEL_FRAME_WEBGL2_REPAIR_FUNCTIONS_CURRENT_V1}
void main(){ivec2 at=ivec2(gl_FragCoord.xy);vec4 before=texelFetch(uCurrent,at,0);
	float amount=uOpacity*repairCoverage(vec2(at)+vec2(.5));
	if(before.a==0.0||amount==0.0){outputColor=before;return;}
	outputColor=repairBlend(before,repairDonor(vec2(at)+vec2(.5)),amount);
}`;
export const PIXEL_FRAME_WEBGL2_REPAIR_HEAL_BLEND_CURRENT_V1 = `#version 300 es
precision highp float;precision highp int;precision highp usampler2D;
uniform highp sampler2D uCurrent;uniform highp sampler2D uDonor;uniform highp sampler2D uSolution;
uniform highp usampler2D uMember;uniform ivec2 uHaloOrigin;uniform ivec2 uHaloExtent;
uniform vec2 uTarget;uniform float uRadius;uniform float uFeather;uniform float uOpacity;
out vec4 outputColor;
float coverage(vec2 center){float d=length(center-uTarget);if(d>uRadius)return 0.0;if(uFeather==0.0)return 1.0;
	float core=(1.0-uFeather)*uRadius;return d<=core?1.0:max(0.0,(uRadius-d)/(uRadius-core));}
void main(){ivec2 at=ivec2(gl_FragCoord.xy),cell=at-uHaloOrigin;vec4 before=texelFetch(uCurrent,at,0);
	if(before.a==0.0||any(lessThan(cell,ivec2(0)))||any(greaterThanEqual(cell,uHaloExtent))){outputColor=before;return;}
	if(texelFetch(uMember,cell,0).r==0u){outputColor=before;return;}
	float alpha=texelFetch(uDonor,cell,0).a,amount=uOpacity*coverage(vec2(at)+vec2(.5));
	if(alpha==0.0||amount==0.0){outputColor=before;return;}float weight=clamp(amount*alpha,0.0,1.0);
	if(weight==0.0){outputColor=before;return;}vec3 solution=texelFetch(uSolution,cell,0).rgb;
	outputColor=vec4(weight==1.0?solution:(1.0-weight)*before.rgb+weight*solution,before.a);
}`;
