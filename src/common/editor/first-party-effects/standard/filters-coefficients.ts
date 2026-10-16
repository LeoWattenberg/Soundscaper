/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StandardFilterEffectType, NormalizedStandardFilterParams } from './filters-definition.ts';

export type NormalizedIirCoefficients = readonly [b0: number, b1: number, b2: number, a1: number, a2: number];

type Coefficients = NormalizedIirCoefficients;

function normalized(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Coefficients {
	return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

// Bilinear transforms of analog prototypes. Biquad/shelf equations are
// independently implemented from https://www.w3.org/TR/audio-eq-cookbook/.
// No Nyquist plug-in implementation is used here.
export function standardFilterCoefficients(type: StandardFilterEffectType, sampleRate: number, params: NormalizedStandardFilterParams): readonly Coefficients[] {
	const omega = 2 * Math.PI * Number(params.frequency) / sampleRate;
	if (type === 'shelf-filter' && Number(params.gain) === 0) return [[1, 0, 0, 0, 0]];
	const order = Number(params.rolloff) / 6;
	const highpass = type === 'highpass-filter';
	if ((type === 'lowpass-filter' || highpass) && order === 1) {
		const tangent = Math.tan(omega / 2);
		const numerator = highpass ? 1 : tangent;
		return [normalized(numerator, highpass ? -numerator : numerator, 0, 1 + tangent, tangent - 1, 0)];
	}
	const sine = Math.sin(omega);
	const cosine = Math.cos(omega);
	if (type === 'notch-filter') {
		const alpha = sine / (2 * Number(params.q));
		return [normalized(1, -2 * cosine, 1, 1 + alpha, -2 * cosine, 1 - alpha)];
	}
	if (type === 'shelf-filter') {
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

function maximumPoleMagnitude(a1: number, a2: number): number {
	if (a2 === 0) return Math.abs(a1);
	const discriminant = a1 * a1 - 4 * a2;
	if (discriminant < 0) return Math.sqrt(a2);
	const root = -.5 * (a1 + (a1 < 0 ? -1 : 1) * Math.sqrt(discriminant));
	return Math.max(Math.abs(root), root === 0 ? 0 : Math.abs(a2 / root));
}

/** Bound a charged cascade's release below -80 dB for input peaks at one.
 * The binomial envelope handles distinct, conjugate and repeated poles.
 */
export function iirReleaseBoundFrames(coefficients: readonly NormalizedIirCoefficients[]): number {
	let radius = 0;
	let poles = 0;
	let degree = 0;
	let logNumerator = Math.log(4);
	for (const [b0, b1, b2, a1, a2] of coefficients) {
		radius = Math.max(radius, maximumPoleMagnitude(a1, a2));
		poles += a2 !== 0 ? 2 : a1 !== 0 ? 1 : 0;
		degree += b2 !== 0 ? 2 : b1 !== 0 ? 1 : 0;
		logNumerator += Math.log(Math.abs(b0) + Math.abs(b1) + Math.abs(b2));
	}
	if (radius === 0 || poles === 0) return degree;
	if (!Number.isFinite(radius) || radius >= 1) throw new RangeError('The filter poles must be stable to estimate their release.');
	const logRadius = Math.log(radius);
	const logTarget = Math.log(.0001);
	const logReleaseBound = (frames: number): number => {
		const lag = frames + 1;
		if (lag < degree) return Infinity;
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
	return upper + 1;
}
