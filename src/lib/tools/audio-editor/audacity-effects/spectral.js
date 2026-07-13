/*
 * Audacity 3.7.7 spectral, restoration, and time-smearing DSP.
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * This is a JavaScript adaptation of core business logic from Audacity tag
 * Audacity-3.7.7, commit 5ef610ed23260d6d648175735bb16b32536eb30b:
 *
 * - libraries/lib-builtin-effects/ClickRemovalBase.cpp — Craig DeForest
 * - libraries/lib-builtin-effects/EqualizationFilter.cpp — Mitch Golden,
 *   Vaughan Johnson, Martyn Shaw, and Paul Licameli
 * - src/effects/EqualizationBandSliders.cpp — Mitch Golden, Vaughan Johnson,
 *   Martyn Shaw, and Paul Licameli
 * - libraries/lib-builtin-effects/NoiseReductionBase.cpp — Dominic Mazzoni
 *   and Paul Licameli
 * - libraries/lib-builtin-effects/PaulstretchBase.cpp — Nasca Octavian Paul
 *   (Paul Nasca)
 * - libraries/lib-builtin-effects/Repair.cpp and
 *   libraries/lib-math/InterpolateAudio.cpp — Dominic Mazzoni
 *
 * Those Audacity sources are licensed GPL-2.0-or-later. This adaptation was
 * made for kw.media in 2026 and selects/distributes them under GPL version 3.
 * Audacity track, project, progress, preference, and UI construction code is
 * intentionally excluded; the functions below operate on immutable channel
 * selections instead.
 */

import { normalizeAudacityEffectParams } from './manifest.js';

const AUDACITY_EQ_FFT_SIZE = 16_384;
const CLICK_WINDOW_SIZE = 8_192;
const CLICK_HOP_SIZE = CLICK_WINDOW_SIZE / 2;
const NOISE_WINDOW_SIZE = 2_048;
const NOISE_STEPS_PER_WINDOW = 4;
const NOISE_HOP_SIZE = NOISE_WINDOW_SIZE / NOISE_STEPS_PER_WINDOW;
const GRAPHIC_EQ_FREQUENCIES = Object.freeze([
	20, 25, 31, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
	800, 1_000, 1_250, 1_600, 2_000, 2_500, 3_150, 4_000, 5_000, 6_300,
	8_000, 10_000, 12_500, 16_000, 20_000,
]);

export function applyAudacityClickRemoval(channels, sampleRate, params = {}) {
	const { frameCount } = validateChannels(channels, sampleRate);
	const normalized = normalizeAudacityEffectParams('audacity-click-removal', params);
	const output = copyChannels(channels);
	if (normalized.threshold === 0 || normalized.maximumWidth === 0) return output;
	if (frameCount <= CLICK_HOP_SIZE) {
		throw new RangeError(`Click Removal requires more than ${CLICK_HOP_SIZE} samples.`);
	}

	// Audacity initializes sep to 2049. RemoveClicks rounds it upward to 4096
	// after using 2049 / 2 for the first window's center offset; the mutated
	// value is then shared by all later windows and channels in the effect run.
	const state = { separation: 2_049 };
	for (const channel of output) {
		for (let start = 0; start + CLICK_HOP_SIZE < frameCount; start += CLICK_HOP_SIZE) {
			const copyLength = Math.min(CLICK_WINDOW_SIZE, frameCount - start);
			const window = new Float32Array(CLICK_WINDOW_SIZE);
			window.set(channel.subarray(start, start + copyLength));
			removeClicksFromWindow(window, normalized.threshold, normalized.maximumWidth, state);
			channel.set(window.subarray(0, copyLength), start);
		}
	}
	return output;
}

export function applyAudacityFilterCurveEq(channels, sampleRate, params = {}) {
	validateChannels(channels, sampleRate);
	const normalized = normalizeAudacityEffectParams('audacity-filter-curve-eq', params);
	const points = normalized.points;
	const kernel = buildEqualizationKernel(
		sampleRate,
		normalized.filterLength,
		(frequency) => normalized.linearFrequencyScale
			? interpolateLinearFrequencyCurve(points, frequency)
			: interpolateLogFrequencyCurve(points, frequency),
	);
	return channels.map((channel) => convolveSame(channel, kernel));
}

