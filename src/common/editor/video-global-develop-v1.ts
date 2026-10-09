/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';

/** Fixed process: straight alpha, Rec.709 primaries, sRGB byte encoding, per-operation quantization. */
export const GLOBAL_DEVELOP_PROCESS_V1 = 'linear-srgb-global-v1';
export const GLOBAL_DEVELOP_EFFECT_TYPES_V1 = Object.freeze(['white-balance-v1', 'tone-ladder-v1'] as const);
export type GlobalDevelopEffectTypeV1 = typeof GLOBAL_DEVELOP_EFFECT_TYPES_V1[number];
export const GLOBAL_DEVELOP_EFFECT_CODES_V1 = Object.freeze({ 'white-balance-v1': 18, 'tone-ladder-v1': 19 });
const PIVOT = 0.18, TONE_SCALE = 0.25;
const PREVIEW_LOOKUPS = new WeakMap<object, Uint8Array>();

function parameter(label: string, labelKey: string, min = -100, max = 100, step = 1) {
	return Object.freeze({ label, labelKey, default: 0, min, max, step, integer: false, control: 'number' });
}
function definition(type: GlobalDevelopEffectTypeV1, label: string, labelKey: string, params: Record<string, ReturnType<typeof parameter>>) {
	return Object.freeze({ type, label, labelKey, shader: type, ffmpegFilter: GLOBAL_DEVELOP_PROCESS_V1, params: Object.freeze(params) });
}
export const GLOBAL_DEVELOP_VIDEO_EFFECT_DEFINITIONS_V1 = Object.freeze({
	'white-balance-v1': definition('white-balance-v1', 'White balance', 'videoEffectWhiteBalance', {
		temperature: parameter('Temperature (relative)', 'videoEffectParamTemperature'), tint: parameter('Tint (relative)', 'videoEffectParamTint'),
	}),
	'tone-ladder-v1': definition('tone-ladder-v1', 'Tone', 'videoEffectToneLadder', {
		exposure: parameter('Exposure (stops)', 'videoEffectParamExposure', -5, 5, 0.01),
		contrast: parameter('Contrast', 'videoEffectParamContrast'), highlights: parameter('Highlights', 'videoEffectParamHighlights'),
		shadows: parameter('Shadows', 'videoEffectParamShadows'), whites: parameter('Whites', 'videoEffectParamWhites'), blacks: parameter('Blacks', 'videoEffectParamBlacks'),
	}),
});

export interface PreparedGlobalDevelopEffectV1 {
	readonly type: GlobalDevelopEffectTypeV1;
	readonly enabled: boolean;
	readonly neutral: boolean;
	readonly params0: readonly [number, number, number, number];
	readonly params1: readonly [number, number, number, number];
}
export function isGlobalDevelopEffectTypeV1(value: unknown): value is GlobalDevelopEffectTypeV1 {
	return value === 'white-balance-v1' || value === 'tone-ladder-v1';
}

/** Partial authoring parameters use owning defaults; every supplied field must be inert and in range. */
export function normalizeGlobalDevelopParamsV1(type: GlobalDevelopEffectTypeV1, value: unknown): Readonly<Record<string, number>> {
	if (!isGlobalDevelopEffectTypeV1(type)) throw new RangeError('Unsupported global develop process.');
	const definitions = GLOBAL_DEVELOP_VIDEO_EFFECT_DEFINITIONS_V1[type].params;
	const input = record(value === undefined ? {} : value, 'global develop parameters', Object.keys(definitions), []);
	const params: Record<string, number> = {};
	for (const [key, descriptor] of Object.entries(definitions)) {
		const candidate = Object.hasOwn(input, key) ? field(input, key, 'global develop parameters') : descriptor.default;
		if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < descriptor.min || candidate > descriptor.max) {
			throw new RangeError(`Global develop ${key} must be between ${String(descriptor.min)} and ${String(descriptor.max)}.`);
		}
		params[key] = candidate;
	}
	return Object.freeze(params);
}

export function normalizeGlobalDevelopEffectV1(value: unknown) {
	const input = record(value, 'global develop effect', ['id', 'type', 'enabled', 'params']);
	const id = field(input, 'id', 'global develop effect'), type = field(input, 'type', 'global develop effect'), enabled = field(input, 'enabled', 'global develop effect');
	if (typeof id !== 'string' || id.length === 0 || id.length > 128) throw new TypeError('Global develop effect requires a bounded ID.');
	if (!isGlobalDevelopEffectTypeV1(type)) throw new RangeError('Unsupported global develop process.');
	if (typeof enabled !== 'boolean') throw new TypeError('Global develop enabled must be boolean.');
	const rawParams = field(input, 'params', 'global develop effect');
	if (rawParams === undefined) throw new TypeError('Global develop effect requires parameter settings.');
	const params = normalizeGlobalDevelopParamsV1(type, rawParams);
	return Object.freeze({ id, type, enabled, params });
}

