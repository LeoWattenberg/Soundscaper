/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Deterministic Beat This v1.1.0 preprocessing.
 *
 * Source authority:
 * https://github.com/CPJKU/beat_this/blob/ad7974846029835307ba19a3d5cefbf40b243041/beat_this/preprocessing.py
 * The owned implementation closes that source's torchaudio parameters without
 * importing Python into the authenticated ONNX runtime family.
 */

export const ASSISTANCE_BEAT_THIS_SAMPLE_RATE = 22_050 as const;
export const ASSISTANCE_BEAT_THIS_FFT_SIZE = 1_024 as const;
export const ASSISTANCE_BEAT_THIS_HOP_SAMPLES = 441 as const;
export const ASSISTANCE_BEAT_THIS_MEL_BINS = 128 as const;

const HALF_FFT = ASSISTANCE_BEAT_THIS_FFT_SIZE / 2;
const MINIMUM_FREQUENCY_HZ = 30;
const MAXIMUM_FREQUENCY_HZ = 11_000;
const LOG_MULTIPLIER = 1_000;
const MAXIMUM_RANGE_FRAMES = 1_500;
const CANCELLATION_FRAME_INTERVAL = 16;
const HANN_WINDOW = periodicHann();
const MEL_FILTER_BANK = slaneyMelFilterBank();

export interface AssistanceBeatThisLogMelV1 {
	readonly frameCount: number;
	readonly melBins: typeof ASSISTANCE_BEAT_THIS_MEL_BINS;
	/** Row-major [frame, mel-bin] Float32 values. */
	readonly values: Float32Array;
}

export interface AssistanceBeatThisPcmSourceV1 {
	readonly sampleCount: number;
	readSamples(
		startSample: number,
		sampleCount: number,
		signal?: AbortSignal,
	): PromiseLike<Float32Array>;
}

export async function createAssistanceBeatThisLogMelV1(
	samples: Float32Array,
	signal?: AbortSignal,
): Promise<AssistanceBeatThisLogMelV1> {
	if (!(samples instanceof Float32Array) || samples.length <= HALF_FFT) {
		throw new RangeError('Beat This PCM length cannot satisfy exact reflect-padded STFT geometry.');
	}
	const frameCount = Math.floor(samples.length / ASSISTANCE_BEAT_THIS_HOP_SAMPLES) + 1;
	const values = new Float32Array(frameCount * ASSISTANCE_BEAT_THIS_MEL_BINS);
	const source: AssistanceBeatThisPcmSourceV1 = Object.freeze({
		sampleCount: samples.length,
		readSamples: (startSample: number, sampleCount: number) => Promise.resolve(
			samples.subarray(startSample, startSample + sampleCount),
		),
	});
	for (let frameStart = 0; frameStart < frameCount; frameStart += MAXIMUM_RANGE_FRAMES) {
		const range = await createAssistanceBeatThisLogMelRangeV1(
			source, frameStart, Math.min(MAXIMUM_RANGE_FRAMES, frameCount - frameStart), signal,
		);
		values.set(range.values, frameStart * ASSISTANCE_BEAT_THIS_MEL_BINS);
	}
	signal?.throwIfAborted();
	return Object.freeze({ frameCount, melBins: ASSISTANCE_BEAT_THIS_MEL_BINS, values });
}

