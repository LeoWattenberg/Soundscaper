/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * What each Audacity effect can do in a realtime insert: whether it runs live at
 * all, how many inputs it takes, the latency and tail it declares at a given
 * sample rate, and the parameter ranges live processing narrows it to. The
 * processors in live.js are built from these descriptors, and surfaces that only
 * need to describe an effect can read them without loading the DSP.
 */

import {
	audacityEffectDefaults,
	audacityEffectTypes,
	normalizeAudacityEffectParams,
} from './manifest.js';
import { audacitySelectionOnlyReason, isAudacityEffectLiveCapable } from './live-capability-policy.js';
import { secondsToSampleFrame as secondsToFrames } from '../timeline-time.ts';

export const CLICK_WINDOW_SIZE = 8_192;
export const EQ_PARTITION_SIZE = 128;
export const NOISE_WINDOW_SIZE = 2_048;
export const NOISE_HOP_SIZE = 512;
export const NOISE_CHUNK_SIZE = 4_096;
export const MAX_LIVE_DELAY_SECONDS = 10;

const liveCapabilities = Object.fromEntries(audacityEffectTypes().map((type) => {
	const live = isAudacityEffectLiveCapable(type);
	return [type, Object.freeze({
		type,
		mode: live ? 'live' : 'selection-only',
		live,
		inputCount: type === 'audacity-auto-duck' ? 2 : 1,
		requiresSidechain: type === 'audacity-auto-duck',
		requiresNoiseProfile: type === 'audacity-noise-reduction',
		paramRanges: freezeParamRanges(liveParamRanges(type)),
		reason: live ? null : audacitySelectionOnlyReason(type) || 'This effect requires render-ahead selection processing.',
		latencyFrames: (sampleRate, params = {}) => liveLatencyFrames(type, sampleRate, params),
		tailFrames: (sampleRate, params = {}) => liveTailFrames(type, sampleRate, params),
	})];
}));

export const AUDACITY_LIVE_EFFECT_CAPABILITIES = Object.freeze(liveCapabilities);

export function audacityLiveEffectCapability(type) {
	const capability = AUDACITY_LIVE_EFFECT_CAPABILITIES[type];
	if (!capability) throw new RangeError(`Unsupported Audacity effect: ${type}.`);
	return capability;
}

export function isAudacityLiveEffect(type) {
	return Boolean(AUDACITY_LIVE_EFFECT_CAPABILITIES[type]?.live);
}

export function audacityLiveEffectLatencyFrames(type, sampleRate, params = {}) {
	return audacityLiveEffectCapability(type).latencyFrames(sampleRate, params);
}

export function audacityLiveEffectTailFrames(type, sampleRate, params = {}) {
	return audacityLiveEffectCapability(type).tailFrames(sampleRate, params);
}

function liveLatencyFrames(type, sampleRate, params) {
	validateSampleRate(sampleRate);
	if (!isAudacityEffectLiveCapable(type)) return 0;
	const settings = normalizeAudacityEffectParams(type, { ...audacityEffectDefaults(type), ...params });
	validateLiveParamRanges({ type, paramRanges: liveParamRanges(type) }, settings);
	if (type === 'audacity-auto-duck') {
		const outerDown = secondsToFrames(settings.outerFadeDown, sampleRate);
		const innerUp = secondsToFrames(settings.innerFadeUp, sampleRate);
		const pause = secondsToFrames(Math.max(settings.maximumPause, settings.outerFadeDown + settings.outerFadeUp), sampleRate);
		return Math.max(outerDown, pause + innerUp);
	}
	if (type === 'audacity-click-removal') return settings.threshold === 0 || settings.maximumWidth === 0 ? 0 : CLICK_WINDOW_SIZE - 1;
	if (type === 'audacity-compressor' || type === 'audacity-limiter') {
		return Math.trunc(settings.lookaheadMs * sampleRate / 1_000);
	}
	if (type === 'audacity-filter-curve-eq' || type === 'audacity-graphic-eq') {
		const delay = (settings.filterLength - 1) / 2;
		return (Math.floor(delay / EQ_PARTITION_SIZE) + 2) * EQ_PARTITION_SIZE - 1;
	}
	if (type === 'audacity-noise-reduction') {
		const attackBlocks = 1 + Math.floor(0.02 * sampleRate / NOISE_HOP_SIZE);
		const rightContext = NOISE_WINDOW_SIZE + (2 + attackBlocks) * NOISE_HOP_SIZE;
		return NOISE_CHUNK_SIZE + rightContext - 1;
	}
	return 0;
}

function liveTailFrames(type, sampleRate, params) {
	validateSampleRate(sampleRate);
	if (!isAudacityEffectLiveCapable(type)) return 0;
	const settings = normalizeAudacityEffectParams(type, { ...audacityEffectDefaults(type), ...params });
	validateLiveParamRanges({ type, paramRanges: liveParamRanges(type) }, settings);
	if (type === 'audacity-echo') {
		if (!(settings.decay > 0)) return 0;
		if (settings.decay >= 1) return Number.POSITIVE_INFINITY;
		return Math.floor(sampleRate * settings.delaySeconds) * Math.ceil(Math.log(0.001) / Math.log(settings.decay));
	}
	if (type === 'audacity-distortion' && settings.dcBlock) return Math.max(1, Math.floor(sampleRate / 20));
	if (type === 'audacity-filter-curve-eq' || type === 'audacity-graphic-eq') return (settings.filterLength - 1) / 2;
	return 0;
}

export function liveParamRanges(type) {
	if (type === 'audacity-echo') return { delaySeconds: [0.001, MAX_LIVE_DELAY_SECONDS], decay: [0, 0.999] };
	if (type === 'audacity-auto-duck') return { maximumPause: [0, 7] };
	return {};
}

function freezeParamRanges(ranges) {
	return Object.freeze(Object.fromEntries(
		Object.entries(ranges).map(([name, limits]) => [name, Object.freeze([...limits])]),
	));
}

export function validateLiveParamRanges(capability, params) {
	for (const [name, limits] of Object.entries(capability.paramRanges)) {
		const value = Number(params[name]);
		if (!Number.isFinite(value) || value < limits[0] || value > limits[1]) {
			throw new RangeError(`${capability.type}.${name} must be between ${limits[0]} and ${limits[1]} for live processing.`);
		}
	}
}

export function validateSampleRate(value) {
	if (!Number.isFinite(value) || value <= 0) throw new RangeError('sampleRate must be a positive finite number.');
}
