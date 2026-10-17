/* SPDX-License-Identifier: AGPL-3.0-only */

/** Every positive transmission and signed reconstruction intermediate fits
 * highp signed32. The signed floor helper matches CPU/GEQ instead of GLSL's
 * negative integer truncation. Alpha is read unchanged from original texels. */
export const DEHAZE_GLSL_V1 = `
int dehaze_floor(int numerator,int denominator) {
	return numerator>=0?numerator/denominator:-((-numerator+denominator-1)/denominator);
}
vec4 dehaze_render(vec2 content_uv) {
	ivec2 size=ivec2(u_source_resolution);
	ivec2 origin=ivec2(floor(u_source_rect.xy*vec2(textureSize(u_texture,0))+0.5));
	ivec2 center=clamp(ivec2(floor(content_uv*vec2(size))),ivec2(0),size-ivec2(1));
	ivec4 color=ivec4(floor(texelFetch(u_texture,origin+center,0)*255.0+0.5));
	if(color.a==0)return vec4(color)/255.0;
	int gain=int(u_params0.x);
	if(gain<=0){
		int fog=(-gain*128+128)/256;
		color.rgb+=((ivec3(255)-color.rgb)*fog+ivec3(128))/256;
		return vec4(color)/255.0;
	}
	int dark=255;
	for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
		ivec2 neighbor=clamp(center+ivec2(x,y),ivec2(0),size-ivec2(1));
		ivec4 sample_byte=ivec4(floor(texelFetch(u_texture,origin+neighbor,0)*255.0+0.5));
		int effective=(min(min(sample_byte.r,sample_byte.g),sample_byte.b)*sample_byte.a+255*(255-sample_byte.a)+127)/255;
		dark=min(dark,effective);
	}
	int transmission=max(26,256-(dark*gain*243)/65280);
	for(int channel=0;channel<3;channel++){
		int numerator=2*(color[channel]-255)*256+transmission;
		color[channel]=clamp(255+dehaze_floor(numerator,2*transmission),0,255);
	}
	return vec4(color)/255.0;
}`;