/** Compute only one overlap-owned model range from a bounded positioned PCM source. */
export async function createAssistanceBeatThisLogMelRangeV1(
	source: AssistanceBeatThisPcmSourceV1,
	frameStart: number,
	frameCount: number,
	signal?: AbortSignal,
): Promise<AssistanceBeatThisLogMelV1> {
	assertRangeRequest(source, frameStart, frameCount, signal);
	const firstCenter = frameStart * ASSISTANCE_BEAT_THIS_HOP_SAMPLES;
	const lastCenter = (frameStart + frameCount - 1) * ASSISTANCE_BEAT_THIS_HOP_SAMPLES;
	const firstWindowSample = firstCenter - HALF_FFT;
	const lastWindowSample = lastCenter + HALF_FFT - 1;
	let readStart = Math.max(0, firstWindowSample);
	let readEnd = Math.min(source.sampleCount, lastWindowSample + 1);
	if (lastWindowSample >= source.sampleCount) {
		readStart = Math.min(readStart, reflectedIndex(lastWindowSample, source.sampleCount));
	}
	if (firstWindowSample < 0) {
		readEnd = Math.max(readEnd, reflectedIndex(firstWindowSample, source.sampleCount) + 1);
	}
	signal?.throwIfAborted();
	const samples = await source.readSamples(readStart, readEnd - readStart, signal);
	signal?.throwIfAborted();
	if (!(samples instanceof Float32Array) || samples.length !== readEnd - readStart) {
		throw new RangeError('Beat This PCM source returned inexact ranged geometry.');
	}
	for (const sample of samples) {
		if (!Number.isFinite(sample)) {
			throw new RangeError('Every Beat This PCM sample must be finite.');
		}
	}
	const values = new Float32Array(frameCount * ASSISTANCE_BEAT_THIS_MEL_BINS);
	const real = new Float32Array(ASSISTANCE_BEAT_THIS_FFT_SIZE);
	const imaginary = new Float32Array(ASSISTANCE_BEAT_THIS_FFT_SIZE);
	const magnitude = new Float32Array(HALF_FFT + 1);
	for (let frame = 0; frame < frameCount; frame += 1) {
		signal?.throwIfAborted();
		fillWindowedFrame(real, imaginary, samples, readStart,
			frameStart + frame, source.sampleCount);
		fftInPlace(real, imaginary);
		for (let frequency = 0; frequency <= HALF_FFT; frequency += 1) {
			magnitude[frequency] = Math.fround(
				Math.hypot(real[frequency]!, imaginary[frequency]!) / Math.sqrt(
					ASSISTANCE_BEAT_THIS_FFT_SIZE,
				),
			);
		}
		const outputOffset = frame * ASSISTANCE_BEAT_THIS_MEL_BINS;
		for (let mel = 0; mel < ASSISTANCE_BEAT_THIS_MEL_BINS; mel += 1) {
			let energy = 0;
			for (let frequency = 0; frequency <= HALF_FFT; frequency += 1) {
				energy = Math.fround(energy + Math.fround(
					magnitude[frequency]! * MEL_FILTER_BANK[
						frequency * ASSISTANCE_BEAT_THIS_MEL_BINS + mel
					]!,
				));
			}
			values[outputOffset + mel] = Math.fround(Math.log1p(LOG_MULTIPLIER * energy));
		}
		if ((frame + 1) % CANCELLATION_FRAME_INTERVAL === 0 && frame + 1 < frameCount) {
			await yieldForCancellation(signal);
		}
	}
	signal?.throwIfAborted();
	return Object.freeze({ frameCount, melBins: ASSISTANCE_BEAT_THIS_MEL_BINS, values });
}

function assertRangeRequest(
	source: AssistanceBeatThisPcmSourceV1,
	frameStart: number,
	frameCount: number,
	signal?: AbortSignal,
): void {
	if (!source || typeof source !== 'object' || typeof source.readSamples !== 'function'
		|| !Number.isSafeInteger(source.sampleCount) || source.sampleCount <= HALF_FFT) {
		throw new RangeError('Beat This preprocessing requires one exact ranged PCM source.');
	}
	const totalFrames = Math.floor(source.sampleCount / ASSISTANCE_BEAT_THIS_HOP_SAMPLES) + 1;
	if (!Number.isSafeInteger(frameStart) || frameStart < 0
		|| !Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > MAXIMUM_RANGE_FRAMES
		|| frameStart + frameCount > totalFrames) {
		throw new RangeError('Beat This preprocessing range exceeds its bounded frame authority.');
	}
	if (signal !== undefined && !(signal instanceof AbortSignal)) {
		throw new TypeError('Beat This preprocessing requires a valid cancellation signal.');
	}
}

function fillWindowedFrame(
	real: Float32Array,
	imaginary: Float32Array,
	samples: Float32Array,
	readStart: number,
	frame: number,
	totalSamples: number,
): void {
	const center = frame * ASSISTANCE_BEAT_THIS_HOP_SAMPLES;
	for (let index = 0; index < ASSISTANCE_BEAT_THIS_FFT_SIZE; index += 1) {
		const sourceIndex = reflectedIndex(center + index - HALF_FFT, totalSamples);
		real[index] = Math.fround(samples[sourceIndex - readStart]! * HANN_WINDOW[index]!);
		imaginary[index] = 0;
	}
}

