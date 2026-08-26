/*
 * Audacity 3.7.7 effect validation and admission contracts.
 * SPDX-License-Identifier: GPL-3.0-only
 */

import {
	AUDACITY_EFFECT_DEFINITIONS,
	audacityEffectDefaults,
	normalizeAudacityEffectParams,
} from './manifest.js';
import {
	STAFFPAD_MAXIMUM_MEMORY_BYTES,
	createStaffPadChangePitchTransform,
	createStaffPadChangeSpeedTransform,
	createStaffPadChangeTempoTransform,
	createStaffPadSlidingStretchTransform,
	staffPadTransformOutputFrames,
} from '../staffpad/parameters.js';

const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;
const FLOAT64_BYTES = Float64Array.BYTES_PER_ELEMENT;
const MEMORY_ESTIMATE_OVERHEAD_BYTES = 2 * 1024 ** 2;

export const AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES = 256 * 1024 ** 2;
export const AUDACITY_STAFFPAD_EFFECT_TYPES = Object.freeze([
	'audacity-change-pitch',
	'audacity-change-tempo',
	'audacity-change-speed-pitch',
	'audacity-sliding-stretch',
]);

const AUDACITY_STAFFPAD_EFFECT_TYPE_SET = new Set(AUDACITY_STAFFPAD_EFFECT_TYPES);

export function isAudacityStaffPadEffect(type) {
	return AUDACITY_STAFFPAD_EFFECT_TYPE_SET.has(type);
}

export function audacityStaffPadTransform(type, params = {}) {
	const normalized = normalizeAudacityEffectParams(type, params);
	switch (type) {
		case 'audacity-change-pitch':
			return createStaffPadChangePitchTransform({
				cents: normalized.semitones * 100,
				preserveFormants: normalized.preserveFormants,
			});
		case 'audacity-change-tempo':
			return createStaffPadChangeTempoTransform({ percent: normalized.tempoPercent });
		case 'audacity-change-speed-pitch':
			return createStaffPadChangeSpeedTransform({ rate: 1 + normalized.speedPercent / 100 });
		case 'audacity-sliding-stretch':
			return createStaffPadSlidingStretchTransform({
				startTempoPercent: normalized.startTempoPercent,
				endTempoPercent: normalized.endTempoPercent,
				startPitchCents: normalized.startPitchSemitones * 100,
				endPitchCents: normalized.endPitchSemitones * 100,
				preserveFormants: normalized.preserveFormants,
			});
		default:
			throw new RangeError(`Unsupported StaffPad Audacity effect: ${type}.`);
	}
}

export function estimateAudacityEffectOutputFrames(type, inputFrames, params = {}) {
	const frames = Number(inputFrames);
	if (!Number.isSafeInteger(frames) || frames <= 0) throw new RangeError('inputFrames must be a positive safe integer.');
	const normalized = normalizeAudacityEffectParams(type, params);
	if (isAudacityStaffPadEffect(type)) return safeFrames(staffPadTransformOutputFrames(frames, audacityStaffPadTransform(type, normalized)));
	if (type === 'audacity-repeat') return safeFrames(frames * (normalized.count + 1));
	if (type === 'audacity-paulstretch') return safeFrames(Math.ceil(frames * normalized.stretchFactor));
	return frames;
}

