/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';

/** A new encoded straight-sRGB byte process; legacy vignette remains unchanged.
 * Pixel centers belong to the CURRENT natural stage output. Signed Amount
 * mixes toward black/white; Highlights protects original maxima only while
 * darkening. All prepared values and intermediates are exact bounded integers. */
export const POST_CROP_VIGNETTE_PROCESS_V1 = 'srgb-natural-output-vignette-q8-v1';
export const POST_CROP_VIGNETTE_EFFECT_TYPE_V1 = 'post-crop-vignette-v1';
export const POST_CROP_VIGNETTE_EFFECT_CODE_V1 = 28;
const DEFAULTS = Object.freeze({ amount: 0, midpoint: 50, roundness: 0, feather: 50, highlights: 0 });
export type PostCropVignetteParamsV1 = Readonly<Record<keyof typeof DEFAULTS, number>>;
const signed = (key: keyof typeof DEFAULTS) => key === 'amount' || key === 'roundness';
const LABEL = Object.freeze({ amount: 'Amount', midpoint: 'Midpoint', roundness: 'Roundness', feather: 'Feather', highlights: 'Highlights' });
const KEY = Object.freeze({ amount: 'videoEffectPostCropVignetteAmount', midpoint: 'videoEffectPostCropVignetteMidpoint', roundness: 'videoEffectPostCropVignetteRoundness',
	feather: 'videoEffectPostCropVignetteFeather', highlights: 'videoEffectPostCropVignetteHighlights' });
export const POST_CROP_VIGNETTE_VIDEO_EFFECT_DEFINITION_V1 = Object.freeze({
	type: POST_CROP_VIGNETTE_EFFECT_TYPE_V1, label: 'Post-crop vignette', labelKey: 'videoEffectPostCropVignette',
	shader: POST_CROP_VIGNETTE_EFFECT_TYPE_V1, ffmpegFilter: POST_CROP_VIGNETTE_PROCESS_V1,
	params: Object.freeze(Object.fromEntries((Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]).map(key => [key,
		Object.freeze({ label: LABEL[key], labelKey: KEY[key], default: DEFAULTS[key], min: signed(key) ? -100 : 0, max: 100, step: 1, integer: false, control: 'number' })]))),
});

export function normalizePostCropVignetteParamsV1(value: unknown): PostCropVignetteParamsV1 {
	const keys = Object.keys(DEFAULTS), input = record(value === undefined ? {} : value, 'post-crop vignette parameters', keys, []);
	const result = {} as Record<keyof typeof DEFAULTS, number>;
	for (const key of keys as (keyof typeof DEFAULTS)[]) {
		const next = Object.hasOwn(input,key) ? field(input,key,'post-crop vignette parameters') : DEFAULTS[key];
		if (typeof next !== 'number' || !Number.isFinite(next) || next < (signed(key) ? -100 : 0) || next > 100) throw new RangeError('Post-crop vignette parameters exceed their finite bounds.');
		result[key] = Object.is(next,-0) ? 0 : next;
	}
	return Object.freeze(result);
}
export function normalizePostCropVignetteEffectV1(value: unknown) {
	const input = record(value,'post-crop vignette effect',['id','type','enabled','params']);
	const id=field(input,'id','post-crop vignette effect'),type=field(input,'type','post-crop vignette effect'),enabled=field(input,'enabled','post-crop vignette effect');
	if (typeof id !== 'string' || !id.length || id.length>128) throw new TypeError('Post-crop vignette requires a bounded effect ID.');
	if (type !== POST_CROP_VIGNETTE_EFFECT_TYPE_V1) throw new RangeError('Unsupported post-crop vignette process.');
	if (typeof enabled !== 'boolean') throw new TypeError('Post-crop vignette enabled must be boolean.');
	const params=field(input,'params','post-crop vignette effect'); if (params === undefined) throw new TypeError('Post-crop vignette requires parameters.');
	return Object.freeze({id,type,enabled,params:normalizePostCropVignetteParamsV1(params)});
}

