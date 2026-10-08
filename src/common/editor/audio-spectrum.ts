/* SPDX-License-Identifier: AGPL-3.0-only */

import { fftRadixTwoFloat64V1 } from './assistance/internal/radix-two-fft-v1.ts';

export const ANALYSIS_FLOOR_DB = -120;

// Twelve accepted powers of two occupy less than one MiB in total.
interface HannWindow { readonly samples: Float64Array; readonly sum: number }
const hannWindows = new Map<number, HannWindow>();
const nativeSampleLength = Object.getOwnPropertyDescriptor(
	Object.getPrototypeOf(Float32Array.prototype) as object, 'length',
)!.get as (this: Float32Array) => number;
interface SpectrumWorkspace {
	readonly real: Float64Array;
	readonly imaginary: Float64Array;
	readonly powers: Float64Array;
	busy: boolean;
}
// One private workspace per accepted geometry, less than 3 MiB in total.
const workspaces = new Map<number, SpectrumWorkspace>();
function acquireWorkspace(size: number): SpectrumWorkspace {
	const existing = workspaces.get(size);
	if (existing && !existing.busy) { existing.busy = true; existing.powers.fill(0); return existing; }
	const workspace = { real: new Float64Array(size), imaginary: new Float64Array(size), powers: new Float64Array(size / 2 + 1), busy: true };
	if (!existing) workspaces.set(size, workspace);
	return workspace;
}
function hannWindow(size: number): HannWindow {
	const existing = hannWindows.get(size);
	if (existing) return existing;
	let sum = 0;
	const samples = Float64Array.from({ length: size }, (_, index) => {
		const weight = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (size - 1));
		sum += weight;
		return weight;
	});
	const window = Object.freeze({ samples, sum });
	hannWindows.set(size, window);
	return window;
}

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
	const workspace = acquireWorkspace(requestedSize);
	const { real, imaginary, powers } = workspace;
	try {
	const { samples: window, sum: windowSum } = hannWindow(requestedSize);
	const windowCount = options.average ? Math.max(1, Math.ceil((frameCount - offset) / (requestedSize / 2))) : 1;
	for (let block = 0; block < windowCount; block += 1) {
		const start = offset + block * (requestedSize / 2);
		for (const channel of channels) {
			const nativeLength = ArrayBuffer.isView(channel) && nativeSampleLength.call(channel) === frameCount;
			const sourceFrames = Number.isInteger(start) && nativeLength ? Math.min(requestedSize, frameCount - start) : requestedSize;
			for (let index = 0; index < sourceFrames; index += 1) {
				const value = channel[start + index] ?? 0;
				real[index] = (Number.isFinite(value) ? value : 0) * window[index]!;
			}
			real.fill(0, sourceFrames);
			imaginary.fill(0);
			fftRadixTwoFloat64V1(real, imaginary, false);
			for (let index = 0; index < powers.length; index += 1) {
				powers[index] = powers[index]! + real[index]! ** 2 + imaginary[index]! ** 2;
			}
		}
	}
	const bins = Array.from({ length: requestedSize / 2 + 1 }, (_, index) => {
		const oneSidedScale = index === 0 || index === requestedSize / 2 ? 1 : 2;
		const amplitude = Math.sqrt(powers[index]! / (channels.length * windowCount)) * oneSidedScale / windowSum;
		return Object.freeze({ frequency: index * sampleRate / requestedSize, amplitude, db: amplitudeToDb(amplitude) });
	});
	return Object.freeze({ sampleRate, size: requestedSize, bins: Object.freeze(bins) });
	} finally { workspace.busy = false; }
}

export function validateAnalysisChannels(channels: unknown): asserts channels is readonly Float32Array[] {
	if (!Array.isArray(channels) || !channels.length || channels.some((channel: unknown) => !(channel instanceof Float32Array))) {
		throw new TypeError('Planar Float32 audio channels are required.');
	}
	const arrays = channels as readonly Float32Array[];
	if (arrays.some(channel => channel.length !== arrays[0]?.length)) throw new RangeError('Audio channels must have equal lengths.');
}