export function applyAudacityGraphicEq(channels, sampleRate, params = {}) {
	validateChannels(channels, sampleRate);
	const normalized = normalizeAudacityEffectParams('audacity-graphic-eq', params);
	const gainAtFrequency = createGraphicEqCurve(
		normalized.gains,
		normalized.interpolation,
		sampleRate / 2,
	);
	const kernel = buildEqualizationKernel(sampleRate, normalized.filterLength, gainAtFrequency);
	return channels.map((channel) => convolveSame(channel, kernel));
}

export function captureAudacityNoiseProfile(channels, sampleRate, params = {}) {
	const { frameCount } = validateChannels(channels, sampleRate);
	// The profiler has no public parameters, but normalize to reject no values
	// differently from the reduction stage if the manifest changes later.
	normalizeAudacityEffectParams('audacity-noise-reduction', params);
	if (frameCount < NOISE_WINDOW_SIZE) {
		throw new RangeError(`The noise profile must contain at least ${NOISE_WINDOW_SIZE} samples.`);
	}

	const window = periodicHann(NOISE_WINDOW_SIZE);
	const binCount = NOISE_WINDOW_SIZE / 2 + 1;
	const sums = new Float64Array(binCount);
	let windowCount = 0;
	for (const channel of channels) {
		for (let start = 0; start + NOISE_WINDOW_SIZE <= frameCount; start += NOISE_HOP_SIZE) {
			const powers = powerSpectrum(channel, start, window);
			for (let bin = 0; bin < binCount; bin += 1) sums[bin] += powers[bin];
			windowCount += 1;
		}
	}
	if (windowCount === 0) throw new RangeError('The selected noise profile is too short.');

	const meanPowers = new Float32Array(binCount);
	for (let bin = 0; bin < binCount; bin += 1) meanPowers[bin] = sums[bin] / windowCount;
	return {
		type: 'audacity-noise-profile',
		version: 1,
		sampleRate,
		windowSize: NOISE_WINDOW_SIZE,
		stepsPerWindow: NOISE_STEPS_PER_WINDOW,
		windowType: 'hann-hann',
		channelCount: channels.length,
		windowCount,
		meanPowers,
	};
}

export function applyAudacityNoiseReduction(channels, sampleRate, params = {}, profile) {
	validateChannels(channels, sampleRate);
	const normalized = normalizeAudacityEffectParams('audacity-noise-reduction', params);
	validateNoiseProfile(profile, sampleRate);
	const attenuation = dbToLinear(-normalized.reductionDb);
	if (attenuation === 1) {
		return normalized.output === 'residue'
			? channels.map((channel) => new Float32Array(channel.length))
			: copyChannels(channels);
	}

	const window = periodicHann(NOISE_WINDOW_SIZE);
	return channels.map((channel) => reduceNoiseChannel(
		channel,
		sampleRate,
		normalized,
		profile.meanPowers,
		window,
		attenuation,
	));
}

export function applyAudacityPaulstretch(channels, sampleRate, params = {}, context = {}) {
	const { frameCount } = validateChannels(channels, sampleRate);
	const normalized = normalizeAudacityEffectParams('audacity-paulstretch', params);
	const inputBufferSize = paulstretchBufferSize(sampleRate, normalized.timeResolution);
	const minimumFrames = inputBufferSize * 2 + 1;
	if (frameCount < minimumFrames) {
		throw new RangeError(
			`Paulstretch Time Resolution is too long for this selection; at least ${minimumFrames} samples are required.`,
		);
	}
	const outputFrames = Math.ceil(frameCount * normalized.stretchFactor);
	if (!Number.isSafeInteger(outputFrames) || outputFrames > 0x7fff_ffff) {
		throw new RangeError('The Paulstretch output is too large.');
	}
	const baseSeed = seedToUint32(context?.seed);
	return channels.map((channel, channelIndex) => paulstretchChannel(
		channel,
		normalized.stretchFactor,
		inputBufferSize,
		outputFrames,
		baseSeed ^ Math.imul(channelIndex + 1, 0x9e37_79b9),
	));
}

