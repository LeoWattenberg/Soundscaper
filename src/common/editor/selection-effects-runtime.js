/* SPDX-License-Identifier: AGPL-3.0-only */

import { applyAudacityEffectAsync } from './audacity-effects/index.js';
import { assertAudacityEffectOutput } from './audacity-effects/contracts.js';
import {
	AUDIO_SELECTION_EFFECT_DEFINITIONS,
	normalizeAudioSelectionEffectParams,
} from './effects.js';
import { processParametricEqChannelsWasm } from './parametric-eq/destructive.js';
import { applySpectralReplacement } from './spectral-edit.js';
import { initializePffft } from './pffft.js';
import {
	applyReviewedUtilityGainSelection,
	REVIEWED_UTILITY_GAIN_SELECTION_EFFECT_TYPE,
} from './reviewed-effects/selection-effect.ts';
import { applyBitcrusher } from './first-party-effects/bitcrusher/dsp.js';
import { BITCRUSHER_EFFECT_TYPE } from './first-party-effects/bitcrusher/definition.js';

export async function applyAudioSelectionEffectAsync(type, channels, sampleRate, params = {}, context = {}) {
	if (!AUDIO_SELECTION_EFFECT_DEFINITIONS[type]) {
		throw new RangeError(`Unsupported selection effect: ${type}.`);
	}
	if (type === REVIEWED_UTILITY_GAIN_SELECTION_EFFECT_TYPE) {
		return applyReviewedUtilityGainSelection(channels, sampleRate, params);
	}
	if (type === BITCRUSHER_EFFECT_TYPE) {
		return assertAudacityEffectOutput(applyBitcrusher(
			assertAudacityEffectOutput(channels),
			sampleRate,
			normalizeAudioSelectionEffectParams(type, params),
		));
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
