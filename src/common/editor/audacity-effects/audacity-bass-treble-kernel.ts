/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Audacity 3.7.7's Bass and Treble shelving biquad, adapted from commit
 * 5ef610ed23260d6d648175735bb16b32536eb30b:
 * libraries/lib-builtin-effects/BassTrebleBase.cpp by Steve Daulton.
 * Audacity distributes that work under GPL; this modified TypeScript
 * adaptation was created for kw.media in 2026 and selects GPL version 3.
 */

export interface AudacityShelfCoefficients {
	readonly b0: number;
	readonly b1: number;
	readonly b2: number;
	readonly a0: number;
	readonly a1: number;
	readonly a2: number;
}

export function audacityShelfCoefficients(
	frequency: number,
	slope: number,
	gainDb: number,
	sampleRate: number,
	highShelf: boolean,
): AudacityShelfCoefficients {
	const omega = 2 * Math.PI * frequency / sampleRate;
	const amplitude = Math.exp(Math.log(10) * gainDb / 40);
	const beta = Math.sqrt((amplitude * amplitude + 1) / slope - (amplitude - 1) ** 2);
	const sine = Math.sin(omega);
	const cosine = Math.cos(omega);
	if (!highShelf) return {
		b0: amplitude * ((amplitude + 1) - (amplitude - 1) * cosine + beta * sine),
		b1: 2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cosine),
		b2: amplitude * ((amplitude + 1) - (amplitude - 1) * cosine - beta * sine),
		a0: (amplitude + 1) + (amplitude - 1) * cosine + beta * sine,
		a1: -2 * ((amplitude - 1) + (amplitude + 1) * cosine),
		a2: (amplitude + 1) + (amplitude - 1) * cosine - beta * sine,
	};
	return {
		b0: amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + beta * sine),
		b1: -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine),
		b2: amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - beta * sine),
		a0: (amplitude + 1) - (amplitude - 1) * cosine + beta * sine,
		a1: 2 * ((amplitude - 1) - (amplitude + 1) * cosine),
		a2: (amplitude + 1) - (amplitude - 1) * cosine - beta * sine,
	};
}

export function processAudacityShelfSample(
	input: number,
	coefficient: AudacityShelfCoefficients,
	state: number[],
): number {
	const output = Math.fround((coefficient.b0 * input
		+ coefficient.b1 * state[0]!
		+ coefficient.b2 * state[1]!
		- coefficient.a1 * state[2]!
		- coefficient.a2 * state[3]!) / coefficient.a0);
	state[1] = state[0]!;
	state[0] = input;
	state[3] = state[2]!;
	state[2] = output;
	return output;
}
