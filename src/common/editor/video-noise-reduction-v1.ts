/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';

/** Encoded straight UNORM8 sRGB, reversible integer YCoCg-R, replicated edges.
 * Alpha-weighted bilateral 3x3 luma and blended 3x3/5x5 chroma neighborhoods
 * read the same immutable input. Signed nearest rounding ties toward +infinity.
 * Alpha-zero centers retain hidden RGB; inverse RGB is explicitly clamped. */
export const NOISE_REDUCTION_PROCESS_V1 = 'srgb-alpha-bilateral-ycocg-noise-q8-v1';
export const NOISE_REDUCTION_EFFECT_TYPE_V1 = 'noise-reduction-v1';
export const NOISE_REDUCTION_EFFECT_CODE_V1 = 30;
const DEFAULTS = Object.freeze({ luminance: 0, luminanceDetail: 50, luminanceContrast: 0, color: 0, colorDetail: 50, colorSmoothness: 50 });
export type NoiseReductionParamsV1 = { readonly [Key in keyof typeof DEFAULTS]: number };
const LABELS = Object.freeze({ luminance: 'Luminance', luminanceDetail: 'Luminance detail', luminanceContrast: 'Luminance contrast',
	color: 'Color', colorDetail: 'Color detail', colorSmoothness: 'Color smoothness' });
const LABEL_KEYS = Object.freeze({ luminance: 'videoEffectNoiseLuminance', luminanceDetail: 'videoEffectNoiseLuminanceDetail',
	luminanceContrast: 'videoEffectNoiseLuminanceContrast', color: 'videoEffectNoiseColor', colorDetail: 'videoEffectNoiseColorDetail', colorSmoothness: 'videoEffectNoiseColorSmoothness' });
const KEYS = Object.freeze(Object.keys(DEFAULTS) as (keyof NoiseReductionParamsV1)[]);
export const NOISE_REDUCTION_VIDEO_EFFECT_DEFINITION_V1 = Object.freeze({ type: NOISE_REDUCTION_EFFECT_TYPE_V1, label: 'Noise reduction',
	labelKey: 'videoEffectNoiseReduction', shader: NOISE_REDUCTION_EFFECT_TYPE_V1, ffmpegFilter: NOISE_REDUCTION_PROCESS_V1,
	params: Object.freeze(Object.fromEntries(KEYS.map(key => [key, Object.freeze({ label: LABELS[key], labelKey: LABEL_KEYS[key],
		default: DEFAULTS[key], min: 0, max: 100, step: 1, integer: false, control: 'number' })]))) });

export function normalizeNoiseReductionParamsV1(value: unknown): Readonly<NoiseReductionParamsV1> {
	const input = record(value === undefined ? {} : value, 'noise reduction parameters', KEYS, []);
	return Object.freeze(Object.fromEntries(KEYS.map(key => {
		const scalar = Object.hasOwn(input, key) ? field(input, key, 'noise reduction parameters') : DEFAULTS[key];
		if (typeof scalar !== 'number' || !Number.isFinite(scalar) || scalar < 0 || scalar > 100) throw new RangeError(`Noise reduction ${key} requires 0 through 100.`);
		return [key, Object.is(scalar, -0) ? 0 : scalar];
	})) as unknown as NoiseReductionParamsV1);
}

export function normalizeNoiseReductionEffectV1(value: unknown) {
	const input = record(value, 'noise reduction effect', ['id', 'type', 'enabled', 'params']);
	const id = field(input, 'id', 'noise reduction effect'), type = field(input, 'type', 'noise reduction effect'), enabled = field(input, 'enabled', 'noise reduction effect');
	if (typeof id !== 'string' || id.length === 0 || id.length > 128) throw new TypeError('Noise reduction requires a bounded ID.');
	if (type !== NOISE_REDUCTION_EFFECT_TYPE_V1) throw new RangeError('Unsupported noise reduction process.');
	if (typeof enabled !== 'boolean') throw new TypeError('Noise reduction enabled must be boolean.');
	const params = field(input, 'params', 'noise reduction effect'); if (params === undefined) throw new TypeError('Noise reduction requires parameters.');
	return Object.freeze({ id, type, enabled, params: normalizeNoiseReductionParamsV1(params) });
}

export interface PreparedNoiseReductionEffectV1 {
	readonly type: typeof NOISE_REDUCTION_EFFECT_TYPE_V1; readonly enabled: boolean; readonly neutral: boolean;
	readonly luminanceQ8: number; readonly luminanceDetailQ8: number; readonly luminanceContrastQ8: number;
	readonly colorQ8: number; readonly colorDetailQ8: number; readonly colorSmoothnessQ8: number;
}
const PREPARED = new WeakSet<object>();
export function prepareNoiseReductionEffectV1(value: unknown): Readonly<PreparedNoiseReductionEffectV1> {
	const { type, enabled, params } = normalizeNoiseReductionEffectV1(value);
	const luminanceQ8 = Math.round(params.luminance * 256 / 100), colorQ8 = Math.round(params.color * 256 / 100);
	const prepared = Object.freeze({ type, enabled, neutral: luminanceQ8 === 0 && colorQ8 === 0, luminanceQ8, colorQ8,
		luminanceDetailQ8: Math.round(params.luminanceDetail * 256 / 100), luminanceContrastQ8: Math.round(params.luminanceContrast * 256 / 100),
		colorDetailQ8: Math.round(params.colorDetail * 256 / 100), colorSmoothnessQ8: Math.round(params.colorSmoothness * 256 / 100) });
	PREPARED.add(prepared); return prepared;
}

/** Scalar accumulators come from admitted original-byte neighborhoods. Luma
 * weight <=65,280; doubled sum <=33,292,800. Chroma doubled signed sum remains
 * below 558 million, including the rounded 25-tap spatial weights. */
export function noiseReductionLumaV1(prepared: PreparedNoiseReductionEffectV1, original: number, sum: number, weight: number, minimum: number, maximum: number): number {
	if (!PREPARED.has(prepared)) throw new TypeError('An owning prepared noise reduction effect is required.');
	if (!prepared.enabled || prepared.luminanceQ8 === 0 || weight === 0) return original;
	const mean = Math.floor((2 * sum + weight) / (2 * weight));
	const protection = Math.floor((prepared.luminanceContrastQ8 * (maximum - minimum) + 127) / 255);
	const strength = Math.floor((prepared.luminanceQ8 * (256 - protection) + 128) / 256);
	return original + Math.floor(((mean - original) * strength + 128) / 256);
}

export function noiseReductionChromaV1(prepared: PreparedNoiseReductionEffectV1, original: number, sum: number, weight: number): number {
	if (!PREPARED.has(prepared)) throw new TypeError('An owning prepared noise reduction effect is required.');
	if (!prepared.enabled || prepared.colorQ8 === 0 || weight === 0) return original;
	const mean = Math.floor((2 * sum + weight) / (2 * weight));
	return original + Math.floor(((mean - original) * prepared.colorQ8 + 128) / 256);
}

export function noiseReductionPreviewPassV1(value: unknown) {
	const prepared = prepareNoiseReductionEffectV1(value); if (!prepared.enabled || prepared.neutral) return null;
	return Object.freeze({ code: NOISE_REDUCTION_EFFECT_CODE_V1,
		params0: Object.freeze([prepared.luminanceQ8, prepared.luminanceDetailQ8, prepared.luminanceContrastQ8, prepared.colorQ8] as const),
		params1: Object.freeze([prepared.colorDetailQ8, prepared.colorSmoothnessQ8, 0, 0] as const), direction: Object.freeze([0,0] as const) });
}
