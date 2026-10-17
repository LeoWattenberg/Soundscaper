/* SPDX-License-Identifier: AGPL-3.0-only */

/** Unsigned highp centers and polynomial hash never wrap: numerator<=
 * 4294934528u, linear sum<=42398709u, polynomial<=4294901537u. All products
 * stay unsigned until each noise sample is bounded to [-128,128]; subsequent
 * signed interpolation and color offset remain <=8454144. */
export const GRAIN_GLSL_V1=`
int grain_floor(int n,int d){return n>=0?n/d:-((-n+d-1)/d);}
highp uint grain_hash(highp uint h){return (h*h+31u*h+17u)%65521u;}
int grain_lattice(highp uint x,highp uint y,highp uint seed){
	highp uint h=grain_hash((x*73u+y*151u+seed*199u+101u)%65521u);
	int first=int(h%257u);h=grain_hash(h);return grain_floor(first+int(h%257u)-255,2);
}
int grain_octave(highp uvec2 center,highp uint size,highp uint seed){
	highp uvec2 q=((2u*center+uvec2(1u))*32768u)/size;
	highp uvec2 cell=q/256u;ivec2 f=ivec2(q%256u);
	int sum=grain_lattice(cell.x,cell.y,seed)*(256-f.x)*(256-f.y)
		+grain_lattice(cell.x+1u,cell.y,seed)*f.x*(256-f.y)
		+grain_lattice(cell.x,cell.y+1u,seed)*(256-f.x)*f.y
		+grain_lattice(cell.x+1u,cell.y+1u,seed)*f.x*f.y;
	return grain_floor(sum+32768,65536);
}
vec4 grain_render(vec2 content_uv){
	ivec2 size=ivec2(u_source_resolution),center=clamp(ivec2(floor(content_uv*vec2(size))),ivec2(0),size-ivec2(1));
	ivec2 origin=ivec2(floor(u_source_rect.xy*vec2(textureSize(u_texture,0))+0.5));
	ivec4 color=ivec4(floor(texelFetch(u_texture,origin+center,0)*255.0+0.5));if(color.a==0)return vec4(color)/255.0;
	highp uint spacing=uint(u_params0.y),seed=uint(u_params0.w);int roughness=int(u_params0.z);
	int noise=grain_floor(grain_octave(uvec2(center),spacing,seed)*(256-roughness)+grain_octave(uvec2(center),spacing/2u,seed)*roughness+128,256);
	int luma=(54*color.r+183*color.g+19*color.b+128)/256,response=2*min(luma,255-luma);
	int delta=grain_floor(noise*int(u_params0.x)*response+131072,262144);
	for(int c=0;c<3;c++)color[c]=clamp(color[c]+delta,0,255);return vec4(color)/255.0;
}`;
