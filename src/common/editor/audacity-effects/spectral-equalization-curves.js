/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * The frequency curve an Audacity 3.7.7 equalizer is, and the linear-phase
 * kernel it becomes. Adapted from commit
 * 5ef610ed23260d6d648175735bb16b32536eb30b:
 * libraries/lib-builtin-effects/EqualizationFilter.cpp and
 * src/effects/EqualizationBandSliders.cpp, by Mitch Golden, Vaughan Johnson,
 * Martyn Shaw, and Paul Licameli, GPL-2.0-or-later upstream. This modified
 * JavaScript adaptation was created for kw.media in 2026 and selects GPL
 * version 3. Split out of spectral.js; no behaviour changes here.
 */

import { fft } from '../pffft.js';
import { dbToLinear } from './basic-channel-math.js';

const AUDACITY_EQ_FFT_SIZE = 16_384;

export const GRAPHIC_EQ_FREQUENCIES = Object.freeze([
	20, 25, 31, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
	800, 1_000, 1_250, 1_600, 2_000, 2_500, 3_150, 4_000, 5_000, 6_300,
	8_000, 10_000, 12_500, 16_000, 20_000,
]);

export function buildEqualizationKernel(sampleRate, filterLength, gainAtFrequency) {
	const real = new Float64Array(AUDACITY_EQ_FFT_SIZE);
	const imaginary = new Float64Array(AUDACITY_EQ_FFT_SIZE);
	const halfFft = AUDACITY_EQ_FFT_SIZE / 2;
	for (let bin = 0; bin <= halfFft; bin += 1) {
		const frequency = bin * sampleRate / AUDACITY_EQ_FFT_SIZE;
		const gain = dbToLinear(gainAtFrequency(frequency));
		real[bin] = gain;
		if (bin > 0 && bin < halfFft) real[AUDACITY_EQ_FFT_SIZE - bin] = gain;
	}
	fft(real, imaginary, true);

	const kernel = new Float64Array(filterLength);
	const halfFilter = (filterLength - 1) / 2;
	for (let tap = 0; tap < filterLength; tap += 1) {
		const offset = tap - halfFilter;
		const sourceIndex = (offset + AUDACITY_EQ_FFT_SIZE) % AUDACITY_EQ_FFT_SIZE;
		const blackman = 0.42
			- 0.5 * Math.cos(2 * Math.PI * tap / (filterLength - 1))
			+ 0.08 * Math.cos(4 * Math.PI * tap / (filterLength - 1));
		kernel[tap] = real[sourceIndex] * blackman;
	}
	return kernel;
}

export function interpolateLogFrequencyCurve(points, frequency) {
	if (points.length === 0) return 0;
	if (points.length === 1) return points[0].gain;
	if (frequency <= points[0].frequency) return points[0].gain;
	const last = points[points.length - 1];
	if (frequency >= last.frequency) return last.gain;
	let low = 0;
	let high = points.length - 1;
	while (high - low > 1) {
		const middle = (low + high) >> 1;
		if (points[middle].frequency <= frequency) low = middle;
		else high = middle;
	}
	const left = points[low];
	const right = points[high];
	const amount = (Math.log(frequency) - Math.log(left.frequency))
		/ (Math.log(right.frequency) - Math.log(left.frequency));
	return left.gain + (right.gain - left.gain) * amount;
}

export function interpolateLinearFrequencyCurve(points, frequency) {
	if (points.length === 0) return 0;
	if (points.length === 1) return points[0].gain;
	if (frequency <= points[0].frequency) return points[0].gain;
	const last = points[points.length - 1];
	if (frequency >= last.frequency) return last.gain;
	let low = 0;
	let high = points.length - 1;
	while (high - low > 1) {
		const middle = (low + high) >> 1;
		if (points[middle].frequency <= frequency) low = middle;
		else high = middle;
	}
	const left = points[low];
	const right = points[high];
	const amount = (frequency - left.frequency) / (right.frequency - left.frequency);
	return left.gain + (right.gain - left.gain) * amount;
}

export function createGraphicEqCurve(allGains, interpolation, nyquist) {
	if (nyquist <= 20) throw new RangeError('Graphic EQ requires a sample rate greater than 40 Hz.');
	let bandCount = 0;
	while (bandCount < GRAPHIC_EQ_FREQUENCIES.length && GRAPHIC_EQ_FREQUENCIES[bandCount] <= nyquist) bandCount += 1;
	if (bandCount < 2) throw new RangeError('Graphic EQ requires at least two audible frequency bands.');
	const frequencies = GRAPHIC_EQ_FREQUENCIES.slice(0, bandCount);
	const gains = allGains.slice(0, bandCount);
	const denominator = Math.log10(nyquist) - Math.log10(20);
	const positions = frequencies.map((frequency) => frequency === 20
		? 0
		: (Math.log10(frequency) - Math.log10(20)) / denominator);
	let cubic = null;
	if (interpolation === 'cubic') {
		const cubicPositions = positions.slice();
		const cubicGains = gains.slice();
		if (cubicPositions.at(-1) < 1 - 1e-12) {
			cubicPositions.push(1);
			cubicGains.push(cubicGains.at(-1));
		}
		cubic = createNaturalCubicSpline(cubicPositions, cubicGains);
	}

	return (frequency) => {
		const x = frequency <= 20
			? 0
			: Math.min(1, (Math.log10(frequency) - Math.log10(20)) / denominator);
		if (interpolation === 'cosine') return graphicCosine(x, positions, gains);
		if (interpolation === 'cubic') return cubic(x);
		return graphicBspline(x, positions, gains);
	};
}

