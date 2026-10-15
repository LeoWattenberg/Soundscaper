/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';

export const OPTICAL_VIGNETTE_EFFECT_TYPE_V1 = 'optical-vignette-v1';
export const OPTICAL_VIGNETTE_EFFECT_CODE_V1 = 37;
export const OPTICAL_VIGNETTE_VIDEO_EFFECT_DEFINITION_V1 = Object.freeze({
	type: OPTICAL_VIGNETTE_EFFECT_TYPE_V1, label: 'Optical vignette', labelKey: 'videoEffectOpticalVignette',
	shader: OPTICAL_VIGNETTE_EFFECT_TYPE_V1, ffmpegFilter: OPTICAL_VIGNETTE_EFFECT_TYPE_V1,
	params: Object.freeze({ amount: Object.freeze({ label: 'Amount', labelKey: 'videoEffectOpticalVignetteAmount', default: 0,
		min: -100, max: 100, step: 1, integer: false, control: 'number' }) }),
});

export function normalizeOpticalVignetteParamsV1(value: unknown): Readonly<{ amount: number }> {
	const input = record(value === undefined ? {} : value, 'optical vignette parameters', ['amount'], []);
	const amount = Object.hasOwn(input, 'amount') ? field(input, 'amount', 'optical vignette parameters') : 0;
	if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < -100 || amount > 100) throw new RangeError('Optical vignette amount requires -100 through 100.');
	return Object.freeze({ amount: amount === 0 ? 0 : amount });
}

export function normalizeOpticalVignetteEffectV1(value: unknown) {
	const input = record(value, 'optical vignette effect', ['id', 'type', 'enabled', 'params']);
	const id = field(input, 'id', 'optical vignette effect'), type = field(input, 'type', 'optical vignette effect'), enabled = field(input, 'enabled', 'optical vignette effect');
	if (typeof id !== 'string' || id.length === 0 || id.length > 128) throw new TypeError('Optical vignette requires a bounded ID.');
	if (type !== OPTICAL_VIGNETTE_EFFECT_TYPE_V1) throw new RangeError('Unsupported optical vignette process.');
	if (typeof enabled !== 'boolean') throw new TypeError('Optical vignette enabled must be boolean.');
	const params = field(input, 'params', 'optical vignette effect'); if (params === undefined) throw new TypeError('Optical vignette requires parameters.');
	return Object.freeze({ id, type: OPTICAL_VIGNETTE_EFFECT_TYPE_V1, enabled, params: normalizeOpticalVignetteParamsV1(params) });
}

/** Positive radial linear-light gain in the incoming stage's aperture. Order
 * remains authored: there is no inferred Original/sensor coordinate authority. */
export function prepareOpticalVignetteEffectV1(value: unknown) {
	const effect = normalizeOpticalVignetteEffectV1(value), amount = effect.params.amount;
	return Object.freeze({ id: effect.id, type: effect.type, enabled: effect.enabled, neutral: amount === 0, amount, strength: amount / 100 });
}

export function opticalVignettePreviewPassV1(value: unknown) {
	const effect = prepareOpticalVignetteEffectV1(value); if (!effect.enabled || effect.neutral) return null;
	return Object.freeze({ code: OPTICAL_VIGNETTE_EFFECT_CODE_V1, params0: Object.freeze([effect.strength, 0, 0, 0] as const),
		params1: Object.freeze([0, 0, 0, 0] as const), direction: Object.freeze([0, 0] as const) });
}

export function serializeOpticalVignetteEffectToFfmpegV1(value: unknown) {
	const effect = normalizeOpticalVignetteEffectV1(value); if (!effect.enabled || effect.params.amount === 0) return null;
	return Object.freeze({ kind: OPTICAL_VIGNETTE_EFFECT_TYPE_V1, effect });
}
