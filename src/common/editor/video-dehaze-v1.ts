/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';

/** Encoded straight UNORM8 sRGB. A replicated3×3 alpha-aware dark channel
 * estimates transmission against fixed white atmospheric light. Positive
 * amounts remove a white veil; negative amounts mix in white atmospheric
 * light. This quantized process does not estimate global airlight or reproduce
 * another editor. Alpha and transparent hidden RGB are retained exactly. */
export const DEHAZE_PROCESS_V1 = 'srgb-alpha-dark3-white-dehaze-q8-v1';
export const DEHAZE_EFFECT_TYPE_V1 = 'dehaze-v1';
export const DEHAZE_EFFECT_CODE_V1 = 33;
export const DEHAZE_VIDEO_EFFECT_DEFINITION_V1 = Object.freeze({
	type: DEHAZE_EFFECT_TYPE_V1, label: 'Dehaze', labelKey: 'videoEffectDehaze', shader: DEHAZE_EFFECT_TYPE_V1, ffmpegFilter: DEHAZE_PROCESS_V1,
	params: Object.freeze({ amount: Object.freeze({ label: 'Amount', labelKey: 'videoEffectDehazeAmount', default: 0,
		min: -100, max: 100, step: 1, integer: false, control: 'number' }) }),
});

export function normalizeDehazeParamsV1(value: unknown): Readonly<{ amount: number }> {
	const input = record(value === undefined ? {} : value,'dehaze parameters',['amount'],[]);
	const amount = Object.hasOwn(input,'amount') ? field(input,'amount','dehaze parameters') : 0;
	if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < -100 || amount > 100) throw new RangeError('Dehaze amount requires -100 through 100.');
	return Object.freeze({ amount: Object.is(amount,-0) ? 0 : amount });
}

export function normalizeDehazeEffectV1(value: unknown) {
	const input = record(value,'dehaze effect',['id','type','enabled','params']);
	const id = field(input,'id','dehaze effect'),type = field(input,'type','dehaze effect'),enabled = field(input,'enabled','dehaze effect');
	if (typeof id !== 'string' || !id.length || id.length > 128) throw new TypeError('Dehaze requires a bounded ID.');
	if (type !== DEHAZE_EFFECT_TYPE_V1) throw new RangeError('Unsupported dehaze process.');
	if (typeof enabled !== 'boolean') throw new TypeError('Dehaze enabled must be boolean.');
	const params = field(input,'params','dehaze effect'); if (params === undefined) throw new TypeError('Dehaze requires parameters.');
	return Object.freeze({ id,type,enabled,params: normalizeDehazeParamsV1(params) });
}

export interface PreparedDehazeEffectV1 { readonly type: typeof DEHAZE_EFFECT_TYPE_V1; readonly enabled: boolean;
	readonly neutral: boolean; readonly gainQ8: number; readonly fogQ8: number }
const PREPARED = new WeakSet<object>();
export function prepareDehazeEffectV1(value: unknown): Readonly<PreparedDehazeEffectV1> {
	const { type,enabled,params } = normalizeDehazeEffectV1(value),gain = Math.round(params.amount * 256 / 100);
	const gainQ8 = Object.is(gain,-0) ? 0 : gain,fogQ8 = gainQ8 < 0 ? Math.floor((-gainQ8 * 128 + 128) / 256) : 0;
	const prepared = Object.freeze({ type,enabled,neutral: gainQ8 === 0,gainQ8,fogQ8 }); PREPARED.add(prepared); return prepared;
}

/** Alpha is composited against white solely for the transmission estimate.
 * The owning byte numerator is<=65152; hidden black never suppresses haze. */
export function dehazeEffectiveDarkByteV1(red: number,green: number,blue: number,alpha: number): number {
	return Math.floor((Math.min(red,green,blue) * alpha + 255 * (255 - alpha) + 127) / 255);
}

/** D*gain*243<=15863040. The fixed26 floor bounds amplification by256/26. */
export function dehazeTransmissionQ8V1(prepared: PreparedDehazeEffectV1,dark: number): number {
	if (!PREPARED.has(prepared)) throw new TypeError('An owning prepared dehaze effect is required.');
	return prepared.enabled && prepared.gainQ8 > 0 ? Math.max(26,256 - Math.floor(dark * prepared.gainQ8 * 243 / 65280)) : 256;
}

/** Signed reconstruction uses floor(n+1/2), including negative intermediates.
 * Every owning numerator fits signed32; no division uses zero transmission. */
export function dehazeOutputByteV1(prepared: PreparedDehazeEffectV1,original: number,transmissionQ8: number): number {
	if (!PREPARED.has(prepared)) throw new TypeError('An owning prepared dehaze effect is required.');
	if (!prepared.enabled || prepared.neutral) return original;
	if (prepared.gainQ8 < 0) return original + Math.floor(((255 - original) * prepared.fogQ8 + 128) / 256);
	return Math.max(0,Math.min(255,255 + Math.floor((2 * (original - 255) * 256 + transmissionQ8) / (2 * transmissionQ8))));
}

export function dehazePreviewPassV1(value: unknown) {
	const prepared = prepareDehazeEffectV1(value); if (!prepared.enabled || prepared.neutral) return null;
	return Object.freeze({ code: DEHAZE_EFFECT_CODE_V1,params0: Object.freeze([prepared.gainQ8,0,0,0] as const),
		params1: Object.freeze([0,0,0,0] as const),direction: Object.freeze([0,0] as const) });
}
