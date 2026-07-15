/*
 * Audacity 3.7.7 native effect dispatcher.
 * SPDX-License-Identifier: GPL-3.0-only
 * See THIRD_PARTY_LICENSES.md and the repository LICENSE.
 */

import {
	applyAudacityAmplify,
	applyAudacityAutoDuck,
	applyAudacityCompressor,
	applyAudacityFadeIn,
	applyAudacityFadeOut,
	applyAudacityInvert,
	applyAudacityLegacyCompressor,
	applyAudacityLimiter,
	applyAudacityLoudnessNormalization,
	applyAudacityNormalize,
	applyAudacityRemoveDcOffset,
	applyAudacityRepeat,
	applyAudacityReverse,
	applyAudacityTruncateSilence,
} from './basic.js';
import {
	applyAudacityBassTreble,
	applyAudacityClassicFilter,
	applyAudacityDistortion,
	applyAudacityEcho,
	applyAudacityPhaser,
	applyAudacityWahwah,
} from './realtime.js';
import {
	applyAudacityClickRemoval,
	applyAudacityFilterCurveEq,
	applyAudacityGraphicEq,
	applyAudacityNoiseReduction,
	applyAudacityPaulstretch,
	applyAudacityRepair,
	captureAudacityNoiseProfile as captureNoiseProfile,
} from './spectral.js';
import { applyAudacityBrowserReverb } from './reverb.js';
import { applySpectralReplacement } from '../spectral-edit.js';
import {
	AUDACITY_EFFECT_DEFINITIONS,
	audacityEffectLabel,
	audacityEffectDefaults,
	normalizeAudacityEffectParams,
} from './manifest.js';
import {
	createStaffPadChangePitchTransform,
	createStaffPadChangeSpeedTransform,
	createStaffPadChangeTempoTransform,
	createStaffPadSlidingStretchTransform,
	isStaffPadPassThrough,
	loadStaffPadWasm,
	renderStaffPad,
	staffPadTransformOutputFrames,
} from '../staffpad/index.js';

const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;
const FLOAT64_BYTES = Float64Array.BYTES_PER_ELEMENT;
const MEMORY_ESTIMATE_OVERHEAD_BYTES = 2 * 1024 ** 2;
const STAFFPAD_WASM_WORKING_SET_BYTES = 16 * 1024 ** 2;
export const AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES = 256 * 1024 ** 2;
export const AUDACITY_STAFFPAD_EFFECT_TYPES = Object.freeze([
	'audacity-change-pitch',
	'audacity-change-tempo',
	'audacity-change-speed-pitch',
	'audacity-sliding-stretch',
]);

const AUDACITY_STAFFPAD_EFFECT_TYPE_SET = new Set(AUDACITY_STAFFPAD_EFFECT_TYPES);
let defaultStaffPadRuntimePromise;

export class AudacityStaffPadError extends Error {
	constructor(code, message, options) {
		super(message, options);
		this.name = 'AudacityStaffPadError';
		this.code = code;
	}
}

export * from './manifest.js';
export { captureNoiseProfile as captureAudacityNoiseProfile };

/**
 * Apply one Audacity-native effect to an in-memory selection.
 * Inputs are never mutated. Length-changing effects return different-sized
 * channel arrays; every other effect retains the input frame count.
 */