/** Admission completes before the product-private ID factory is invoked. */
export function createPostCropVignetteEffectV1(value: unknown, createId: () => string) {
	const input=record(value,'post-crop vignette creation',['id','type','enabled','params','index'],[]);
	const take=(key:string)=>Object.hasOwn(input,key)?field(input,key,'post-crop vignette creation'):undefined;
	const id=take('id'),type=take('type'),enabled=Object.hasOwn(input,'enabled')?take('enabled'):true,index=take('index');
	if(Object.hasOwn(input,'id')&&(typeof id!=='string'||!id.length||id.length>128))throw new TypeError('Invalid vignette effect ID.');
	if(Object.hasOwn(input,'type')&&type!==POST_CROP_VIGNETTE_EFFECT_TYPE_V1)throw new RangeError('Invalid vignette effect type.');
	if(typeof enabled!=='boolean')throw new TypeError('Vignette enabled must be boolean.');
	if(index!==undefined&&(!Number.isSafeInteger(index)||typeof index!=='number'||index<0||index>100_000))throw new RangeError('Invalid vignette insertion index.');
	const params=normalizePostCropVignetteParamsV1(take('params'));
	if(typeof createId!=='function')throw new TypeError('Vignette creation requires its private ID factory.');
	const normalized=normalizePostCropVignetteEffectV1({id:id??createId(),type:POST_CROP_VIGNETTE_EFFECT_TYPE_V1,enabled,params});
	return {...normalized,params:{...normalized.params}};
}

export interface PreparedPostCropVignetteEffectV1 {
	readonly type: typeof POST_CROP_VIGNETTE_EFFECT_TYPE_V1; readonly enabled: boolean; readonly neutral: boolean;
	readonly amountQ8: number; readonly midpointQ16: number; readonly roundnessQ8: number; readonly featherQ16: number; readonly highlightsQ8: number;
}
const PREPARED = new WeakSet<object>();
export function preparePostCropVignetteEffectV1(value: unknown): Readonly<PreparedPostCropVignetteEffectV1> {
	const effect=normalizePostCropVignetteEffectV1(value),p=effect.params,amountQ8=Math.round(p.amount*256/100);
	const prepared=Object.freeze({type:effect.type,enabled:effect.enabled,neutral:amountQ8===0,amountQ8,
		midpointQ16:Math.round(p.midpoint*65536/100),roundnessQ8:Math.round(p.roundness*256/100),featherQ16:Math.round(p.feather*65536/100),highlightsQ8:Math.round(p.highlights*256/100)});
	PREPARED.add(prepared); return prepared;
}
function owned(value: PreparedPostCropVignetteEffectV1): void { if (!PREPARED.has(value)) throw new TypeError('An owning post-crop vignette preparation is required.'); }
function integer(value: number,min: number,max: number): void { if (!Number.isSafeInteger(value)||value<min||value>max) throw new RangeError('Invalid post-crop vignette scalar.'); }

/** Q8 coordinates use nearest integer with ties toward +infinity, including
 * negative centers. The circular basis clips at squared radius2 BEFORE
 * roundness interpolation. This bounds even65536:1 geometry; no Float32
 * product is used. Feather0 is a one-Q16-unit hard edge, center inclusive. */
export function postCropVignetteWeightV1(p: PreparedPostCropVignetteEffectV1,width: number,height: number,x: number,y: number): number {
	owned(p); integer(width,1,65536); integer(height,1,65536); integer(x,0,width-1); integer(y,0,height-1);
	if (!p.enabled||p.neutral) return 0;
	const coordinate=(position:number,size:number,denominator:number)=>Math.floor((2*(2*position+1-size)*256+denominator)/(2*denominator));
	const rx=coordinate(x,width,width),ry=coordinate(y,height,height),ellipse=rx*rx+ry*ry,square=Math.max(rx*rx,ry*ry);
	const side=Math.min(width,height),cx=Math.max(-512,Math.min(512,coordinate(x,width,side))),cy=Math.max(-512,Math.min(512,coordinate(y,height,side)));
	const circle=Math.min(131072,cx*cx+cy*cy),r=Math.abs(p.roundnessQ8),other=p.roundnessQ8<0?square:circle;
	const distance=Math.floor((ellipse*(256-r)+other*r+128)/256);
	const t=Math.max(0,Math.min(256,Math.floor((distance-p.midpointQ16)*256/Math.max(1,p.featherQ16))));
	return Math.floor((t*t*(768-2*t)+32768)/65536);
}

/** Mix one original byte; maxRGB is captured before any channel is changed.
 * Q8 strength×coverage and final signed half-up mix stay within16777216. */
