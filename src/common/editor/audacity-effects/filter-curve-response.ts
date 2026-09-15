/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Actual FIR response adapted from EqualizationPanel.cpp, Audacity
 * 5ef610ed23260d6d648175735bb16b32536eb30b. Mitch Golden, Vaughan Johnson,
 * Martyn Shaw, Paul Licameli; GPL-2.0-or-later, version 3 selected.
 * Browser adaptation for kw.media, 2026.
 */
import { initializePffft } from '../pffft.js';
import { buildEqualizationKernel } from './spectral-equalization-curves.js';
import { filterCurveGain, type FilterCurvePoint } from './filter-curve.ts';

/** The symmetric FIR's cosine response, including frequencies between FFT bins. */
export function filterCurveKernelGain(kernel: ArrayLike<number>, frequency: number, sampleRate: number): number {
	const half = (kernel.length - 1) / 2;
	const theta = 2 * Math.PI * frequency / sampleRate;
	const sine = Math.sin(theta / 2);
	const realStep = -2 * sine * sine;
	const imaginaryStep = -Math.sin(theta);
	let real = Math.cos(theta * half);
	let imaginary = Math.sin(theta * half);
	let gain = kernel[half]!;
	for (let tap = 0; tap < half; tap += 1) {
		gain += 2 * kernel[tap]! * real;
		const previous = real;
		real += real * realStep - imaginary * imaginaryStep;
		imaginary += imaginary * realStep + previous * imaginaryStep;
	}
	return 20 * Math.log10(Math.max(1e-12, Math.abs(gain)));
}

export async function filterCurveResponse(
	points: readonly FilterCurvePoint[], sampleRate: number, filterLength: number,
	linearFrequencyScale: boolean, frequencies: readonly number[],
): Promise<readonly FilterCurvePoint[]> {
	await initializePffft();
	const kernel = buildEqualizationKernel(sampleRate, filterLength,
		(frequency: number) => filterCurveGain(points, frequency, linearFrequencyScale));
	return frequencies.map((frequency) => ({
		frequency, gain: filterCurveKernelGain(kernel, frequency, sampleRate),
	}));
}
