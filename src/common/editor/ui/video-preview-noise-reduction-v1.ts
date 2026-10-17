/* SPDX-License-Identifier: AGPL-3.0-only */

/** Integer byte neighborhoods; texelFetch and explicit replication do not use
 * filtered UV sampling. Every signed accumulator/numerator stays below 559M. */
export const NOISE_REDUCTION_GLSL_V1 = `
int noise_floor_div(int n,int d) { return n>=0 ? n/d : -((-n+d-1)/d); }
ivec3 noise_lifting(ivec3 rgb) {
	int co=rgb.r-rgb.b, t=rgb.b+noise_floor_div(co,2), cg=rgb.g-t;
	return ivec3(t+noise_floor_div(cg,2),co,cg);
}
vec4 noise_reduction_render(vec2 content_uv) {
	ivec2 size=ivec2(u_source_resolution);
	ivec2 origin=ivec2(floor(u_source_rect.xy*vec2(textureSize(u_texture,0))+0.5));
	ivec2 center=clamp(ivec2(floor(content_uv*vec2(size))),ivec2(0),size-ivec2(1));
	ivec4 color=ivec4(floor(texelFetch(u_texture,origin+center,0)*255.0+0.5));
	if(color.a==0) return vec4(color)/255.0;
	ivec3 original=noise_lifting(color.rgb), reduced=original;
	if(int(u_params0.x)!=0) {
		int sum=0,weight=0,minimum=original.x,maximum=original.x;
		for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
			ivec2 neighbor=clamp(center+ivec2(x,y),ivec2(0),size-ivec2(1));
			ivec4 sample_byte=ivec4(floor(texelFetch(u_texture,origin+neighbor,0)*255.0+0.5));
			if(sample_byte.a==0) continue;
			int ny=noise_lifting(sample_byte.rgb).x;
			minimum=min(minimum,ny); maximum=max(maximum,ny);
			int range_weight=max(0,16-abs(ny-original.x)*int(u_params0.y)/256);
			int w=sample_byte.a*(x==0?2:1)*(y==0?2:1)*range_weight;
			weight+=w; sum+=w*ny;
		}
		int mean=(2*sum+weight)/(2*weight);
		int protection=(int(u_params0.z)*(maximum-minimum)+127)/255;
		int strength=(int(u_params0.x)*(256-protection)+128)/256;
		reduced.x=original.x+noise_floor_div((mean-original.x)*strength+128,256);
	}
	if(int(u_params0.w)!=0) {
		int weights[5]=int[5](1,4,6,4,1);
		int sum_co=0,sum_cg=0,weight=0;
		for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++) {
			int inner=(abs(x)<=1 && abs(y)<=1)?(x==0?2:1)*(y==0?2:1):0;
			int spatial=(inner*16*(256-int(u_params1.y))+weights[x+2]*weights[y+2]*int(u_params1.y)+128)/256;
			if(spatial==0) continue;
			ivec2 neighbor=clamp(center+ivec2(x,y),ivec2(0),size-ivec2(1));
			ivec4 sample_byte=ivec4(floor(texelFetch(u_texture,origin+neighbor,0)*255.0+0.5));
			if(sample_byte.a==0) continue;
			ivec3 components=noise_lifting(sample_byte.rgb);
			int distance=max(abs(components.y-original.y),abs(components.z-original.z));
			int w=spatial*sample_byte.a*max(0,16-distance*int(u_params1.x)/256);
			weight+=w; sum_co+=w*components.y; sum_cg+=w*components.z;
		}
		int mean_co=noise_floor_div(2*sum_co+weight,2*weight), mean_cg=noise_floor_div(2*sum_cg+weight,2*weight);
		reduced.y=original.y+noise_floor_div((mean_co-original.y)*int(u_params0.w)+128,256);
		reduced.z=original.z+noise_floor_div((mean_cg-original.z)*int(u_params0.w)+128,256);
	}
	int t=reduced.x-noise_floor_div(reduced.z,2), blue=t-noise_floor_div(reduced.y,2);
	color.rgb=clamp(ivec3(reduced.y+blue,reduced.z+t,blue),ivec3(0),ivec3(255));
	return vec4(color)/255.0;
}`;
