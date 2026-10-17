/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact byte-neighborhood code27. The source texture is straight RGBA;
 * texelFetch ignores the legacy LINEAR sampler. Replication is explicit.
 * All accumulators stay below2.1million; the signed gain stays below131000. */
export const DETAIL_SHARPEN_GLSL_V1 = `
vec4 detail_sharpen_render(vec2 content_uv) {
	ivec2 size = ivec2(u_source_resolution);
	ivec2 origin = ivec2(floor(u_source_rect.xy * vec2(textureSize(u_texture,0)) + 0.5));
	ivec2 center = clamp(ivec2(floor(content_uv * vec2(size))),ivec2(0),size-ivec2(1));
	ivec4 color = ivec4(floor(texelFetch(u_texture,origin+center,0)*255.0+0.5));
	if (color.a == 0) return vec4(color)/255.0;
	int weight = 0; ivec3 sum = ivec3(0);
	for (int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
		ivec2 neighbor = clamp(center+ivec2(x,y),ivec2(0),size-ivec2(1));
		ivec4 sample_byte = ivec4(floor(texelFetch(u_texture,origin+neighbor,0)*255.0+0.5));
		int w = sample_byte.a*(x==0?2:1)*(y==0?2:1);
		weight += w; sum += sample_byte.rgb*w;
	}
	ivec3 blur = (2*sum+ivec3(weight))/(2*weight), delta = color.rgb-blur;
	ivec3 numerator = delta*int(u_params0.x)+ivec3(128);
	// GLSL signed division truncates; convert negative numerators to floor.
	ivec3 gain;
	for(int c=0;c<3;c++) gain[c] = numerator[c]>=0 ? numerator[c]/256 : -((-numerator[c]+255)/256);
	for(int c=0;c<3;c++) if(abs(delta[c])>int(u_params0.y)) color[c] = clamp(color[c]+gain[c],0,255);
	return vec4(color)/255.0;
}`;
