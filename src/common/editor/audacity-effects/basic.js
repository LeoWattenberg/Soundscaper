/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * One-shot JavaScript adaptations of Audacity 3.7.7 built-in effects from
 * commit 5ef610ed23260d6d648175735bb16b32536eb30b. The adapted source paths
 * are libraries/lib-builtin-effects/{AmplifyBase,AutoDuckBase,
 * LegacyCompressorBase,LoudnessBase,NormalizeBase,RepeatBase,
 * TruncSilenceBase}.cpp, libraries/lib-builtin-effects/{Fade,Invert,
 * Reverse}.cpp, src/effects/Amplify.cpp,
 * libraries/lib-dynamic-range-processor/CompressorProcessor.cpp,
 * libraries/lib-dynamic-range-processor/SimpleCompressor/
 * {GainReductionComputer,LookAheadGainReduction}.cpp, and
 * libraries/lib-math/EBUR128.cpp.
 *
 * Named upstream authors and contributors: Dominic Mazzoni, Markus Meyer,
 * Martyn Shaw, Steve Jolly, Roger B. Dannenberg, Mark Phillips, Max Maisel,
 * Vaughan Johnson, Lynn Allan, Philip Van Baren, and Matthieu Hodgkinson.
 * The SimpleCompressor code is Copyright (c) 2019 Daniel Rudrich and comes
 * from https://github.com/DanielRudrich/SimpleCompressor under GPL version 3.
 * Audacity is distributed under GPL version 3; several individual source
 * files identify themselves as GPL-2.0-or-later. This modified JavaScript
 * adaptation was created for kw.media in 2026.
 */

import { normalizeAudacityEffectParams } from './manifest.js';
import {
	applyLegacyCompressorChannel,
	applyLinkedDynamics,
	RMS_WINDOW_SIZE,
} from './basic-dynamics.js';
import {
	channelPeak,
	cloneChannels,
	dbToLinear,
	multiplyChannel,
	multiplyChannels,
	sampleOrZero,
	timeToFrames,
} from './basic-channel-math.js';
import { integratedLoudnessPower, normalizeRms } from './basic-loudness.js';

const TRUNCATE_BLEND_FRAMES = 100;


/** Audacity Amplify, including its selection-peak clipping guard. */
export function applyAudacityAmplify(channels, sampleRate = 48_000, params = {}) {
	validateAudio(channels, sampleRate);
	const settings = effectParams('audacity-amplify', params);
	let gain = dbToLinear(settings.gainDb);
	if (!settings.allowClipping) {
		const peak = channelPeak(channels);
		if (peak > 0 && peak * gain > 1) gain = 1 / peak;
	}
	return multiplyChannels(channels, gain);
}

/**
 * Audacity Auto Duck. Audacity intentionally analyses only the first channel
 * of the control track, so this port does the same for controlChannels.
 */
export function applyAudacityAutoDuck(
	channels,
	sampleRate = 48_000,
	params = {},
	controlChannels,
) {
	validateAudio(channels, sampleRate);
	validateControlAudio(controlChannels, channels[0].length);
	const settings = effectParams('audacity-auto-duck', params);
	const output = cloneChannels(channels);
	const frameCount = channels[0].length;
	if (frameCount === 0) return output;

	const outerFadeDownFrames = timeToFrames(settings.outerFadeDown, sampleRate);
	const outerFadeUpFrames = timeToFrames(settings.outerFadeUp, sampleRate);
	const scanStart = outerFadeDownFrames;
	const scanEnd = frameCount - outerFadeUpFrames;
	if (scanEnd <= scanStart) return output;

	const maximumPause = Math.max(
		settings.maximumPause,
		settings.outerFadeDown + settings.outerFadeUp,
	);
	const minimumPauseFrames = timeToFrames(maximumPause, sampleRate);
	const threshold = dbToLinear(settings.thresholdDb) ** 2 * RMS_WINDOW_SIZE;
	const rmsWindow = new Float64Array(RMS_WINDOW_SIZE);
	const control = controlChannels[0];
	const regions = [];
	let rmsPosition = 0;
	let rmsSum = 0;
	let inDuckRegion = false;
	let duckRegionStart = 0;
	let pauseFrames = 0;

	for (let index = scanStart; index < scanEnd; index += 1) {
		rmsSum -= rmsWindow[rmsPosition];
		const square = control[index] * control[index];
		rmsWindow[rmsPosition] = square;
		rmsSum += square;
		rmsPosition = (rmsPosition + 1) % RMS_WINDOW_SIZE;

		const thresholdExceeded = rmsSum > threshold;
		if (thresholdExceeded) {
			pauseFrames = 0;
			if (!inDuckRegion) {
				inDuckRegion = true;
				duckRegionStart = index;
			}
		} else if (inDuckRegion) {
			pauseFrames += 1;
			if (pauseFrames >= minimumPauseFrames) {
				regions.push({
					start: duckRegionStart - outerFadeDownFrames,
					end: index - pauseFrames + outerFadeUpFrames,
				});
				inDuckRegion = false;
			}
		}
	}

	if (inDuckRegion) {
		regions.push({
			start: duckRegionStart - outerFadeDownFrames,
			end: scanEnd - pauseFrames + outerFadeUpFrames,
		});
	}

	const fadeDownFrames = Math.max(1, timeToFrames(
		settings.outerFadeDown + settings.innerFadeDown,
		sampleRate,
	));
	const fadeUpFrames = Math.max(1, timeToFrames(
		settings.outerFadeUp + settings.innerFadeUp,
		sampleRate,
	));
	for (const region of regions) {
		const start = Math.max(0, region.start);
		const end = Math.min(frameCount, region.end);
		for (let index = start; index < end; index += 1) {
			const gainDownDb = settings.duckAmountDb * (index - start) / fadeDownFrames;
			const gainUpDb = settings.duckAmountDb * (end - index) / fadeUpFrames;
			const gainDb = Math.max(settings.duckAmountDb, gainDownDb, gainUpDb);
			const gain = dbToLinear(gainDb);
			for (const channel of output) channel[index] *= gain;
		}
	}
	return output;
}

