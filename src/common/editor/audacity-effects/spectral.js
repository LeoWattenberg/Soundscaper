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
import { fft } from '../pffft.js';
import { dbToLinear } from './basic-channel-math.js';
import {
	buildEqualizationKernel,
	convolveSame,
	createGraphicEqCurve,
	interpolateLinearFrequencyCurve,
	interpolateLogFrequencyCurve,
} from './spectral-equalization-curves.js';
import {
	NOISE_HOP_SIZE,
	NOISE_STEPS_PER_WINDOW,
	NOISE_WINDOW_SIZE,
	powerSpectrum,
	reduceNoiseChannel,
	validateNoiseProfile,
} from './spectral-noise-reduction.js';
import { interpolateAudioLsar } from './spectral-repair-interpolation.js';

const CLICK_WINDOW_SIZE = 8_192;
const CLICK_HOP_SIZE = CLICK_WINDOW_SIZE / 2;


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


function periodicHann(size) {
	const window = new Float64Array(size);
	for (let index = 0; index < size; index += 1) window[index] = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / size);
	return window;
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
