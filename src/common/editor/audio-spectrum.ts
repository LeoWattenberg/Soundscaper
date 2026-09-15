/* SPDX-License-Identifier: AGPL-3.0-only */

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
	fftInPlace(real, imaginary);
	const bins = Array.from({ length: requestedSize / 2 + 1 }, (_, index) => {
		const amplitude = Math.hypot(real[index] ?? 0, imaginary[index] ?? 0) * 2 / requestedSize;
		return Object.freeze({ frequency: index * sampleRate / requestedSize, amplitude, db: amplitudeToDb(amplitude) });
	});
	return Object.freeze({ sampleRate, size: requestedSize, bins: Object.freeze(bins) });
}

function fftInPlace(real: Float64Array, imaginary: Float64Array): void {
	const length = real.length;
	for (let index = 1, reversed = 0; index < length; index += 1) {
		let bit = length >> 1;
		while (reversed & bit) { reversed ^= bit; bit >>= 1; }
		reversed ^= bit;
		if (index >= reversed) continue;
		[real[index], real[reversed]] = [real[reversed] ?? 0, real[index] ?? 0];
		[imaginary[index], imaginary[reversed]] = [imaginary[reversed] ?? 0, imaginary[index] ?? 0];
	}
	for (let size = 2; size <= length; size <<= 1) {
		const angle = -2 * Math.PI / size;
		const stepReal = Math.cos(angle);
		const stepImaginary = Math.sin(angle);
		for (let start = 0; start < length; start += size) {
			let weightReal = 1;
			let weightImaginary = 0;
			for (let index = 0; index < size / 2; index += 1) {
				const even = start + index;
				const odd = even + size / 2;
				const evenReal = real[even] ?? 0;
				const evenImaginary = imaginary[even] ?? 0;
				const oddReal = (real[odd] ?? 0) * weightReal - (imaginary[odd] ?? 0) * weightImaginary;
				const oddImaginary = (real[odd] ?? 0) * weightImaginary + (imaginary[odd] ?? 0) * weightReal;
				real[odd] = evenReal - oddReal;
				imaginary[odd] = evenImaginary - oddImaginary;
				real[even] = evenReal + oddReal;
				imaginary[even] = evenImaginary + oddImaginary;
				const nextWeightReal = weightReal * stepReal - weightImaginary * stepImaginary;
				weightImaginary = weightReal * stepImaginary + weightImaginary * stepReal;
				weightReal = nextWeightReal;
			}
		}
	}
}

export function validateAnalysisChannels(channels: unknown): asserts channels is readonly Float32Array[] {
	if (!Array.isArray(channels) || !channels.length || channels.some((channel: unknown) => !(channel instanceof Float32Array))) {
		throw new TypeError('Planar Float32 audio channels are required.');
	}
	const arrays = channels as readonly Float32Array[];
	if (arrays.some(channel => channel.length !== arrays[0]?.length)) throw new RangeError('Audio channels must have equal lengths.');
}
