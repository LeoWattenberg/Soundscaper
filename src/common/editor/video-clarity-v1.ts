/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';

/** Encoded straight UNORM8 sRGB. A dense7×7 alpha-weighted binomial luma
 * mean defines local midtone structure. One common signed RGB offset changes
 * local contrast, preserving channel differences until gamut clipping.
 * The triangular midtone gate protects black/white; alpha-zero centers retain
 * hidden RGB, and output alpha is never calculated by the effect. */
export const CLARITY_PROCESS_V1 = 'srgb-alpha-binomial7-luma-clarity-q8-v1';
export const CLARITY_EFFECT_TYPE_V1 = 'clarity-v1';
export const CLARITY_EFFECT_CODE_V1 = 29;
export const CLARITY_BINOMIAL_V1 = Object.freeze([1,6,15,20,15,6,1] as const);
export const CLARITY_VIDEO_EFFECT_DEFINITION_V1 = Object.freeze({
	type: CLARITY_EFFECT_TYPE_V1, label: 'Clarity', labelKey: 'videoEffectClarity', shader: CLARITY_EFFECT_TYPE_V1, ffmpegFilter: CLARITY_PROCESS_V1,
	params: Object.freeze({ amount: Object.freeze({ label: 'Amount', labelKey: 'videoEffectClarityAmount', default: 0,
		min: -100, max: 100, step: 1, integer: false, control: 'number' }) }),
});

export function normalizeClarityParamsV1(value: unknown): Readonly<{ amount: number }> {
	const input = record(value === undefined ? {} : value, 'clarity parameters', ['amount'], []);
	const amount = Object.hasOwn(input, 'amount') ? field(input, 'amount', 'clarity parameters') : 0;
	if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < -100 || amount > 100) throw new RangeError('Clarity amount requires -100 through 100.');
	return Object.freeze({ amount: Object.is(amount, -0) ? 0 : amount });
}

export function normalizeClarityEffectV1(value: unknown) {
	const input = record(value, 'clarity effect', ['id', 'type', 'enabled', 'params']);
	const id = field(input, 'id', 'clarity effect'), type = field(input, 'type', 'clarity effect'), enabled = field(input, 'enabled', 'clarity effect');
	if (typeof id !== 'string' || !id.length || id.length > 128) throw new TypeError('Clarity requires a bounded ID.');
	if (type !== CLARITY_EFFECT_TYPE_V1) throw new RangeError('Unsupported clarity process.');
	if (typeof enabled !== 'boolean') throw new TypeError('Clarity enabled must be boolean.');
	const params = field(input, 'params', 'clarity effect'); if (params === undefined) throw new TypeError('Clarity requires parameters.');
	return Object.freeze({ id, type, enabled, params: normalizeClarityParamsV1(params) });
}

export interface PreparedClarityEffectV1 { readonly type: typeof CLARITY_EFFECT_TYPE_V1; readonly enabled: boolean;
	readonly neutral: boolean; readonly gainQ8: number }
const PREPARED = new WeakSet<object>();
export function prepareClarityEffectV1(value: unknown): Readonly<PreparedClarityEffectV1> {
	const { type, enabled, params } = normalizeClarityEffectV1(value), gain = Math.round(params.amount * 256 / 100);
	const gainQ8 = Object.is(gain, -0) ? 0 : gain;
	const prepared = Object.freeze({ type, enabled, neutral: gainQ8 === 0, gainQ8 }); PREPARED.add(prepared); return prepared;
}

/** Byte luma coefficients sum256; their largest numerator is65408. */
export function clarityLumaByteV1(red: number, green: number, blue: number): number {
	return Math.floor((54 * red + 183 * green + 19 * blue + 128) / 256);
}
/** Owning accumulators: weight<=4096*255; sum<=4096*255*255=266342400.
 * Positive blur rounding stays below534M; signed gain stays below16.6M. */
export function clarityAdjustmentV1(prepared: PreparedClarityEffectV1, originalLuma: number, sum: number, weight: number): number {
	if (!PREPARED.has(prepared)) throw new TypeError('An owning prepared clarity effect is required.');
	if (!prepared.enabled || prepared.neutral || weight === 0) return 0;
	const blur = Math.floor((2 * sum + weight) / (2 * weight)), midtone = 2 * Math.min(originalLuma, 255 - originalLuma);
	return Math.floor(((originalLuma - blur) * prepared.gainQ8 * midtone + 32512) / 65024);
}

export function clarityPreviewPassV1(value: unknown) {
	const prepared = prepareClarityEffectV1(value); if (!prepared.enabled || prepared.neutral) return null;
	return Object.freeze({ code: CLARITY_EFFECT_CODE_V1, params0: Object.freeze([prepared.gainQ8,0,0,0] as const),
		params1: Object.freeze([0,0,0,0] as const), direction: Object.freeze([0,0] as const) });
}

export function serializeClarityEffectToFfmpegV1(value: unknown): Readonly<{ kind: 'clarity-v1'; expression: string; preserveAlpha: true }> | null {
	const prepared = prepareClarityEffectV1(value); if (!prepared.enabled || prepared.neutral) return null;
	const neighbors = Array.from({ length: 49 }, (_, n) => ({ x: n%7-3, y: Math.floor(n/7)-3,
		weight: CLARITY_BINOMIAL_V1[n%7]! * CLARITY_BINOMIAL_V1[Math.floor(n/7)]! }));
	const point = (name: string, x: number, y: number) => `${name}(clip(X${x<0?String(x):`+${String(x)}`},0,W-1),clip(Y${y<0?String(y):`+${String(y)}`},0,H-1))`;
	const luma = (x: number, y: number) => `floor((54*${point('r',x,y)}+183*${point('g',x,y)}+19*${point('b',x,y)}+128)/256)`;
	const center = luma(0,0), weight = neighbors.map(n => `${String(n.weight)}*${point('alpha',n.x,n.y)}`).join('+');
	const sum = neighbors.map(n => `${String(n.weight)}*${point('alpha',n.x,n.y)}*${luma(n.x,n.y)}`).join('+');
	const expressions = ['r','g','b'].map(name => `${name}='if(eq(alpha(X,Y),0),${name}(X,Y),st(0,${weight});st(1,${sum});st(2,floor((2*ld(1)+ld(0))/(2*max(ld(0),1))));st(3,${center}-ld(2));st(4,2*min(${center},255-${center}));clip(${name}(X,Y)+floor((ld(3)*${String(prepared.gainQ8)}*ld(4)+32512)/65024),0,255))'`);
	return Object.freeze({ kind: 'clarity-v1', expression: `format=pix_fmts=gbrap,geq=${expressions.join(':')}:a='alpha(X,Y)':interpolation=nearest,format=pix_fmts=rgba`, preserveAlpha: true });
}
