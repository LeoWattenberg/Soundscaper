/* SPDX-License-Identifier: AGPL-3.0-only */

// The stable CommandParameters representation Audacity's RealtimeEffectState
// writes at the pinned revision, and the translation between it and the browser
// rack's own parameter names. This mapping is the portable project format's
// contract, which is why it lives apart from the XML that carries it and why
// browser labels or translated UI strings never enter it. Split out of
// aup4-effects.js; no behaviour changes here.

import {
	booleanParam,
	boundedIndex,
	decodeCommandParameters,
	encodeCommandParameters,
	enumParam,
	finiteNumber,
	numberParam,
	parameterEntries,
	stableNumberString,
} from './audacity-command-parameters.js';
import { isPlainObject } from './aup4-effect-xml-values.js';

export const AUDACITY_EFFECT_ID_PREFIX = 'Effect_Audacity_Audacity_';
export const AUDACITY_EFFECT_PATH_PREFIX = 'Built-in Effect: ';
export const MAX_NATIVE_PARAMETERS = 512;
export const MAX_NATIVE_PARAMETER_NAME_CODE_UNITS = 256;
export const MAX_NATIVE_PARAMETER_VALUE_CODE_UNITS = 4_096;


const DISTORTION_MODES = Object.freeze([
	'hard-clipping', 'soft-clipping', 'soft-overdrive', 'medium-overdrive',
	'hard-overdrive', 'cubic', 'even-harmonics', 'expand-compress', 'leveller',
	'rectifier', 'hard-limiter',
]);
const DISTORTION_NATIVE_MODES = Object.freeze([
	'Hard Clipping', 'Soft Clipping', 'Soft Overdrive', 'Medium Overdrive',
	'Hard Overdrive', 'Cubic Curve (odd harmonics)', 'Even Harmonics',
	'Expand and Compress', 'Leveller', 'Rectifier Distortion', 'Hard Limiter 1413',
]);
const FILTER_FAMILIES = Object.freeze(['butterworth', 'chebyshev-i', 'chebyshev-ii']);
const FILTER_NATIVE_FAMILIES = Object.freeze(['Butterworth', 'Chebyshev Type I', 'Chebyshev Type II']);
const FILTER_DIRECTIONS = Object.freeze(['lowpass', 'highpass']);
const FILTER_NATIVE_DIRECTIONS = Object.freeze(['Lowpass', 'Highpass']);
const EQ_INTERPOLATIONS = Object.freeze(['bspline', 'cosine', 'cubic']);
const EQ_NATIVE_INTERPOLATIONS = Object.freeze(['B-spline', 'Cosine', 'Cubic']);