/** Audacity's current linked-channel compressor. */
export function applyAudacityCompressor(channels, sampleRate = 48_000, params = {}) {
	validateAudio(channels, sampleRate);
	const settings = effectParams('audacity-compressor', params);
	return applyLinkedDynamics(channels, sampleRate, {
		thresholdDb: settings.thresholdDb,
		makeupGainDb: settings.makeupGainDb,
		kneeWidthDb: settings.kneeWidthDb,
		ratio: settings.ratio,
		lookaheadMs: settings.lookaheadMs,
		attackMs: settings.attackMs,
		releaseMs: settings.releaseMs,
	});
}

/** Audacity's original, per-channel two-pass compressor. */
export function applyAudacityLegacyCompressor(channels, sampleRate = 48_000, params = {}) {
	validateAudio(channels, sampleRate);
	const settings = effectParams('audacity-legacy-compressor', params);
	const output = channels.map((channel) => applyLegacyCompressorChannel(channel, sampleRate, settings));
	if (!settings.normalize) return output;
	const maximum = channelPeak(output);
	return maximum > 0 ? multiplyChannels(output, 1 / maximum) : output;
}

/** Audacity's linear Fade In curve. */
export function applyAudacityFadeIn(channels, sampleRate = 48_000, params = {}) {
	validateAudio(channels, sampleRate);
	effectParams('audacity-fade-in', params);
	return channels.map((channel) => {
		const output = new Float32Array(channel.length);
		for (let index = 0; index < channel.length; index += 1) {
			output[index] = channel[index] * index / channel.length;
		}
		return output;
	});
}

/** Audacity's linear Fade Out curve. */
export function applyAudacityFadeOut(channels, sampleRate = 48_000, params = {}) {
	validateAudio(channels, sampleRate);
	effectParams('audacity-fade-out', params);
	return channels.map((channel) => {
		const output = new Float32Array(channel.length);
		for (let index = 0; index < channel.length; index += 1) {
			output[index] = channel[index] * (channel.length - 1 - index) / channel.length;
		}
		return output;
	});
}

/** Audacity Invert. */
export function applyAudacityInvert(channels, sampleRate = 48_000, params = {}) {
	validateAudio(channels, sampleRate);
	effectParams('audacity-invert', params);
	return channels.map((channel) => Float32Array.from(channel, (sample) => -sample));
}

/** Audacity's current linked-channel brick-wall limiter. */
export function applyAudacityLimiter(channels, sampleRate = 48_000, params = {}) {
	validateAudio(channels, sampleRate);
	const settings = effectParams('audacity-limiter', params);
	return applyLinkedDynamics(channels, sampleRate, {
		thresholdDb: settings.thresholdDb,
		makeupGainDb: settings.makeupTargetDb - settings.thresholdDb,
		kneeWidthDb: settings.kneeWidthDb,
		ratio: Number.POSITIVE_INFINITY,
		lookaheadMs: settings.lookaheadMs,
		attackMs: 0,
		releaseMs: settings.releaseMs,
	});
}

