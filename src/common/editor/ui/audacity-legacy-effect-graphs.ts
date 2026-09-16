/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Audacity 3.7.7 wx effect diagrams adapted from LegacyCompressor.cpp (Dominic
 * Mazzoni, Martyn Shaw), AutoDuck.cpp (Markus Meyer) and ScienFilter.cpp (Norm C,
 * Mitch Golden, Vaughan Johnson), revision 5ef610ed23260d6d648175735bb16b32536eb30b.
 * Classic Filters evaluates the same biquads as the browser audio processor.
 */

import { classicFilterCoefficients } from '../audacity-effects/classic-filter-coefficients.js';

export interface AudacityGraphPoint { readonly x: number; readonly y: number }
interface GraphResponse { readonly line: string; readonly points: readonly AudacityGraphPoint[] }
export interface AudacityDuckControl extends AudacityGraphPoint {
	readonly id: string;
	readonly value: number;
	readonly unit: 's' | 'dB';
	readonly above: boolean;
}
interface BiquadSection {
	readonly b0: number; readonly b1: number; readonly b2: number;
	readonly a1: number; readonly a2: number;
}

function parameter(value: unknown, fallback: number, minimum: number, maximum: number): number {
	const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
	return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function line(points: readonly AudacityGraphPoint[]): string {
	return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${Number(point.x.toFixed(4))} ${Number(point.y.toFixed(4))}`).join(' ');
}

/** The original wx diagram always normalizes its final output to 0 dB. */
export function audacityLegacyCompressorResponse(parameters: Readonly<Record<string, unknown>>): GraphResponse {
	const threshold = parameter(parameters.thresholdDb, -12, -60, -1);
	const ratio = parameter(parameters.ratio, 2, 1.1, 10);
	const makeup = threshold * (1 / ratio - 1);
	const points = [
		{ x: 0, y: 100 - makeup / 60 * 100 },
		{ x: (60 + threshold) / 60 * 100, y: -threshold / ratio / 60 * 100 },
		{ x: 100, y: 0 },
	];
	return { points, line: line(points) };
}

/** Exact 600×300 wx preview geometry, including its integer pixel truncation. */
export function audacityAutoDuckEnvelope(parameters: Readonly<Record<string, unknown>>): GraphResponse & { readonly controls: readonly AudacityDuckControl[] } {
	const amount = parameter(parameters.duckAmountDb, -12, -24, 0);
	const outerDown = parameter(parameters.outerFadeDown, 0.5, 0, 3);
	const outerUp = parameter(parameters.outerFadeUp, 0.5, 0, 3);
	const innerDown = parameter(parameters.innerFadeDown, 0, 0, 3);
	const innerUp = parameter(parameters.innerFadeUp, 0, 0, 3);
	const lowered = 50 - Math.trunc(amount * 8);
	const points = [
		{ x: 10, y: 50 },
		{ x: 150 - Math.trunc(outerDown * 40), y: 50 },
		{ x: 150 + Math.trunc(innerDown * 40), y: lowered },
		{ x: 450 - Math.trunc(innerUp * 40), y: lowered },
		{ x: 450 + Math.trunc(outerUp * 40), y: 50 },
		{ x: 590, y: 50 },
	];
	return { points, line: line(points), controls: [
		{ id: 'outerFadeDown', ...points[1]!, value: outerDown, unit: 's', above: true },
		{ id: 'innerFadeDown', ...points[2]!, value: innerDown, unit: 's', above: false },
		{ id: 'innerFadeUp', ...points[3]!, value: innerUp, unit: 's', above: false },
		{ id: 'outerFadeUp', ...points[4]!, value: outerUp, unit: 's', above: true },
		{ id: 'duckAmountDb', x: Math.trunc((points[2]!.x + points[3]!.x) / 2), y: lowered, value: amount, unit: 'dB', above: true },
	] };
}

function filterSections(parameters: Readonly<Record<string, unknown>>, sampleRate: number): readonly BiquadSection[] {
	return classicFilterCoefficients({
		family: parameters.family === 'chebyshev-i' || parameters.family === 'chebyshev-ii' ? parameters.family : 'butterworth',
		direction: parameters.direction === 'highpass' ? 'highpass' : 'lowpass',
		order: Math.round(parameter(parameters.order, 1, 1, 10)),
		cutoffHz: parameter(parameters.cutoffHz, 1000, 1, 23_999),
		passbandRippleDb: parameter(parameters.passbandRippleDb, 1, 0, 100),
		stopbandAttenuationDb: parameter(parameters.stopbandAttenuationDb, 30, 0, 100),
	}, sampleRate / 2) as readonly BiquadSection[];
}

function filterGainDb(sections: readonly BiquadSection[], frequency: number, sampleRate: number): number {
	const angle = 2 * Math.PI * frequency / sampleRate;
	const cos = Math.cos(angle); const sin = Math.sin(angle);
	const cos2 = Math.cos(2 * angle); const sin2 = Math.sin(2 * angle);
	let gainDb = 0;
	for (const section of sections) {
		const realNumerator = section.b0 + section.b1 * cos + section.b2 * cos2;
		const imaginaryNumerator = -section.b1 * sin - section.b2 * sin2;
		const realDenominator = 1 + section.a1 * cos + section.a2 * cos2;
		const imaginaryDenominator = -section.a1 * sin - section.a2 * sin2;
		const power = (realNumerator ** 2 + imaginaryNumerator ** 2) / (realDenominator ** 2 + imaginaryDenominator ** 2);
		gainDb += 10 * Math.log10(Math.max(1e-24, power));
	}
	return gainDb;
}

export function audacityClassicFilterGainDb(parameters: Readonly<Record<string, unknown>>, frequency: number, sampleRate = 48_000): number {
	const rate = parameter(sampleRate, 48_000, 8000, 384_000);
	return filterGainDb(filterSections(parameters, rate), parameter(frequency, 20, 0, rate / 2), rate);
}

/** Logarithmic response, retaining the wx graph's default -30..+20 dB range. */
export function audacityClassicFilterResponse(
	parameters: Readonly<Record<string, unknown>>, sampleRate = 48_000,
	options: { readonly minimumDb?: number; readonly maximumDb?: number } = {},
): GraphResponse & { readonly minimumFrequency: number; readonly maximumFrequency: number } {
	const rate = parameter(sampleRate, 48_000, 8000, 384_000);
	const minimumDb = parameter(options.minimumDb, -30, -120, -10);
	const maximumDb = parameter(options.maximumDb, 20, 0, 20);
	const minimumFrequency = 20;
	const maximumFrequency = rate / 2;
	const frequencyRange = Math.log(maximumFrequency / minimumFrequency);
	const sections = filterSections(parameters, rate);
	const points = Array.from({ length: 400 }, (_, index) => {
		const x = index / 399;
		const frequency = minimumFrequency * Math.exp(x * frequencyRange);
		const gainDb = filterGainDb(sections, frequency, rate);
		return { x: x * 100, y: Math.max(0, Math.min(100, (maximumDb - gainDb) / (maximumDb - minimumDb) * 100)) };
	});
	return { points, line: line(points), minimumFrequency, maximumFrequency };
}
