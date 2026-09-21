/* SPDX-License-Identifier: AGPL-3.0-only */

import { fftRadixTwoFloat64V1 } from './assistance/internal/radix-two-fft-v1.ts';

export const ANALYSIS_FLOOR_DB = -120;

export function amplitudeToDb(amplitude: number): number {
	return amplitude > 0 ? Math.max(ANALYSIS_FLOOR_DB, 20 * Math.log10(amplitude)) : ANALYSIS_FLOOR_DB;
}

/** Windowed radix-2 spectrum shared by Plot Spectrum and spectral selection gestures. */
export function calculateAudioSpectrum(
	channels: readonly Float32Array[], sampleRate: number, options: Readonly<{ size?: number; offsetFrame?: number }> = {},
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
	for (let index = 0; index < requestedSize; index += 1) {
		const frame = offset + index;
		let sample = 0;
		if (frame < frameCount) for (const channel of channels) sample += (channel[frame] ?? 0) / channels.length;
		const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (requestedSize - 1));
		real[index] = sample * window;
	}
	fftRadixTwoFloat64V1(real, imaginary, false);
	const bins = Array.from({ length: requestedSize / 2 + 1 }, (_, index) => {
		const amplitude = Math.hypot(real[index] ?? 0, imaginary[index] ?? 0) * 2 / requestedSize;
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
