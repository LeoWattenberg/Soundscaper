/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeStandardFilterParams,
	isStandardFilterEffect,
	type StandardFilterEffectType,
} from './filters-definition.ts';
import { standardFilterCoefficients } from './filters-coefficients.ts';

export interface StandardFilterProcessorOptions {
	type: StandardFilterEffectType;
	sampleRate: number;
	channelCount: number;
	params: Readonly<Record<string, unknown>>;
}

export interface StandardFilterProcessor {
	reset(): void;
	updateParams(params: Readonly<Record<string, unknown>>): void;
	processBlock(input: readonly Float32Array[], output: readonly Float32Array[], frames: number): void;
}

export function createStandardFilterProcessor(options: StandardFilterProcessorOptions): StandardFilterProcessor {
	const { type, sampleRate, channelCount } = options;
	if (!isStandardFilterEffect(type)) throw new RangeError(`Unsupported standard filter: ${String(type)}.`);
	if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384_000) throw new RangeError('The sample rate must be between 8000 and 384000 Hz.');
	if (!Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 32) throw new RangeError('The channel count must be an integer between 1 and 32.');
	let params = normalizeStandardFilterParams(type, sampleRate, options.params);
	let coefficients = standardFilterCoefficients(type, sampleRate, params);
	let state = new Float64Array(channelCount * coefficients.length * 2);
	return {
		reset() { state.fill(0); },
		updateParams(nextParams) {
			const next = normalizeStandardFilterParams(type, sampleRate, { ...params, ...nextParams });
			const nextCoefficients = standardFilterCoefficients(type, sampleRate, next);
			if (nextCoefficients.length !== coefficients.length) state = new Float64Array(channelCount * nextCoefficients.length * 2);
			params = next;
			coefficients = nextCoefficients;
		},
		processBlock(input, output, frames) {
			if (!Number.isSafeInteger(frames) || frames < 0 || input.length > channelCount || output.length !== channelCount) {
				throw new RangeError('The filter block must match its channel count and provide a buffer for every frame.');
			}
			for (let channel = 0; channel < channelCount; channel++) {
				if ((input[channel] && input[channel].length < frames) || output[channel].length < frames) {
					throw new RangeError('The filter block must provide a buffer for every frame.');
				}
			}
			// Direct form II transposed, retaining double precision state between
			// calls. There are no allocations or coefficient calculations here.
			for (let channel = 0; channel < channelCount; channel++) {
				for (let frame = 0; frame < frames; frame++) {
					const sample = input[channel]?.[frame] ?? 0;
					let value = Number.isFinite(sample) ? sample : 0;
					for (let stage = 0; stage < coefficients.length; stage++) {
						const coefficient = coefficients[stage];
						const index = (channel * coefficients.length + stage) * 2;
						const filtered = coefficient[0] * value + state[index];
						state[index] = coefficient[1] * value - coefficient[3] * filtered + state[index + 1];
						state[index + 1] = coefficient[2] * value - coefficient[4] * filtered;
						value = filtered;
					}
					output[channel][frame] = value;
				}
			}
		},
	};
}