export function applyAudacityEffect(type, channels, sampleRate, params = {}, context = {}) {
	const normalized = normalizeAudacityEffectParams(type, params);
	if (isAudacityStaffPadEffect(type)) {
		throw new AudacityStaffPadError(
			'STAFFPAD_ASYNC_REQUIRED',
			`${audacityEffectLabel(type, 'en')} requires the asynchronous StaffPad WebAssembly dispatcher.`,
		);
	}
	let output;
	switch (type) {
		case 'audacity-amplify': output = applyAudacityAmplify(channels, sampleRate, normalized); break;
		case 'audacity-auto-duck': output = applyAudacityAutoDuck(channels, sampleRate, normalized, context.controlChannels); break;
		case 'audacity-bass-treble': output = applyAudacityBassTreble(channels, sampleRate, normalized); break;
		case 'audacity-click-removal': output = applyAudacityClickRemoval(channels, sampleRate, normalized); break;
		case 'audacity-compressor': output = applyAudacityCompressor(channels, sampleRate, normalized); break;
		case 'audacity-legacy-compressor': output = applyAudacityLegacyCompressor(channels, sampleRate, normalized); break;
		case 'audacity-distortion': output = applyAudacityDistortion(channels, sampleRate, normalized); break;
		case 'audacity-echo': output = applyAudacityEcho(channels, sampleRate, normalized); break;
		case 'audacity-fade-in': output = applyAudacityFadeIn(channels, sampleRate, normalized); break;
		case 'audacity-fade-out': output = applyAudacityFadeOut(channels, sampleRate, normalized); break;
		case 'audacity-filter-curve-eq': output = applyAudacityFilterCurveEq(channels, sampleRate, normalized); break;
		case 'audacity-graphic-eq': output = applyAudacityGraphicEq(channels, sampleRate, normalized); break;
		case 'audacity-invert': output = applyAudacityInvert(channels, sampleRate, normalized); break;
		case 'audacity-limiter': output = applyAudacityLimiter(channels, sampleRate, normalized); break;
		case 'audacity-loudness-normalization': output = applyAudacityLoudnessNormalization(channels, sampleRate, normalized); break;
		case 'audacity-noise-reduction': output = applyAudacityNoiseReduction(channels, sampleRate, normalized, context.noiseProfile); break;
		case 'audacity-normalize': output = applyAudacityNormalize(channels, sampleRate, normalized); break;
		case 'audacity-paulstretch': output = applyAudacityPaulstretch(channels, sampleRate, normalized, context); break;
		case 'audacity-phaser': output = applyAudacityPhaser(channels, sampleRate, normalized); break;
		case 'audacity-repair': output = applyAudacityRepair(channels, sampleRate, normalized, context); break;
		case 'audacity-remove-dc-offset': output = applyAudacityRemoveDcOffset(channels, sampleRate); break;
		case 'audacity-reverb': output = applyAudacityBrowserReverb(channels, sampleRate, normalized); break;
		case 'audacity-repeat': output = applyAudacityRepeat(channels, sampleRate, normalized); break;
		case 'audacity-reverse': output = applyAudacityReverse(channels, sampleRate, normalized); break;
		case 'audacity-classic-filters': output = applyAudacityClassicFilter(channels, sampleRate, normalized); break;
		case 'audacity-truncate-silence': output = applyAudacityTruncateSilence(channels, sampleRate, normalized); break;
		case 'audacity-wahwah': output = applyAudacityWahwah(channels, sampleRate, normalized); break;
		default: throw new RangeError(`Unsupported Audacity effect: ${type}.`);
	}
	return assertAudacityEffectOutput(output);
}

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

export async function applyAudacityEffectAsync(type, channels, sampleRate, params = {}, context = {}) {
	if (!isAudacityStaffPadEffect(type)) {
		return applyAudacitySpectralContext(
			channels,
			applyAudacityEffect(type, channels, sampleRate, params, context),
			sampleRate,
			context,
		);
	}
	const normalizedChannels = assertAudacityEffectOutput(channels);
	if (normalizedChannels[0].length === 0) throw new RangeError('StaffPad input must contain at least one frame.');
	const transform = audacityStaffPadTransform(type, params);
	if (isStaffPadPassThrough(transform)) {
		return applyAudacitySpectralContext(
			normalizedChannels,
			normalizedChannels.map((channel) => new Float32Array(channel)),
			sampleRate,
			context,
		);
	}
	const contextual = staffPadContextChannels(normalizedChannels, context);
	let runtime = context.staffPadRuntime;
	if (!runtime) {
		try {
			runtime = context.staffPadWasmSource == null
				? await loadDefaultStaffPadRuntime()
				: await loadStaffPadWasm(context.staffPadWasmSource);
		} catch (cause) {
			throw new AudacityStaffPadError(
				'STAFFPAD_WASM_UNAVAILABLE',
				'StaffPad WebAssembly is unavailable; the effect was not applied.',
				{ cause },
			);
		}
	}
	const outputFrames = staffPadTransformOutputFrames(normalizedChannels[0].length, transform);
	const output = Array.from({ length: normalizedChannels.length }, () => new Float32Array(outputFrames));
	let nextFrame = 0;
	await renderStaffPad({
		channels: contextual.channels,
		sampleRate,
		selection: {
			startFrame: contextual.beforeFrames,
			frameCount: normalizedChannels[0].length,
		},
		transform,
	}, runtime, {
		isCancelled: typeof context.isCancelled === 'function' ? context.isCancelled : undefined,
		onProgress: typeof context.onProgress === 'function' ? context.onProgress : undefined,
		onChunk(chunk, frameOffset) {
			if (frameOffset !== nextFrame) throw new Error('StaffPad returned non-contiguous output.');
			for (let channel = 0; channel < output.length; channel += 1) output[channel].set(chunk[channel], frameOffset);
			nextFrame += chunk[0].length;
		},
	});
	if (nextFrame !== outputFrames) throw new Error(`StaffPad returned ${nextFrame} of ${outputFrames} frames.`);
	return applyAudacitySpectralContext(normalizedChannels, assertAudacityEffectOutput(output), sampleRate, context);
}

