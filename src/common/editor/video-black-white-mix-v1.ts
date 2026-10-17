/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';

/** Straight UNORM8 sRGB. Enabled zero controls deliberately produces Rec709 gray;
 * disabled retains all bytes. Hue controls adjust gray by chroma, so grays remain
 * invariant. Q16 interpolation/adjustment use nearest rounding toward +infinity. */
export const BLACK_WHITE_MIX_PROCESS_V1 = 'srgb-bw-hue-q16-v1';
export const BLACK_WHITE_MIX_EFFECT_TYPE_V1 = 'black-white-mix-v1';
export const BLACK_WHITE_MIX_EFFECT_CODE_V1 = 22;
const KEYS = ['red','orange','yellow','green','aqua','blue','purple','magenta'] as const;
const CENTERS = [0,128,256,512,768,1024,1152,1280,1536] as const;
const Q = 65536;
type Key = typeof KEYS[number];
const parameter = (label:string,labelKey:string) => Object.freeze({label,labelKey,default:0,min:-100,max:100,step:1,integer:false,control:'number'});
export const BLACK_WHITE_MIX_VIDEO_EFFECT_DEFINITION_V1 = Object.freeze({
	type:BLACK_WHITE_MIX_EFFECT_TYPE_V1,label:'Black-and-white mix',labelKey:'videoEffectBlackWhiteMix',
	shader:BLACK_WHITE_MIX_EFFECT_TYPE_V1,ffmpegFilter:BLACK_WHITE_MIX_PROCESS_V1,
	params:Object.freeze({red:parameter('Red','videoEffectParamMixRed'),orange:parameter('Orange','videoEffectParamMixOrange'),
		yellow:parameter('Yellow','videoEffectParamMixYellow'),green:parameter('Green','videoEffectParamMixGreen'),
		aqua:parameter('Aqua','videoEffectParamMixAqua'),blue:parameter('Blue','videoEffectParamMixBlue'),
		purple:parameter('Purple','videoEffectParamMixPurple'),magenta:parameter('Magenta','videoEffectParamMixMagenta')}),
});

export function normalizeBlackWhiteMixParamsV1(value:unknown):Readonly<Record<Key,number>> {
	const input=record(value===undefined?{}:value,'black-and-white parameters',KEYS,[]);
	const read=(key:Key)=>{
		const value=Object.hasOwn(input,key)?field(input,key,'black-and-white parameters'):0;
		if(typeof value!=='number'||!Number.isFinite(value)||value<-100||value>100)throw new RangeError(`Black-and-white ${key} requires -100 through 100.`);
		return Object.is(value,-0)?0:value;
	};
	return Object.freeze({red:read('red'),orange:read('orange'),yellow:read('yellow'),green:read('green'),
		aqua:read('aqua'),blue:read('blue'),purple:read('purple'),magenta:read('magenta')});
}

export function normalizeBlackWhiteMixEffectV1(value:unknown) {
	const input=record(value,'black-and-white effect',['id','type','enabled','params']);
	const id=field(input,'id','black-and-white effect'),type=field(input,'type','black-and-white effect'),enabled=field(input,'enabled','black-and-white effect');
	if(typeof id!=='string'||!id.length||id.length>128)throw new TypeError('Black-and-white effect requires a bounded ID.');
	if(type!==BLACK_WHITE_MIX_EFFECT_TYPE_V1)throw new RangeError('Unsupported black-and-white process.');
	if(typeof enabled!=='boolean')throw new TypeError('Black-and-white enabled must be boolean.');
	const raw=field(input,'params','black-and-white effect');if(raw===undefined)throw new TypeError('Black-and-white effect requires parameters.');
	return Object.freeze({id,type,enabled,params:normalizeBlackWhiteMixParamsV1(raw)});
}

export interface PreparedBlackWhiteMixEffectV1 {
	readonly type:typeof BLACK_WHITE_MIX_EFFECT_TYPE_V1;readonly enabled:boolean;readonly neutral:false;
	readonly params0:readonly [number,number,number,number];readonly params1:readonly [number,number,number,number];
}
export function prepareBlackWhiteMixEffectV1(value:unknown):Readonly<PreparedBlackWhiteMixEffectV1> {
	const {type,enabled,params}=normalizeBlackWhiteMixEffectV1(value),coefficient=(key:Key)=>Math.round(params[key]/100*Q);
	return Object.freeze({type,enabled,neutral:false,
		params0:Object.freeze([coefficient('red'),coefficient('orange'),coefficient('yellow'),coefficient('green')] as const),
		params1:Object.freeze([coefficient('aqua'),coefficient('blue'),coefficient('purple'),coefficient('magenta')] as const)});
}

