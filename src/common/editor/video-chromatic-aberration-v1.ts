/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';

export const CHROMATIC_ABERRATION_EFFECT_TYPE_V1 = 'chromatic-aberration-v1';
export const CHROMATIC_ABERRATION_EFFECT_CODE_V1 = 35;
const parameter = (label: string, labelKey: string) => Object.freeze({ label, labelKey, default: 0, min: -100, max: 100, step: 1, integer: false, control: 'number' });
export const CHROMATIC_ABERRATION_VIDEO_EFFECT_DEFINITION_V1 = Object.freeze({
	type: CHROMATIC_ABERRATION_EFFECT_TYPE_V1, label: 'Chromatic aberration', labelKey: 'videoEffectChromaticAberration',
	shader: CHROMATIC_ABERRATION_EFFECT_TYPE_V1, ffmpegFilter: CHROMATIC_ABERRATION_EFFECT_TYPE_V1,
	params: Object.freeze({ red: parameter('Red', 'videoEffectChromaticAberrationRed'), blue: parameter('Blue', 'videoEffectChromaticAberrationBlue') }),
});

export function normalizeChromaticAberrationParamsV1(value: unknown): Readonly<{ red: number; blue: number }> {
	const input = record(value === undefined ? {} : value, 'chromatic aberration parameters', ['red', 'blue'], []);
	const take = (name: 'red' | 'blue') => {
		const candidate = Object.hasOwn(input, name) ? field(input, name, 'chromatic aberration parameters') : 0;
		if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < -100 || candidate > 100) throw new RangeError('Chromatic aberration controls require -100 through 100.');
		return Object.is(candidate, -0) ? 0 : candidate;
	};
	return Object.freeze({ red: take('red'), blue: take('blue') });
}

export function normalizeChromaticAberrationEffectV1(value: unknown) {
	const input = record(value, 'chromatic aberration effect', ['id', 'type', 'enabled', 'params']);
	const id = field(input, 'id', 'chromatic aberration effect'), type = field(input, 'type', 'chromatic aberration effect'), enabled = field(input, 'enabled', 'chromatic aberration effect');
	if (typeof id !== 'string' || id.length === 0 || id.length > 128) throw new TypeError('Chromatic aberration requires a bounded ID.');
	if (type !== CHROMATIC_ABERRATION_EFFECT_TYPE_V1) throw new RangeError('Unsupported chromatic aberration process.');
	if (typeof enabled !== 'boolean') throw new TypeError('Chromatic aberration enabled must be boolean.');
	const params = field(input, 'params', 'chromatic aberration effect'); if (params === undefined) throw new TypeError('Chromatic aberration requires parameters.');
	return Object.freeze({ id, type: CHROMATIC_ABERRATION_EFFECT_TYPE_V1, enabled, params: normalizeChromaticAberrationParamsV1(params) });
}

/** Red and blue sample separate small radial inverses; green/alpha retain the
 * exact reference grid. This color adjustment remains maskable and transports
 * no geometry. Each zero control preserves that source component exactly. */
export function prepareChromaticAberrationEffectV1(value: unknown) {
	const effect = normalizeChromaticAberrationEffectV1(value), { red, blue } = effect.params;
	return Object.freeze({ id: effect.id, type: effect.type, enabled: effect.enabled, neutral: red === 0 && blue === 0,
		red, blue, redCoefficient: red * .0001, blueCoefficient: blue * .0001 });
}

export function chromaticAberrationPreviewPassV1(value: unknown) {
	const effect = prepareChromaticAberrationEffectV1(value); if (!effect.enabled || effect.neutral) return null;
	return Object.freeze({ code: CHROMATIC_ABERRATION_EFFECT_CODE_V1, params0: Object.freeze([effect.redCoefficient, effect.blueCoefficient, effect.red === 0 ? 0 : 1, effect.blue === 0 ? 0 : 1] as const),
		params1: Object.freeze([0, 0, 0, 0] as const), direction: Object.freeze([0, 0] as const) });
}

export function serializeChromaticAberrationEffectToFfmpegV1(value: unknown) {
	const effect = normalizeChromaticAberrationEffectV1(value); if (!effect.enabled || effect.params.red === 0 && effect.params.blue === 0) return null;
	return Object.freeze({ kind: CHROMATIC_ABERRATION_EFFECT_TYPE_V1, effect });
}
