import {
	createEbuR128Meter,
	ebuChannelWeights,
	EBU_R128_MAXIMUM_CHANNELS,
} from './ebu-r128.js';

export { findNearestAudioZeroCrossing } from './zero-crossing.js';

export { ANALYSIS_FLOOR_DB, amplitudeToDb, calculateAudioSpectrum } from './audio-spectrum.ts';
import { amplitudeToDb, validateAnalysisChannels } from './audio-spectrum.ts';

/**
 * @typedef {Object} AudioAnalysisResult
 * @property {number} sampleRate
 * @property {number} channelCount
 * @property {number} frameCount
 * @property {number} peakDbfs
 * @property {number} truePeakDbtp
 * @property {number} rmsDbfs
 * @property {number | null} stereoCorrelation
 * @property {number | null} momentaryLufs
 * @property {number | null} shortTermLufs
 * @property {number | null} integratedLufs
 * @property {number | null} loudnessRangeLufs
 */

/**
 * Creates a bounded-state analyzer. Each `push` accepts one equally-sized typed
 * array per channel; K-weighting, gating windows, correlation, and true-peak
 * interpolation remain continuous across arbitrary chunk boundaries.
 *
 * @returns {{push: (channels: Array<ArrayBufferView>) => *, finish: () => AudioAnalysisResult}}
 */
export function createStreamingAudioAnalyzer(options = {}) {
	const sampleRate = Number(options.sampleRate);
	const channelCount = Number(options.channelCount ?? 2);
	if (!Number.isInteger(sampleRate) || sampleRate < 8_000) throw new RangeError('A valid analysis sample rate is required.');
	if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > EBU_R128_MAXIMUM_CHANNELS) {
		throw new RangeError(`Analysis channel count must be from 1 to ${EBU_R128_MAXIMUM_CHANNELS}.`);
	}
	const oversample = Number(options.truePeakOversample ?? 4);
	if (![1, 2, 4, 8].includes(oversample)) throw new RangeError('True-peak oversampling must be 1, 2, 4, or 8.');
	const clipThreshold = Number(options.clipThreshold ?? 1);
	if (!Number.isFinite(clipThreshold) || clipThreshold <= 0) throw new RangeError('Clip threshold must be positive.');
	const channelWeights = options.channelWeights || ebuChannelWeights(channelCount);
	if (channelWeights.length !== channelCount || channelWeights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
		throw new RangeError('A non-negative loudness weight is required for every channel.');
	}

	const ebuMeter = createEbuR128Meter({
		sampleRate,
		channelCount,
		channelWeights,
		running: true,
	});
	const samplePeaks = new Float64Array(channelCount);
	const momentaryFrames = Math.max(1, Math.round(sampleRate * 0.4));
	const momentaryStep = Math.max(1, Math.round(sampleRate * 0.1));
	const shortTermFrames = Math.max(momentaryFrames, Math.round(sampleRate * 3));
	const shortTermStep = Math.max(1, Math.round(sampleRate));
	let frameCount = 0;
	let sampleSquareSum = 0;
	let clippedSamples = 0;
	let clippedFrames = 0;
	let leftSum = 0;
	let rightSum = 0;
	let leftSquareSum = 0;
	let rightSquareSum = 0;
	let crossSum = 0;
	let result = null;

	function push(channels) {
		if (result) throw new Error('Cannot add PCM after analysis has finished.');
		if (!Array.isArray(channels) || channels.length !== channelCount) {
			throw new RangeError(`Expected ${channelCount} PCM channels.`);
		}
		const frames = channels[0]?.length;
		if (!Number.isInteger(frames)) throw new TypeError('PCM channels must be typed arrays.');
		if (channels.some((channel) => !ArrayBuffer.isView(channel) || channel.length !== frames)) {
			throw new RangeError('PCM channels must be equally sized typed arrays.');
		}
		ebuMeter.push(channels);

		for (let frame = 0; frame < frames; frame += 1) {
			let frameClipped = false;
			for (let channel = 0; channel < channelCount; channel += 1) {
				const sample = Number(channels[channel][frame]);
				if (!Number.isFinite(sample)) throw new RangeError('PCM samples must be finite.');
				const absolute = Math.abs(sample);
				samplePeaks[channel] = Math.max(samplePeaks[channel], absolute);
				sampleSquareSum += sample * sample;
				if (absolute >= clipThreshold) {
					clippedSamples += 1;
					frameClipped = true;
				}
			}
			if (frameClipped) clippedFrames += 1;
			if (channelCount >= 2) {
				const left = Number(channels[0][frame]);
				const right = Number(channels[1][frame]);
				leftSum += left;
				rightSum += right;
				leftSquareSum += left * left;
				rightSquareSum += right * right;
				crossSum += left * right;
			}
			frameCount += 1;
		}
		return api;
	}

	function finish() {
		if (result) return result;
		const ebu = ebuMeter.snapshot().loudness;
		const peakAmplitude = Math.max(0, ...samplePeaks);
		const truePeakAmplitude = Number.isFinite(ebu.maximumTruePeakDbtp)
			? Math.max(peakAmplitude, 10 ** (ebu.maximumTruePeakDbtp / 20))
			: peakAmplitude;
		const integratedLufs = ebu.integratedLufs;
		result = Object.freeze({
			sampleRate,
			channelCount,
			frameCount,
			durationSeconds: frameCount / sampleRate,
			peakAmplitude,
			peakDbfs: amplitudeToDb(peakAmplitude),
			channelPeakDbfs: Array.from(samplePeaks, amplitudeToDb),
			truePeakAmplitude,
			truePeakDbtp: amplitudeToDb(truePeakAmplitude),
			truePeakOversample: oversample,
			truePeakEstimated: true,
			rmsAmplitude: frameCount ? Math.sqrt(sampleSquareSum / (frameCount * channelCount)) : 0,
			rmsDbfs: amplitudeToDb(frameCount ? Math.sqrt(sampleSquareSum / (frameCount * channelCount)) : 0),
			clippedSamples,
			clippedFrames,
			stereoCorrelation: calculateCorrelation(),
			momentaryLufs: ebu.momentaryLufs,
			maxMomentaryLufs: ebu.maximumMomentaryLufs,
			shortTermLufs: ebu.shortTermLufs,
			maxShortTermLufs: ebu.maximumShortTermLufs,
			integratedLufs,
			loudnessRangeLufs: ebu.loudnessRangeLu,
			momentaryBlockCount: loudnessBlockCount(frameCount, momentaryFrames, momentaryStep),
			shortTermBlockCount: loudnessBlockCount(frameCount, shortTermFrames, shortTermStep),
		});
		return result;
	}

	function calculateCorrelation() {
		if (channelCount < 2 || frameCount < 2) return null;
		const covariance = crossSum - leftSum * rightSum / frameCount;
		const leftVariance = leftSquareSum - leftSum * leftSum / frameCount;
		const rightVariance = rightSquareSum - rightSum * rightSum / frameCount;
		const denominator = Math.sqrt(Math.max(0, leftVariance) * Math.max(0, rightVariance));
		return denominator > 0 ? Math.max(-1, Math.min(1, covariance / denominator)) : null;
	}

	const api = Object.freeze({ push, finish });
	return api;
}

