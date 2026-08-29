/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeSpectrogramScale,
	type SpectrogramScale,
} from './geometry.ts';

const DEFAULT_SAMPLE_RATE = 48_000;
const DEFAULT_MAXIMUM_FREQUENCY = 20_000;
const DEFAULT_WINDOW_SIZE = 2_048;
const DEFAULT_GAIN_DB = 20;
const DEFAULT_RANGE_DB = 80;

export type SpectrogramCanvasWindowType = 'hann' | 'hamming' | 'blackman';

export interface SpectrogramCanvasSettings {
	readonly scale?: unknown;
	readonly minimumFrequency?: unknown;
	readonly maximumFrequency?: unknown;
	readonly windowSize?: unknown;
	readonly windowType?: unknown;
	readonly gain?: unknown;
	readonly range?: unknown;
}

export interface SpectrogramCanvasOptions {
	readonly scale: SpectrogramScale;
	readonly minFreq: number;
	readonly maxFreq: number;
	readonly fftWindowSize: number;
	readonly windowType: SpectrogramCanvasWindowType;
	readonly gainDb: number;
	readonly rangeDb: number;
	readonly sampleRate: number;
}

export function createSpectrogramCanvasOptions(
	settings: SpectrogramCanvasSettings | null | undefined,
	sampleRateValue: unknown,
): SpectrogramCanvasOptions {
	const sampleRate = finitePositiveOr(sampleRateValue, DEFAULT_SAMPLE_RATE);
	const nyquistFrequency = sampleRate / 2;
	let minFreq = clamp(finiteOr(settings?.minimumFrequency, 0), 0, nyquistFrequency);
	let maxFreq = clamp(
		finiteOr(settings?.maximumFrequency, Math.min(DEFAULT_MAXIMUM_FREQUENCY, nyquistFrequency)),
		0,
		nyquistFrequency,
	);
	if (maxFreq <= minFreq) {
		minFreq = 0;
		maxFreq = Math.min(DEFAULT_MAXIMUM_FREQUENCY, nyquistFrequency);
	}
	return Object.freeze({
		scale: normalizeSpectrogramScale(settings?.scale),
		minFreq,
		maxFreq,
		fftWindowSize: powerOfTwoOr(settings?.windowSize, DEFAULT_WINDOW_SIZE),
		windowType: normalizeWindowType(settings?.windowType),
		gainDb: clamp(finiteOr(settings?.gain, DEFAULT_GAIN_DB), -120, 120),
		rangeDb: clamp(finiteOr(settings?.range, DEFAULT_RANGE_DB), 1, 240),
		sampleRate,
	});
}

export function spectrogramCanvasDrawKey(options: SpectrogramCanvasOptions): string {
	return JSON.stringify([
		options.scale,
		options.minFreq,
		options.maxFreq,
		options.fftWindowSize,
		options.windowType,
		options.gainDb,
		options.rangeDb,
		options.sampleRate,
	]);
}

function normalizeWindowType(value: unknown): SpectrogramCanvasWindowType {
	const windowType = String(value || 'hann').toLowerCase();
	if (windowType === 'hamming' || windowType === 'blackman') return windowType;
	return 'hann';
}

function powerOfTwoOr(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isSafeInteger(number) && number >= 32 && (number & (number - 1)) === 0
		? number
		: fallback;
}

function finiteOr(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function finitePositiveOr(value: unknown, fallback: number): number {
	const number = finiteOr(value, fallback);
	return number > 0 ? number : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}
