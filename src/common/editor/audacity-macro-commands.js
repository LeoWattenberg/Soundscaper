/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Audacity's text-macro command IDs and the CommandParameters contract for the
 * effects a macro applies over a selection rather than through a realtime rack.
 *
 * A command ID is EffectDefinitionInterface::GetSquashedName applied to the
 * effect's ComponentInterfaceSymbol; parameter names, value encodings and
 * declaration order come from each effect's own EffectParameter declarations.
 * Ported from Audacity 3.7.7 commit
 * 5ef610ed23260d6d648175735bb16b32536eb30b. Audacity is distributed under GPL
 * version 3; this JavaScript adaptation was created for kw.media in 2026.
 */

import {
	AUP4_REALTIME_EFFECT_PROFILES,
	decodeAudacityRealtimeEffectParameters,
	encodeAudacityRealtimeEffectParameters,
} from './aup4-effects.js';
import {
	booleanParam,
	boundedIndex,
	constantParam,
	decodeCommandParameters,
	encodeCommandParameters,
	enumParam,
	finiteNumber,
	numberParam,
	roundedParameter,
	stableNumberString,
} from './audacity-command-parameters.js';

const TRUNCATE_SILENCE_ACTIONS = Object.freeze(['truncate', 'compress']);
const TRUNCATE_SILENCE_NATIVE_ACTIONS = Object.freeze([
	'Truncate Detected Silence', 'Compress Excess Silence',
]);
const LOUDNESS_TARGETS = Object.freeze(['lufs', 'rms']);

/**
 * Audacity's EffectDefinitionInterface::GetSquashedName: the internal symbol
 * split on spaces, each token capitalized, and joined. This is the only place a
 * macro command ID is decided, so a command can never drift from the effect
 * symbol the AUP4 plugin ID is built from.
 */
export function audacitySquashedName(symbol) {
	return String(symbol).trim().split(' ').filter(Boolean)
		.map((token) => token.slice(0, 1).toUpperCase() + token.slice(1).toLowerCase())
		.join('');
}

/** Audacity stores Amplify as a linear ratio; the browser stores decibels. */
const decibelRatioParam = (model, native) => ({
	model,
	native,
	kind: 'number',
	encode: (value) => stableNumberString(10 ** (Number(value) / 20)),
	decode: (value) => {
		const ratio = finiteNumber(value);
		return ratio === undefined || !(ratio > 0)
			? undefined
			: roundedParameter(20 * Math.log10(ratio));
	},
});

/**
 * Audacity stores a pitch shift as the percentage change in frequency, which
 * its own Calc_SemitonesChange_fromPercentChange converts back to the semitones
 * the browser's shifter takes.
 */
const semitonePercentParam = (model, native) => ({
	model,
	native,
	kind: 'number',
	encode: (value) => stableNumberString(100 * (2 ** (Number(value) / 12) - 1)),
	decode: (value) => {
		const percent = finiteNumber(value);
		return percent === undefined || !(100 + percent > 0)
			? undefined
			: roundedParameter(12 * Math.log2((100 + percent) / 100));
	},
});

/** An option Audacity stores as a bare index rather than a symbolic name. */
const indexParam = (model, native, values) => ({
	model,
	native,
	kind: 'enum',
	encode: (value) => {
		const index = values.indexOf(value);
		if (index < 0) throw new RangeError(`Unsupported ${native} value: ${value}.`);
		return String(index);
	},
	decode: (value) => {
		const index = boundedIndex(value, values.length);
		return index === undefined ? undefined : values[index];
	},
});

/** Accept a name an earlier Audacity 3 release wrote; always emit the current one. */
const withLegacyNames = (descriptor, ...legacyNatives) => ({ ...descriptor, legacyNatives });

/**
 * The effects a macro applies one selection at a time. Audacity's realtime rack
 * effects keep their contract in AUP4_REALTIME_EFFECT_PROFILES because their
 * parameters also have to survive a project round trip; these run offline and
 * exist only in macro text.
 */
