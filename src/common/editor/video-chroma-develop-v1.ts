/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';

/** Straight UNORM8 sRGB, Rec.709 integer luma, saturation then adaptive vibrance; each substep rounds/clamps. */
export const CHROMA_DEVELOP_PROCESS_V1 = 'srgb-chroma-q16-v1';
export const CHROMA_DEVELOP_EFFECT_TYPE_V1 = 'chroma-v1';
export const CHROMA_DEVELOP_EFFECT_CODE_V1 = 21;
const Q = 65536;
const parameter = (label: string, labelKey: string) => Object.freeze({ label, labelKey, default: 0,
	min: -100, max: 100, step: 1, integer: false, control: 'number' });
export const CHROMA_DEVELOP_VIDEO_EFFECT_DEFINITION_V1 = Object.freeze({
	type: CHROMA_DEVELOP_EFFECT_TYPE_V1, label: 'Vibrance and saturation', labelKey: 'videoEffectChromaDevelop',
	shader: CHROMA_DEVELOP_EFFECT_TYPE_V1, ffmpegFilter: CHROMA_DEVELOP_PROCESS_V1,
	params: Object.freeze({ saturation: parameter('Saturation', 'videoEffectParamSaturation'), vibrance: parameter('Vibrance', 'videoEffectParamVibrance') }),
});

export function normalizeChromaDevelopParamsV1(value: unknown): Readonly<{ saturation: number; vibrance: number }> {
	const input = record(value === undefined ? {} : value, 'chroma parameters', ['saturation','vibrance'], []);
	const read = (key: 'saturation' | 'vibrance') => {
		const value = Object.hasOwn(input,key) ? field(input,key,'chroma parameters') : 0;
		if (typeof value !== 'number' || !Number.isFinite(value) || value < -100 || value > 100) throw new RangeError(`Chroma ${key} requires -100 through 100.`);
		return Object.is(value,-0) ? 0 : value;
	};
	return Object.freeze({ saturation: read('saturation'), vibrance: read('vibrance') });
}

export function normalizeChromaDevelopEffectV1(value: unknown) {
	const input = record(value,'chroma effect',['id','type','enabled','params']);
	const id = field(input,'id','chroma effect'), type = field(input,'type','chroma effect'), enabled = field(input,'enabled','chroma effect');
	if (typeof id !== 'string' || !id.length || id.length > 128) throw new TypeError('Chroma effect requires a bounded ID.');
	if (type !== CHROMA_DEVELOP_EFFECT_TYPE_V1) throw new RangeError('Unsupported chroma process.');
	if (typeof enabled !== 'boolean') throw new TypeError('Chroma enabled must be boolean.');
	const raw = field(input,'params','chroma effect'); if (raw === undefined) throw new TypeError('Chroma effect requires parameters.');
	return Object.freeze({ id, type, enabled, params: normalizeChromaDevelopParamsV1(raw) });
}

export interface PreparedChromaDevelopEffectV1 {
	readonly type: typeof CHROMA_DEVELOP_EFFECT_TYPE_V1;
	readonly enabled: boolean; readonly neutral: boolean;
	readonly params0: readonly [number,number,number,number];
	readonly params1: readonly [number,number,number,number];
}
export function prepareChromaDevelopEffectV1(value: unknown): Readonly<PreparedChromaDevelopEffectV1> {
	const {type,enabled,params} = normalizeChromaDevelopEffectV1(value);
	return Object.freeze({ type, enabled, neutral: params.saturation === 0 && params.vibrance === 0,
		params0: Object.freeze([Math.round((1+params.saturation/100)*Q), Math.round(params.vibrance/100*Q),0,0] as const),
		params1: Object.freeze([0,0,0,0] as const) });
}
function luma(r: number,g: number,b: number): number { return Math.floor((54*r+183*g+19*b+128)/256); }
function channel(byte: number,y: number,factor: number): number { return Math.floor(Math.max(0,Math.min(255*Q,y*Q+(byte-y)*factor+Q/2))/Q); }

