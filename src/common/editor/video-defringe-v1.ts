/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';

export const DEFRINGE_EFFECT_TYPE_V1 = 'defringe-v1';
export const DEFRINGE_EFFECT_CODE_V1 = 36;
const parameter = (label: string, labelKey: string, initial = 0) => Object.freeze({ label, labelKey, default: initial, min: 0, max: 100, step: 1, integer: false, control: 'number' });
export const DEFRINGE_VIDEO_EFFECT_DEFINITION_V1 = Object.freeze({
	type: DEFRINGE_EFFECT_TYPE_V1, label: 'Defringe', labelKey: 'videoEffectDefringe', shader: DEFRINGE_EFFECT_TYPE_V1, ffmpegFilter: DEFRINGE_EFFECT_TYPE_V1,
	params: Object.freeze({ purple: parameter('Purple', 'videoEffectDefringePurple'), green: parameter('Green', 'videoEffectDefringeGreen'),
		edgeThreshold: parameter('Edge threshold', 'videoEffectDefringeEdgeThreshold', 25) }),
});

export function normalizeDefringeParamsV1(value: unknown): Readonly<{ purple: number; green: number; edgeThreshold: number }> {
	const input = record(value === undefined ? {} : value, 'defringe parameters', ['purple', 'green', 'edgeThreshold'], []);
	const take = (name: 'purple' | 'green' | 'edgeThreshold') => {
		const candidate = Object.hasOwn(input, name) ? field(input, name, 'defringe parameters') : name === 'edgeThreshold' ? 25 : 0;
		if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0 || candidate > 100) throw new RangeError('Defringe controls require 0 through 100.');
		return candidate === 0 ? 0 : candidate;
	};
	return Object.freeze({ purple: take('purple'), green: take('green'), edgeThreshold: take('edgeThreshold') });
}

export function normalizeDefringeEffectV1(value: unknown) {
	const input = record(value, 'defringe effect', ['id', 'type', 'enabled', 'params']);
	const id = field(input, 'id', 'defringe effect'), type = field(input, 'type', 'defringe effect'), enabled = field(input, 'enabled', 'defringe effect');
	if (typeof id !== 'string' || id.length === 0 || id.length > 128) throw new TypeError('Defringe requires a bounded ID.');
	if (type !== DEFRINGE_EFFECT_TYPE_V1) throw new RangeError('Unsupported defringe process.');
	if (typeof enabled !== 'boolean') throw new TypeError('Defringe enabled must be boolean.');
	const params = field(input, 'params', 'defringe effect'); if (params === undefined) throw new TypeError('Defringe requires parameters.');
	return Object.freeze({ id, type: DEFRINGE_EFFECT_TYPE_V1, enabled, params: normalizeDefringeParamsV1(params) });
}

/** Manual fixed-radius edge suppression. Classification stays in continuous
 * encoded RGB; local mask coverage remains on the destination reference grid. */
export function prepareDefringeEffectV1(value: unknown) {
	const effect = normalizeDefringeEffectV1(value), { purple, green, edgeThreshold } = effect.params;
	return Object.freeze({ id: effect.id, type: effect.type, enabled: effect.enabled, neutral: purple === 0 && green === 0,
		purple, green, edgeThreshold, purpleAmount: purple / 100, greenAmount: green / 100, threshold: edgeThreshold / 100 });
}

export function defringePreviewPassV1(value: unknown) {
	const effect = prepareDefringeEffectV1(value); if (!effect.enabled || effect.neutral) return null;
	return Object.freeze({ code: DEFRINGE_EFFECT_CODE_V1, params0: Object.freeze([effect.purpleAmount, effect.greenAmount, effect.threshold, 0] as const),
		params1: Object.freeze([0, 0, 0, 0] as const), direction: Object.freeze([0, 0] as const) });
}

export function serializeDefringeEffectToFfmpegV1(value: unknown) {
	const effect = normalizeDefringeEffectV1(value); if (!effect.enabled || effect.params.purple === 0 && effect.params.green === 0) return null;
	return Object.freeze({ kind: DEFRINGE_EFFECT_TYPE_V1, effect });
}
