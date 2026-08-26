/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Lightweight live-effect descriptors; processor implementations remain in live.js.
 */

import {
	audacityEffectDefaults,
	audacityEffectTypes,
	normalizeAudacityEffectParams,
} from './manifest.js';
import { secondsToSampleFrame as secondsToFrames } from '../timeline-time.ts';

const CLICK_WINDOW_SIZE = 8_192;
const EQ_PARTITION_SIZE = 128;
const NOISE_WINDOW_SIZE = 2_048;
const NOISE_HOP_SIZE = 512;
const NOISE_CHUNK_SIZE = 4_096;
const MAX_LIVE_DELAY_SECONDS = 10;

const LIVE_TYPES = new Set([
	'audacity-auto-duck',
	'audacity-bass-treble',
	'audacity-click-removal',
	'audacity-compressor',
	'audacity-distortion',
	'audacity-echo',
	'audacity-filter-curve-eq',
	'audacity-graphic-eq',
	'audacity-invert',
	'audacity-limiter',
	'audacity-noise-reduction',
	'audacity-phaser',
	'audacity-classic-filters',
	'audacity-wahwah',
]);

const SELECTION_ONLY_REASONS = Object.freeze({
	'audacity-amplify': 'The no-clipping gain depends on the complete selection peak.',
	'audacity-fade-in': 'The gain curve depends on selection position and length.',
	'audacity-fade-out': 'The gain curve depends on the future selection boundary.',
	'audacity-legacy-compressor': 'The algorithm performs whole-selection and backwards passes.',
	'audacity-loudness-normalization': 'The gain depends on complete-program loudness.',
	'audacity-normalize': 'DC offset and peak gain depend on complete-selection statistics.',
	'audacity-paulstretch': 'The effect changes duration and cannot be a one-in/one-out insert.',
	'audacity-repair': 'Repair requires an explicitly marked short damaged selection and surrounding context.',
	'audacity-repeat': 'The effect changes duration and cannot be a one-in/one-out insert.',
	'audacity-reverse': 'The first output sample depends on the end of the complete selection.',
	'audacity-truncate-silence': 'The effect removes time and cannot be a one-in/one-out insert.',
});

const liveCapabilities = Object.fromEntries(audacityEffectTypes().map((type) => {
	const live = LIVE_TYPES.has(type);
	return [type, Object.freeze({
		type,
		mode: live ? 'live' : 'selection-only',
		live,
		inputCount: type === 'audacity-auto-duck' ? 2 : 1,
		requiresSidechain: type === 'audacity-auto-duck',
		requiresNoiseProfile: type === 'audacity-noise-reduction',
		paramRanges: freezeParamRanges(liveParamRanges(type)),
		reason: live ? null : SELECTION_ONLY_REASONS[type] || 'This effect requires render-ahead selection processing.',
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
	if (!LIVE_TYPES.has(type)) return 0;
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
	if (!LIVE_TYPES.has(type)) return 0;
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

function liveParamRanges(type) {
	if (type === 'audacity-echo') return { delaySeconds: [0.001, MAX_LIVE_DELAY_SECONDS], decay: [0, 0.999] };
	if (type === 'audacity-auto-duck') return { maximumPause: [0, 7] };
	return {};
}

function freezeParamRanges(ranges) {
	return Object.freeze(Object.fromEntries(
		Object.entries(ranges).map(([name, limits]) => [name, Object.freeze([...limits])]),
	));
}

function validateLiveParamRanges(capability, params) {
	for (const [name, limits] of Object.entries(capability.paramRanges)) {
		const value = Number(params[name]);
		if (!Number.isFinite(value) || value < limits[0] || value > limits[1]) {
			throw new RangeError(`${capability.type}.${name} must be between ${limits[0]} and ${limits[1]} for live processing.`);
		}
	}
}

function validateSampleRate(value) {
	if (!Number.isFinite(value) || value <= 0) throw new RangeError('sampleRate must be a positive finite number.');
}
