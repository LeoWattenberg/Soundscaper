import {
	estimateAudacityEffectOutputFrames,
	estimateAudacityEffectPeakBytes,
} from './audacity-effects/contracts.js';
import {
	normalizeAudioSelectionEffectParams,
} from './effects.js';
import { PARAMETRIC_EQ_WASM_MEMORY_BYTES } from './parametric-eq/wasm-runtime.js';
import {
	REVIEWED_UTILITY_GAIN_SELECTION_EFFECT_TYPE,
	estimateReviewedUtilityGainOutputFrames, estimateReviewedUtilityGainPeakBytes,
} from './reviewed-effects/selection-effect-contract.ts';
import { BITCRUSHER_EFFECT_TYPE } from './first-party-effects/bitcrusher/definition.js';

const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;
const MEMORY_ESTIMATE_OVERHEAD_BYTES = 2 * 1024 ** 2;

export function estimateAudioSelectionEffectOutputFrames(type, inputFrames, params = {}) {
	if (type === REVIEWED_UTILITY_GAIN_SELECTION_EFFECT_TYPE) {
		return estimateReviewedUtilityGainOutputFrames(inputFrames, params);
	}
	if (type === BITCRUSHER_EFFECT_TYPE) {
		const bitcrusherFrames = positiveInteger(inputFrames, 'inputFrames');
		normalizeAudioSelectionEffectParams(type, params);
		return bitcrusherFrames;
	}
	if (type !== 'eq') return estimateAudacityEffectOutputFrames(type, inputFrames, params);
	const frames = positiveInteger(inputFrames, 'inputFrames');
	normalizeAudioSelectionEffectParams(type, params);
	return frames;
}

export function estimateAudioSelectionEffectPeakBytes(type, inputFrames, params = {}, options = {}) {
	if (type === REVIEWED_UTILITY_GAIN_SELECTION_EFFECT_TYPE) {
		return estimateReviewedUtilityGainPeakBytes(inputFrames, params, options.channelCount ?? 2);
	}
	if (type === BITCRUSHER_EFFECT_TYPE) {
		// One input copy, one output copy, and a few doubles of per-channel state.
		const bitcrusherFrames = positiveInteger(inputFrames, 'inputFrames');
		const bitcrusherChannels = positiveInteger(options.channelCount ?? 2, 'channelCount', 32);
		normalizeAudioSelectionEffectParams(type, params);
		return safeBytes(
			bitcrusherFrames * bitcrusherChannels * FLOAT32_BYTES * 2 + MEMORY_ESTIMATE_OVERHEAD_BYTES,
		);
	}
	if (type !== 'eq') return estimateAudacityEffectPeakBytes(type, inputFrames, params, options);
	const frames = positiveInteger(inputFrames, 'inputFrames');
	const channelCount = positiveInteger(options.channelCount ?? 2, 'channelCount', 32);
	const beforeFrames = nonNegativeInteger(options.beforeFrames ?? 0, 'beforeFrames');
	normalizeAudioSelectionEffectParams(type, params);
	const inputBytes = safeBytes(frames * channelCount * FLOAT32_BYTES);
	const beforeBytes = safeBytes(beforeFrames * channelCount * FLOAT32_BYTES);
	const processingBytes = safeBytes((frames + beforeFrames) * channelCount * FLOAT32_BYTES);
	const renderPeak = safeBytes(inputBytes * 2 + beforeBytes + MEMORY_ESTIMATE_OVERHEAD_BYTES);
	const workerPeak = safeBytes(
		inputBytes * 2
		+ beforeBytes * 2
		+ processingBytes * 2
		+ PARAMETRIC_EQ_WASM_MEMORY_BYTES
		+ MEMORY_ESTIMATE_OVERHEAD_BYTES,
	);
	const persistenceScratch = Math.min(frames, 65_536) * channelCount * FLOAT32_BYTES
		+ Math.ceil(inputBytes / 8);
	const persistencePeak = safeBytes(
		inputBytes * 3 + persistenceScratch + MEMORY_ESTIMATE_OVERHEAD_BYTES,
	);
	return Math.max(renderPeak, workerPeak, persistencePeak);
}

export async function applyAudioSelectionEffectAsync(type, channels, sampleRate, params = {}, context = {}) {
	const implementation = await import('./selection-effects-runtime.js');
	return implementation.applyAudioSelectionEffectAsync(type, channels, sampleRate, params, context);
}

function positiveInteger(value, name, maximum = Number.MAX_SAFE_INTEGER) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return number;
}

function nonNegativeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return number;
}

function safeBytes(value) {
	if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
		throw new RangeError('The effect memory estimate is too large.');
	}
	return Math.ceil(value);
}
