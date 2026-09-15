/* SPDX-License-Identifier: AGPL-3.0-only */

const LIVE_CONTROL_REASON = 'This processor supports live controls but not timeline automation.';
export const STANDARD_VOCODER_MAXIMUM_BANDS = 240;
/** Bound causal normalization to 80 dB of makeup; quiet tails stay finite. */
export const STANDARD_VOCODER_NORMALIZATION_FLOOR = .0001;

export function standardVocoderBandGeometry(sampleRate: number, bands: number) {
	const octaves = Math.log2(sampleRate / 2.205 / 20);
	const ratio = 2 ** (octaves / bands);
	return { ratio, firstFrequency: 20 * Math.sqrt(ratio), q: Math.SQRT2 * bands / octaves };
}
type Range = [number, number, {
	unit: string; step: number; taper: string; integer?: boolean;
	automatable: false; automationBlockReason: string;
}];
function range(minimum: number, maximum: number, unit: string, step: number, taper = 'linear', integer = false): Range {
	return [minimum, maximum, { unit, step, taper, integer, automatable: false, automationBlockReason: LIVE_CONTROL_REASON }];
}
function choice(options: readonly string[]) {
	return Object.freeze({ options: Object.freeze(options), automatable: false, automationBlockReason: LIVE_CONTROL_REASON });
}

export interface TremoloParams {
	waveform: 'sine' | 'triangle' | 'sawtooth' | 'inverse-sawtooth' | 'square';
	phase: number;
	depth: number;
	frequency: number;
}
export interface VocoderParams {
	bands: number;
	distance: number;
	outputMode: 'both-channels' | 'right-only';
	carrierLevel: number;
	noiseLevel: number;
	radarLevel: number;
	radarFrequency: number;
	outputGain: number;
}
interface ModulationDefinition {
	readonly defaults: Readonly<Record<string, number | string>>;
	readonly ranges: Readonly<Record<string, Range>>;
	readonly choices: Readonly<Record<string, ReturnType<typeof choice>>>;
}

/** Catalogue contract only: startup never reaches oscillator or filter code. */
export const STANDARD_MODULATION_EFFECT_DEFINITIONS = Object.freeze({
	tremolo: Object.freeze({
		defaults: Object.freeze({ waveform: 'sine', phase: 0, depth: 40, frequency: 4 }),
		ranges: Object.freeze({
			phase: range(-180, 180, '°', 1),
			depth: range(0, 100, '%', 1),
			frequency: range(0.001, 1000, 'Hz', 0.001, 'logarithmic'),
		}),
		choices: Object.freeze({ waveform: choice(['sine', 'triangle', 'sawtooth', 'inverse-sawtooth', 'square']) }),
	}),
	vocoder: Object.freeze({
		defaults: Object.freeze({
			bands: 40, distance: 20, outputMode: 'both-channels', carrierLevel: 100,
			noiseLevel: 0, radarLevel: 0, radarFrequency: 30, outputGain: 0,
		}),
		ranges: Object.freeze({
			bands: range(10, STANDARD_VOCODER_MAXIMUM_BANDS, '', 1, 'linear', true),
			distance: range(1, 120, '', 1),
			carrierLevel: range(0, 100, '%', 1),
			noiseLevel: range(0, 100, '%', 1),
			radarLevel: range(0, 100, '%', 1),
			radarFrequency: range(1, 100, 'Hz', 1, 'logarithmic'),
			outputGain: range(-24, 24, 'dB', 0.1, 'decibel'),
		}),
		choices: Object.freeze({ outputMode: choice(['both-channels', 'right-only']) }),
	}),
});

