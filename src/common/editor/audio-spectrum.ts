/* SPDX-License-Identifier: AGPL-3.0-only */

import { fftRadixTwoFloat64V1 } from './assistance/internal/radix-two-fft-v1.ts';

export const ANALYSIS_FLOOR_DB = -120;

export function amplitudeToDb(amplitude: number): number {
	return amplitude > 0 ? Math.max(ANALYSIS_FLOOR_DB, 20 * Math.log10(amplitude)) : ANALYSIS_FLOOR_DB;
}

/** Windowed radix-2 spectrum shared by Plot Spectrum and spectral selection gestures. */
export function calculateAudioSpectrum(
	channels: readonly Float32Array[], sampleRate: number, options: Readonly<{ size?: number; offsetFrame?: number; average?: boolean }> = {},
) {
	validateAnalysisChannels(channels);
	if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('Spectrum sample rate must be positive.');
	const requestedSize = Number(options.size ?? 2_048);
	if (!Number.isSafeInteger(requestedSize) || requestedSize < 32 || requestedSize > 65_536 || (requestedSize & (requestedSize - 1))) {
		throw new RangeError('Spectrum size must be a power of two from 32 through 65536.');
	}
	const frameCount = channels[0]?.length ?? 0;
	const offset = Math.max(0, Math.min(frameCount, Number(options.offsetFrame) || 0));
	const real = new Float64Array(requestedSize);
	const imaginary = new Float64Array(requestedSize);
	const powers = new Float64Array(requestedSize / 2 + 1);
	const window = Float64Array.from({ length: requestedSize }, (_, index) =>
		0.5 - 0.5 * Math.cos(2 * Math.PI * index / (requestedSize - 1)));
	const windowCount = options.average ? Math.max(1, Math.ceil((frameCount - offset) / (requestedSize / 2))) : 1;
	for (let block = 0; block < windowCount; block += 1) {
		const start = offset + block * (requestedSize / 2);
		for (const channel of channels) {
			for (let index = 0; index < requestedSize; index += 1) {
				const value = channel[start + index] ?? 0;
				real[index] = (Number.isFinite(value) ? value : 0) * window[index]!;
			}
			imaginary.fill(0);
			fftRadixTwoFloat64V1(real, imaginary, false);
			for (let index = 0; index < powers.length; index += 1) {
				powers[index] = powers[index]! + real[index]! ** 2 + imaginary[index]! ** 2;
			}
		}
	}
	const bins = Array.from({ length: requestedSize / 2 + 1 }, (_, index) => {
		const amplitude = Math.sqrt(powers[index]! / (channels.length * windowCount)) * 2 / requestedSize;
		return Object.freeze({ frequency: index * sampleRate / requestedSize, amplitude, db: amplitudeToDb(amplitude) });
	});
	return Object.freeze({ sampleRate, size: requestedSize, bins: Object.freeze(bins) });
}

export function validateAnalysisChannels(channels: unknown): asserts channels is readonly Float32Array[] {
	if (!Array.isArray(channels) || !channels.length || channels.some((channel: unknown) => !(channel instanceof Float32Array))) {
		throw new TypeError('Planar Float32 audio channels are required.');
	}
	const arrays = channels as readonly Float32Array[];
	if (arrays.some(channel => channel.length !== arrays[0]?.length)) throw new RangeError('Audio channels must have equal lengths.');
}