/** torch.stft(center=true, pad_mode="reflect") for the single required pad. */
function reflectedIndex(index: number, length: number): number {
	if (index < 0) return -index;
	if (index >= length) return 2 * length - 2 - index;
	return index;
}

function fftInPlace(real: Float32Array, imaginary: Float32Array): void {
	const size = real.length;
	for (let index = 1, reverse = 0; index < size; index += 1) {
		let bit = size >> 1;
		for (; (reverse & bit) !== 0; bit >>= 1) reverse ^= bit;
		reverse ^= bit;
		if (index < reverse) {
			const realValue = real[index]!;
			real[index] = real[reverse]!;
			real[reverse] = realValue;
			const imaginaryValue = imaginary[index]!;
			imaginary[index] = imaginary[reverse]!;
			imaginary[reverse] = imaginaryValue;
		}
	}
	for (let length = 2; length <= size; length <<= 1) {
		const half = length >> 1;
		const angle = -2 * Math.PI / length;
		for (let start = 0; start < size; start += length) {
			for (let offset = 0; offset < half; offset += 1) {
				const cosine = Math.cos(angle * offset);
				const sine = Math.sin(angle * offset);
				const right = start + offset + half;
				const left = start + offset;
				const rotatedReal = Math.fround(real[right]! * cosine - imaginary[right]! * sine);
				const rotatedImaginary = Math.fround(real[right]! * sine + imaginary[right]! * cosine);
				const leftReal = real[left]!;
				const leftImaginary = imaginary[left]!;
				real[left] = Math.fround(leftReal + rotatedReal);
				imaginary[left] = Math.fround(leftImaginary + rotatedImaginary);
				real[right] = Math.fround(leftReal - rotatedReal);
				imaginary[right] = Math.fround(leftImaginary - rotatedImaginary);
			}
		}
	}
}

function periodicHann(): Float32Array {
	const result = new Float32Array(ASSISTANCE_BEAT_THIS_FFT_SIZE);
	for (let index = 0; index < result.length; index += 1) {
		result[index] = Math.fround(0.5 * (1 - Math.cos(
			2 * Math.PI * index / ASSISTANCE_BEAT_THIS_FFT_SIZE,
		)));
	}
	return result;
}

/** torchaudio melscale="slaney", norm=null triangular filter bank. */
function slaneyMelFilterBank(): Float32Array {
	const pointCount = ASSISTANCE_BEAT_THIS_MEL_BINS + 2;
	const points = new Float64Array(pointCount);
	const minimum = hzToSlaneyMel(MINIMUM_FREQUENCY_HZ);
	const maximum = hzToSlaneyMel(MAXIMUM_FREQUENCY_HZ);
	for (let point = 0; point < pointCount; point += 1) {
		points[point] = slaneyMelToHz(minimum
			+ (maximum - minimum) * point / (pointCount - 1));
	}
	const result = new Float32Array((HALF_FFT + 1) * ASSISTANCE_BEAT_THIS_MEL_BINS);
	for (let frequency = 0; frequency <= HALF_FFT; frequency += 1) {
		const hz = frequency * ASSISTANCE_BEAT_THIS_SAMPLE_RATE / ASSISTANCE_BEAT_THIS_FFT_SIZE;
		for (let mel = 0; mel < ASSISTANCE_BEAT_THIS_MEL_BINS; mel += 1) {
			const lower = points[mel]!;
			const center = points[mel + 1]!;
			const upper = points[mel + 2]!;
			const down = (hz - lower) / (center - lower);
			const up = (upper - hz) / (upper - center);
			result[frequency * ASSISTANCE_BEAT_THIS_MEL_BINS + mel] = Math.fround(
				Math.max(0, Math.min(down, up)),
			);
		}
	}
	return result;
}

function hzToSlaneyMel(hz: number): number {
	const linearSpacing = 200 / 3;
	if (hz < 1_000) return hz / linearSpacing;
	return 15 + Math.log(hz / 1_000) / (Math.log(6.4) / 27);
}

function slaneyMelToHz(mel: number): number {
	const linearSpacing = 200 / 3;
	if (mel < 15) return mel * linearSpacing;
	return 1_000 * Math.exp((Math.log(6.4) / 27) * (mel - 15));
}

async function yieldForCancellation(signal?: AbortSignal): Promise<void> {
	signal?.throwIfAborted();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	signal?.throwIfAborted();
}
