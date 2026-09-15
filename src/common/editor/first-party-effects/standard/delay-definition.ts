/* SPDX-License-Identifier: AGPL-3.0-only */

const reason = 'This processor supports live controls but not timeline automation.';
export const STANDARD_DELAY_MEMORY_LIMIT_BYTES = 64 * 1024 ** 2;
function range(minimum: number, maximum: number, unit: string, step: number, taper = 'linear', integer = false) {
	return [minimum, maximum, { unit, step, taper, integer, automatable: false, automationBlockReason: reason }] as const;
}
function choice(options: string[]) { return { options, automatable: false, automationBlockReason: reason }; }

export const STANDARD_DELAY_EFFECT_DEFINITION = Object.freeze({
	defaults: { time: .3, echoGain: -6, echoes: 5, pitchShift: 0, mix: 1,
		delayType: 'regular', pitchQuality: 'smooth' },
	ranges: {
		time: range(0, 5, 's', .001),
		echoGain: range(-30, 1, 'dB', .1, 'decibel'),
		echoes: range(1, 30, 'echoes', 1, 'linear', true),
		pitchShift: range(-2, 2, 'semitones', .01),
		mix: range(0, 1, 'ratio', .01),
	},
	choices: {
		delayType: choice(['regular', 'bouncing-ball', 'reverse-bouncing-ball']),
		pitchQuality: choice(['fast', 'smooth']),
	},
});

export function normalizeStandardDelayParams(params: Readonly<Record<string, unknown>>) {
	const defaults: Readonly<Record<string, unknown>> = STANDARD_DELAY_EFFECT_DEFINITION.defaults;
	const result: Record<string, number | string> = {};
	for (const [name, [minimum, maximum, metadata]] of Object.entries(STANDARD_DELAY_EFFECT_DEFINITION.ranges)) {
		const value = Number(params[name] ?? defaults[name]);
		if (!Number.isFinite(value) || value < minimum || value > maximum) {
			throw new RangeError(`multi-tap-delay.${name} must be between ${String(minimum)} and ${String(maximum)}.`);
		}
		result[name] = metadata.integer ? Math.round(value) : value;
	}
	for (const [name, descriptor] of Object.entries(STANDARD_DELAY_EFFECT_DEFINITION.choices)) {
		const value = String(params[name] ?? defaults[name]);
		if (!descriptor.options.includes(value)) throw new RangeError(`Invalid multi-tap-delay.${name}.`);
		result[name] = value;
	}
	return result;
}

/** Finite taps use the Nyquist bouncing interval pattern, with a causal pitch window. */
export function standardDelayTailSeconds(params: Readonly<Record<string, unknown>>): number {
	const next = normalizeStandardDelayParams(params);
	if (Number(next.mix) === 0) return 0;
	const echoes = Number(next.echoes);
	const duration = Number(next.time) * (next.delayType === 'regular' ? echoes : (echoes + 1) / 2);
	return duration + (Number(next.pitchShift) === 0 ? 0 : next.pitchQuality === 'fast' ? .02 : .08);
}

/** Fresh processors reserve geometric capacity; live processors retain larger
 * history on shrink. Round toward the 64 MiB bound without rejecting a fit.
 */
export function standardDelayCapacityFrames(params: Readonly<Record<string, unknown>>,
	sampleRate: number, channelCount: number): number {
	if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
		throw new RangeError('sampleRate must be between 8000 and 384000 Hz.');
	}
	if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 32) {
		throw new RangeError('channelCount must be between 1 and 32.');
	}
	const required = Math.max(2, Math.ceil(standardDelayTailSeconds({ ...params, mix: 1 }) * sampleRate) + 2);
	const maximum = Math.floor(STANDARD_DELAY_MEMORY_LIMIT_BYTES / (channelCount * Float32Array.BYTES_PER_ELEMENT));
	if (required > maximum) throw new RangeError('The delay configuration exceeds the 64 MiB processor memory limit. Reduce time or echoes.');
	return Math.min(maximum, 2 ** Math.ceil(Math.log2(required)));
}
