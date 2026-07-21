import {
	applyAudacityEffectAsync,
	assertAudacityEffectOutput,
	estimateAudacityEffectOutputFrames,
	estimateAudacityEffectPeakBytes,
} from './audacity-effects/index.js';
import {
	AUDIO_SELECTION_EFFECT_DEFINITIONS,
	normalizeAudioSelectionEffectParams,
} from './effects.js';
import { processParametricEqChannelsWasm } from './parametric-eq/destructive.js';
import { PARAMETRIC_EQ_WASM_MEMORY_BYTES } from './parametric-eq/wasm-runtime.js';
import { applySpectralReplacement } from './spectral-edit.js';
import { initializePffft } from './pffft.js';

const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;
const MEMORY_ESTIMATE_OVERHEAD_BYTES = 2 * 1024 ** 2;

export function estimateAudioSelectionEffectOutputFrames(type, inputFrames, params = {}) {
	if (type !== 'eq') return estimateAudacityEffectOutputFrames(type, inputFrames, params);
	const frames = positiveInteger(inputFrames, 'inputFrames');
	normalizeAudioSelectionEffectParams(type, params);
	return frames;
}

export function estimateAudioSelectionEffectPeakBytes(type, inputFrames, params = {}, options = {}) {
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
	if (!AUDIO_SELECTION_EFFECT_DEFINITIONS[type]) {
		throw new RangeError(`Unsupported selection effect: ${type}.`);
	}
	if (type !== 'eq') return applyAudacityEffectAsync(type, channels, sampleRate, params, context);
	await initializePffft();
	const input = assertAudacityEffectOutput(channels);
	const normalized = normalizeAudioSelectionEffectParams(type, params);
	const contextual = prependContextChannels(input, context.beforeChannels);
	const contextualOutput = assertAudacityEffectOutput(await processParametricEqChannelsWasm(
		contextual.channels,
		sampleRate,
		normalized,
		{ wasmModule: context.wasmModule, effectId: context.effectId },
	));
	if (contextualOutput.length !== input.length
		|| contextualOutput.some((channel) => channel.length !== contextual.channels[0].length)) {
		throw new RangeError('The parametric EQ changed the selection channel layout or frame count.');
	}
	const output = contextual.beforeFrames > 0
		? contextualOutput.map((channel) => channel.slice(contextual.beforeFrames))
		: contextualOutput;
	if (!context?.spectralSelection) return assertAudacityEffectOutput(output);
	return assertAudacityEffectOutput(applySpectralReplacement(input, output, {
		...context.spectralSelection,
		sampleRate,
	}));
}

function prependContextChannels(channels, beforeValue) {
	if (beforeValue == null) return { channels, beforeFrames: 0 };
	if (!Array.isArray(beforeValue) || beforeValue.length !== channels.length) {
		throw new RangeError('beforeChannels must match the parametric EQ channel count.');
	}
	let beforeFrames = null;
	const before = beforeValue.map((channel, index) => {
		if (!(channel instanceof Float32Array)) throw new TypeError(`beforeChannels[${index}] must be a Float32Array.`);
		if (beforeFrames == null) beforeFrames = channel.length;
		else if (channel.length !== beforeFrames) throw new RangeError('beforeChannels must have matching lengths.');
		return channel;
	});
	return {
		beforeFrames: beforeFrames || 0,
		channels: channels.map((channel, index) => {
			const combined = new Float32Array((beforeFrames || 0) + channel.length);
			combined.set(before[index]);
			combined.set(channel, beforeFrames || 0);
			return combined;
		}),
	};
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
