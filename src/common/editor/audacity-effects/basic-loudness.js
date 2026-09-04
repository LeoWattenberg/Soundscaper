/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Loudness measurement for Audacity 3.7.7's normalization effects, adapted from
 * commit 5ef610ed23260d6d648175735bb16b32536eb30b:
 * libraries/lib-math/EBUR128.cpp and
 * libraries/lib-builtin-effects/LoudnessBase.cpp. The K-weighting filter pair,
 * the gated 400 ms block histogram and the RMS path are kept in the upstream
 * single-precision order so measured values match Audacity's.
 *
 * Named upstream authors and contributors: Max Maisel and Dominic Mazzoni. This
 * modified JavaScript adaptation was created for kw.media in 2026, and was
 * split out of basic.js without behaviour changes.
 */

import {
	channelRms,
	cloneChannels,
	dbToLinear,
	multiplyChannel,
	multiplyChannels,
} from './basic-channel-math.js';

const EBU_HISTOGRAM_BIN_COUNT = 65_536;
const EBU_ABSOLUTE_GATE = (-70 + 0.691) / 10;
const EBU_POWER_SCALE = 0.8529037031;

export function normalizeRms(channels, targetDb, independent) {
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

export function integratedLoudnessPower(channels, sampleRate) {
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

export function weightingFilters(sampleRate) {
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

export function createBiquad(b0, b1, b2, a1, a2) {
	return { b0, b1, b2, a1, a2, x1: 0, x2: 0, y1: 0, y2: 0 };
}

export function processBiquad(input, filter) {
	const output = input * filter.b0 + filter.x1 * filter.b1 + filter.x2 * filter.b2
		- filter.y1 * filter.a1 - filter.y2 * filter.a2;
	filter.x2 = filter.x1;
	filter.x1 = input;
	filter.y2 = filter.y1;
	filter.y1 = output;
	return Math.fround(output);
}

export function addLoudnessBlock(histogram, ring, validLength) {
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

export function histogramSums(histogram, startIndex) {
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

