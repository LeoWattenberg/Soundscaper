/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Audacity 3.7.7's spectral noise gate, adapted from commit
 * 5ef610ed23260d6d648175735bb16b32536eb30b:
 * libraries/lib-builtin-effects/NoiseReductionBase.cpp, by Dominic Mazzoni and
 * Paul Licameli, GPL-2.0-or-later upstream. This modified JavaScript adaptation
 * was created for kw.media in 2026 and selects GPL version 3. Split out of
 * spectral.js; no behaviour changes here.
 */

import { fft } from '../pffft.js';

export const NOISE_WINDOW_SIZE = 2_048;
export const NOISE_STEPS_PER_WINDOW = 4;
export const NOISE_HOP_SIZE = NOISE_WINDOW_SIZE / NOISE_STEPS_PER_WINDOW;

export function validateNoiseProfile(profile, sampleRate) {
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

export function reduceNoiseChannel(channel, sampleRate, params, meanPowers, window, attenuation) {
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

export function powerSpectrum(channel, start, window) {
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