function graphicCosine(x, positions, gains) {
	const last = positions.length - 1;
	if (x < positions[0]) {
		const span = positions[1] - positions[0];
		const distance = positions[0] - x;
		return distance < span ? gains[0] * (1 + Math.cos(Math.PI * distance / span)) / 2 : 0;
	}
	if (x > positions[last]) {
		const span = positions[last] - positions[last - 1];
		const distance = x - positions[last];
		return distance < span ? gains[last] * (1 + Math.cos(Math.PI * distance / span)) / 2 : 0;
	}
	if (x === positions[last]) return gains[last];
	const left = intervalAt(positions, x);
	const span = positions[left + 1] - positions[left];
	const amount = (x - positions[left]) / span;
	const leftWeight = (1 + Math.cos(Math.PI * amount)) / 2;
	return gains[left] * leftWeight + gains[left + 1] * (1 - leftWeight);
}

function graphicBspline(x, positions, gains) {
	const last = positions.length - 1;
	if (x < positions[0]) {
		const amount = (x - positions[0]) / (positions[1] - positions[0]);
		if (amount < -1.5) return 0;
		if (amount < -0.5) return gains[0] * (amount + 1.5) ** 2 / 2;
		return gains[0] * (0.75 - amount ** 2) + gains[1] * (amount + 0.5) ** 2 / 2;
	}
	if (x > positions[last]) {
		const amount = (x - positions[last]) / (positions[last] - positions[last - 1]);
		if (amount > 1.5) return 0;
		if (amount > 0.5) return gains[last] * (amount - 1.5) ** 2 / 2;
		return gains[last] * (0.75 - amount ** 2) + gains[last - 1] * (amount - 0.5) ** 2 / 2;
	}
	if (x === positions[last]) return gains[last];
	const left = intervalAt(positions, x);
	const amount = (x - positions[left]) / (positions[left + 1] - positions[left]);
	if (amount < 0.5) {
		let value = gains[left] * (0.75 - amount ** 2);
		if (left + 1 <= last) value += gains[left + 1] * (amount + 0.5) ** 2 / 2;
		if (left > 0) value += gains[left - 1] * (amount - 0.5) ** 2 / 2;
		return value;
	}
	let value = gains[left] * (amount - 1.5) ** 2 / 2;
	if (left + 1 <= last) value += gains[left + 1] * (0.75 - (1 - amount) ** 2);
	if (left + 2 <= last) value += gains[left + 2] * (amount - 0.5) ** 2 / 2;
	return value;
}

function intervalAt(points, x) {
	let low = 0;
	let high = points.length - 1;
	while (high - low > 1) {
		const middle = (low + high) >> 1;
		if (points[middle] <= x) low = middle;
		else high = middle;
	}
	return low;
}

function createNaturalCubicSpline(x, y) {
	const second = new Float64Array(x.length);
	const work = new Float64Array(x.length);
	for (let index = 1; index + 1 < x.length; index += 1) {
		const sigma = (x[index] - x[index - 1]) / (x[index + 1] - x[index - 1]);
		const divisor = sigma * second[index - 1] + 2;
		second[index] = (sigma - 1) / divisor;
		const slopes = (y[index + 1] - y[index]) / (x[index + 1] - x[index])
			- (y[index] - y[index - 1]) / (x[index] - x[index - 1]);
		work[index] = (6 * slopes / (x[index + 1] - x[index - 1]) - sigma * work[index - 1]) / divisor;
	}
	for (let index = x.length - 2; index >= 0; index -= 1) {
		second[index] = second[index] * second[index + 1] + work[index];
	}
	return (value) => {
		if (value <= x[0]) return y[0];
		if (value >= x.at(-1)) return y.at(-1);
		const left = intervalAt(x, value);
		const width = x[left + 1] - x[left];
		const a = (x[left + 1] - value) / width;
		const b = (value - x[left]) / width;
		return a * y[left] + b * y[left + 1]
			+ ((a ** 3 - a) * second[left] + (b ** 3 - b) * second[left + 1]) * width ** 2 / 6;
	};
}

export function convolveSame(input, kernel) {
	const fftSize = nextPowerOfTwo(kernel.length * 2);
	const blockSize = fftSize - kernel.length + 1;
	const kernelReal = new Float64Array(fftSize);
	const kernelImaginary = new Float64Array(fftSize);
	kernelReal.set(kernel);
	fft(kernelReal, kernelImaginary, false);
	const full = new Float64Array(input.length + kernel.length - 1);
	for (let inputOffset = 0; inputOffset < input.length; inputOffset += blockSize) {
		const count = Math.min(blockSize, input.length - inputOffset);
		const real = new Float64Array(fftSize);
		const imaginary = new Float64Array(fftSize);
		for (let index = 0; index < count; index += 1) real[index] = input[inputOffset + index];
		fft(real, imaginary, false);
		for (let bin = 0; bin < fftSize; bin += 1) {
			const re = real[bin];
			const im = imaginary[bin];
			real[bin] = re * kernelReal[bin] - im * kernelImaginary[bin];
			imaginary[bin] = re * kernelImaginary[bin] + im * kernelReal[bin];
		}
		fft(real, imaginary, true);
		const convolutionFrames = count + kernel.length - 1;
		for (let index = 0; index < convolutionFrames; index += 1) full[inputOffset + index] += real[index];
	}
	const delay = (kernel.length - 1) / 2;
	const output = new Float32Array(input.length);
	for (let frame = 0; frame < output.length; frame += 1) output[frame] = full[frame + delay];
	return output;
}

function nextPowerOfTwo(value) {
	return 2 ** Math.ceil(Math.log2(value));
}