/** Estimate the complete selection-effect browser-process peak. */
export function estimateAudacityEffectPeakBytes(type, inputFrames, params = {}, options = {}) {
	const frames = Number(inputFrames);
	if (!Number.isSafeInteger(frames) || frames <= 0) throw new RangeError('inputFrames must be a positive safe integer.');
	const channelCount = positiveInteger(options.channelCount ?? 2, 'channelCount', 32);
	const sampleRate = Number(options.sampleRate ?? 48_000);
	if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate must be a positive finite number.');
	const normalized = normalizeAudacityEffectParams(type, params);
	const outputFrames = estimateAudacityEffectOutputFrames(type, frames, normalized);
	const inputBytes = safeBytes(frames * channelCount * FLOAT32_BYTES);
	const outputBytes = safeBytes(outputFrames * channelCount * FLOAT32_BYTES);
	let contextBytes = 0;
	let scratchBytes = 0;
	if (options.spectralWindowSize != null) {
		const windowSize = positiveInteger(options.spectralWindowSize, 'spectralWindowSize', 16_384);
		if (windowSize < 32 || (windowSize & (windowSize - 1)) !== 0) {
			throw new RangeError('spectralWindowSize must be a power of two between 32 and 16384.');
		}
		scratchBytes += inputBytes + frames * FLOAT64_BYTES * 2 + windowSize * FLOAT64_BYTES * 5;
	}

	switch (type) {
		case 'audacity-change-pitch':
		case 'audacity-change-tempo':
		case 'audacity-change-speed-pitch':
		case 'audacity-sliding-stretch':
			contextBytes += (nonNegativeInteger(options.beforeFrames ?? 0, 'beforeFrames')
				+ nonNegativeInteger(options.afterFrames ?? 0, 'afterFrames'))
				* channelCount * FLOAT32_BYTES * 2;
			scratchBytes += STAFFPAD_MAXIMUM_MEMORY_BYTES;
			break;
		case 'audacity-auto-duck': {
			const controlChannelCount = positiveInteger(
				options.controlChannelCount ?? channelCount,
				'controlChannelCount',
				32,
			);
			contextBytes += frames * controlChannelCount * FLOAT32_BYTES * 2;
			break;
		}
		case 'audacity-click-removal':
			scratchBytes += 8_192 * (FLOAT32_BYTES + FLOAT64_BYTES * 3);
			break;
		case 'audacity-compressor':
		case 'audacity-legacy-compressor':
		case 'audacity-limiter':
			scratchBytes += frames * FLOAT64_BYTES;
			break;
		case 'audacity-echo':
			scratchBytes += Math.floor(sampleRate * normalized.delaySeconds) * FLOAT32_BYTES;
			break;
		case 'audacity-filter-curve-eq':
		case 'audacity-graphic-eq': {
			const fftSize = nextPowerOfTwo(normalized.filterLength * 2);
			scratchBytes += frames * FLOAT64_BYTES
				+ normalized.filterLength * FLOAT64_BYTES
				+ fftSize * FLOAT64_BYTES * 4;
			break;
		}
		case 'audacity-loudness-normalization':
			scratchBytes += Math.ceil(sampleRate * 0.4) * FLOAT64_BYTES
				+ 65_536 * Uint32Array.BYTES_PER_ELEMENT;
			break;
		case 'audacity-noise-reduction':
			scratchBytes += frames * 40 + 256 * 1024;
			contextBytes += 2 * (2_048 / 2 + 1) * FLOAT32_BYTES;
			break;
		case 'audacity-paulstretch': {
			const requested = sampleRate * normalized.timeResolution / 2;
			const inputBufferSize = Math.max(128, 2 ** Math.floor(Math.log2(requested) + 0.5));
			const fftSize = inputBufferSize * 2;
			scratchBytes += outputFrames * FLOAT64_BYTES * 2
				+ fftSize * FLOAT64_BYTES * 3;
			break;
		}
		case 'audacity-repair': {
			const beforeFrames = nonNegativeInteger(options.beforeFrames ?? 128, 'beforeFrames');
			const afterFrames = nonNegativeInteger(options.afterFrames ?? 128, 'afterFrames');
			contextBytes += (beforeFrames + afterFrames) * channelCount * FLOAT32_BYTES * 2;
			scratchBytes += 64 * 1024;
			break;
		}
		case 'audacity-truncate-silence':
			scratchBytes += outputBytes;
			break;
		default:
			break;
	}

	const renderPeak = safeBytes(inputBytes * 2 + MEMORY_ESTIMATE_OVERHEAD_BYTES);
	const workerPeak = safeBytes(
		inputBytes * 2 + outputBytes + contextBytes + scratchBytes + MEMORY_ESTIMATE_OVERHEAD_BYTES,
	);
	const persistenceScratch = Math.min(outputFrames, 65_536) * channelCount * FLOAT32_BYTES
		+ Math.ceil(outputBytes / 8);
	const persistencePeak = safeBytes(
		inputBytes + outputBytes * 2 + persistenceScratch + MEMORY_ESTIMATE_OVERHEAD_BYTES,
	);
	return Math.max(renderPeak, workerPeak, persistencePeak);
}

/** Validate the shape and every PCM value returned by an effect. */
export function assertAudacityEffectOutput(channels) {
	if (!Array.isArray(channels) || channels.length === 0) {
		throw new TypeError('Audacity effect output must be a non-empty array of Float32Array channels.');
	}
	let frameCount = null;
	for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
		const channel = channels[channelIndex];
		if (!(channel instanceof Float32Array)) {
			throw new TypeError(`Audacity effect output channel ${channelIndex} must be a Float32Array.`);
		}
		if (frameCount == null) frameCount = channel.length;
		else if (channel.length !== frameCount) throw new RangeError('Audacity effect output channels must have matching lengths.');
		for (let frame = 0; frame < channel.length; frame += 1) {
			if (!Number.isFinite(channel[frame])) {
				throw new RangeError(`Audacity effect output channel ${channelIndex} contains a non-finite sample at frame ${frame}.`);
			}
		}
	}
	return channels;
}

export function createAudacityEffectSelection(type, params = {}) {
	if (!AUDACITY_EFFECT_DEFINITIONS[type]) throw new RangeError(`Unsupported Audacity effect: ${type}.`);
	return { type, params: normalizeAudacityEffectParams(type, { ...audacityEffectDefaults(type), ...params }) };
}

function safeFrames(value) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('The effect output is too large.');
	return value;
}

function safeBytes(value) {
	if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
		throw new RangeError('The effect memory estimate is too large.');
	}
	return Math.ceil(value);
}

function positiveInteger(value, name, maximum = Number.MAX_SAFE_INTEGER) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
		throw new RangeError(`${name} must be a positive integer no greater than ${maximum}.`);
	}
	return number;
}

function nonNegativeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`${name} must be a non-negative integer.`);
	return number;
}

function nextPowerOfTwo(value) {
	return 2 ** Math.ceil(Math.log2(value));
}