/** Audacity Loudness Normalization in RMS or EBU R128 mode. */
export function applyAudacityLoudnessNormalization(
	channels,
	sampleRate = 48_000,
	params = {},
) {
	validateAudio(channels, sampleRate);
	const settings = effectParams('audacity-loudness-normalization', params);
	if (settings.mode === 'rms') {
		return normalizeRms(channels, settings.targetRmsDb, settings.stereoIndependent);
	}

	const targetPower = 10 ** (settings.targetLufs / 10);
	if (!settings.stereoIndependent) {
		const extent = integratedLoudnessPower(channels, sampleRate);
		if (extent === 0) return cloneChannels(channels);
		const linkedTargetPower = channels.length === 1 && settings.dualMono
			? targetPower / 2
			: targetPower;
		const gain = Math.sqrt(linkedTargetPower / extent);
		return multiplyChannels(channels, gain);
	}

	const originalIsMono = channels.length === 1;
	return channels.map((channel) => {
		const extent = integratedLoudnessPower([channel], sampleRate);
		if (extent === 0) return new Float32Array(channel);
		let channelTargetPower = targetPower;
		if (settings.dualMono || !originalIsMono) channelTargetPower /= 2;
		return multiplyChannel(channel, Math.sqrt(channelTargetPower / extent));
	});
}

/** Audacity Normalize, including per-channel DC removal and stereo linking. */
export function applyAudacityNormalize(channels, sampleRate = 48_000, params = {}) {
	validateAudio(channels, sampleRate);
	const settings = effectParams('audacity-normalize', params);
	if (!settings.removeDc && !settings.applyGain) return cloneChannels(channels);

	const offsets = channels.map((channel) => {
		if (!settings.removeDc || channel.length === 0) return 0;
		let sum = 0;
		for (const sample of channel) sum += sample;
		return Math.fround(-sum / channel.length);
	});
	const extents = channels.map((channel, channelIndex) => {
		let minimum = Number.POSITIVE_INFINITY;
		let maximum = Number.NEGATIVE_INFINITY;
		for (const sample of channel) {
			if (sample < minimum) minimum = sample;
			if (sample > maximum) maximum = sample;
		}
		if (channel.length === 0) return 0;
		return Math.max(
			Math.abs(minimum + offsets[channelIndex]),
			Math.abs(maximum + offsets[channelIndex]),
		);
	});
	let linkedExtent = 0;
	for (const extent of extents) linkedExtent = Math.max(linkedExtent, extent);
	const target = dbToLinear(settings.peakDb);

	return channels.map((channel, channelIndex) => {
		const extent = settings.stereoIndependent ? extents[channelIndex] : linkedExtent;
		const multiplier = Math.fround(settings.applyGain && extent > 0 ? target / extent : 1);
		const offset = offsets[channelIndex];
		return Float32Array.from(channel, (sample) => (sample + offset) * multiplier);
	});
}

/** Dedicated Audacity Remove DC Offset action without peak normalization. */
export function applyAudacityRemoveDcOffset(channels, sampleRate = 48_000) {
	validateAudio(channels, sampleRate);
	return channels.map((channel) => {
		if (!channel.length) return new Float32Array(channel);
		let sum = 0;
		for (const sample of channel) sum += sample;
		const offset = Math.fround(-sum / channel.length);
		return Float32Array.from(channel, (sample) => sample + offset);
	});
}

/** Audacity Repeat: count is the number of appended copies. */
export function applyAudacityRepeat(channels, sampleRate = 48_000, params = {}) {
	validateAudio(channels, sampleRate);
	const settings = effectParams('audacity-repeat', params);
	const repetitions = settings.count + 1;
	const outputLength = channels[0].length * repetitions;
	if (!Number.isSafeInteger(outputLength) || outputLength > 0xffff_ffff) {
		throw new RangeError('The repeated audio is too large.');
	}
	return channels.map((channel) => {
		const output = new Float32Array(outputLength);
		for (let repetition = 0; repetition < repetitions; repetition += 1) {
			output.set(channel, repetition * channel.length);
		}
		return output;
	});
}

/** Audacity Reverse. */
export function applyAudacityReverse(channels, sampleRate = 48_000, params = {}) {
	validateAudio(channels, sampleRate);
	effectParams('audacity-reverse', params);
	return channels.map((channel) => Float32Array.from(channel).reverse());
}

