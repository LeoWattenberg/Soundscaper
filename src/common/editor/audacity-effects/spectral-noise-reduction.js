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

export function prepareNoiseReductionGeometry(params, meanPowers) {
	const sensitivity = params.sensitivity * Math.log(10);
	const thresholds = Float64Array.from(meanPowers, power => sensitivity * power);
	const radius = Math.floor(params.frequencySmoothingBands);
	const first = radius > 0 ? new Int32Array(meanPowers.length) : null;
	const end = radius > 0 ? new Int32Array(meanPowers.length) : null;
	if (first) for (let bin = 0; bin < meanPowers.length; bin++) {
		first[bin] = Math.max(0, bin - radius);
		end[bin] = Math.min(meanPowers.length - 1, bin + radius) + 1;
	}
	return { thresholds, first, end };
}

export function reduceNoiseChannel(channel, sampleRate, params, meanPowers, window, attenuation,
	normalization = noiseReductionNormalization(channel.length, window),
	geometry = prepareNoiseReductionGeometry(params, meanPowers)) {
	const starts = paddedFrameStarts(channel.length, NOISE_WINDOW_SIZE, NOISE_HOP_SIZE);
	const binCount = meanPowers.length;
	const workspace = createPowerSpectrumWorkspace(window);
	const powers = Array.from({ length: NOISE_STEPS_PER_WINDOW + 1 }, () => new Float32Array(binCount));
	const gains = new Float32Array(starts.length * binCount);
	const neighborSlots = new Int32Array(powers.length);
	let nextPower = 0;

	for (let frame = 0; frame < starts.length; frame += 1) {
		const first = Math.max(0, frame - NOISE_STEPS_PER_WINDOW / 2);
		const last = Math.min(starts.length - 1, frame + NOISE_STEPS_PER_WINDOW / 2);
		while (nextPower <= last) {
			workspace.read(channel, starts[nextPower], powers[nextPower % powers.length]);
			nextPower += 1;
		}
		const neighborCount = last - first + 1;
		for (let neighbor = 0; neighbor < neighborCount; neighbor++) neighborSlots[neighbor] = (first + neighbor) % powers.length;
		const frameOffset = frame * binCount;
		for (let bin = 0; bin < binCount; bin += 1) {
			let greatest = 0;
			let secondGreatest = 0;
			for (let neighbor = 0; neighbor < neighborCount; neighbor += 1) {
				const power = powers[neighborSlots[neighbor]][bin];
				if (power >= greatest) {
					secondGreatest = greatest;
					greatest = power;
				} else if (power >= secondGreatest) {
					secondGreatest = power;
				}
			}
			gains[frameOffset + bin] = secondGreatest <= geometry.thresholds[bin] ? attenuation : 1;
		}
	}

	const attackBlocks = 1 + Math.floor(0.02 * sampleRate / NOISE_HOP_SIZE);
	const releaseBlocks = 1 + Math.floor(0.1 * sampleRate / NOISE_HOP_SIZE);
	const attackFactor = attenuation ** (1 / attackBlocks);
	const releaseFactor = attenuation ** (1 / releaseBlocks);
	for (let bin = 0; bin < binCount; bin += 1) {
		for (let frame = 1; frame < starts.length; frame += 1) {
			const index = frame * binCount + bin;
			gains[index] = Math.max(gains[index], gains[index - binCount] * releaseFactor);
		}
		for (let frame = starts.length - 2; frame >= 0; frame -= 1) {
			const index = frame * binCount + bin;
			gains[index] = Math.max(gains[index], gains[index + binCount] * attackFactor);
		}
	}

	if (geometry.first) {
		const prefix = new Float64Array(binCount + 1);
		for (let frame = 0; frame < starts.length; frame++) applyGeometricFrequencySmoothing(gains, frame * binCount, binCount, geometry, prefix);
	}

	const accumulated = new Float64Array(channel.length);
	const { real, imaginary } = workspace;
	for (let frame = 0; frame < starts.length; frame += 1) {
		const start = starts[frame];
		workspace.load(channel, start);
		fft(real, imaginary, false);
		for (let bin = 0; bin <= NOISE_WINDOW_SIZE / 2; bin += 1) {
			const gain = gains[frame * binCount + bin];
			real[bin] *= gain;
			imaginary[bin] *= gain;
			if (bin > 0 && bin < NOISE_WINDOW_SIZE / 2) {
				real[NOISE_WINDOW_SIZE - bin] *= gain;
				imaginary[NOISE_WINDOW_SIZE - bin] *= gain;
			}
		}
		fft(real, imaginary, true);
		const firstOutput = Math.max(0, -start);
		const endOutput = Math.min(NOISE_WINDOW_SIZE, channel.length - start);
		for (let index = firstOutput; index < endOutput; index += 1) {
			const outputIndex = start + index;
			accumulated[outputIndex] += real[index] * window[index];
		}
	}

	const reduced = new Float32Array(channel.length);
	for (let frame = 0; frame < reduced.length; frame += 1) {
		reduced[frame] = normalization[frame] > 1e-12 ? accumulated[frame] / normalization[frame] : channel[frame];
	}
	if (params.output === 'reduce') return reduced;
	// Audacity's NRC_LEAVE_RESIDUE multiplies by gain - 1, so its residue
	// has inverted polarity: reduced - original.
	for (let frame = 0; frame < reduced.length; frame += 1) reduced[frame] = reduced[frame] - channel[frame];
	return reduced;
}

function applyGeometricFrequencySmoothing(gains, offset, binCount, geometry, prefix) {
	for (let bin = 0; bin < binCount; bin += 1) {
		prefix[bin + 1] = prefix[bin] + Math.log(gains[offset + bin]);
	}
	for (let bin = 0; bin < binCount; bin += 1) {
		const first = geometry.first[bin];
		const end = geometry.end[bin];
		gains[offset + bin] = Math.exp((prefix[end] - prefix[first]) / (end - first));
	}
}

export function powerSpectrum(channel, start, window) {
	return createPowerSpectrumWorkspace(window).read(channel, start);
}

export function createPowerSpectrumWorkspace(window) {
	const size = window.length;
	const real = new Float64Array(size);
	const imaginary = new Float64Array(size);
	const workspace = {
		real, imaginary,
		load(channel, start) {
			const first = Math.min(size, Math.max(0, -start));
			const end = Math.max(first, Math.min(size, channel.length - start));
			real.fill(0, 0, first);
			real.fill(0, end);
			imaginary.fill(0);
			for (let index = first; index < end; index += 1) {
				const sourceIndex = start + index;
				real[index] = channel[sourceIndex] * window[index];
			}
		},
		read(channel, start, powers = new Float32Array(size / 2 + 1)) {
			workspace.load(channel, start);
			fft(real, imaginary, false);
			for (let bin = 0; bin < powers.length; bin += 1) powers[bin] = real[bin] ** 2 + imaginary[bin] ** 2;
			return powers;
		},
	};
	return workspace;
}

export function noiseReductionNormalization(frameCount, window) {
	const normalization = new Float64Array(frameCount);
	for (const start of paddedFrameStarts(frameCount, window.length, NOISE_HOP_SIZE)) {
		for (let index = 0; index < window.length; index += 1) {
			const outputIndex = start + index;
			if (outputIndex >= 0 && outputIndex < frameCount) normalization[outputIndex] += window[index] * window[index];
		}
	}
	return normalization;
}

function paddedFrameStarts(frameCount, windowSize, hopSize) {
	const starts = [];
	for (let start = -(windowSize - hopSize); start < frameCount; start += hopSize) starts.push(start);
	return starts;
}
