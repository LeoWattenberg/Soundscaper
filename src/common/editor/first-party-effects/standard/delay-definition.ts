/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertStandardDelayPitchNativeCapacity } from './delay-pitch-admission.ts';

const reason = 'This processor supports live controls but not timeline automation.';
export const STANDARD_DELAY_MEMORY_LIMIT_BYTES = 64 * 1024 ** 2;
export const STANDARD_DELAY_STAFFPAD_BLOCK_FRAMES = 1024;
function range(minimum: number, maximum: number, unit: string, step: number, taper = 'linear', integer = false) {
	return [minimum, maximum, { unit, step, taper, integer, automatable: false, automationBlockReason: reason }] as const;
}
function choice(options: string[]) { return { options, automatable: false, automationBlockReason: reason }; }

export const STANDARD_DELAY_EFFECT_DEFINITION = Object.freeze({
	defaults: { time: .3, echoGain: -6, echoes: 5, pitchShift: 0, mix: 1,
		delayType: 'regular' },
	ranges: {
		time: range(0, 5, 's', .001),
		echoGain: range(-30, 1, 'dB', .1, 'decibel'),
		echoes: range(1, 30, 'echoes', 1, 'linear', true),
		pitchShift: range(-2, 2, 'semitones', .01),
		mix: range(0, 1, 'ratio', .01),
	},
	choices: {
		delayType: choice(['regular', 'bouncing-ball', 'reverse-bouncing-ball']),
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

/** Each echo uses another streaming StaffPad pitch stage. Its hop-delivery
 * reserve is fixed, so arbitrary caller block boundaries cannot shift audio.
 */
export function standardDelayPitchStageLatencyFrames(params: Readonly<Record<string, unknown>>, sampleRate: number): number {
	const next = normalizeStandardDelayParams(params);
	if (Number(next.pitchShift) === 0) return 0;
	const fft = 2 ** (12 + Math.round(Math.log2(sampleRate / 44100)));
	const latency = fft - fft / 4 + 3;
	const ratio = Math.fround(2 ** (Number(next.pitchShift) / 12));
	const coefficient = Math.fround(ratio < 1 ? 1 / 3 : 2 / 3);
	const factor = Math.fround(Math.fround(ratio * coefficient) + Math.fround(1 - coefficient));
	return standardDelayPitchDeliveryFrames(next, sampleRate) + Math.trunc(Math.fround(latency * factor));
}

export function standardDelayPitchDeliveryFrames(params: Readonly<Record<string, unknown>>, sampleRate: number): number {
	const fft = 2 ** (12 + Math.round(Math.log2(sampleRate / 44100)));
	const ratio = 2 ** (Number(params.pitchShift ?? 0) / 12);
	return Math.ceil(fft / 4 * Math.max(1, 1 / ratio)) + STANDARD_DELAY_STAFFPAD_BLOCK_FRAMES + 1;
}

export function standardDelayPitchQueueFrames(params: Readonly<Record<string, unknown>>, sampleRate: number): number {
	const fft = 2 ** (12 + Math.round(Math.log2(sampleRate / 44100)));
	return 2 ** Math.ceil(Math.log2(2 * (fft + standardDelayPitchDeliveryFrames(params, sampleRate))));
}

export function standardDelayLatencyFrames(params: Readonly<Record<string, unknown>>, sampleRate: number): number {
	const next = normalizeStandardDelayParams(params);
	return Number(next.mix) === 0 ? 0 : Number(next.echoes) * standardDelayPitchStageLatencyFrames(next, sampleRate);
}

/** Finite taps use the Nyquist bouncing interval pattern. */
export function standardDelayTailSeconds(params: Readonly<Record<string, unknown>>): number {
	const next = normalizeStandardDelayParams(params);
	if (Number(next.mix) === 0) return 0;
	const echoes = Number(next.echoes);
	const duration = Number(next.time) * (next.delayType === 'regular' ? echoes : (echoes + 1) / 2);
	return duration + (Number(next.pitchShift) === 0 ? 0 : .2 * echoes);
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
	const next = normalizeStandardDelayParams(params);
	const pitched = Number(next.pitchShift) !== 0;
	if (pitched && sampleRate > 192000) throw new RangeError('StaffPad pitched delay supports sample rates up to 192000 Hz.');
	if (pitched) assertStandardDelayPitchNativeCapacity(sampleRate, channelCount, Number(next.echoes));
	const latency = standardDelayLatencyFrames({ ...next, mix: 1 }, sampleRate);
	const required = Math.max(2, Math.ceil(standardDelayTailSeconds({ ...next, pitchShift: 0, mix: 1 }) * sampleRate) + latency + 2);
	const ringCount = pitched ? Number(next.echoes) + 1 : 1;
	const maximum = Math.floor(STANDARD_DELAY_MEMORY_LIMIT_BYTES / (ringCount * channelCount * Float32Array.BYTES_PER_ELEMENT));
	if (required > maximum) throw new RangeError('The delay configuration exceeds the 64 MiB processor memory limit. Reduce time or echoes.');
	return Math.min(maximum, 2 ** Math.ceil(Math.log2(required)));
}