export const AUDACITY_SELECTION_EFFECT_MACRO_PROFILES = deepFreeze({
	'audacity-amplify': {
		symbol: 'Amplify',
		params: [
			decibelRatioParam('gainDb', 'Ratio'),
			booleanParam('allowClipping', 'AllowClipping'),
		],
		// Audacity captures only Ratio when Amplify runs from a macro and forces
		// clipping on, so a macro Audacity itself wrote carries no clipping flag
		// and means "allow it".
		macroDefaults: { allowClipping: true },
	},
	'audacity-change-pitch': {
		symbol: 'Change Pitch',
		params: [
			semitonePercentParam('semitones', 'Percentage'),
			// Audacity 3 picks between SoundTouch and SBSMS here. Soundscaper
			// always uses the StaffPad shifter Audacity 4 adopted, so the macro
			// carries Audacity's own default rather than a mapped value, and
			// formant preservation has no Audacity 3 representation at all.
			constantParam('SBSMS', '0'),
		],
	},
	'audacity-change-speed-pitch': {
		symbol: 'Change Speed and Pitch',
		params: [numberParam('speedPercent', 'Percentage')],
	},
	'audacity-change-tempo': {
		symbol: 'Change Tempo',
		params: [numberParam('tempoPercent', 'Percentage'), constantParam('SBSMS', '0')],
	},
	'audacity-fade-in': { symbol: 'Fade In', params: [] },
	'audacity-fade-out': { symbol: 'Fade Out', params: [] },
	'audacity-legacy-compressor': {
		symbol: 'Legacy Compressor',
		params: [
			numberParam('thresholdDb', 'Threshold'),
			numberParam('noiseFloorDb', 'NoiseFloor'),
			numberParam('ratio', 'Ratio'),
			numberParam('attackSeconds', 'AttackTime'),
			numberParam('releaseSeconds', 'ReleaseTime'),
			booleanParam('normalize', 'Normalize'),
			booleanParam('usePeak', 'UsePeak'),
		],
	},
	'audacity-loudness-normalization': {
		symbol: 'Loudness Normalization',
		params: [
			booleanParam('stereoIndependent', 'StereoIndependent'),
			numberParam('targetLufs', 'LUFSLevel'),
			numberParam('targetRmsDb', 'RMSLevel'),
			booleanParam('dualMono', 'DualMono'),
			indexParam('mode', 'NormalizeTo', LOUDNESS_TARGETS),
		],
	},
	'audacity-normalize': {
		symbol: 'Normalize',
		params: [
			numberParam('peakDb', 'PeakLevel'),
			// Audacity 3.7 renamed ApplyGain to ApplyVolume with the rest of its
			// gain-to-volume rename.
			withLegacyNames(booleanParam('applyGain', 'ApplyVolume'), 'ApplyGain'),
			booleanParam('removeDc', 'RemoveDcOffset'),
			booleanParam('stereoIndependent', 'StereoIndependent'),
		],
	},
	'audacity-paulstretch': {
		symbol: 'Paulstretch',
		params: [
			numberParam('stretchFactor', 'Stretch Factor'),
			numberParam('timeResolution', 'Time Resolution'),
		],
	},
	'audacity-repair': { symbol: 'Repair', params: [] },
	'audacity-repeat': { symbol: 'Repeat', params: [numberParam('count', 'Count')] },
	'audacity-reverb': {
		symbol: 'Reverb',
		params: [
			numberParam('roomSize', 'RoomSize'),
			numberParam('preDelay', 'Delay'),
			numberParam('reverberance', 'Reverberance'),
			numberParam('damping', 'HfDamping'),
			numberParam('toneLow', 'ToneLow'),
			numberParam('toneHigh', 'ToneHigh'),
			numberParam('wetGainDb', 'WetGain'),
			numberParam('dryGainDb', 'DryGain'),
			numberParam('stereoWidth', 'StereoWidth'),
			booleanParam('wetOnly', 'WetOnly'),
		],
	},
	'audacity-reverse': { symbol: 'Reverse', params: [] },
	'audacity-sliding-stretch': {
		symbol: 'Sliding Stretch',
		params: [
			numberParam('startTempoPercent', 'RatePercentChangeStart'),
			numberParam('endTempoPercent', 'RatePercentChangeEnd'),
			numberParam('startPitchSemitones', 'PitchHalfStepsStart'),
			numberParam('endPitchSemitones', 'PitchHalfStepsEnd'),
			// Audacity writes the pitch slide twice and processes from the
			// percentage, so the percentage is declared last and wins whenever a
			// hand-written macro disagrees with itself.
			semitonePercentParam('startPitchSemitones', 'PitchPercentChangeStart'),
			semitonePercentParam('endPitchSemitones', 'PitchPercentChangeEnd'),
		],
	},
	'audacity-truncate-silence': {
		symbol: 'Truncate Silence',
		params: [
			numberParam('thresholdDb', 'Threshold'),
			enumParam('action', 'Action', TRUNCATE_SILENCE_ACTIONS, TRUNCATE_SILENCE_NATIVE_ACTIONS),
			numberParam('minimumSilence', 'Minimum'),
			numberParam('truncateTo', 'Truncate'),
			numberParam('compressPercent', 'Compress'),
			booleanParam('independent', 'Independent'),
		],
	},
});

/**
 * Every effect that travels as an Audacity macro command. Soundscaper effects
 * and Audacity effects with no macro command of their own — Remove DC Offset,
 * which Audacity only offers inside Normalize — travel as namespaced extension
 * lines instead.
 */
export const AUDACITY_EFFECT_MACRO_COMMANDS = Object.freeze(Object.fromEntries([
	...Object.entries(AUP4_REALTIME_EFFECT_PROFILES),
	...Object.entries(AUDACITY_SELECTION_EFFECT_MACRO_PROFILES),
].map(([type, profile]) => [type, audacitySquashedName(profile.symbol)])));

/** The CommandParameters contract for an effect that has a macro command. */
export function audacityMacroEffectProfile(type) {
	return AUDACITY_SELECTION_EFFECT_MACRO_PROFILES[type] ?? AUP4_REALTIME_EFFECT_PROFILES[type] ?? null;
}

/**
 * Parameter values Audacity implies rather than writes when an effect runs from
 * a macro, applied under anything the macro text actually carries.
 */
export function audacityMacroEffectDefaults(type) {
	return AUDACITY_SELECTION_EFFECT_MACRO_PROFILES[type]?.macroDefaults ?? {};
}

/**
 * Encode an effect's parameters for a macro command line. Rack effects reuse
 * the realtime encoder so a macro and a project write the same names, values
 * and equalization curves.
 */
export function encodeAudacityMacroEffectParameters(type, params = {}) {
	const profile = AUDACITY_SELECTION_EFFECT_MACRO_PROFILES[type];
	if (profile) return encodeCommandParameters(profile, params);
	if (AUP4_REALTIME_EFFECT_PROFILES[type]) return encodeAudacityRealtimeEffectParameters(type, params);
	throw new RangeError(`Unsupported Audacity macro effect: ${type}.`);
}

export function decodeAudacityMacroEffectParameters(type, parameters) {
	const profile = AUDACITY_SELECTION_EFFECT_MACRO_PROFILES[type];
	if (profile) return decodeCommandParameters(profile, parameters);
	if (AUP4_REALTIME_EFFECT_PROFILES[type]) return decodeAudacityRealtimeEffectParameters(type, parameters);
	throw new RangeError(`Unsupported Audacity macro effect: ${type}.`);
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
