/* SPDX-License-Identifier: AGPL-3.0-only */

type Range = [number, number, { unit: string; step: number; taper: string; automatable: boolean; automationBlockReason: string }];
function range(min: number, max: number, unit: string, step: number, taper = 'linear'): Range {
	return [min, max, { unit, step, taper, automatable: false,
		automationBlockReason: 'This processor supports live controls but not timeline automation.' }];
}

export const DEESSER_EFFECT_DEFINITION = Object.freeze({
	defaults: { frequency: 6000, threshold: -30, reduction: 9, attack: 0.001, release: 0.08 },
	ranges: {
		frequency: range(1000, 16000, 'Hz', 1, 'logarithmic'),
		threshold: range(-60, 0, 'dB', 0.1, 'decibel'),
		reduction: range(0, 24, 'dB', 0.1, 'decibel'),
		attack: range(0.0001, 0.1, 's', 0.0001, 'logarithmic'),
		release: range(0.01, 1, 's', 0.001, 'logarithmic'),
	},
});

export const MULTIBAND_COMPRESSOR_EFFECT_DEFINITION = Object.freeze({
	defaults: {
		lowCrossover: 250, highCrossover: 4000,
		lowThreshold: -24, lowRatio: 2, lowGain: 0,
		midThreshold: -24, midRatio: 2, midGain: 0,
		highThreshold: -24, highRatio: 2, highGain: 0,
		attack: 0.01, release: 0.15,
	},
	ranges: {
		lowCrossover: range(40, 2000, 'Hz', 1, 'logarithmic'),
		highCrossover: range(2500, 16000, 'Hz', 1, 'logarithmic'),
		lowThreshold: range(-60, 0, 'dB', 0.1, 'decibel'),
		lowRatio: range(1, 20, ':1', 0.1, 'logarithmic'),
		lowGain: range(-12, 12, 'dB', 0.1, 'decibel'),
		midThreshold: range(-60, 0, 'dB', 0.1, 'decibel'),
		midRatio: range(1, 20, ':1', 0.1, 'logarithmic'),
		midGain: range(-12, 12, 'dB', 0.1, 'decibel'),
		highThreshold: range(-60, 0, 'dB', 0.1, 'decibel'),
		highRatio: range(1, 20, ':1', 0.1, 'logarithmic'),
		highGain: range(-12, 12, 'dB', 0.1, 'decibel'),
		attack: range(0.0001, 0.1, 's', 0.0001, 'logarithmic'),
		release: range(0.01, 1, 's', 0.001, 'logarithmic'),
	},
});

export type DynamicsEffectType = 'deesser' | 'multiband-compressor';
export function isBandDynamicsEffect(type: string): type is DynamicsEffectType {
	return type === 'deesser' || type === 'multiband-compressor';
}

export function normalizeBandDynamicsParams(type: DynamicsEffectType, params: Readonly<Record<string, unknown>>) {
	const definition = type === 'deesser' ? DEESSER_EFFECT_DEFINITION : MULTIBAND_COMPRESSOR_EFFECT_DEFINITION;
	const defaults: Record<string, number> = definition.defaults;
	const result: Record<string, number> = {};
	for (const [key, [minimum, maximum]] of Object.entries(definition.ranges)) {
		const value = Number(params[key] ?? defaults[key]);
		if (!Number.isFinite(value) || value < minimum || value > maximum) {
			throw new RangeError(`${type}.${key} must be between ${minimum} and ${maximum}.`);
		}
		result[key] = value;
	}
	return result;
}