// These names and symbols are the stable CommandParameters representation
// written by RealtimeEffectState at the pinned Audacity revision. Keeping the
// mapping here prevents browser labels or translated UI strings from becoming
// part of the portable project format.
export const AUP4_REALTIME_EFFECT_PROFILES = deepFreeze({
	'audacity-auto-duck': {
		symbol: 'Auto Duck',
		params: [
			numberParam('duckAmountDb', 'DuckAmountDb'),
			numberParam('innerFadeDown', 'InnerFadeDownLen'),
			numberParam('innerFadeUp', 'InnerFadeUpLen'),
			numberParam('outerFadeDown', 'OuterFadeDownLen'),
			numberParam('outerFadeUp', 'OuterFadeUpLen'),
			numberParam('thresholdDb', 'ThresholdDb'),
			numberParam('maximumPause', 'MaximumPause'),
		],
	},
	'audacity-bass-treble': {
		symbol: 'Bass and Treble',
		params: [
			numberParam('bassDb', 'Bass'),
			numberParam('trebleDb', 'Treble'),
			numberParam('volumeDb', 'Gain'),
			{ native: 'Link Sliders', constant: '0' },
		],
	},
	'audacity-click-removal': {
		symbol: 'Click Removal',
		params: [numberParam('threshold', 'Threshold'), numberParam('maximumWidth', 'Width')],
	},
	'audacity-compressor': {
		symbol: 'Compressor',
		params: [
			numberParam('thresholdDb'), numberParam('makeupGainDb'), numberParam('kneeWidthDb'),
			numberParam('ratio', 'compressionRatio'), numberParam('lookaheadMs'),
			numberParam('attackMs'), numberParam('releaseMs'),
		],
	},
	'audacity-distortion': {
		symbol: 'Distortion',
		params: [
			enumParam('mode', 'Type', DISTORTION_MODES, DISTORTION_NATIVE_MODES), booleanParam('dcBlock', 'DC Block'),
			numberParam('thresholdDb', 'Threshold dB'), numberParam('noiseFloorDb', 'Noise Floor'),
			numberParam('parameter1', 'Parameter 1'), numberParam('parameter2', 'Parameter 2'),
			numberParam('repeats', 'Repeats'),
		],
	},
	'audacity-echo': {
		symbol: 'Echo',
		params: [numberParam('delaySeconds', 'Delay'), numberParam('decay', 'Decay')],
	},
	'audacity-filter-curve-eq': {
		symbol: 'Filter Curve',
		params: [
			numberParam('filterLength', 'FilterLength'),
			booleanParam('linearFrequencyScale', 'InterpolateLin'),
			enumParam('interpolation', 'InterpolationMethod', EQ_INTERPOLATIONS, EQ_NATIVE_INTERPOLATIONS),
		],
		curve: true,
	},
	'audacity-graphic-eq': {
		symbol: 'Graphic EQ',
		params: [
			numberParam('filterLength', 'FilterLength'),
			{ native: 'InterpolateLin', constant: '0' },
			enumParam('interpolation', 'InterpolationMethod', EQ_INTERPOLATIONS, EQ_NATIVE_INTERPOLATIONS),
		],
		bands: true,
	},
	'audacity-invert': { symbol: 'Invert', params: [] },
	'audacity-limiter': {
		symbol: 'Limiter',
		params: [
			numberParam('thresholdDb'), numberParam('makeupTargetDb'), numberParam('kneeWidthDb'),
			numberParam('lookaheadMs'), numberParam('releaseMs'),
		],
	},
	'audacity-noise-reduction': {
		symbol: 'Noise Reduction',
		params: [
			numberParam('sensitivity', 'Sensitivity'),
			numberParam('frequencySmoothingBands', 'Frequency Smoothing Bands'),
			numberParam('reductionDb', 'Noise Gain'),
			{
				model: 'output', native: 'Noise Reduction Choice',
				encode: (value) => value === 'residue' ? '1' : '0',
				decode: (value) => {
					const index = boundedIndex(value, 2);
					return index === undefined ? undefined : index === 1 ? 'residue' : 'reduce';
				},
			},
		],
	},
	'audacity-phaser': {
		symbol: 'Phaser',
		params: [
			numberParam('stages', 'Stages'), numberParam('dryWet', 'DryWet'),
			numberParam('frequency', 'Freq'), numberParam('phaseDegrees', 'Phase'),
			numberParam('depth', 'Depth'), numberParam('feedbackPercent', 'Feedback'),
			numberParam('outputGainDb', 'Gain'),
		],
	},
	'audacity-classic-filters': {
		symbol: 'Classic Filters',
		params: [
			enumParam('family', 'FilterType', FILTER_FAMILIES, FILTER_NATIVE_FAMILIES),
			enumParam('direction', 'FilterSubtype', FILTER_DIRECTIONS, FILTER_NATIVE_DIRECTIONS),
			numberParam('order', 'Order'), numberParam('cutoffHz', 'Cutoff'),
			numberParam('passbandRippleDb', 'PassbandRipple'),
			numberParam('stopbandAttenuationDb', 'StopbandRipple'),
		],
	},
	'audacity-wahwah': {
		symbol: 'Wahwah',
		params: [
			numberParam('frequency', 'Freq'), numberParam('phaseDegrees', 'Phase'),
			numberParam('depthPercent', 'Depth'), numberParam('resonance', 'Resonance'),
			numberParam('frequencyOffsetPercent', 'Offset'), numberParam('outputGainDb', 'Gain'),
		],
	},
});

const TYPE_BY_NATIVE_ID = new Map(Object.entries(AUP4_REALTIME_EFFECT_PROFILES)
	.map(([type, profile]) => [nativeEffectId(profile.symbol), type]));
