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

const RMS_WINDOW_SIZE = 100;
const EBU_HISTOGRAM_BIN_COUNT = 65_536;
const EBU_ABSOLUTE_GATE = (-70 + 0.691) / 10;
const EBU_POWER_SCALE = 0.8529037031;
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

function applyLinkedDynamics(channels, sampleRate, settings) {
	const frameCount = channels[0].length;
	const envelope = new Float64Array(frameCount);
	const slope = Number.isFinite(settings.ratio) ? 1 / settings.ratio - 1 : -1;
	const kneeHalf = settings.kneeWidthDb / 2;
	const attackSeconds = settings.attackMs / 1_000;
	const releaseSeconds = settings.releaseMs / 1_000;
	const alphaAttack = attackSeconds === 0
		? 1
		: 1 - Math.exp(-1 / (sampleRate * attackSeconds));
	const alphaRelease = releaseSeconds === 0
		? 1
		: 1 - Math.exp(-1 / (sampleRate * releaseSeconds));
	let state = 0;

	for (let index = 0; index < frameCount; index += 1) {
		let sidechain = 0;
		for (const channel of channels) sidechain = Math.max(sidechain, Math.abs(channel[index]));
		const levelDb = sidechain === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(sidechain);
		const overshoot = levelDb - settings.thresholdDb;
		let gainReduction;
		if (overshoot <= -kneeHalf) gainReduction = 0;
		else if (overshoot <= kneeHalf && settings.kneeWidthDb > 0) {
			gainReduction = 0.5 * slope * (overshoot + kneeHalf) ** 2 / settings.kneeWidthDb;
		} else gainReduction = slope * overshoot;
		const difference = gainReduction - state;
		state += (difference < 0 ? alphaAttack : alphaRelease) * difference;
		envelope[index] = state;
	}

	const lookaheadFrames = Math.trunc(settings.lookaheadMs * sampleRate / 1_000);
	if (lookaheadFrames > 0) applyLookaheadEnvelope(envelope, lookaheadFrames);
	return channels.map((channel) => {
		const output = new Float32Array(frameCount);
		for (let index = 0; index < frameCount; index += 1) {
			output[index] = channel[index] * dbToLinear(envelope[index] + settings.makeupGainDb);
		}
		return output;
	});
}

function applyLookaheadEnvelope(envelope, lookaheadFrames) {
	// SimpleCompressor works backwards through its gain-reduction delay line.
	// A one-shot selection can compensate the matching audio delay directly,
	// leaving an aligned, same-length result while preserving that ramp logic.
	let nextGainReduction = 0;
	let step = 0;
	for (let index = envelope.length - 1; index >= 0; index -= 1) {
		const sample = envelope[index];
		if (sample > nextGainReduction) {
			envelope[index] = nextGainReduction;
			nextGainReduction += step;
		} else {
			step = -sample / lookaheadFrames;
			nextGainReduction = sample + step;
		}
	}
}

