/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact dense7×7 local luma contrast. Positive blur numerator<=533729280;
 * signed-Q8 adjustment<16.6M. All intermediates fit highp signed32 integers. */
export const CLARITY_GLSL_V1 = `
int clarity_bin(int n) { return n==0||n==6?1:n==1||n==5?6:n==2||n==4?15:20; }
int clarity_luma(ivec3 rgb) { return (54*rgb.r+183*rgb.g+19*rgb.b+128)/256; }
vec4 clarity_render(vec2 content_uv) {
	ivec2 size=ivec2(u_source_resolution);
	ivec2 origin=ivec2(floor(u_source_rect.xy*vec2(textureSize(u_texture,0))+0.5));
	ivec2 center=clamp(ivec2(floor(content_uv*vec2(size))),ivec2(0),size-ivec2(1));
	ivec4 color=ivec4(floor(texelFetch(u_texture,origin+center,0)*255.0+0.5));
	if(color.a==0)return vec4(color)/255.0;
	int weight=0,sum=0;
	for(int y=0;y<7;y++)for(int x=0;x<7;x++){
		ivec2 neighbor=clamp(center+ivec2(x-3,y-3),ivec2(0),size-ivec2(1));
		ivec4 sample_byte=ivec4(floor(texelFetch(u_texture,origin+neighbor,0)*255.0+0.5));
		int w=sample_byte.a*clarity_bin(x)*clarity_bin(y);weight+=w;sum+=w*clarity_luma(sample_byte.rgb);
	}
	int luma=clarity_luma(color.rgb),blur=(2*sum+weight)/(2*weight),mid=2*min(luma,255-luma);
	int numerator=(luma-blur)*int(u_params0.x)*mid+32512;
	int adjustment=numerator>=0?numerator/65024:-((-numerator+65023)/65024);
	color.rgb=clamp(color.rgb+ivec3(adjustment),ivec3(0),ivec3(255));return vec4(color)/255.0;
}`;