// Earlier browser builds lower-cased the second word of these two symbols and
// wrote a plugin ID Audacity does not recognize. Keep reading those files.
TYPE_BY_NATIVE_ID.set(nativeEffectId('Click removal'), 'audacity-click-removal');
TYPE_BY_NATIVE_ID.set(nativeEffectId('Noise reduction'), 'audacity-noise-reduction');

export function aup4NativeEffectId(type) {
	const profile = AUP4_REALTIME_EFFECT_PROFILES[type];
	return profile ? nativeEffectId(profile.symbol) : null;
}

export function canEncodeAup4NativeRealtimeEffect(effect) {
	const profile = AUP4_REALTIME_EFFECT_PROFILES[effect?.type];
	if (!profile || effect?.context !== undefined || effect?.state !== undefined || !isPlainObject(effect?.params)) {
		return false;
	}
	const supportedParams = new Set(profile.params
		.filter((descriptor) => descriptor.model)
		.map((descriptor) => descriptor.model));
	if (profile.curve) supportedParams.add('points');
	if (profile.bands) supportedParams.add('gains');
	return Object.keys(effect.params).every((name) => supportedParams.has(name));
}

/**
 * Encode a browser Audacity rack effect's parameters with Audacity's stable
 * CommandParameters names and values. This representation is shared by AUP4
 * realtime effects and text macros.
 */
export function encodeAudacityRealtimeEffectParameters(type, params = {}) {
	const profile = requireRealtimeEffectProfile(type);
	const output = encodeCommandParameters(profile, params);
	appendEqualizationPoints(profile, params, output);
	return Object.freeze(output.map((entry) => Object.freeze(entry)));
}

/**
 * Decode Audacity CommandParameters into browser rack parameters. Unknown
 * parameters are ignored here because AUP4 must preserve future parameters
 * opaquely; callers parsing a stricter interchange format can reject them
 * before calling this helper.
 */
export function decodeAudacityRealtimeEffectParameters(type, parameters) {
	const profile = requireRealtimeEffectProfile(type);
	const nativeParams = parameterEntries(parameters);
	const params = decodeCommandParameters(profile, nativeParams);
	readEqualizationPoints(profile, nativeParams, params);
	return params;
}

function appendEqualizationPoints(profile, params, output) {
	let points = null;
	if (profile.curve && Array.isArray(params.points)) points = params.points;
	if (profile.bands && Array.isArray(params.gains)) {
		const frequencies = params.gains.length === 31
			? [20, 25, 31, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000]
			: [];
		points = frequencies.map((frequency, index) => ({ frequency, gain: params.gains[index] }));
	}
	if (output.length + (points?.length || 0) * 2 > MAX_NATIVE_PARAMETERS) throw new RangeError('Audacity realtime effect has too many parameters.');
	for (const [index, point] of (points || []).entries()) {
		output.push([`f${index}`, stableNumberString(point.frequency)]);
		output.push([`v${index}`, stableNumberString(point.gain)]);
	}
}
function readEqualizationPoints(profile, nativeParams, params) {
	if (!profile.curve && !profile.bands) return;
	const points = [];
	for (let index = 0; index < MAX_NATIVE_PARAMETERS / 2; index += 1) {
		if (!nativeParams.has(`f${index}`) || !nativeParams.has(`v${index}`)) break;
		const frequency = finiteNumber(nativeParams.get(`f${index}`));
		const gain = finiteNumber(nativeParams.get(`v${index}`));
		if (frequency == null || gain == null || frequency <= 0) break;
		points.push({ frequency, gain });
	}
	if (profile.curve && points.length) params.points = points;
	if (profile.bands && points.length === 31) params.gains = points.map((point) => point.gain);
}

function requireRealtimeEffectProfile(type) {
	const profile = AUP4_REALTIME_EFFECT_PROFILES[type];
	if (!profile) throw new RangeError(`Unsupported Audacity realtime effect: ${type}.`);
	return profile;
}

function nativeEffectId(symbol) {
	return `${AUDACITY_EFFECT_ID_PREFIX}${symbol}_${AUDACITY_EFFECT_PATH_PREFIX}${symbol}`;
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

export function realtimeEffectTypeForNativeId(nativeId) {
	return TYPE_BY_NATIVE_ID.get(nativeId);
}

export { nativeEffectId };
