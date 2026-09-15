/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StandardFilterEffectType, NormalizedStandardFilterParams } from './filters-definition.ts';

type Coefficients = readonly [b0: number, b1: number, b2: number, a1: number, a2: number];

function normalized(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Coefficients {
	return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

// Bilinear transforms of analog prototypes. Biquad/shelf equations are
// independently implemented from https://www.w3.org/TR/audio-eq-cookbook/.
// No Nyquist plug-in implementation is used here.
export function standardFilterCoefficients(type: StandardFilterEffectType, sampleRate: number, params: NormalizedStandardFilterParams): readonly Coefficients[] {
	const omega = 2 * Math.PI * Number(params.frequency) / sampleRate;
	const sine = Math.sin(omega);
	const cosine = Math.cos(omega);
	if (type === 'notch-filter') {
		const alpha = sine / (2 * Number(params.q));
		return [normalized(1, -2 * cosine, 1, 1 + alpha, -2 * cosine, 1 - alpha)];
	}
	if (type === 'shelf-filter') {
		if (Number(params.gain) === 0) return [[1, 0, 0, 0, 0]];
		const amplitude = 10 ** (Number(params.gain) / 40);
		const sum = amplitude + 1;
		const difference = amplitude - 1;
		// Shelf slope S = 1 gives a monotonic shelf for both boosts and cuts.
		const beta = sine * Math.sqrt(2 * amplitude);
		if (params.filterType === 'low') {
			return [normalized(
				amplitude * (sum - difference * cosine + beta),
				2 * amplitude * (difference - sum * cosine),
				amplitude * (sum - difference * cosine - beta),
				sum + difference * cosine + beta,
				-2 * (difference + sum * cosine),
				sum + difference * cosine - beta,
			)];
		}
		return [normalized(
			amplitude * (sum + difference * cosine + beta),
			-2 * amplitude * (difference + sum * cosine),
			amplitude * (sum + difference * cosine - beta),
			sum - difference * cosine + beta,
			2 * (difference - sum * cosine),
			sum - difference * cosine - beta,
		)];
	}
	const order = Number(params.rolloff) / 6;
	const highpass = type === 'highpass-filter';
	if (order === 1) {
		const tangent = Math.tan(omega / 2);
		const numerator = highpass ? 1 : tangent;
		return [normalized(numerator, highpass ? -numerator : numerator, 0, 1 + tangent, tangent - 1, 0)];
	}
	const stages: Coefficients[] = [];
	for (let stage = 0; stage < order / 2; stage++) {
		// Conjugate Butterworth poles give Q = 1/(2 sin((2k+1)pi/2N)).
		const q = 1 / (2 * Math.sin((2 * stage + 1) * Math.PI / (2 * order)));
		const alpha = sine / (2 * q);
		const numerator = highpass ? (1 + cosine) / 2 : (1 - cosine) / 2;
		stages.push(normalized(numerator, (highpass ? -2 : 2) * numerator, numerator,
			1 + alpha, -2 * cosine, 1 - alpha));
	}
	return stages;
}
