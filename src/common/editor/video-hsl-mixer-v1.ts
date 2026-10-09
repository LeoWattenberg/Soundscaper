/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';

/** Straight UNORM8 encoded sRGB HSL. Original hue selects/interpolates eight
 * control bands; saturation, lightness, then hue apply in that order. Signed
 * nearest rounding ties toward +infinity. Enabled zero controls and gray are
 * exact byte identities; alpha never participates in the color calculation. */
export const HSL_MIXER_PROCESS_V1 = 'srgb-hsl-hue-q16-v1';
export const HSL_MIXER_EFFECT_TYPE_V1 = 'hsl-mixer-v1';
export const HSL_MIXER_EFFECT_CODE_V1 = 23;
const COLORS = ['red','orange','yellow','green','aqua','blue','purple','magenta'] as const;
const SUFFIXES = ['Hue','Saturation','Luminance'] as const;
const CENTERS = [0,128,256,512,768,1024,1152,1280,1536] as const;
const KEYS = SUFFIXES.flatMap(suffix => COLORS.map(color => `${color}${suffix}` as Key));
const Q = 65536;
type Key = `${typeof COLORS[number]}${typeof SUFFIXES[number]}`;
type Tuple = readonly [number,number,number,number];
const parameter = (color:string,suffix:string) => Object.freeze({label:`${color} ${suffix==='Luminance'?'lightness':suffix.toLowerCase()}`,
	labelKey:`videoEffectParamHsl${color}${suffix}`,default:0,min:suffix==='Hue'?-180:-100,max:suffix==='Hue'?180:100,step:1,integer:false,control:'number'});
export const HSL_MIXER_VIDEO_EFFECT_DEFINITION_V1 = Object.freeze({
	type:HSL_MIXER_EFFECT_TYPE_V1,label:'HSL mixer',labelKey:'videoEffectHslMixer',shader:HSL_MIXER_EFFECT_TYPE_V1,ffmpegFilter:HSL_MIXER_PROCESS_V1,
	params:Object.freeze(Object.fromEntries(SUFFIXES.flatMap(suffix => COLORS.map(color =>
		[`${color}${suffix}`,parameter(color[0]!.toUpperCase()+color.slice(1),suffix)])))),
});