/** Owning admitted pixel loop: no tuple or frame allocation per pixel; hidden RGB and alpha remain independent. */
export function applyChromaDevelopPixelV1(prepared: PreparedChromaDevelopEffectV1, pixels: Uint8Array, offset: number): void {
	if (!prepared.enabled || prepared.neutral) return;
	const p = prepared.params0, firstY = luma(pixels[offset]!,pixels[offset+1]!,pixels[offset+2]!);
	const r = channel(pixels[offset]!,firstY,p[0]), g = channel(pixels[offset+1]!,firstY,p[0]), b = channel(pixels[offset+2]!,firstY,p[0]);
	const range = Math.max(r,g,b)-Math.min(r,g,b), factor = Q+Math.floor((p[1]*(255-range)+127)/255), y = luma(r,g,b);
	pixels[offset] = channel(r,y,factor); pixels[offset+1] = channel(g,y,factor); pixels[offset+2] = channel(b,y,factor);
}

export function chromaDevelopPreviewPassV1(value: unknown) {
	const prepared = prepareChromaDevelopEffectV1(value); if (!prepared.enabled || prepared.neutral) return null;
	return Object.freeze({code:CHROMA_DEVELOP_EFFECT_CODE_V1,params0:prepared.params0,params1:prepared.params1,direction:Object.freeze([0,0])});
}

/** Generated algebra only. All integer intermediates are exact in FFmpeg's double evaluator. */
export function serializeChromaDevelopEffectToFfmpegV1(value: unknown): Readonly<{ expression: string; preserveAlpha: true }> | null {
	const prepared = prepareChromaDevelopEffectV1(value); if (!prepared.enabled || prepared.neutral) return null;
	const y = (rgb: string[]) => `floor((54*(${rgb[0]!})+183*(${rgb[1]!})+19*(${rgb[2]!})+128)/256)`;
	const convert = (c: string,l: string,f: string) => `floor(clip((${l})*65536+((${c})-(${l}))*(${f})+32768,0,16711680)/65536)`;
	const rgb = ['r(X,Y)','g(X,Y)','b(X,Y)'], initialY = y(rgb);
	const first = rgb.map(c=>convert(c,initialY,String(prepared.params0[0])));
	const retained = ['ld(0)','ld(1)','ld(2)'], secondY = y(retained);
	const range = 'max(max(ld(0),ld(1)),ld(2))-min(min(ld(0),ld(1)),ld(2))';
	const factor = `65536+floor((${String(prepared.params0[1])}*(255-(${range}))+127)/255)`;
	const expressions = ['r','g','b'].map((name,index)=>`${name}='${first.map((c,i)=>`st(${String(i)},${c});`).join('')}st(3,${factor});${convert(retained[index]!,secondY,'ld(3)')}'`);
	return Object.freeze({expression:`format=pix_fmts=gbrap,geq=${expressions.join(':')}:a='alpha(X,Y)':interpolation=nearest,format=pix_fmts=rgba`,preserveAlpha:true});
}

/** Q16 coefficients fit exactly in float uniforms; all shader intermediates are highp signed integers below 34 million. */
export const CHROMA_DEVELOP_GLSL_V1 = `
int chroma_luma(ivec3 c) { return (54*c.r+183*c.g+19*c.b+128)/256; }
ivec3 chroma_scale(ivec3 c,int factor) {
	int y = chroma_luma(c);
	return clamp(ivec3(y*65536)+(c-ivec3(y))*factor+ivec3(32768),ivec3(0),ivec3(16711680))/65536;
}
vec3 chroma_develop_rgb(vec3 rgb,vec4 p) {
	ivec3 c = ivec3(floor(clamp(rgb,0.0,1.0)*255.0+0.5));
	c = chroma_scale(c,int(p.x));
	int range = max(max(c.r,c.g),c.b)-min(min(c.r,c.g),c.b);
	int n = int(p.y)*(255-range)+127;
	int delta = n >= 0 ? n/255 : -((-n+254)/255);
	return vec3(chroma_scale(c,65536+delta))/255.0;
}`;
