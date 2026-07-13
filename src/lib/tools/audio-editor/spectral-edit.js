/*
 * Repository-owned browser spectral editing primitives.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const DEFAULT_WINDOW_SIZE = 2048;
const DEFAULT_HOP_DIVISOR = 4;

/**
 * Apply a constant gain to a time/frequency rectangle using a Hann-windowed
 * overlap-add STFT. Input channels are never mutated.
 *
 * `gainDb: -Infinity` is the Audacity-style spectral Delete operation.
 */
export function applySpectralGain(channels, options = {}) {
	const input = normalizeChannels(channels);
	const sampleRate = positiveInteger(options.sampleRate, 'sampleRate');
	const frameCount = input[0].length;
	const startFrame = boundedInteger(options.startFrame ?? 0, 0, frameCount, 'startFrame');
	const endFrame = boundedInteger(options.endFrame ?? frameCount, startFrame, frameCount, 'endFrame');
	if (endFrame <= startFrame) throw new RangeError('Spectral editing requires a non-empty time range.');
	const minimumFrequency = finiteRange(options.minimumFrequency ?? 0, 0, sampleRate / 2, 'minimumFrequency');
	const maximumFrequency = finiteRange(options.maximumFrequency ?? sampleRate / 2, minimumFrequency, sampleRate / 2, 'maximumFrequency');
	if (maximumFrequency <= minimumFrequency) throw new RangeError('Spectral editing requires a non-empty frequency range.');
	const windowSize = powerOfTwo(options.windowSize ?? DEFAULT_WINDOW_SIZE, 32, 16_384, 'windowSize');
	const hopSize = positiveInteger(options.hopSize ?? windowSize / DEFAULT_HOP_DIVISOR, 'hopSize');
	if (hopSize > windowSize) throw new RangeError('hopSize cannot exceed windowSize.');
	const gainDb = Number(options.gainDb ?? 0);
	if (Number.isNaN(gainDb) || gainDb === Infinity) throw new RangeError('gainDb must be finite or -Infinity.');
	const gain = gainDb === -Infinity ? 0 : 10 ** (gainDb / 20);
	if (!Number.isFinite(gain) || gain < 0 || gain > 1_000_000) throw new RangeError('gainDb produces an unsafe gain.');
	if (gain === 1) return input.map((channel) => channel.slice());

	const window = createHannWindow(windowSize);
	const firstWindow = Math.floor((startFrame - windowSize + 1) / hopSize) * hopSize;
	const lastWindow = Math.ceil((endFrame - 1) / hopSize) * hopSize;
	const output = input.map((channel) => channel.slice());
	for (let channelIndex = 0; channelIndex < input.length; channelIndex += 1) {
		const source = input[channelIndex];
		const accumulation = new Float64Array(endFrame - startFrame);
		const normalization = new Float64Array(endFrame - startFrame);
		const real = new Float64Array(windowSize);
		const imaginary = new Float64Array(windowSize);
		for (let windowStart = firstWindow; windowStart <= lastWindow; windowStart += hopSize) {
			real.fill(0);
			imaginary.fill(0);
			for (let frame = 0; frame < windowSize; frame += 1) {
				const sourceFrame = windowStart + frame;
				if (sourceFrame >= 0 && sourceFrame < frameCount) real[frame] = source[sourceFrame] * window[frame];
			}
			fft(real, imaginary, false);
			for (let bin = 0; bin <= windowSize / 2; bin += 1) {
				const frequency = bin * sampleRate / windowSize;
				if (frequency < minimumFrequency || frequency > maximumFrequency) continue;
				real[bin] *= gain;
				imaginary[bin] *= gain;
				if (bin > 0 && bin < windowSize / 2) {
					const mirror = windowSize - bin;
					real[mirror] *= gain;
					imaginary[mirror] *= gain;
				}
			}
			fft(real, imaginary, true);
			for (let frame = 0; frame < windowSize; frame += 1) {
				const targetFrame = windowStart + frame;
				if (targetFrame < startFrame || targetFrame >= endFrame) continue;
				const localFrame = targetFrame - startFrame;
				const weight = window[frame];
				accumulation[localFrame] += real[frame] * weight;
				normalization[localFrame] += weight * weight;
			}
		}
		for (let frame = startFrame; frame < endFrame; frame += 1) {
			const localFrame = frame - startFrame;
			if (normalization[localFrame] > 1e-12) {
				output[channelIndex][frame] = finiteSample(accumulation[localFrame] / normalization[localFrame]);
			}
		}
	}
	return output;
}

export function deleteSpectralSelection(channels, options = {}) {
	return applySpectralGain(channels, { ...options, gainDb: -Infinity });
}

function createHannWindow(size) {
	const window = new Float64Array(size);
	for (let index = 0; index < size; index += 1) {
		window[index] = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / size);
	}
	return window;
}

function fft(real, imaginary, inverse) {
	const size = real.length;
	for (let index = 1, reversed = 0; index < size; index += 1) {
		let bit = size >> 1;
		while (reversed & bit) {
			reversed ^= bit;
			bit >>= 1;
		}
		reversed ^= bit;
		if (index >= reversed) continue;
		[real[index], real[reversed]] = [real[reversed], real[index]];
		[imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
	}
	for (let length = 2; length <= size; length <<= 1) {
		const angle = (inverse ? 2 : -2) * Math.PI / length;
		const rootReal = Math.cos(angle);
		const rootImaginary = Math.sin(angle);
		for (let offset = 0; offset < size; offset += length) {
			let phaseReal = 1;
			let phaseImaginary = 0;
			for (let index = 0; index < length / 2; index += 1) {
				const even = offset + index;
				const odd = even + length / 2;
				const oddReal = real[odd] * phaseReal - imaginary[odd] * phaseImaginary;
				const oddImaginary = real[odd] * phaseImaginary + imaginary[odd] * phaseReal;
				real[odd] = real[even] - oddReal;
				imaginary[odd] = imaginary[even] - oddImaginary;
				real[even] += oddReal;
				imaginary[even] += oddImaginary;
				const nextPhaseReal = phaseReal * rootReal - phaseImaginary * rootImaginary;
				phaseImaginary = phaseReal * rootImaginary + phaseImaginary * rootReal;
				phaseReal = nextPhaseReal;
			}
		}
	}
	if (!inverse) return;
	for (let index = 0; index < size; index += 1) {
		real[index] /= size;
		imaginary[index] /= size;
	}
}

function normalizeChannels(channels) {
	if (!Array.isArray(channels) || channels.length < 1) throw new TypeError('channels must contain at least one Float32Array.');
	let frameCount = null;
	return channels.map((channel, index) => {
		if (!(channel instanceof Float32Array)) throw new TypeError(`channels[${index}] must be a Float32Array.`);
		if (frameCount == null) frameCount = channel.length;
		else if (channel.length !== frameCount) throw new RangeError('All channels must have the same frame count.');
		return channel;
	});
}

function finiteSample(value) {
	return Number.isFinite(value) ? Math.max(-16, Math.min(16, value)) : 0;
}

function powerOfTwo(value, minimum, maximum, name) {
	const number = positiveInteger(value, name);
	if (number < minimum || number > maximum || (number & (number - 1)) !== 0) {
		throw new RangeError(`${name} must be a power of two between ${minimum} and ${maximum}.`);
	}
	return number;
}

function positiveInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1) throw new RangeError(`${name} must be a positive safe integer.`);
	return number;
}

function boundedInteger(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	}
	return number;
}

function finiteRange(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	}
	return number;
}