/** The owning admitted loop retains no per-pixel tuple, body or frame. */
export function applyBlackWhiteMixPixelV1(prepared:PreparedBlackWhiteMixEffectV1,pixels:Uint8Array,offset:number):void {
	if(!prepared.enabled)return;
	const r=pixels[offset]!,g=pixels[offset+1]!,b=pixels[offset+2]!,max=Math.max(r,g,b),c=max-Math.min(r,g,b);
	let gray=Math.floor((54*r+183*g+19*b+128)/256);
	if(c!==0){
		let n=max===r?g-b:max===g?b-r+2*c:r-g+4*c;if(n<0)n+=6*c;
		const h=Math.floor((n*512+c)/(2*c))%1536;let left=0;
		while(left<7&&h>=CENTERS[left+1]!)left++;
		const width=CENTERS[left+1]!-CENTERS[left]!,distance=h-CENTERS[left]!;
		const right=(left+1)%8,a=left<4?prepared.params0[left]!:prepared.params1[left-4]!,z=right<4?prepared.params0[right]!:prepared.params1[right-4]!;
		const mix=a+Math.floor(((z-a)*distance+width/2)/width);
		gray=Math.max(0,Math.min(255,gray+Math.floor((c*mix+Q/2)/Q)));
	}
	pixels[offset]=gray;pixels[offset+1]=gray;pixels[offset+2]=gray;
}

export function blackWhiteMixPreviewPassV1(value:unknown) {
	const prepared=prepareBlackWhiteMixEffectV1(value);if(!prepared.enabled)return null;
	return Object.freeze({code:BLACK_WHITE_MIX_EFFECT_CODE_V1,params0:prepared.params0,params1:prepared.params1,direction:Object.freeze([0,0])});
}

/** Generated integer algebra only; GEQ's double evaluator exactly retains these
 * bounded integer intermediates. Stores are initialized independently per RGB
 * expression/pixel and never carry state across pixels or authored operations. */
export function serializeBlackWhiteMixEffectToFfmpegV1(value:unknown):Readonly<{expression:string;preserveAlpha:true}>|null {
	const p=prepareBlackWhiteMixEffectV1(value);if(!p.enabled)return null;
	const coefficients=[...p.params0,...p.params1];
	const prefix="st(0,r(X,Y));st(1,g(X,Y));st(2,b(X,Y));st(3,max(max(ld(0),ld(1)),ld(2)));st(4,ld(3)-min(min(ld(0),ld(1)),ld(2)));st(5,floor((54*ld(0)+183*ld(1)+19*ld(2)+128)/256));";
	const hue="st(6,if(eq(ld(3),ld(0)),ld(1)-ld(2),if(eq(ld(3),ld(1)),ld(2)-ld(0)+2*ld(4),ld(0)-ld(1)+4*ld(4))));st(6,if(lt(ld(6),0),ld(6)+6*ld(4),ld(6)));st(6,mod(floor((ld(6)*512+ld(4))/(2*ld(4))),1536));";
	let mix='';for(let i=7;i>=0;i--){const a=coefficients[i]!,z=coefficients[(i+1)%8]!,width=CENTERS[i+1]!-CENTERS[i]!;
		const expression=`${String(a)}+floor((${String(z-a)}*(ld(6)-${String(CENTERS[i])})+${String(width/2)})/${String(width)})`;
		mix=i===7?expression:`if(lt(ld(6),${String(CENTERS[i+1])}),${expression},${mix})`;
	}
	const gray=`${prefix}if(eq(ld(4),0),ld(5),${hue}clip(ld(5)+floor((ld(4)*(${mix})+32768)/65536),0,255))`;
	// The owning graph preserves the original alpha plane outside swscale's
	// RGBA/GBRAP conversion, which otherwise rounds alpha128..254 upward.
	return Object.freeze({expression:`format=pix_fmts=gbrap,geq=r='${gray}':g='${gray}':b='${gray}':a='alpha(X,Y)':interpolation=nearest,format=pix_fmts=rgba`,preserveAlpha:true});
}

/** Q16 uniforms are exactly representable. Highp signed-int intermediates stay
 * below 34 million; signed floor division agrees with CPU/GEQ at negative ties. */
export const BLACK_WHITE_MIX_GLSL_V1=`
int bw_floor_div(int n,int d){return n>=0?n/d:-((-n+d-1)/d);}
vec3 black_white_mix_rgb(vec3 rgb,vec4 p0,vec4 p1){
	ivec3 v=ivec3(floor(clamp(rgb,0.0,1.0)*255.0+0.5));
	int m=max(max(v.r,v.g),v.b),c=m-min(min(v.r,v.g),v.b);
	int y=(54*v.r+183*v.g+19*v.b+128)/256;
	if(c==0)return vec3(float(y)/255.0);
	int n=m==v.r?v.g-v.b:m==v.g?v.b-v.r+2*c:v.r-v.g+4*c;
	if(n<0)n+=6*c;
	int h=((n*512+c)/(2*c))%1536;
	int centers[9]=int[9](0,128,256,512,768,1024,1152,1280,1536);
	int controls[8]=int[8](int(p0.x),int(p0.y),int(p0.z),int(p0.w),int(p1.x),int(p1.y),int(p1.z),int(p1.w));
	int left=0;for(int i=0;i<7;i++){if(h>=centers[i+1])left=i+1;}
	int width=centers[left+1]-centers[left],distance=h-centers[left];
	int a=controls[left],z=controls[(left+1)%8];
	int mix=a+bw_floor_div((z-a)*distance+width/2,width);
	y=clamp(y+bw_floor_div(c*mix+32768,65536),0,255);
	return vec3(float(y)/255.0);
}`;