function applyLegacyCompressorChannel(channel, sampleRate, settings) {
	if (channel.length === 0) return new Float32Array();
	const threshold = dbToLinear(settings.thresholdDb);
	const noiseFloor = dbToLinear(settings.noiseFloorDb);
	const attackInverse = Math.exp(Math.log(threshold) /
		(sampleRate * settings.attackSeconds + 0.5));
	const decay = Math.exp(Math.log(threshold) /
		(sampleRate * settings.releaseSeconds + 0.5));
	const compression = settings.ratio > 1 ? 1 - 1 / settings.ratio : 0;
	const envelope = new Float64Array(channel.length);
	const rmsWindow = new Float64Array(RMS_WINDOW_SIZE);
	let rmsPosition = 0;
	let rmsSum = 0;
	let noiseCounter = RMS_WINDOW_SIZE;
	let lastLevel = threshold;
	for (const sample of channel) lastLevel = Math.max(lastLevel, Math.abs(sample));

	for (let index = 0; index < channel.length; index += 1) {
		let level;
		if (settings.usePeak) level = Math.abs(channel[index]);
		else {
			rmsSum -= rmsWindow[rmsPosition];
			rmsWindow[rmsPosition] = channel[index] * channel[index];
			rmsSum += rmsWindow[rmsPosition];
			rmsPosition = (rmsPosition + 1) % RMS_WINDOW_SIZE;
			level = Math.sqrt(rmsSum / RMS_WINDOW_SIZE);
		}
		if (level < noiseFloor) noiseCounter += 1;
		else noiseCounter = 0;
		if (noiseCounter < RMS_WINDOW_SIZE) {
			lastLevel = Math.max(threshold, lastLevel * decay, level);
		}
		envelope[index] = lastLevel;
	}

	for (let index = envelope.length - 1; index >= 0; index -= 1) {
		lastLevel = Math.max(threshold, lastLevel * attackInverse);
		if (envelope[index] < lastLevel) envelope[index] = lastLevel;
		else lastLevel = envelope[index];
	}

	const output = new Float32Array(channel.length);
	for (let index = 0; index < channel.length; index += 1) {
		const numerator = settings.usePeak ? 1 : threshold;
		const sample = channel[index] * (numerator / envelope[index]) ** compression;
		output[index] = sample;
	}
	return output;
}

function normalizeRms(channels, targetDb, independent) {
	const target = dbToLinear(targetDb);
	const rmsValues = channels.map(channelRms);
	if (independent) {
		return channels.map((channel, index) => rmsValues[index] === 0
			? new Float32Array(channel)
			: multiplyChannel(channel, target / rmsValues[index]));
	}
	let squareSum = 0;
	for (const rms of rmsValues) squareSum += rms * rms;
	const extent = Math.sqrt(squareSum / rmsValues.length);
	return extent === 0 ? cloneChannels(channels) : multiplyChannels(channels, target / extent);
}

function integratedLoudnessPower(channels, sampleRate) {
	if (channels[0].length === 0) return 0;
	const blockSize = Math.ceil(0.4 * sampleRate);
	const blockOverlap = Math.ceil(0.1 * sampleRate);
	const ring = new Float64Array(blockSize);
	const histogram = new Uint32Array(EBU_HISTOGRAM_BIN_COUNT);
	const filters = channels.map(() => weightingFilters(sampleRate));
	let ringPosition = 0;
	let ringSize = 0;
	let histogramCount = 0;

	for (let index = 0; index < channels[0].length; index += 1) {
		let power = 0;
		for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
			const [shelf, highPass] = filters[channelIndex];
			const weighted = processBiquad(
				processBiquad(channels[channelIndex][index], shelf),
				highPass,
			);
			power += weighted * weighted;
		}
		ring[ringPosition] = power;
		ringPosition += 1;
		ringSize += 1;
		if (ringPosition % blockOverlap === 0 && ringSize >= blockSize) {
			histogramCount += addLoudnessBlock(histogram, ring, blockSize);
			ringSize = blockSize;
		}
		if (ringPosition === blockSize) ringPosition = 0;
	}

	if (histogramCount === 0) {
		histogramCount += addLoudnessBlock(histogram, ring, Math.min(ringSize, blockSize));
	}
	if (histogramCount === 0) return 0;
	const absolute = histogramSums(histogram, 0);
	if (absolute.count === 0 || absolute.power === 0) return 0;
	const relativeGate = Math.log10(absolute.power / absolute.count) - 1;
	const relativeIndex = Math.round(
		(relativeGate - EBU_ABSOLUTE_GATE) * EBU_HISTOGRAM_BIN_COUNT
		/ -EBU_ABSOLUTE_GATE - 1,
	);
	const gated = histogramSums(histogram, Math.max(0, relativeIndex + 1));
	return gated.count === 0 ? 0 : EBU_POWER_SCALE * gated.power / gated.count;
}