export function applyAudacityRepair(channels, sampleRate, params = {}, context = {}) {
	const { frameCount } = validateChannels(channels, sampleRate);
	normalizeAudacityEffectParams('audacity-repair', params);
	if (frameCount > 128) {
		throw new RangeError('Repair is intended for damaged selections of at most 128 samples.');
	}

	const beforeChannels = normalizeContextChannels(context?.beforeChannels, channels.length, 'beforeChannels');
	const afterChannels = normalizeContextChannels(context?.afterChannels, channels.length, 'afterChannels');
	if (!beforeChannels && !afterChannels) {
		throw new RangeError('Repair requires audio touching at least one side of the selection.');
	}
	const contextFrames = Math.max(frameCount * 2, 128);
	const output = [];
	for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
		const before = beforeChannels?.[channelIndex] || EMPTY_FLOAT32;
		const after = afterChannels?.[channelIndex] || EMPTY_FLOAT32;
		const beforeLength = Math.min(before.length, contextFrames);
		const afterLength = Math.min(after.length, contextFrames);
		if (beforeLength + afterLength === 0) {
			throw new RangeError(`Repair channel ${channelIndex} has no surrounding audio.`);
		}
		const buffer = new Float64Array(beforeLength + frameCount + afterLength);
		for (let index = 0; index < beforeLength; index += 1) {
			buffer[index] = before[before.length - beforeLength + index];
		}
		for (let index = 0; index < frameCount; index += 1) {
			buffer[beforeLength + index] = channels[channelIndex][index];
		}
		for (let index = 0; index < afterLength; index += 1) {
			buffer[beforeLength + frameCount + index] = after[index];
		}
		interpolateAudioLsar(
			buffer,
			beforeLength,
			frameCount,
			createRandom(0x6d2b_79f5 ^ Math.imul(channelIndex + 1, 0x85eb_ca6b)),
		);
		output.push(Float32Array.from(buffer.subarray(beforeLength, beforeLength + frameCount)));
	}
	return output;
}

const EMPTY_FLOAT32 = new Float32Array(0);

function validateChannels(channels, sampleRate) {
	if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
		throw new RangeError('sampleRate must be a positive finite number.');
	}
	if (!Array.isArray(channels) || channels.length === 0) {
		throw new TypeError('channels must be a non-empty array of Float32Array objects.');
	}
	let frameCount = null;
	for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
		const channel = channels[channelIndex];
		if (!(channel instanceof Float32Array)) {
			throw new TypeError(`channels[${channelIndex}] must be a Float32Array.`);
		}
		if (frameCount == null) frameCount = channel.length;
		else if (channel.length !== frameCount) throw new RangeError('All channels must have the same frame count.');
		for (let frame = 0; frame < channel.length; frame += 1) {
			if (!Number.isFinite(channel[frame])) {
				throw new RangeError(`channels[${channelIndex}][${frame}] must be finite.`);
			}
		}
	}
	if (frameCount === 0) throw new RangeError('The audio selection must contain at least one frame.');
	return { frameCount };
}

function normalizeContextChannels(value, channelCount, name) {
	if (value == null) return null;
	if (!Array.isArray(value) || value.length !== channelCount) {
		throw new RangeError(`${name} must contain ${channelCount} channels.`);
	}
	let length = null;
	for (let channelIndex = 0; channelIndex < value.length; channelIndex += 1) {
		const channel = value[channelIndex];
		if (!(channel instanceof Float32Array)) throw new TypeError(`${name}[${channelIndex}] must be a Float32Array.`);
		if (length == null) length = channel.length;
		else if (channel.length !== length) throw new RangeError(`All ${name} channels must have the same frame count.`);
		for (let frame = 0; frame < channel.length; frame += 1) {
			if (!Number.isFinite(channel[frame])) throw new RangeError(`${name}[${channelIndex}][${frame}] must be finite.`);
		}
	}
	return value;
}

