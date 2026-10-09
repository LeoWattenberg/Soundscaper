/* SPDX-License-Identifier: AGPL-3.0-only */

import { standardFilterCoefficients } from './filters-coefficients.ts';
import { iirReleaseBoundFrames } from '../../iir-release-bound.ts';

// The startup catalogue owns controls only. DSP is imported by the renderer.
const LIVE_CONTROL_REASON = 'This processor supports live controls but not timeline automation.';

interface LiveControlMetadata {
	unit: string;
	step: number;
	taper: string;
	automatable: false;
	automationBlockReason: string;
}

type ParameterRange = [number, number, LiveControlMetadata];
interface ParameterChoice {
	options: readonly (string | number)[];
	automatable: false;
	automationBlockReason: string;
}

export interface StandardFilterEffectDefinition {
	defaults: Readonly<Record<string, number | string>>;
	ranges: Readonly<Record<string, ParameterRange>>;
	choices: Readonly<Record<string, ParameterChoice>>;
}

function range(minimum: number, maximum: number, unit: string, step: number, taper: string): ParameterRange {
	return [minimum, maximum, { unit, step, taper, automatable: false, automationBlockReason: LIVE_CONTROL_REASON }];
}

function choice(options: readonly (string | number)[]): ParameterChoice {
	return Object.freeze({ options: Object.freeze(options), automatable: false, automationBlockReason: LIVE_CONTROL_REASON });
}

// The catalog admits every supported sample rate. Editors and DSP constrain
// the actual cutoff to below the current sample rate's Nyquist frequency.
const MAXIMUM_SUPPORTED_NYQUIST = 384_000 / 2;
const CUTOFF_RANGES = Object.freeze({ frequency: range(0.1, MAXIMUM_SUPPORTED_NYQUIST, 'Hz', 0.1, 'logarithmic') });
const ROLLOFF_CHOICES = Object.freeze({ rolloff: choice([6, 12, 24, 36, 48]) });

export type StandardFilterEffectType = 'highpass-filter' | 'lowpass-filter' | 'notch-filter' | 'shelf-filter';

export const STANDARD_FILTER_EFFECT_DEFINITIONS: Readonly<Record<StandardFilterEffectType, StandardFilterEffectDefinition>> = Object.freeze({
	'highpass-filter': Object.freeze({
		defaults: Object.freeze({ frequency: 1000, rolloff: 6 }),
		ranges: CUTOFF_RANGES,
		choices: ROLLOFF_CHOICES,
	}),
	'lowpass-filter': Object.freeze({
		defaults: Object.freeze({ frequency: 1000, rolloff: 6 }),
		ranges: CUTOFF_RANGES,
		choices: ROLLOFF_CHOICES,
	}),
	'notch-filter': Object.freeze({
		defaults: Object.freeze({ frequency: 60, q: 1 }),
		ranges: Object.freeze({
			frequency: range(0.1, MAXIMUM_SUPPORTED_NYQUIST, 'Hz', 0.1, 'logarithmic'),
			q: range(0.1, 1000, 'Q', 0.1, 'logarithmic'),
		}),
		choices: Object.freeze({}),
	}),
	'shelf-filter': Object.freeze({
		defaults: Object.freeze({ frequency: 1000, gain: -6, filterType: 'low' }),
		ranges: Object.freeze({
			frequency: range(10, 10_000, 'Hz', 1, 'logarithmic'),
			gain: range(-72, 72, 'dB', 0.1, 'decibel'),
		}),
		choices: Object.freeze({ filterType: choice(['low', 'high']) }),
	}),
});

export function isStandardFilterEffect(type: string): type is StandardFilterEffectType {
	return Object.hasOwn(STANDARD_FILTER_EFFECT_DEFINITIONS, type);
}

export type NormalizedStandardFilterParams = Record<string, number | string>;

export function normalizeStandardFilterParams(type: StandardFilterEffectType, sampleRate: number,
	params: Readonly<Record<string, unknown>>): NormalizedStandardFilterParams {
	if (!isStandardFilterEffect(type)) throw new RangeError(`Unsupported standard filter: ${String(type)}.`);
	if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) throw new RangeError('The sample rate must be between 8000 and 384000 Hz.');
	const definition = STANDARD_FILTER_EFFECT_DEFINITIONS[type];
	const result: NormalizedStandardFilterParams = {};
	for (const [key, [minimum, maximum]] of Object.entries(definition.ranges)) {
		const value = Number(params[key] ?? definition.defaults[key]);
		if (!Number.isFinite(value) || value < minimum || value > maximum) {
			throw new RangeError(`${type}.${key} must be between ${String(minimum)} and ${String(maximum)}.`);
		}
		result[key] = value;
	}
	if (Number(result.frequency) >= sampleRate / 2) {
		throw new RangeError(`${type}.frequency must be less than the Nyquist frequency (${String(sampleRate / 2)} Hz).`);
	}
	for (const [key, metadata] of Object.entries(definition.choices)) {
		const value = params[key] ?? definition.defaults[key];
		const match = metadata.options.find((option) => String(option) === String(value));
		if (match === undefined) throw new RangeError(`${type}.${key} is not a supported option.`);
		result[key] = match;
	}
	return result;
}

/** Absolute release bound for histories whose input peaks at one. Exact poles
 * include real roots, conjugate roots and repeats; the binomial envelope also
 * bounds cascaded stages without assuming that their poles are distinct.
 */
export function standardFilterTailSeconds(type: StandardFilterEffectType, params: Readonly<Record<string, unknown>>,
	sampleRate = 48000): number {
	const normalized = normalizeStandardFilterParams(type, sampleRate, params);
	if (type === 'shelf-filter' && Number(normalized.gain) === 0) return 0;
	const coefficients = standardFilterCoefficients(type, sampleRate, normalized);
	return iirReleaseBoundFrames(coefficients) / sampleRate;
}