function weightingFilters(sampleRate) {
	const shelfFrequency = 1681.974450955533;
	const shelfQ = 0.7071752369554196;
	const shelfDb = 3.999843853973347;
	let k = Math.tan(Math.PI * shelfFrequency / sampleRate);
	const high = 10 ** (shelfDb / 20);
	const band = high ** 0.4996667741545416;
	let a0 = 1 + k / shelfQ + k * k;
	const shelf = createBiquad(
		(high + band * k / shelfQ + k * k) / a0,
		2 * (k * k - high) / a0,
		(high - band * k / shelfQ + k * k) / a0,
		2 * (k * k - 1) / a0,
		(1 - k / shelfQ + k * k) / a0,
	);

	const highPassFrequency = 38.13547087602444;
	const highPassQ = 0.5003270373238773;
	k = Math.tan(Math.PI * highPassFrequency / sampleRate);
	a0 = 1 + k / highPassQ + k * k;
	const highPass = createBiquad(
		1,
		-2,
		1,
		2 * (k * k - 1) / a0,
		(1 - k / highPassQ + k * k) / a0,
	);
	return [shelf, highPass];
}

function createBiquad(b0, b1, b2, a1, a2) {
	return { b0, b1, b2, a1, a2, x1: 0, x2: 0, y1: 0, y2: 0 };
}

function processBiquad(input, filter) {
	const output = input * filter.b0 + filter.x1 * filter.b1 + filter.x2 * filter.b2
		- filter.y1 * filter.a1 - filter.y2 * filter.a2;
	filter.x2 = filter.x1;
	filter.x1 = input;
	filter.y2 = filter.y1;
	filter.y1 = output;
	return Math.fround(output);
}

function addLoudnessBlock(histogram, ring, validLength) {
	if (validLength <= 0) return 0;
	let blockPower = 0;
	for (let index = 0; index < validLength; index += 1) blockPower += ring[index];
	if (!(blockPower > 0)) return 0;
	const logPower = Math.log10(blockPower / validLength);
	const histogramIndex = Math.round(
		(logPower - EBU_ABSOLUTE_GATE) * EBU_HISTOGRAM_BIN_COUNT
		/ -EBU_ABSOLUTE_GATE - 1,
	);
	if (histogramIndex < 0 || histogramIndex >= EBU_HISTOGRAM_BIN_COUNT) return 0;
	histogram[histogramIndex] += 1;
	return 1;
}

function histogramSums(histogram, startIndex) {
	let power = 0;
	let count = 0;
	for (let index = startIndex; index < EBU_HISTOGRAM_BIN_COUNT; index += 1) {
		if (histogram[index] === 0) continue;
		const value = -EBU_ABSOLUTE_GATE / EBU_HISTOGRAM_BIN_COUNT * (index + 1)
			+ EBU_ABSOLUTE_GATE;
		power += 10 ** value * histogram[index];
		count += histogram[index];
	}
	return { power, count };
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

function sampleOrZero(channel, index) {
	return index >= 0 && index < channel.length ? channel[index] : 0;
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

function cloneChannels(channels) {
	return channels.map((channel) => new Float32Array(channel));
}

function multiplyChannels(channels, gain) {
	return channels.map((channel) => multiplyChannel(channel, gain));
}

function multiplyChannel(channel, gain) {
	return Float32Array.from(channel, (sample) => sample * gain);
}

function channelPeak(channels) {
	let peak = 0;
	for (const channel of channels) {
		for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
	}
	return peak;
}

function channelRms(channel) {
	if (channel.length === 0) return 0;
	let sum = 0;
	for (const sample of channel) sum += sample * sample;
	return Math.sqrt(sum / channel.length);
}

function dbToLinear(db) {
	return 10 ** (db / 20);
}

function timeToFrames(seconds, sampleRate) {
	return Math.round(seconds * sampleRate);
}