function copyChannels(channels) {
	return channels.map((channel) => new Float32Array(channel));
}

function removeClicksFromWindow(buffer, threshold, maximumWidth, state) {
	const length = buffer.length;
	const centerOffset = Math.floor(state.separation / 2);
	let rmsWindow = 1;
	while (rmsWindow < state.separation) rmsWindow *= 2;
	state.separation = rmsWindow;
	const squares = new Float64Array(length);
	const meanSquares = new Float64Array(length - rmsWindow);
	const prefix = new Float64Array(length + 1);
	for (let index = 0; index < length; index += 1) {
		const square = buffer[index] * buffer[index];
		squares[index] = square;
		prefix[index + 1] = prefix[index] + square;
	}
	for (let index = 0; index < meanSquares.length; index += 1) {
		meanSquares[index] = (prefix[index + rmsWindow] - prefix[index]) / rmsWindow;
	}

	let left = 0;
	for (let widthReciprocal = Math.floor(maximumWidth / 4); widthReciprocal >= 1; widthReciprocal = Math.floor(widthReciprocal / 2)) {
		const width = Math.floor(maximumWidth / widthReciprocal);
		for (let index = 0; index < meanSquares.length; index += 1) {
			let localMeanSquare = 0;
			for (let offset = 0; offset < width; offset += 1) {
				localMeanSquare += squares[index + centerOffset + offset];
			}
			localMeanSquare /= width;
			if (localMeanSquare >= threshold * meanSquares[index] / 10) {
				if (left === 0) left = index + centerOffset;
				continue;
			}

			const right = index + width + centerOffset;
			if (left !== 0 && index - left + centerOffset <= width * 2) {
				const leftValue = buffer[left];
				const rightValue = buffer[right];
				const span = right - left;
				for (let frame = left; frame < right; frame += 1) {
					buffer[frame] = (rightValue * (frame - left) + leftValue * (right - frame)) / span;
					squares[frame] = buffer[frame] * buffer[frame];
				}
				left = 0;
			} else if (left !== 0) {
				left = 0;
			}
		}
	}
}

