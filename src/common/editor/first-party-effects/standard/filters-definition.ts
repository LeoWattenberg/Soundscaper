/* SPDX-License-Identifier: AGPL-3.0-only */

import { standardFilterCoefficients } from './filters-coefficients.ts';

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

const CUTOFF_RANGES = Object.freeze({ frequency: range(0.1, 24_000, 'Hz', 0.1, 'logarithmic') });
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
			frequency: range(0.1, 24_000, 'Hz', 0.1, 'logarithmic'),
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

function maximumPoleMagnitude(a1: number, a2: number): number {
	if (a2 === 0) return Math.abs(a1);
	const discriminant = a1 * a1 - 4 * a2;
	if (discriminant < 0) return Math.sqrt(a2);
	// The stable quadratic form avoids subtracting nearly equal real roots.
	const root = -.5 * (a1 + (a1 < 0 ? -1 : 1) * Math.sqrt(discriminant));
	return Math.max(Math.abs(root), root === 0 ? 0 : Math.abs(a2 / root));
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
	let radius = 0;
	let poles = 0;
	let degree = 0;
	let logNumerator = Math.log(4); // Transient and numerical headroom above the coefficient bound.
	for (const [b0, b1, b2, a1, a2] of coefficients) {
		radius = Math.max(radius, maximumPoleMagnitude(a1, a2));
		poles += a2 !== 0 ? 2 : a1 !== 0 ? 1 : 0;
		degree += b2 !== 0 ? 2 : b1 !== 0 ? 1 : 0;
		// Numerator convolution has at most this absolute coefficient sum;
		// shelf boosts are therefore included in the release headroom.
		logNumerator += Math.log(Math.abs(b0) + Math.abs(b1) + Math.abs(b2));
	}
	if (radius === 0 || poles === 0) return degree / sampleRate;
	if (!Number.isFinite(radius) || radius >= 1) throw new RangeError('The filter poles must be stable to estimate their release.');
	const logRadius = Math.log(radius);
	const logTarget = Math.log(.0001); // -80 dB relative to full scale.
	const logReleaseBound = (frames: number): number => {
		const lag = frames + 1;
		if (lag < degree) return Infinity;
		// binomial(lag+poles-1,poles-1) bounds the impulse of all pole
		// factors. Its adjacent-term ratio decreases with lag, so summing
		// the remaining release is bounded by a geometric series.
		const logRatio = logRadius + Math.log1p((poles - 1) / (lag + 1));
		if (logRatio >= 0) return Infinity;
		let logBound = logNumerator + (lag - degree) * logRadius - Math.log(-Math.expm1(logRatio));
		for (let term = 1; term < poles; term++) logBound += Math.log((lag + term) / term);
		return logBound;
	};
	let lower = 0;
	let upper = Math.max(degree + 1, Math.ceil((poles - 1) / (1 - radius)) + 1);
	while (logReleaseBound(upper) > logTarget) {
		if (upper > Number.MAX_SAFE_INTEGER / 2) throw new RangeError('The filter release estimate is too large.');
		upper *= 2;
	}
	while (upper - lower > 1) {
		const middle = Math.floor(lower + (upper - lower) / 2);
		if (logReleaseBound(middle) > logTarget) lower = middle;
		else upper = middle;
	}
	return (upper + 1) / sampleRate;
}