export function prepareGlobalDevelopEffectV1(value: unknown): Readonly<PreparedGlobalDevelopEffectV1> {
	const { type, enabled, params } = normalizeGlobalDevelopEffectV1(value);
	const neutral = Object.values(params).every(value => value === 0);
	const params0: [number, number, number, number] = type === 'white-balance-v1'
		? [2 ** (params.temperature! / 100 + params.tint! / 200), 2 ** (-params.tint! / 100), 2 ** (-params.temperature! / 100 + params.tint! / 200), 0]
		: [2 ** params.exposure!, 2 ** (params.contrast! / 50), params.highlights! / 100 * TONE_SCALE, params.shadows! / 100 * TONE_SCALE];
	const params1: [number, number, number, number] = type === 'white-balance-v1' ? [0, 0, 0, 0] : [params.whites! / 100 * TONE_SCALE, params.blacks! / 100 * TONE_SCALE, 0, 0];
	return Object.freeze({ type, enabled, neutral, params0: Object.freeze(params0), params1: Object.freeze(params1) });
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
function smooth(low: number, high: number, value: number): number {
	const t = clamp((value - low) / (high - low)); return t * t * (3 - 2 * t);
}
export function globalDevelopByteChannelV1(prepared: PreparedGlobalDevelopEffectV1, byte: number, channel: 0 | 1 | 2): number {
	if (!prepared.enabled || prepared.neutral) return byte;
	const encoded = byte / 255, linear = encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
	const p = prepared.params0, q = prepared.params1;
	let result: number;
	if (prepared.type === 'white-balance-v1') result = clamp(linear * p[channel]);
	else {
		const v = clamp((linear * p[0] - PIVOT) * p[1] + PIVOT);
		result = clamp(v + p[2] * smooth(0.5, 1, v) + p[3] * (1 - smooth(0, 0.5, v))
			+ q[0] * smooth(0.75, 1, v) + q[1] * (1 - smooth(0, 0.25, v)));
	}
	const output = result <= 0.0031308 ? 12.92 * result : 1.055 * result ** (1 / 2.4) - 0.055;
	return Math.floor(clamp(output) * 255 + 0.5);
}

/** UNORM8 separable operations compile their owning CPU rounding into a private 1KiB transfer texture. */
export function globalDevelopPreviewPassV1(value: unknown) {
	const prepared = prepareGlobalDevelopEffectV1(value);
	if (!prepared.enabled || prepared.neutral) return null;
	const pass = Object.freeze({ code: GLOBAL_DEVELOP_EFFECT_CODES_V1[prepared.type],
		params0: prepared.params0, params1: prepared.params1, direction: Object.freeze([0, 0]) });
	const bytes = new Uint8Array(1024);
	for (let byte = 0; byte < 256; byte++) {
		for (const channel of [0, 1, 2] as const) bytes[byte * 4 + channel] = globalDevelopByteChannelV1(prepared, byte, channel);
		bytes[byte * 4 + 3] = 255;
	}
	PREVIEW_LOOKUPS.set(pass, bytes);
	return pass;
}

/** Only the exact owning pass identity is accepted; returned upload bytes never expose private storage. */
export function copyGlobalDevelopPreviewLookupV1(value: unknown): Uint8Array<ArrayBuffer> {
	const bytes = value && typeof value === 'object' ? PREVIEW_LOOKUPS.get(value) : undefined;
	if (!bytes) throw new TypeError('Global develop GPU transfer requires its owning prepared pass.');
	return bytes.slice();
}

/** The same fixed linear masks/gains, explicit byte rounding, and unmodified alpha; no user expression enters this graph. */
export function serializeGlobalDevelopEffectToFfmpegV1(value: unknown): Readonly<{ expression: string; preserveAlpha: true }> | null {
	const prepared = prepareGlobalDevelopEffectV1(value);
	if (!prepared.enabled || prepared.neutral) return null;
	const token = (value: number) => String(Object.is(value, -0) ? 0 : value), p = prepared.params0, q = prepared.params1;
	const smoothExpression = (low: number, high: number) => {
		const t = `clip((ld(1)-${token(low)})/${token(high - low)},0,1)`; return `(${t})*(${t})*(3-2*(${t}))`;
	};
	const expressions = ['r', 'g', 'b'].map((channel, index) => {
		const sample = `${channel}(X,Y)/255`;
		const decode = `if(lte(${sample},0.04045),(${sample})/12.92,pow(((${sample})+0.055)/1.055,2.4))`;
		const linear = prepared.type === 'white-balance-v1' ? `clip(ld(0)*${token(p[index]!)},0,1)`
			: `clip(ld(1)+${token(p[2])}*(${smoothExpression(0.5, 1)})+${token(p[3])}*(1-(${smoothExpression(0, 0.5)}))`
				+ `+${token(q[0])}*(${smoothExpression(0.75, 1)})+${token(q[1])}*(1-(${smoothExpression(0, 0.25)})),0,1)`;
		const tone = prepared.type === 'tone-ladder-v1' ? `st(1,clip((ld(0)*${token(p[0])}-${token(PIVOT)})*${token(p[1])}+${token(PIVOT)},0,1));` : '';
		return `${channel}='st(0,${decode});${tone}st(2,${linear});floor(255*clip(if(lte(ld(2),0.0031308),12.92*ld(2),1.055*pow(ld(2),1/2.4)-0.055),0,1)+0.5)'`;
	});
	return Object.freeze({ expression: `format=pix_fmts=gbrap,geq=${expressions.join(':')}:a='alpha(X,Y)':interpolation=nearest,format=pix_fmts=rgba`, preserveAlpha: true });
}

/** Actual native shaders read the same compiled byte transfer, avoiding device-dependent pow precision. */
export const GLOBAL_DEVELOP_GLSL_V1 = `
uniform sampler2D u_global_lookup;
vec3 global_develop_rgb(vec3 rgb, int code, vec4 p, vec4 q) {
	ivec3 sample_byte = ivec3(floor(clamp(rgb, 0.0, 1.0) * 255.0 + 0.5));
	return vec3(texelFetch(u_global_lookup, ivec2(sample_byte.r, 0), 0).r,
		texelFetch(u_global_lookup, ivec2(sample_byte.g, 0), 0).g,
		texelFetch(u_global_lookup, ivec2(sample_byte.b, 0), 0).b);
}`;
