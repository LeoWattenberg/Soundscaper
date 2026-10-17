/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';

/** Encoded straight UNORM8 sRGB; replicated edges, alpha-weighted3x3 binomial
 * blur rounded first, then signed nearest-Q8 gain with ties toward +infinity.
 * Alpha-zero centers retain hidden RGB. Alpha never enters the output plane. */
export const DETAIL_SHARPEN_PROCESS_V1 = 'srgb-alpha-binomial-detail-q8-v1';
export const DETAIL_SHARPEN_EFFECT_TYPE_V1 = 'detail-sharpen-v1';
export const DETAIL_SHARPEN_EFFECT_CODE_V1 = 27;
export const DETAIL_SHARPEN_VIDEO_EFFECT_DEFINITION_V1 = Object.freeze({
	type: DETAIL_SHARPEN_EFFECT_TYPE_V1, label: 'Detail sharpening', labelKey: 'videoEffectDetailSharpen',
	shader: DETAIL_SHARPEN_EFFECT_TYPE_V1, ffmpegFilter: DETAIL_SHARPEN_PROCESS_V1,
	params: Object.freeze({
		amount: Object.freeze({ label: 'Amount', labelKey: 'videoEffectDetailSharpenAmount', default: 100, min: 0, max: 200, step: 1, integer: false, control: 'number' }),
		threshold: Object.freeze({ label: 'Threshold', labelKey: 'videoEffectDetailSharpenThreshold', default: 0, min: 0, max: 255, step: 1, integer: true, control: 'number' }),
	}),
});

export function normalizeDetailSharpenParamsV1(value: unknown): Readonly<{ amount: number; threshold: number }> {
	const input = record(value === undefined ? {} : value, 'detail sharpening parameters', ['amount', 'threshold'], []);
	const amount = Object.hasOwn(input, 'amount') ? field(input, 'amount', 'detail sharpening parameters') : 100;
	const threshold = Object.hasOwn(input, 'threshold') ? field(input, 'threshold', 'detail sharpening parameters') : 0;
	if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 200) throw new RangeError('Detail sharpening amount requires0 through200.');
	if (typeof threshold !== 'number' || !Number.isSafeInteger(threshold) || threshold < 0 || threshold > 255) throw new RangeError('Detail sharpening threshold requires0 through255 integers.');
	return Object.freeze({ amount: Object.is(amount, -0) ? 0 : amount, threshold: Object.is(threshold, -0) ? 0 : threshold });
}

export function normalizeDetailSharpenEffectV1(value: unknown) {
	const input = record(value, 'detail sharpening effect', ['id', 'type', 'enabled', 'params']);
	const id = field(input, 'id', 'detail sharpening effect'), type = field(input, 'type', 'detail sharpening effect'), enabled = field(input, 'enabled', 'detail sharpening effect');
	if (typeof id !== 'string' || !id.length || id.length > 128) throw new TypeError('Detail sharpening requires a bounded ID.');
	if (type !== DETAIL_SHARPEN_EFFECT_TYPE_V1) throw new RangeError('Unsupported detail sharpening process.');
	if (typeof enabled !== 'boolean') throw new TypeError('Detail sharpening enabled must be boolean.');
	const params = field(input, 'params', 'detail sharpening effect'); if (params === undefined) throw new TypeError('Detail sharpening requires parameters.');
	return Object.freeze({ id, type, enabled, params: normalizeDetailSharpenParamsV1(params) });
}

export interface PreparedDetailSharpenEffectV1 { readonly type: typeof DETAIL_SHARPEN_EFFECT_TYPE_V1; readonly enabled: boolean;
	readonly neutral: boolean; readonly gainQ8: number; readonly threshold: number }
const PREPARED = new WeakSet<object>();
export function prepareDetailSharpenEffectV1(value: unknown): Readonly<PreparedDetailSharpenEffectV1> {
	const { type, enabled, params } = normalizeDetailSharpenEffectV1(value), gainQ8 = Math.round(params.amount * 256 / 100);
	const prepared = Object.freeze({ type, enabled, neutral: gainQ8 === 0, gainQ8, threshold: params.threshold }); PREPARED.add(prepared); return prepared;
}

/** Inputs are scalar accumulators from the admitted byte neighborhood. Sum is
 * <=16*255*255=1040400; signed gain product is bounded by255*512=130560. */
export function detailSharpenByteV1(prepared: PreparedDetailSharpenEffectV1, original: number, sum: number, weight: number): number {
	if (!PREPARED.has(prepared)) throw new TypeError('An owning prepared detail sharpening effect is required.');
	if (!prepared.enabled || prepared.neutral || weight === 0) return original;
	const blur = Math.floor((2 * sum + weight) / (2 * weight)), delta = original - blur;
	return Math.abs(delta) <= prepared.threshold ? original : Math.max(0, Math.min(255, original + Math.floor((delta * prepared.gainQ8 + 128) / 256)));
}

export function detailSharpenPreviewPassV1(value: unknown) {
	const prepared = prepareDetailSharpenEffectV1(value); if (!prepared.enabled || prepared.neutral) return null;
	return Object.freeze({ code: DETAIL_SHARPEN_EFFECT_CODE_V1, params0: Object.freeze([prepared.gainQ8, prepared.threshold, 0, 0] as const),
		params1: Object.freeze([0, 0, 0, 0] as const), direction: Object.freeze([0, 0] as const) });
}

export function serializeDetailSharpenEffectToFfmpegV1(value: unknown): Readonly<{ kind: 'detail-sharpen-v1'; expression: string; preserveAlpha: true }> | null {
	const prepared = prepareDetailSharpenEffectV1(value); if (!prepared.enabled || prepared.neutral) return null;
	const neighbors = Array.from({ length: 9 }, (_, n) => ({ x: n % 3 - 1, y: Math.floor(n / 3) - 1,
		weight: (n % 3 === 1 ? 2 : 1) * (Math.floor(n / 3) === 1 ? 2 : 1) }));
	const point = (name: string, x: number, y: number) => `${name}(clip(X${x < 0 ? String(x) : `+${String(x)}`},0,W-1),clip(Y${y < 0 ? String(y) : `+${String(y)}`},0,H-1))`;
	const weight = neighbors.map(n => `${String(n.weight)}*${point('alpha', n.x, n.y)}`).join('+');
	const expressions = ['r', 'g', 'b'].map(name => {
		const sum = neighbors.map(n => `${String(n.weight)}*${point('alpha', n.x, n.y)}*${point(name, n.x, n.y)}`).join('+');
		return `${name}='if(eq(alpha(X,Y),0),${name}(X,Y),st(0,${weight});st(1,floor((2*(${sum})+ld(0))/(2*max(ld(0),1))));st(2,${name}(X,Y)-ld(1));if(lte(abs(ld(2)),${String(prepared.threshold)}),${name}(X,Y),clip(${name}(X,Y)+floor((ld(2)*${String(prepared.gainQ8)}+128)/256),0,255)))'`;
	});
	return Object.freeze({ kind: 'detail-sharpen-v1', expression: `format=pix_fmts=gbrap,geq=${expressions.join(':')}:a='alpha(X,Y)':interpolation=nearest,format=pix_fmts=rgba`, preserveAlpha: true });
}
