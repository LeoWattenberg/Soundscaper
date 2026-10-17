/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';

export const LENS_DISTORTION_EFFECT_TYPE_V1 = 'lens-distortion-v1';
export const LENS_DISTORTION_EFFECT_CODE_V1 = 34;
export const LENS_DISTORTION_VIDEO_EFFECT_DEFINITION_V1 = Object.freeze({
	type: LENS_DISTORTION_EFFECT_TYPE_V1, label: 'Lens distortion', labelKey: 'videoEffectLensDistortion',
	shader: LENS_DISTORTION_EFFECT_TYPE_V1, ffmpegFilter: LENS_DISTORTION_EFFECT_TYPE_V1,
	params: Object.freeze({ amount: Object.freeze({ label: 'Amount', labelKey: 'videoEffectLensDistortionAmount',
		default: 0, min: -100, max: 100, step: 1, integer: false, control: 'number' }) }),
});

export function normalizeLensDistortionParamsV1(value: unknown): Readonly<{ amount: number }> {
	const input = record(value === undefined ? {} : value, 'lens distortion parameters', ['amount'], []);
	const amount = Object.hasOwn(input, 'amount') ? field(input, 'amount', 'lens distortion parameters') : 0;
	if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < -100 || amount > 100) throw new RangeError('Lens distortion amount requires -100 through 100.');
	return Object.freeze({ amount: Object.is(amount, -0) ? 0 : amount });
}

export function normalizeLensDistortionEffectV1(value: unknown) {
	const input = record(value, 'lens distortion effect', ['id', 'type', 'enabled', 'params']);
	const id = field(input, 'id', 'lens distortion effect'), type = field(input, 'type', 'lens distortion effect'), enabled = field(input, 'enabled', 'lens distortion effect');
	if (typeof id !== 'string' || id.length === 0 || id.length > 128) throw new TypeError('Lens distortion requires a bounded ID.');
	if (type !== LENS_DISTORTION_EFFECT_TYPE_V1) throw new RangeError('Unsupported lens distortion process.');
	if (typeof enabled !== 'boolean') throw new TypeError('Lens distortion enabled must be boolean.');
	const params = field(input, 'params', 'lens distortion effect'); if (params === undefined) throw new TypeError('Lens distortion requires parameters.');
	return Object.freeze({ id, type: LENS_DISTORTION_EFFECT_TYPE_V1, enabled, params: normalizeLensDistortionParamsV1(params) });
}

/** Fixed-extent inverse radial map. Pixel-center displacement is normalized
 * by the source half-diagonal; transparent taps outside the source participate
 * in premultiplied bilinear sampling. No profile database is consulted. */
export function prepareLensDistortionEffectV1(value: unknown) {
	const effect = normalizeLensDistortionEffectV1(value), amount = effect.params.amount;
	return Object.freeze({ id: effect.id, type: effect.type, enabled: effect.enabled, neutral: amount === 0, amount, k: amount * .003 });
}

export function lensDistortionPreviewPassV1(value: unknown) {
	const effect = prepareLensDistortionEffectV1(value); if (!effect.enabled || effect.neutral) return null;
	return Object.freeze({ code: LENS_DISTORTION_EFFECT_CODE_V1, params0: Object.freeze([effect.k, 0, 0, 0] as const),
		params1: Object.freeze([0, 0, 0, 0] as const), direction: Object.freeze([0, 0] as const) });
}

export function serializeLensDistortionEffectToFfmpegV1(value: unknown) {
	const effect = normalizeLensDistortionEffectV1(value); if (!effect.enabled || effect.params.amount === 0) return null;
	return Object.freeze({ kind: LENS_DISTORTION_EFFECT_TYPE_V1, effect });
}