export function postCropVignetteByteV1(p: PreparedPostCropVignetteEffectV1,byte: number,maxRGB: number,weight: number): number {
	owned(p); integer(byte,0,255); integer(maxRGB,byte,255); integer(weight,0,256);
	if (!p.enabled||p.neutral) return byte;
	const protection=p.amountQ8<0?Math.floor((maxRGB*p.highlightsQ8+127)/255):0;
	const coverage=Math.floor((weight*(256-protection)+128)/256),target=p.amountQ8<0?0:255;
	return Math.max(0,Math.min(255,byte+Math.floor(((target-byte)*Math.abs(p.amountQ8)*coverage+32768)/65536)));
}

export function postCropVignettePreviewPassV1(value: unknown) {
	const p=preparePostCropVignetteEffectV1(value); if(!p.enabled||p.neutral) return null;
	return Object.freeze({code:POST_CROP_VIGNETTE_EFFECT_CODE_V1,params0:Object.freeze([p.amountQ8,p.midpointQ16,p.featherQ16,p.roundnessQ8] as const),
		params1:Object.freeze([p.highlightsQ8,0,0,0] as const),direction:Object.freeze([0,0] as const)});
}

export interface PostCropVignetteFfmpegOperationV1 { readonly kind:'post-crop-vignette-v1';readonly expression:string;readonly preserveAlpha:true }
const OPERATIONS=new WeakSet<object>();
/** Ten GEQ scalar registers; input r/g/b are always original stage channels.
 * floor() owns signed division. W/H are the current filtered natural output. */
export function serializePostCropVignetteEffectToFfmpegV1(value:unknown):Readonly<PostCropVignetteFfmpegOperationV1>|null {
	const p=preparePostCropVignetteEffectV1(value);if(!p.enabled||p.neutral)return null;
	const q=(position:string,size:string,denominator:string)=>`floor((2*(2*${position}+1-${size})*256+${denominator})/(2*${denominator}))`;
	const rect=`st(0,${q('X','W','W')});st(1,${q('Y','H','H')});st(2,ld(0)*ld(0)+ld(1)*ld(1));`;
	const other=p.roundnessQ8<0?'st(3,max(ld(0)*ld(0),ld(1)*ld(1)));':
		`st(0,clip(${q('X','W','min(W,H)')},-512,512));st(1,clip(${q('Y','H','min(W,H)')},-512,512));st(3,min(131072,ld(0)*ld(0)+ld(1)*ld(1)));`;
	const r=Math.abs(p.roundnessQ8),strength=Math.abs(p.amountQ8),target=p.amountQ8<0?0:255;
	const shape=`st(4,floor((ld(2)*${String(256-r)}+ld(3)*${String(r)}+128)/256));`
		+`st(5,clip(floor((ld(4)-${String(p.midpointQ16)})*256/${String(Math.max(1,p.featherQ16))}),0,256));`
		+'st(6,floor((ld(5)*ld(5)*(768-2*ld(5))+32768)/65536));st(7,max(r(X,Y),max(g(X,Y),b(X,Y))));'
		+`st(8,${p.amountQ8<0?`floor((ld(7)*${String(p.highlightsQ8)}+127)/255)`:'0'});st(9,floor((ld(6)*(256-ld(8))+128)/256));`;
	const expressions=['r','g','b'].map(name=>`${name}='if(eq(alpha(X,Y),0),${name}(X,Y),${rect}${other}${shape}clip(${name}(X,Y)+floor((${String(target)}-${name}(X,Y))*${String(strength)}*ld(9)/65536+0.5),0,255))'`);
	const operation=Object.freeze({kind:'post-crop-vignette-v1' as const,expression:`format=pix_fmts=gbrap,geq=${expressions.join(':')}:a='alpha(X,Y)':interpolation=nearest,format=pix_fmts=rgba`,preserveAlpha:true as const});
	OPERATIONS.add(operation);return operation;
}
export function assertPostCropVignetteFfmpegOperationV1(value:unknown):asserts value is Readonly<PostCropVignetteFfmpegOperationV1> {
	if(!value||typeof value!=='object'||!OPERATIONS.has(value))throw new TypeError('An owning compiled post-crop vignette operation is required.');
}
