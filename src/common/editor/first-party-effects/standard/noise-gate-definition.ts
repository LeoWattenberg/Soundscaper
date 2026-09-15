/* SPDX-License-Identifier: AGPL-3.0-only */

const reason = 'This processor supports live controls but not timeline automation.';
function range(minimum: number, maximum: number, unit: string, step: number, taper = 'linear') {
	return [minimum, maximum, { unit, step, taper, automatable: false, automationBlockReason: reason }] as const;
}

export const NOISE_GATE_EFFECT_DEFINITION = Object.freeze({
	defaults: { threshold: -40, attack: .01, hold: .05, release: .1, rangeDb: -24,
		gateFrequency: 0, stereoLink: 'linked' },
	ranges: {
		threshold: range(-96, -6, 'dB', .1, 'decibel'),
		attack: range(.001, 1, 's', .001, 'logarithmic'),
		hold: range(0, 2, 's', .001),
		release: range(.01, 4, 's', .001, 'logarithmic'),
		rangeDb: range(-100, 0, 'dB', .1, 'decibel'),
		gateFrequency: range(0, 10000, 'Hz', 1),
	},
	choices: { stereoLink: { options: ['linked', 'independent'], automatable: false,
		automationBlockReason: reason } },
});

export function normalizeNoiseGateParams(params: Readonly<Record<string, unknown>>): Record<string, number | string> {
	const defaults: Readonly<Record<string, unknown>> = NOISE_GATE_EFFECT_DEFINITION.defaults;
	const result: Record<string, number | string> = {};
	for (const [name, [minimum, maximum]] of Object.entries(NOISE_GATE_EFFECT_DEFINITION.ranges)) {
		const value = Number(params[name] ?? defaults[name]);
		if (!Number.isFinite(value) || value < minimum || value > maximum) {
			throw new RangeError(`noise-gate.${name} must be between ${String(minimum)} and ${String(maximum)}.`);
		}
		result[name] = value;
	}
	const stereoLink = params.stereoLink ?? defaults.stereoLink;
	if (stereoLink !== 'linked' && stereoLink !== 'independent') throw new RangeError('Invalid noise-gate.stereoLink.');
	return { ...result, stereoLink };
}

/** Silent release for bounded source PCM with fixed gate controls. Each
 * crossover has H(z)=c(1+z^-1)/(1-a*z^-1), c=k/(1+k), a=1-2c.
 * The two-filter inverse denominator tail is
 * r^n*(1+n*(1-r))/(1-r)^2, where r=abs(a). Multiplying the numerator
 * sum gives max(1,k^2); exp(-x)*(1+x) conservatively bounds that tail.
 * Gain reduction never exceeds 1-floor, and two samples cover the numerator.
 */
export function standardNoiseGateTailSeconds(params: Readonly<Record<string, unknown>>, sampleRate = 48000): number {
	if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) throw new RangeError('Invalid sample rate.');
	const settings = normalizeNoiseGateParams(params);
	const frequency = Number(settings.gateFrequency);
	if (frequency >= sampleRate / 2) throw new RangeError('noise-gate.gateFrequency must be below the Nyquist frequency.');
	const rangeDb = Number(settings.rangeDb);
	if (frequency === 0 || rangeDb === 0) return 0;
	const k = Math.tan(Math.PI * Math.min(frequency, sampleRate * .45) / sampleRate);
	const coefficient = k / (1 + k);
	const radius = Math.abs(1 - 2 * coefficient);
	if (radius === 0) return 2 / sampleRate;
	const floor = rangeDb <= -96 ? 0 : 10 ** (rangeDb / 20);
	const threshold = .0001 / ((1 - floor) * Math.max(1, k * k));
	let lower = 0;
	let upper = 64;
	for (let iteration = 0; iteration < 32; iteration++) {
		const x = (lower + upper) / 2;
		if (Math.exp(-x) * (1 + x) > threshold) lower = x;
		else upper = x;
	}
	return upper / (-sampleRate * Math.log(radius)) + 2 / sampleRate;
}