export function normalizeHslMixerParamsV1(value:unknown):Readonly<Record<Key,number>> {
	const input=record(value===undefined?{}:value,'HSL parameters',KEYS,[]),output={} as Record<Key,number>;
	for(const key of KEYS){
		const value=Object.hasOwn(input,key)?field(input,key,'HSL parameters'):0,limit=key.endsWith('Hue')?180:100;
		if(typeof value!=='number'||!Number.isFinite(value)||value < -limit||value > limit)throw new RangeError(`HSL ${key} requires -${String(limit)} through ${String(limit)}.`);
		output[key]=Object.is(value,-0)?0:value;
	}
	return Object.freeze(output);
}
export function normalizeHslMixerEffectV1(value:unknown) {
	const input=record(value,'HSL effect',['id','type','enabled','params']);
	const id=field(input,'id','HSL effect'),type=field(input,'type','HSL effect'),enabled=field(input,'enabled','HSL effect');
	if(typeof id!=='string'||!id.length||id.length>128)throw new TypeError('HSL effect requires a bounded ID.');
	if(type!==HSL_MIXER_EFFECT_TYPE_V1)throw new RangeError('Unsupported HSL process.');
	if(typeof enabled!=='boolean')throw new TypeError('HSL enabled must be boolean.');
	const raw=field(input,'params','HSL effect');if(raw===undefined)throw new TypeError('HSL effect requires parameters.');
	return Object.freeze({id,type,enabled,params:normalizeHslMixerParamsV1(raw)});
}
export interface PreparedHslMixerEffectV1 {
	readonly type:typeof HSL_MIXER_EFFECT_TYPE_V1;readonly enabled:boolean;readonly neutral:boolean;
	readonly params0:Tuple;readonly params1:Tuple;readonly params2:Tuple;readonly params3:Tuple;readonly params4:Tuple;readonly params5:Tuple;
}
export function prepareHslMixerEffectV1(value:unknown):Readonly<PreparedHslMixerEffectV1> {
	const {type,enabled,params}=normalizeHslMixerEffectV1(value);
	const tuple=(suffix:typeof SUFFIXES[number],start:number):Tuple=>Object.freeze(COLORS.slice(start,start+4)
		.map(color=>Math.round(params[`${color}${suffix}`]/(suffix==='Hue'?60:100)*Q)) as [number,number,number,number]);
	return Object.freeze({type,enabled,neutral:KEYS.every(key=>params[key]===0),params0:tuple('Hue',0),params1:tuple('Hue',4),
		params2:tuple('Saturation',0),params3:tuple('Saturation',4),params4:tuple('Luminance',0),params5:tuple('Luminance',4)});
}
function nearest(n:number,d:number):number{return Math.floor((n+d/2)/d);}
function clamp(n:number,low:number,high:number):number{return Math.max(low,Math.min(high,n));}
function interpolate(a:Tuple,b:Tuple,left:number,distance:number,width:number):number {
	const right=(left+1)%8,first=left<4?a[left]!:b[left-4]!,last=right<4?a[right]!:b[right-4]!;
	return first+nearest((last-first)*distance,width);
}
/** Admitted scalar loop retains no per-pixel arrays, callbacks or frame copies. */
export function applyHslMixerPixelV1(p:PreparedHslMixerEffectV1,pixels:Uint8Array,offset:number):void {
	if(!p.enabled||p.neutral)return;
	const r=pixels[offset]!,g=pixels[offset+1]!,b=pixels[offset+2]!,max=Math.max(r,g,b),min=Math.min(r,g,b),c=max-min;
	if(c===0)return;
	let n=max===r?g-b:max===g?b-r+2*c:r-g+4*c;if(n<0)n+=6*c;
	const h=Math.floor((n*512+c)/(2*c));let left=0;while(left<7&&h>=CENTERS[left+1]!)left++;
	const distance=h-CENTERS[left]!,width=CENTERS[left+1]!-CENTERS[left]!;
	const hue=interpolate(p.params0,p.params1,left,distance,width),sat=interpolate(p.params2,p.params3,left,distance,width),lum=interpolate(p.params4,p.params5,left,distance,width);
	const l=max+min,d=255-Math.abs(l-255),saturated=clamp(nearest(c*(Q+sat),Q),0,d);
	const nextL=l+nearest((lum>=0?510-l:l)*lum,Q),nextD=255-Math.abs(nextL-255),nextC=clamp(nearest(saturated*nextD,d),0,nextD),base=nextL-nextC;
	if(hue===0){
		pixels[offset]=clamp(nearest(base*c+2*nextC*(r-min),2*c),0,255);
		pixels[offset+1]=clamp(nearest(base*c+2*nextC*(g-min),2*c),0,255);
		pixels[offset+2]=clamp(nearest(base*c+2*nextC*(b-min),2*c),0,255);return;
	}
	const phase=((nearest(n*Q,c)+hue)%(6*Q)+6*Q)%(6*Q),sector=Math.floor(phase/Q),x=nextC*(Q-Math.abs(phase%(2*Q)-Q)),top=nextC*Q;
	const rn=sector===0||sector===5?top:sector===1||sector===4?x:0;
	const gn=sector===1||sector===2?top:sector===0||sector===3?x:0;
	const bn=sector===3||sector===4?top:sector===2||sector===5?x:0;
	pixels[offset]=clamp(nearest(base*Q+2*rn,2*Q),0,255);
	pixels[offset+1]=clamp(nearest(base*Q+2*gn,2*Q),0,255);
	pixels[offset+2]=clamp(nearest(base*Q+2*bn,2*Q),0,255);
}
export function hslMixerPreviewPassV1(value:unknown) {
	const p=prepareHslMixerEffectV1(value);if(!p.enabled||p.neutral)return null;
	return Object.freeze({code:HSL_MIXER_EFFECT_CODE_V1,params0:p.params0,params1:p.params1,params2:p.params2,params3:p.params3,
		params4:p.params4,params5:p.params5,direction:Object.freeze([0,0])});
}

/** GEQ has ten registers: all stores below are 0..9 and initialized per channel
 * and pixel. Its double evaluator exactly retains these bounded integers. */