/** Audacity Truncate Silence with its centred cut and 100-frame crossfade. */
export function applyAudacityTruncateSilence(
	channels,
	sampleRate = 48_000,
	params = {},
) {
	validateAudio(channels, sampleRate);
	const settings = effectParams('audacity-truncate-silence', params);
	const frameCount = channels[0].length;
	if (frameCount === 0) return cloneChannels(channels);
	const threshold = dbToLinear(settings.thresholdDb);
	const minimumFrames = Math.max(1, Math.trunc(
		Math.max(settings.minimumSilence, 0.001) * sampleRate,
	));
	const regions = findLinkedSilentRegions(channels, threshold, minimumFrames);
	let output = cloneChannels(channels);

	for (let regionIndex = regions.length - 1; regionIndex >= 0; regionIndex -= 1) {
		const region = regions[regionIndex];
		const inputFrames = region.end - region.start;
		let outputFrames;
		if (settings.action === 'truncate') {
			outputFrames = Math.min(settings.truncateTo * sampleRate, inputFrames);
		} else {
			outputFrames = minimumFrames
				+ (inputFrames - minimumFrames) * settings.compressPercent / 100;
		}
		const cutFramesExact = Math.max(0, inputFrames - outputFrames);
		if (cutFramesExact === 0) continue;
		const cutStart = Math.round(region.start + outputFrames / 2);
		const cutEnd = Math.round(region.end - outputFrames / 2);
		if (cutEnd <= cutStart) continue;
		const blendFrames = Math.min(TRUNCATE_BLEND_FRAMES, inputFrames);
		output = output.map((channel) => removeRangeWithCrossfade(
			channel,
			cutStart,
			cutEnd,
			blendFrames,
		));
	}
	return output;
}


function findLinkedSilentRegions(channels, threshold, minimumFrames) {
	const regions = [];
	let runStart = -1;
	for (let index = 0; index < channels[0].length; index += 1) {
		let silent = true;
		for (const channel of channels) {
			if (Math.abs(channel[index]) >= threshold) {
				silent = false;
				break;
			}
		}
		if (silent && runStart < 0) runStart = index;
		else if (!silent && runStart >= 0) {
			if (index - runStart >= minimumFrames) regions.push({ start: runStart, end: index });
			runStart = -1;
		}
	}
	if (runStart >= 0 && channels[0].length - runStart >= minimumFrames) {
		regions.push({ start: runStart, end: channels[0].length });
	}
	return regions;
}

function removeRangeWithCrossfade(channel, cutStart, cutEnd, blendFrames) {
	const start = Math.max(0, Math.min(channel.length, cutStart));
	const end = Math.max(start, Math.min(channel.length, cutEnd));
	const removedFrames = end - start;
	if (removedFrames === 0) return new Float32Array(channel);
	const firstBlendFrame = start - Math.floor(blendFrames / 2);
	const secondBlendFrame = end - Math.floor(blendFrames / 2);
	const blended = new Float32Array(blendFrames);
	for (let index = 0; index < blendFrames; index += 1) {
		const left = sampleOrZero(channel, firstBlendFrame + index);
		const right = sampleOrZero(channel, secondBlendFrame + index);
		blended[index] = ((blendFrames - index) * left + index * right) / blendFrames;
	}

	const output = new Float32Array(channel.length - removedFrames);
	output.set(channel.subarray(0, start));
	output.set(channel.subarray(end), start);
	for (let index = 0; index < blendFrames; index += 1) {
		const destination = firstBlendFrame + index;
		if (destination >= 0 && destination < output.length) output[destination] = blended[index];
	}
	return output;
}


function validateAudio(channels, sampleRate) {
	if (!Array.isArray(channels) || channels.length === 0) {
		throw new TypeError('channels must be a non-empty array of Float32Array values.');
	}
	if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
		throw new RangeError('sampleRate must be a positive finite number.');
	}
	const length = channels[0] instanceof Float32Array ? channels[0].length : -1;
	for (const channel of channels) {
		if (!(channel instanceof Float32Array)) throw new TypeError('Every channel must be a Float32Array.');
		if (channel.length !== length) throw new RangeError('All channels must have the same length.');
	}
}

function validateControlAudio(channels, minimumLength) {
	if (!Array.isArray(channels) || channels.length === 0) {
		throw new TypeError('Auto Duck requires at least one control channel.');
	}
	for (const channel of channels) {
		if (!(channel instanceof Float32Array)) {
			throw new TypeError('Every control channel must be a Float32Array.');
		}
		if (channel.length < minimumLength) {
			throw new RangeError('Control channels must span the complete input selection.');
		}
	}
}

function effectParams(type, params) {
	return normalizeAudacityEffectParams(type, params);
}