function applyAudacitySpectralContext(channels, processed, sampleRate, context) {
	if (!context?.spectralSelection) return processed;
	return applySpectralReplacement(channels, processed, {
		...context.spectralSelection,
		sampleRate,
	});
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

/**
 * Estimate the browser-process peak for the complete selection-effect path:
 * dry render, transferred worker inputs, DSP output/scratch, AudioBuffer copy,
 * chunked persistence, and waveform peak generation. Effect scratch is based
 * on the one-shot algorithms in this directory, not merely output size.
 */
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
		// The bin compositor retains the processed output, allocates a complete
		// replacement output, two Float64 overlap-add extents, and five reusable
		// window/complex FFT arrays for one channel.
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
			scratchBytes += STAFFPAD_WASM_WORKING_SET_BYTES;
			break;
		case 'audacity-auto-duck': {
			// The dry-rendered control track and its transferred worker clone.
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
			// One Float64 convolution extent plus the reusable kernel/block FFTs.
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
			// Per-frame spectra/gains and Float64 overlap-add accumulators for the
			// currently processed channel. The small profile exists in both realms.
			scratchBytes += frames * 40 + 256 * 1024;
			contextBytes += 2 * (2_048 / 2 + 1) * FLOAT32_BYTES;
			break;
		case 'audacity-paulstretch': {
			const requested = sampleRate * normalized.timeResolution / 2;
			const inputBufferSize = Math.max(128, 2 ** Math.floor(Math.log2(requested) + 0.5));
			const fftSize = inputBufferSize * 2;
			// Float64 overlap-add and normalization extents for one channel, plus
			// the Hann window and complex FFT working arrays.
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
			// A shortening pass can briefly retain the preceding and next arrays.
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

function loadDefaultStaffPadRuntime() {
	defaultStaffPadRuntimePromise ||= loadStaffPadWasm();
	return defaultStaffPadRuntimePromise;
}

function staffPadContextChannels(channels, context) {
	const before = normalizeOptionalContextChannels(context.beforeChannels, channels.length, 'beforeChannels');
	const after = normalizeOptionalContextChannels(context.afterChannels, channels.length, 'afterChannels');
	const beforeFrames = before?.[0].length ?? 0;
	const afterFrames = after?.[0].length ?? 0;
	return {
		beforeFrames,
		channels: channels.map((channel, index) => {
			const combined = new Float32Array(beforeFrames + channel.length + afterFrames);
			if (before) combined.set(before[index], 0);
			combined.set(channel, beforeFrames);
			if (after) combined.set(after[index], beforeFrames + channel.length);
			return combined;
		}),
	};
}

function normalizeOptionalContextChannels(value, channelCount, name) {
	if (value == null) return null;
	if (!Array.isArray(value) || value.length !== channelCount) {
		throw new RangeError(`${name} must match the StaffPad channel count.`);
	}
	let frameCount = null;
	return value.map((channel, channelIndex) => {
		if (!(channel instanceof Float32Array)) throw new TypeError(`${name}[${channelIndex}] must be a Float32Array.`);
		if (frameCount == null) frameCount = channel.length;
		else if (channel.length !== frameCount) throw new RangeError(`${name} channels must have matching lengths.`);
		return channel;
	});
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
