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
import { initializePffft } from '../pffft.js';
import {
	audacityEffectLabel,
	normalizeAudacityEffectParams,
} from './manifest.js';
import {
	isStaffPadPassThrough,
	loadStaffPadWasm,
	renderStaffPad,
	staffPadTransformOutputFrames,
} from '../staffpad/index.js';
import {
	assertAudacityEffectOutput,
	audacityStaffPadTransform,
	isAudacityStaffPadEffect,
} from './contracts.js';

let defaultStaffPadRuntimePromise;

export class AudacityStaffPadError extends Error {
	constructor(code, message, options) {
		super(message, options);
		this.name = 'AudacityStaffPadError';
		this.code = code;
	}
}

export * from './manifest.js';
export {
	AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES,
	AUDACITY_STAFFPAD_EFFECT_TYPES,
	assertAudacityEffectOutput,
	audacityStaffPadTransform,
	createAudacityEffectSelection,
	estimateAudacityEffectOutputFrames,
	estimateAudacityEffectPeakBytes,
	isAudacityStaffPadEffect,
} from './contracts.js';
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

export async function applyAudacityEffectAsync(type, channels, sampleRate, params = {}, context = {}) {
	const staffPad = isAudacityStaffPadEffect(type);
	if (!staffPad || context?.spectralSelection) await initializePffft();
	if (!staffPad) {
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

function loadDefaultStaffPadRuntime() {
	defaultStaffPadRuntimePromise ||= loadStaffPadWasm().catch((error) => {
		defaultStaffPadRuntimePromise = undefined;
		throw error;
	});
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
