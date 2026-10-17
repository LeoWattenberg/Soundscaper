/* SPDX-License-Identifier: AGPL-3.0-only */

/** True highp integer arithmetic. Every center numerator is <=33619456;
 * squared-radius blend <=33554560, signed byte mix <=16809984. The
 * owning shader declares highp int. No large product passes through float. */
export const POST_CROP_VIGNETTE_GLSL_V1 = `
int post_crop_floor(int numerator,int denominator) {
	return numerator>=0 ? numerator/denominator : -((-numerator+denominator-1)/denominator);
}
int post_crop_coordinate(int position,int size,int denominator) {
	return post_crop_floor(2*(2*position+1-size)*256+denominator,2*denominator);
}
vec4 post_crop_vignette_render(vec2 content_uv) {
	ivec2 size=ivec2(u_source_resolution);
	ivec2 origin=ivec2(floor(u_source_rect.xy*vec2(textureSize(u_texture,0))+0.5));
	ivec2 center=clamp(ivec2(floor(content_uv*vec2(size))),ivec2(0),size-ivec2(1));
	ivec4 color=ivec4(floor(texelFetch(u_texture,origin+center,0)*255.0+0.5));
	if(color.a==0) return vec4(color)/255.0;
	int rx=post_crop_coordinate(center.x,size.x,size.x),ry=post_crop_coordinate(center.y,size.y,size.y);
	int ellipse=rx*rx+ry*ry,square=max(rx*rx,ry*ry),side=min(size.x,size.y);
	int cx=clamp(post_crop_coordinate(center.x,size.x,side),-512,512);
	int cy=clamp(post_crop_coordinate(center.y,size.y,side),-512,512);
	int circle=min(131072,cx*cx+cy*cy),roundness=int(u_params0.w),r=abs(roundness);
	int distance=(ellipse*(256-r)+(roundness<0?square:circle)*r+128)/256;
	int t=clamp(post_crop_floor((distance-int(u_params0.y))*256,max(1,int(u_params0.z))),0,256);
	int weight=(t*t*(768-2*t)+32768)/65536,amount=int(u_params0.x);
	int maximum=max(color.r,max(color.g,color.b));
	int protection=amount<0 ? (maximum*int(u_params1.x)+127)/255 : 0;
	int coverage=(weight*(256-protection)+128)/256,target=amount<0?0:255;
	for(int c=0;c<3;c++)color[c]=clamp(color[c]+post_crop_floor((target-color[c])*abs(amount)*coverage+32768,65536),0,255);
	return vec4(color)/255.0;
}`;
