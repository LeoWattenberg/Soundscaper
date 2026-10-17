/* SPDX-License-Identifier: AGPL-3.0-only */

/** Both original-alpha means round before the band/gate. Every numerator is
 * below33358081; signed adjustment is below16744449. No floating blur plane
 * or texture interpolation enters the explicit straight-byte process. */
export const TEXTURE_GLSL_V1=`
int texture_effect_floor(int n,int d){return n>=0?n/d:-((-n+d-1)/d);}
int texture_effect_luma(ivec3 c){return (54*c.r+183*c.g+19*c.b+128)/256;}
vec4 texture_effect_render(vec2 content_uv){
	ivec2 size=ivec2(u_source_resolution),center=clamp(ivec2(floor(content_uv*vec2(size))),ivec2(0),size-ivec2(1));
	ivec2 origin=ivec2(floor(u_source_rect.xy*vec2(textureSize(u_texture,0))+0.5));
	ivec4 color=ivec4(floor(texelFetch(u_texture,origin+center,0)*255.0+0.5));if(color.a==0)return vec4(color)/255.0;
	int bins[5]=int[5](1,4,6,4,1),weight3=0,sum3=0,weight5=0,sum5=0;
	for(int row=0;row<5;row++)for(int column=0;column<5;column++){
		ivec2 p=clamp(center+ivec2(column-2,row-2),ivec2(0),size-ivec2(1));
		ivec4 sample_color=ivec4(floor(texelFetch(u_texture,origin+p,0)*255.0+0.5));int luma=texture_effect_luma(sample_color.rgb);
		int w5=sample_color.a*bins[row]*bins[column];weight5+=w5;sum5+=w5*luma;
		if(row>0&&row<4&&column>0&&column<4){int w3=sample_color.a*(row==2?2:1)*(column==2?2:1);weight3+=w3;sum3+=w3*luma;}
	}
	int fine=(2*sum3+weight3)/(2*weight3),coarse=(2*sum5+weight5)/(2*weight5);
	int gate=max(0,256-4*abs(texture_effect_luma(color.rgb)-coarse));
	int delta=texture_effect_floor((fine-coarse)*int(u_params0.x)*gate+32768,65536);
	for(int c=0;c<3;c++)color[c]=clamp(color[c]+delta,0,255);return vec4(color)/255.0;
}`;
