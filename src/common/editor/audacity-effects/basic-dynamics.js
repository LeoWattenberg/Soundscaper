/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * The gain envelopes Audacity 3.7.7's dynamics effects compute, adapted from
 * commit 5ef610ed23260d6d648175735bb16b32536eb30b:
 * libraries/lib-dynamic-range-processor/CompressorProcessor.cpp and
 * SimpleCompressor/{GainReductionComputer,LookAheadGainReduction}.cpp, and
 * libraries/lib-builtin-effects/LegacyCompressorBase.cpp.
 *
 * Named upstream authors and contributors: Matthieu Hodgkinson, Dominic
 * Mazzoni, Martyn Shaw, Steve Jolly, and Max Maisel. The SimpleCompressor code
 * is Copyright (c) 2019 Daniel Rudrich and comes from
 * https://github.com/DanielRudrich/SimpleCompressor under GPL version 3. This
 * modified JavaScript adaptation was created for kw.media in 2026, and was
 * split out of basic.js without behaviour changes.
 */

import { dbToLinear } from './basic-channel-math.js';

export const RMS_WINDOW_SIZE = 100;

export function applyLinkedDynamics(channels, sampleRate, settings) {
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

export function applyLookaheadEnvelope(envelope, lookaheadFrames) {
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

export function applyLegacyCompressorChannel(channel, sampleRate, settings) {
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