/** @returns {AudioAnalysisResult} */
export function analyzeAudioChannels(channels, sampleRate, options = {}) {
	return createStreamingAudioAnalyzer({ ...options, sampleRate, channelCount: channels.length })
		.push(channels)
		.finish();
}

/** Audacity-style Find Clipping report with linked-channel frame regions. */
export function findAudioClippingRegions(channels, options = {}) {
	validateAnalysisChannels(channels);
	const threshold = Number(options.threshold ?? 1);
	const minimumConsecutiveSamples = Number(options.minimumConsecutiveSamples ?? 3);
	if (!Number.isFinite(threshold) || threshold <= 0) throw new RangeError('Clipping threshold must be positive.');
	if (!Number.isSafeInteger(minimumConsecutiveSamples) || minimumConsecutiveSamples <= 0) {
		throw new RangeError('Minimum consecutive clipping samples must be positive.');
	}
	const regions = [];
	let startFrame = null;
	let peakAmplitude = 0;
	let clippedSamples = 0;
	for (let frame = 0; frame <= channels[0].length; frame += 1) {
		let framePeak = 0;
		let frameClippedSamples = 0;
		if (frame < channels[0].length) {
			for (const channel of channels) {
				const amplitude = Math.abs(channel[frame]);
				framePeak = Math.max(framePeak, amplitude);
				if (amplitude >= threshold) frameClippedSamples += 1;
			}
		}
		if (frameClippedSamples) {
			if (startFrame == null) startFrame = frame;
			peakAmplitude = Math.max(peakAmplitude, framePeak);
			clippedSamples += frameClippedSamples;
			continue;
		}
		if (startFrame == null) continue;
		const endFrame = frame;
		if (endFrame - startFrame >= minimumConsecutiveSamples) {
			regions.push(Object.freeze({ startFrame, endFrame, frameCount: endFrame - startFrame, clippedSamples, peakAmplitude }));
		}
		startFrame = null;
		peakAmplitude = 0;
		clippedSamples = 0;
	}
	return Object.freeze(regions);
}

/** Audacity Contrast report comparing foreground and background RMS levels. */
export function analyzeAudioContrast(foregroundChannels, backgroundChannels, options = {}) {
	validateAnalysisChannels(foregroundChannels);
	validateAnalysisChannels(backgroundChannels);
	const minimumDifferenceDb = Number(options.minimumDifferenceDb ?? 20);
	if (!Number.isFinite(minimumDifferenceDb) || minimumDifferenceDb < 0) throw new RangeError('Minimum contrast must be non-negative.');
	const foregroundRmsDb = rmsDb(foregroundChannels);
	const backgroundRmsDb = rmsDb(backgroundChannels);
	const differenceDb = foregroundRmsDb - backgroundRmsDb;
	return Object.freeze({
		foregroundRmsDb,
		backgroundRmsDb,
		differenceDb,
		minimumDifferenceDb,
		passes: differenceDb >= minimumDifferenceDb,
	});
}

function rmsDb(channels) {
	let squares = 0;
	let count = 0;
	for (const channel of channels) for (const sample of channel) { squares += sample * sample; count += 1; }
	return amplitudeToDb(count ? Math.sqrt(squares / count) : 0);
}

function loudnessBlockCount(frameCount, windowFrames, stepFrames) {
	return frameCount < windowFrames ? 0 : 1 + Math.floor((frameCount - windowFrames) / stepFrames);
}