export type StandardModulationEffectType = keyof typeof STANDARD_MODULATION_EFFECT_DEFINITIONS;
export function isStandardModulationEffect(type: string): type is StandardModulationEffectType {
	return type === 'tremolo' || type === 'vocoder';
}
export function normalizeStandardModulationParams(type: 'tremolo', params: Readonly<Record<string, unknown>>): TremoloParams;
export function normalizeStandardModulationParams(type: 'vocoder', params: Readonly<Record<string, unknown>>): VocoderParams;
export function normalizeStandardModulationParams(type: StandardModulationEffectType, params: Readonly<Record<string, unknown>>): TremoloParams | VocoderParams;
export function normalizeStandardModulationParams(type: StandardModulationEffectType, params: Readonly<Record<string, unknown>>): TremoloParams | VocoderParams {
	const definition: ModulationDefinition = STANDARD_MODULATION_EFFECT_DEFINITIONS[type];
	const result: Record<string, number | string> = {};
	for (const [key, [minimum, maximum, metadata]] of Object.entries(definition.ranges)) {
		const value = Number(params[key] ?? definition.defaults[key]);
		if (!Number.isFinite(value) || value < minimum || value > maximum) {
			throw new RangeError(`${type}.${key} must be between ${minimum} and ${maximum}.`);
		}
		if (metadata.integer && !Number.isInteger(value)) throw new RangeError(`${type}.${key} must be an integer.`);
		result[key] = value;
	}
	for (const [key, metadata] of Object.entries(definition.choices)) {
		const value = params[key] ?? definition.defaults[key];
		if (typeof value !== 'string' || !metadata.options.includes(value)) throw new RangeError(`${type}.${key} is not a supported choice.`);
		result[key] = value;
	}
	return result as unknown as TremoloParams | VocoderParams;
}

/** Conservative -80 dB release for fixed controls. The lowest analysis band
 * and highest-Q envelope section determine the slowest pole radius. Twelve
 * positive exponential stages bound the three band-pass sections and four
 * second-order Butterworth envelope sections, including repeated poles.
 * 27x filter and 4096x envelope headroom cover ringing before the bounded
 * causal normalization and explicit output gain. Rack rendering applies
 * its separate 10-second cap.
 */
export function standardVocoderTailSeconds(params: Readonly<Record<string, unknown>>, sampleRate = 48000): number {
	if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) throw new RangeError('Invalid sample rate.');
	const settings = normalizeStandardModulationParams('vocoder', params);
	if (settings.carrierLevel === 0 && settings.noiseLevel === 0 && settings.radarLevel === 0) return 0;
	const { firstFrequency: frequency, q } = standardVocoderBandGeometry(sampleRate, settings.bands);
	const alpha = Math.sin(2 * Math.PI * frequency / sampleRate) / (2 * q);
	const bandpassRate = sampleRate * .5 * (Math.log1p(alpha) - Math.log1p(-alpha));
	const envelopeQ = 1 / (2 * Math.cos(7 * Math.PI / 16));
	const envelopeAlpha = Math.sin(2 * Math.PI * frequency / settings.distance / sampleRate) / (2 * envelopeQ);
	const envelopeRate = sampleRate * .5 * (Math.log1p(envelopeAlpha) - Math.log1p(-envelopeAlpha));
	const carrierMagnitude = Math.sqrt(settings.carrierLevel / 100)
		+ (settings.noiseLevel / 100) ** 2 + Math.sqrt(settings.radarLevel / 100);
	const headroom = 27 * 4096 * settings.bands * carrierMagnitude
		/ STANDARD_VOCODER_NORMALIZATION_FLOOR * 10 ** (settings.outputGain / 20);
	const threshold = .0001 / Math.max(1, headroom);
	let lower = 0;
	let upper = 64;
	for (let iteration = 0; iteration < 32; iteration += 1) {
		const x = (lower + upper) / 2;
		let term = 1;
		let polynomial = 1;
		for (let stage = 1; stage < 12; stage += 1) {
			term *= x / stage;
			polynomial += term;
		}
		const release = Math.exp(-x) * polynomial;
		if (release > threshold) lower = x;
		else upper = x;
	}
	return upper / Math.min(bandpassRate, envelopeRate) + 4 / sampleRate;
}

export interface StandardModulationOptions {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly params?: Readonly<Record<string, unknown>>;
}