export function serializeHslMixerEffectToFfmpegV1(value:unknown):Readonly<{expression:string;preserveAlpha:true}>|null {
	const p=prepareHslMixerEffectV1(value);if(!p.enabled||p.neutral)return null;
	const band=(a:Tuple,b:Tuple)=>{
		const values=[...a,...b];let result='';
		for(let i=7;i>=0;i--){const first=values[i]!,last=values[(i+1)%8]!,width=CENTERS[i+1]!-CENTERS[i]!;
			const term=`${String(first)}+floor((${String(last-first)}*(ld(6)-${String(CENTERS[i])})+${String(width/2)})/${String(width)})`;
			result=i===7?term:`if(lt(ld(6),${String(CENTERS[i+1])}),${term},${result})`;
		}return result;
	};
	const prefix='st(0,r(X,Y));st(1,g(X,Y));st(2,b(X,Y));st(4,min(min(ld(0),ld(1)),ld(2)));st(3,max(max(ld(0),ld(1)),ld(2))-ld(4));';
	const l='(ld(3)+2*ld(4))',d=`(255-abs(${l}-255))`;
	const body=`st(5,if(eq(ld(0),ld(3)+ld(4)),ld(1)-ld(2),if(eq(ld(1),ld(3)+ld(4)),ld(2)-ld(0)+2*ld(3),ld(0)-ld(1)+4*ld(3))));st(5,if(lt(ld(5),0),ld(5)+6*ld(3),ld(5)));st(6,floor((ld(5)*512+ld(3))/(2*ld(3))));`
		+`st(7,${band(p.params2,p.params3)});st(8,${band(p.params4,p.params5)});st(6,${band(p.params0,p.params1)});`
		+`st(9,clip(floor((ld(3)*(65536+ld(7))+32768)/65536),0,${d}));st(7,${l}+floor((if(gte(ld(8),0),510-${l},${l})*ld(8)+32768)/65536));st(8,255-abs(ld(7)-255));st(9,clip(floor((ld(9)*ld(8)+${d}/2)/${d}),0,ld(8)));st(7,ld(7)-ld(9));`
		+'st(5,mod(mod(floor((ld(5)*65536+ld(3)/2)/ld(3))+ld(6),393216)+393216,393216));st(8,ld(9)*(65536-abs(mod(ld(5),131072)-65536)));';
	const top='ld(9)*65536',x='ld(8)',phase='ld(5)';
	const channels=[`if(lt(${phase},65536),${top},if(lt(${phase},131072),${x},if(lt(${phase},262144),0,if(lt(${phase},327680),${x},${top}))))`,
		`if(lt(${phase},65536),${x},if(lt(${phase},196608),${top},if(lt(${phase},262144),${x},0)))`,
		`if(lt(${phase},131072),0,if(lt(${phase},196608),${x},if(lt(${phase},327680),${top},${x})))`];
	const expressions=['r','g','b'].map((name,i)=>`${name}='${prefix}if(eq(ld(3),0),ld(${String(i)}),${body}clip(if(eq(ld(6),0),floor((ld(7)*ld(3)+2*ld(9)*(ld(${String(i)})-ld(4))+ld(3))/(2*ld(3))),floor((ld(7)*65536+2*(${channels[i]!})+65536)/131072)),0,255))'`);
	return Object.freeze({expression:`format=pix_fmts=gbrap,geq=${expressions.join(':')}:a='alpha(X,Y)':interpolation=nearest,format=pix_fmts=rgba`,preserveAlpha:true});
}

/** Coefficients fit exact Float32 uniforms. All highp signed-int intermediates
 * stay below 101 million, including negative interpolation and hue wrapping. */
export const HSL_MIXER_GLSL_V1=`
int hsl_floor_div(int n,int d){return n>=0?n/d:-((-n+d-1)/d);}
int hsl_nearest(int n,int d){return hsl_floor_div(n+d/2,d);}
int hsl_control(vec4 a,vec4 b,int i){return i<4?int(a[i]):int(b[i-4]);}
int hsl_mix(vec4 a,vec4 b,int left,int distance,int width){
	int first=hsl_control(a,b,left),last=hsl_control(a,b,(left+1)%8);
	return first+hsl_nearest((last-first)*distance,width);
}
vec3 hsl_mixer_rgb(vec3 rgb,vec4 p0,vec4 p1,vec4 p2,vec4 p3,vec4 p4,vec4 p5){
	ivec3 v=ivec3(floor(clamp(rgb,0.0,1.0)*255.0+0.5));
	int m=max(max(v.r,v.g),v.b),low=min(min(v.r,v.g),v.b),c=m-low;if(c==0)return rgb;
	int n=m==v.r?v.g-v.b:m==v.g?v.b-v.r+2*c:v.r-v.g+4*c;if(n<0)n+=6*c;
	int h=(n*512+c)/(2*c),centers[9]=int[9](0,128,256,512,768,1024,1152,1280,1536),left=0;
	for(int i=0;i<7;i++){if(h>=centers[i+1])left=i+1;}
	int distance=h-centers[left],width=centers[left+1]-centers[left];
	int hue=hsl_mix(p0,p1,left,distance,width),sat=hsl_mix(p2,p3,left,distance,width),lum=hsl_mix(p4,p5,left,distance,width);
	int l=m+low,d=255-abs(l-255),saturated=clamp(hsl_nearest(c*(65536+sat),65536),0,d);
	int nextL=l+hsl_nearest((lum>=0?510-l:l)*lum,65536),nextD=255-abs(nextL-255);
	int nextC=clamp(hsl_nearest(saturated*nextD,d),0,nextD),base=nextL-nextC;
	if(hue==0)return vec3(clamp(ivec3(hsl_nearest(base*c+2*nextC*(v.r-low),2*c),hsl_nearest(base*c+2*nextC*(v.g-low),2*c),hsl_nearest(base*c+2*nextC*(v.b-low),2*c)),ivec3(0),ivec3(255)))/255.0;
	int phase=(hsl_nearest(n*65536,c)+hue+393216)%393216;
	int sector=phase/65536,x=nextC*(65536-abs(phase%131072-65536)),top=nextC*65536;
	int rn=sector==0||sector==5?top:sector==1||sector==4?x:0;
	int gn=sector==1||sector==2?top:sector==0||sector==3?x:0;
	int bn=sector==3||sector==4?top:sector==2||sector==5?x:0;
	return vec3(clamp(ivec3(hsl_nearest(base*65536+2*rn,131072),hsl_nearest(base*65536+2*gn,131072),hsl_nearest(base*65536+2*bn,131072)),ivec3(0),ivec3(255)))/255.0;
}`;