function buildEqualizationKernel(sampleRate, filterLength, gainAtFrequency) {
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

function interpolateLogFrequencyCurve(points, frequency) {
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

function interpolateLinearFrequencyCurve(points, frequency) {
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

function createGraphicEqCurve(allGains, interpolation, nyquist) {
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

function convolveSame(input, kernel) {
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

function validateNoiseProfile(profile, sampleRate) {
	if (!profile || profile.type !== 'audacity-noise-profile' || profile.version !== 1) {
		throw new TypeError('A noise profile captured by captureAudacityNoiseProfile is required.');
	}
	if (profile.sampleRate !== sampleRate) {
		throw new RangeError('The noise profile sample rate must match the audio sample rate.');
	}
	if (profile.windowSize !== NOISE_WINDOW_SIZE || profile.stepsPerWindow !== NOISE_STEPS_PER_WINDOW) {
		throw new RangeError('The noise profile uses incompatible analysis settings.');
	}
	if (!(profile.meanPowers instanceof Float32Array) || profile.meanPowers.length !== NOISE_WINDOW_SIZE / 2 + 1) {
		throw new TypeError('The noise profile spectrum is invalid.');
	}
	for (let bin = 0; bin < profile.meanPowers.length; bin += 1) {
		if (!Number.isFinite(profile.meanPowers[bin]) || profile.meanPowers[bin] < 0) {
			throw new RangeError(`The noise profile spectrum is invalid at bin ${bin}.`);
		}
	}
}

function reduceNoiseChannel(channel, sampleRate, params, meanPowers, window, attenuation) {
	const starts = paddedFrameStarts(channel.length, NOISE_WINDOW_SIZE, NOISE_HOP_SIZE);
	const powers = starts.map((start) => powerSpectrum(channel, start, window));
	const binCount = meanPowers.length;
	const gains = powers.map(() => new Float32Array(binCount));
	const sensitivity = params.sensitivity * Math.log(10);

	for (let frame = 0; frame < powers.length; frame += 1) {
		const first = Math.max(0, frame - NOISE_STEPS_PER_WINDOW / 2);
		const last = Math.min(powers.length - 1, frame + NOISE_STEPS_PER_WINDOW / 2);
		for (let bin = 0; bin < binCount; bin += 1) {
			let greatest = 0;
			let secondGreatest = 0;
			for (let neighbor = first; neighbor <= last; neighbor += 1) {
				const power = powers[neighbor][bin];
				if (power >= greatest) {
					secondGreatest = greatest;
					greatest = power;
				} else if (power >= secondGreatest) {
					secondGreatest = power;
				}
			}
			gains[frame][bin] = secondGreatest <= sensitivity * meanPowers[bin] ? attenuation : 1;
		}
	}

	const attackBlocks = 1 + Math.floor(0.02 * sampleRate / NOISE_HOP_SIZE);
	const releaseBlocks = 1 + Math.floor(0.1 * sampleRate / NOISE_HOP_SIZE);
	const attackFactor = attenuation ** (1 / attackBlocks);
	const releaseFactor = attenuation ** (1 / releaseBlocks);
	for (let bin = 0; bin < binCount; bin += 1) {
		for (let frame = 1; frame < gains.length; frame += 1) {
			gains[frame][bin] = Math.max(gains[frame][bin], gains[frame - 1][bin] * releaseFactor);
		}
		for (let frame = gains.length - 2; frame >= 0; frame -= 1) {
			gains[frame][bin] = Math.max(gains[frame][bin], gains[frame + 1][bin] * attackFactor);
		}
	}

	const smoothingBins = Math.floor(params.frequencySmoothingBands);
	if (smoothingBins > 0) {
		for (const frameGains of gains) applyGeometricFrequencySmoothing(frameGains, smoothingBins);
	}

	const accumulated = new Float64Array(channel.length);
	const normalization = new Float64Array(channel.length);
	for (let frame = 0; frame < starts.length; frame += 1) {
		const start = starts[frame];
		const real = new Float64Array(NOISE_WINDOW_SIZE);
		const imaginary = new Float64Array(NOISE_WINDOW_SIZE);
		for (let index = 0; index < NOISE_WINDOW_SIZE; index += 1) {
			const sourceIndex = start + index;
			if (sourceIndex >= 0 && sourceIndex < channel.length) real[index] = channel[sourceIndex] * window[index];
		}
		fft(real, imaginary, false);
		for (let bin = 0; bin <= NOISE_WINDOW_SIZE / 2; bin += 1) {
			const gain = gains[frame][bin];
			real[bin] *= gain;
			imaginary[bin] *= gain;
			if (bin > 0 && bin < NOISE_WINDOW_SIZE / 2) {
				real[NOISE_WINDOW_SIZE - bin] *= gain;
				imaginary[NOISE_WINDOW_SIZE - bin] *= gain;
			}
		}
		fft(real, imaginary, true);
		for (let index = 0; index < NOISE_WINDOW_SIZE; index += 1) {
			const outputIndex = start + index;
			if (outputIndex < 0 || outputIndex >= channel.length) continue;
			accumulated[outputIndex] += real[index] * window[index];
			normalization[outputIndex] += window[index] * window[index];
		}
	}

	const reduced = new Float32Array(channel.length);
	for (let frame = 0; frame < reduced.length; frame += 1) {
		reduced[frame] = normalization[frame] > 1e-12 ? accumulated[frame] / normalization[frame] : channel[frame];
	}
	if (params.output === 'reduce') return reduced;
	const residue = new Float32Array(channel.length);
	// Audacity's NRC_LEAVE_RESIDUE multiplies by gain - 1, so its residue
	// has inverted polarity: reduced - original.
	for (let frame = 0; frame < residue.length; frame += 1) residue[frame] = reduced[frame] - channel[frame];
	return residue;
}

function applyGeometricFrequencySmoothing(gains, radius) {
	const logs = new Float64Array(gains.length);
	const prefix = new Float64Array(gains.length + 1);
	for (let bin = 0; bin < gains.length; bin += 1) {
		logs[bin] = Math.log(gains[bin]);
		prefix[bin + 1] = prefix[bin] + logs[bin];
	}
	for (let bin = 0; bin < gains.length; bin += 1) {
		const first = Math.max(0, bin - radius);
		const last = Math.min(gains.length - 1, bin + radius);
		gains[bin] = Math.exp((prefix[last + 1] - prefix[first]) / (last - first + 1));
	}
}

function powerSpectrum(channel, start, window) {
	const size = window.length;
	const real = new Float64Array(size);
	const imaginary = new Float64Array(size);
	for (let index = 0; index < size; index += 1) {
		const sourceIndex = start + index;
		if (sourceIndex >= 0 && sourceIndex < channel.length) real[index] = channel[sourceIndex] * window[index];
	}
	fft(real, imaginary, false);
	const powers = new Float32Array(size / 2 + 1);
	for (let bin = 0; bin < powers.length; bin += 1) powers[bin] = real[bin] ** 2 + imaginary[bin] ** 2;
	return powers;
}

function paddedFrameStarts(frameCount, windowSize, hopSize) {
	const starts = [];
	for (let start = -(windowSize - hopSize); start < frameCount; start += hopSize) starts.push(start);
	return starts;
}

function paulstretchBufferSize(sampleRate, timeResolution) {
	const requested = sampleRate * timeResolution / 2;
	const powerOfTwo = 2 ** Math.floor(Math.log2(requested) + 0.5);
	if (!Number.isFinite(powerOfTwo) || powerOfTwo <= 0) throw new RangeError('Paulstretch buffer size is invalid.');
	return Math.max(128, powerOfTwo);
}

function paulstretchChannel(input, stretchFactor, inputBufferSize, outputFrames, seed) {
	const fftSize = inputBufferSize * 2;
	const outputHop = inputBufferSize;
	const window = periodicHann(fftSize);
	const accumulated = new Float64Array(outputFrames);
	const normalization = new Float64Array(outputFrames);
	const random = createRandom(seed);

	for (let outputStart = -outputHop; outputStart < outputFrames; outputStart += outputHop) {
		const outputCenter = outputStart + inputBufferSize;
		const inputCenter = outputCenter / stretchFactor;
		const inputStart = Math.round(inputCenter - inputBufferSize);
		const real = new Float64Array(fftSize);
		const imaginary = new Float64Array(fftSize);
		for (let index = 0; index < fftSize; index += 1) {
			const sourceIndex = inputStart + index;
			if (sourceIndex >= 0 && sourceIndex < input.length) real[index] = input[sourceIndex] * window[index];
		}
		fft(real, imaginary, false);
		for (let bin = 1; bin < fftSize / 2; bin += 1) {
			const magnitude = Math.hypot(real[bin], imaginary[bin]);
			const phase = random() * Math.PI * 2;
			const re = magnitude * Math.cos(phase);
			const im = magnitude * Math.sin(phase);
			real[bin] = re;
			imaginary[bin] = im;
			real[fftSize - bin] = re;
			imaginary[fftSize - bin] = -im;
		}
		real[0] = 0;
		imaginary[0] = 0;
		real[fftSize / 2] = 0;
		imaginary[fftSize / 2] = 0;
		fft(real, imaginary, true);
		for (let index = 0; index < fftSize; index += 1) {
			const destination = outputStart + index;
			if (destination < 0 || destination >= outputFrames) continue;
			accumulated[destination] += real[index] * window[index];
			normalization[destination] += window[index] * window[index];
		}
	}

	const output = new Float32Array(outputFrames);
	for (let frame = 0; frame < outputFrames; frame += 1) {
		if (normalization[frame] > 1e-12) output[frame] = accumulated[frame] / normalization[frame];
	}
	const fadeLength = Math.min(100, Math.floor(inputBufferSize / 2) - 1, input.length, output.length);
	for (let frame = 0; frame < fadeLength; frame += 1) {
		const amount = frame / fadeLength;
		output[frame] = output[frame] * amount + input[frame] * (1 - amount);
		const outputIndex = output.length - 1 - frame;
		const inputIndex = input.length - 1 - frame;
		output[outputIndex] = output[outputIndex] * amount + input[inputIndex] * (1 - amount);
	}
	return output;
}

function interpolateAudioLsar(buffer, firstBad, badCount, random) {
	const length = buffer.length;
	if (badCount >= length) return;
	if (firstBad === 0) {
		const reversed = new Float64Array(length);
		for (let index = 0; index < length; index += 1) reversed[length - 1 - index] = buffer[index];
		interpolateAudioLsar(reversed, length - badCount, badCount, random);
		for (let index = 0; index < length; index += 1) buffer[length - 1 - index] = reversed[index];
		return;
	}

	const rightCount = length - firstBad - badCount;
	const order = Math.min(badCount * 3, 50, Math.max(firstBad - 1, rightCount - 1));
	if (order < 3 || order >= length) {
		linearInterpolateAudio(buffer, firstBad, badCount);
		return;
	}

	const signal = new Float64Array(buffer);
	for (let index = 0; index < signal.length; index += 1) signal[index] += (random() - 0.5) / 10_000;
	const covariance = new Float64Array(order * order);
	const target = new Float64Array(order);
	for (let start = 0; start + order < length; start += 1) {
		if (!(start + order < firstBad || start >= firstBad + badCount)) continue;
		for (let row = 0; row < order; row += 1) {
			const rowValue = signal[start + row];
			target[row] += signal[start + order] * rowValue;
			for (let column = 0; column < order; column += 1) {
				covariance[row * order + column] += rowValue * signal[start + column];
			}
		}
	}
	const coefficients = solveLinearSystem(covariance, target, order);
	if (!coefficients) {
		linearInterpolateAudio(buffer, firstBad, badCount);
		return;
	}

	const normal = new Float64Array(badCount * badCount);
	const rightHandSide = new Float64Array(badCount);
	for (let row = 0; row < length - order; row += 1) {
		let knownContribution = 0;
		const unknownCoefficients = new Float64Array(badCount);
		for (let columnOffset = 0; columnOffset <= order; columnOffset += 1) {
			const column = row + columnOffset;
			const value = columnOffset === order ? 1 : -coefficients[columnOffset];
			if (column >= firstBad && column < firstBad + badCount) {
				unknownCoefficients[column - firstBad] += value;
			} else {
				knownContribution += value * signal[column];
			}
		}
		for (let left = 0; left < badCount; left += 1) {
			const leftValue = unknownCoefficients[left];
			if (leftValue === 0) continue;
			rightHandSide[left] -= leftValue * knownContribution;
			for (let right = 0; right < badCount; right += 1) {
				normal[left * badCount + right] += leftValue * unknownCoefficients[right];
			}
		}
	}
	const repaired = solveLinearSystem(normal, rightHandSide, badCount);
	if (!repaired) {
		linearInterpolateAudio(buffer, firstBad, badCount);
		return;
	}
	for (let index = 0; index < badCount; index += 1) buffer[firstBad + index] = repaired[index];
}

function linearInterpolateAudio(buffer, firstBad, badCount) {
	const end = firstBad + badCount;
	const decay = 0.9;
	if (firstBad === 0) {
		let value = buffer[end];
		let delta = end + 1 < buffer.length ? buffer[end] - buffer[end + 1] : 0;
		for (let index = end - 1; index >= 0; index -= 1) {
			value += delta;
			buffer[index] = value;
			value *= decay;
			delta *= decay;
		}
		return;
	}
	if (end === buffer.length) {
		let value = buffer[firstBad - 1];
		let delta = firstBad >= 2 ? buffer[firstBad - 1] - buffer[firstBad - 2] : 0;
		for (let index = firstBad; index < end; index += 1) {
			value += delta;
			buffer[index] = value;
			value *= decay;
			delta *= decay;
		}
		return;
	}
	const left = buffer[firstBad - 1];
	const right = buffer[end];
	const delta = (right - left) / (badCount + 1);
	for (let index = 0; index < badCount; index += 1) buffer[firstBad + index] = left + delta * (index + 1);
}

function solveLinearSystem(matrix, vector, size) {
	if (size === 0) return new Float64Array(0);
	const a = new Float64Array(matrix);
	const b = new Float64Array(vector);
	let scale = 0;
	for (const value of a) scale = Math.max(scale, Math.abs(value));
	const tolerance = Math.max(Number.MIN_VALUE, scale * Number.EPSILON * size * 8);
	for (let column = 0; column < size; column += 1) {
		let pivot = column;
		let pivotValue = Math.abs(a[column * size + column]);
		for (let row = column + 1; row < size; row += 1) {
			const candidate = Math.abs(a[row * size + column]);
			if (candidate > pivotValue) {
				pivot = row;
				pivotValue = candidate;
			}
		}
		if (!(pivotValue > tolerance)) return null;
		if (pivot !== column) {
			for (let index = column; index < size; index += 1) {
				const temporary = a[column * size + index];
				a[column * size + index] = a[pivot * size + index];
				a[pivot * size + index] = temporary;
			}
			const temporary = b[column];
			b[column] = b[pivot];
			b[pivot] = temporary;
		}
		const divisor = a[column * size + column];
		for (let row = column + 1; row < size; row += 1) {
			const factor = a[row * size + column] / divisor;
			if (factor === 0) continue;
			a[row * size + column] = 0;
			for (let index = column + 1; index < size; index += 1) {
				a[row * size + index] -= factor * a[column * size + index];
			}
			b[row] -= factor * b[column];
		}
	}
	const result = new Float64Array(size);
	for (let row = size - 1; row >= 0; row -= 1) {
		let value = b[row];
		for (let column = row + 1; column < size; column += 1) value -= a[row * size + column] * result[column];
		result[row] = value / a[row * size + row];
		if (!Number.isFinite(result[row])) return null;
	}
	return result;
}

function periodicHann(size) {
	const window = new Float64Array(size);
	for (let index = 0; index < size; index += 1) window[index] = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / size);
	return window;
}

function dbToLinear(decibels) {
	return 10 ** (decibels / 20);
}

function nextPowerOfTwo(value) {
	return 2 ** Math.ceil(Math.log2(value));
}

function fft(real, imaginary, inverse) {
	const size = real.length;
	if (imaginary.length !== size || size < 2 || (size & (size - 1)) !== 0) {
		throw new RangeError('FFT arrays must have the same power-of-two length.');
	}
	for (let index = 1, reversed = 0; index < size; index += 1) {
		let bit = size >> 1;
		for (; reversed & bit; bit >>= 1) reversed ^= bit;
		reversed ^= bit;
		if (index < reversed) {
			let temporary = real[index];
			real[index] = real[reversed];
			real[reversed] = temporary;
			temporary = imaginary[index];
			imaginary[index] = imaginary[reversed];
			imaginary[reversed] = temporary;
		}
	}
	for (let length = 2; length <= size; length *= 2) {
		const angle = (inverse ? 2 : -2) * Math.PI / length;
		const stepReal = Math.cos(angle);
		const stepImaginary = Math.sin(angle);
		for (let start = 0; start < size; start += length) {
			let twiddleReal = 1;
			let twiddleImaginary = 0;
			for (let offset = 0; offset < length / 2; offset += 1) {
				const even = start + offset;
				const odd = even + length / 2;
				const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
				const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
				real[odd] = real[even] - oddReal;
				imaginary[odd] = imaginary[even] - oddImaginary;
				real[even] += oddReal;
				imaginary[even] += oddImaginary;
				const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
				twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
				twiddleReal = nextReal;
			}
		}
	}
	if (inverse) {
		for (let index = 0; index < size; index += 1) {
			real[index] /= size;
			imaginary[index] /= size;
		}
	}
}

function seedToUint32(value) {
	if (value == null) return 0x1a2b_3c4d;
	if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value) >>> 0;
	const string = String(value);
	let hash = 0x811c_9dc5;
	for (let index = 0; index < string.length; index += 1) {
		hash ^= string.charCodeAt(index);
		hash = Math.imul(hash, 0x0100_0193);
	}
	return hash >>> 0;
}

function createRandom(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b_79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}
