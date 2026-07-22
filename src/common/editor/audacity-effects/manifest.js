/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Audacity native effect inventory and parameter contract.
 * The original inventory is based on Audacity 3.7.7 commit
 * 5ef610ed23260d6d648175735bb16b32536eb30b; StaffPad pitch-and-tempo
 * effects are pinned separately to current Audacity 4 development sources.
 * Audacity is GPL-3.0; individual effect files are GPL-2.0-or-later unless
 * otherwise noted. This JavaScript adaptation was created for kw.media in 2026.
 */

import {
	canonicalCopyValue,
	effectNameCopyKey,
	effectOptionCopyKey,
	effectParameterCopyKey,
} from '../../i18n/canonical-extras.js';
import { localizedValue } from '../../i18n/locale.js';

export const AUDACITY_EFFECT_SOURCE = Object.freeze({
	version: '3.7.7',
	commit: '5ef610ed23260d6d648175735bb16b32536eb30b',
	url: 'https://github.com/audacity/audacity/tree/Audacity-3.7.7',
});

export const AUDACITY_STAFFPAD_SOURCE = Object.freeze({
	version: '4-current',
	commit: '908ad0a526e5bfdab68de780e893cebe172d27eb',
	url: 'https://github.com/audacity/audacity/tree/908ad0a526e5bfdab68de780e893cebe172d27eb',
});

const FLOAT_MAX = 3.4028234663852886e38;

export const AUDACITY_EFFECT_UPSTREAM_FILES = deepFreeze({
	'audacity-amplify': [
		'libraries/lib-builtin-effects/AmplifyBase.cpp',
		'src/effects/Amplify.cpp',
	],
	'audacity-auto-duck': ['libraries/lib-builtin-effects/AutoDuckBase.cpp'],
	'audacity-bass-treble': ['libraries/lib-builtin-effects/BassTrebleBase.cpp'],
	'audacity-click-removal': ['libraries/lib-builtin-effects/ClickRemovalBase.cpp'],
	'audacity-change-pitch': [
		'src/effects/builtin_collection/changepitch/changepitcheffect.cpp',
		'au3/libraries/au3-time-and-pitch/StaffPad/TimeAndPitch.cpp',
		'au3/libraries/au3-time-and-pitch/FormantShifter.cpp',
	],
	'audacity-change-tempo': [
		'au3/libraries/au3-builtin-effects/ChangeTempoBase.cpp',
		'au3/libraries/au3-time-and-pitch/StaffPad/TimeAndPitch.cpp',
	],
	'audacity-change-speed-pitch': [
		'au3/libraries/au3-builtin-effects/ChangeSpeedBase.cpp',
		'au3/libraries/au3-time-and-pitch/StaffPad/TimeAndPitch.cpp',
	],
	'audacity-sliding-stretch': [
		'src/effects/builtin_collection/slidingstretch/slidingstretcheffect.cpp',
		'au3/libraries/au3-time-and-pitch/StaffPad/TimeAndPitch.cpp',
		'au3/libraries/au3-time-and-pitch/FormantShifter.cpp',
	],
	'audacity-compressor': [
		'src/effects/Compressor.cpp',
		'libraries/lib-dynamic-range-processor/CompressorProcessor.cpp',
		'libraries/lib-dynamic-range-processor/SimpleCompressor/GainReductionComputer.cpp',
		'libraries/lib-dynamic-range-processor/SimpleCompressor/LookAheadGainReduction.cpp',
	],
	'audacity-legacy-compressor': ['libraries/lib-builtin-effects/LegacyCompressorBase.cpp'],
	'audacity-distortion': ['libraries/lib-builtin-effects/DistortionBase.cpp'],
	'audacity-echo': ['libraries/lib-builtin-effects/EchoBase.cpp'],
	'audacity-fade-in': ['libraries/lib-builtin-effects/Fade.cpp'],
	'audacity-fade-out': ['libraries/lib-builtin-effects/Fade.cpp'],
	'audacity-filter-curve-eq': [
		'libraries/lib-builtin-effects/EqualizationBase.cpp',
		'libraries/lib-builtin-effects/EqualizationFilter.cpp',
	],
	'audacity-graphic-eq': [
		'libraries/lib-builtin-effects/EqualizationBase.cpp',
		'libraries/lib-builtin-effects/EqualizationFilter.cpp',
		'src/effects/EqualizationBandSliders.cpp',
	],
	'audacity-invert': ['libraries/lib-builtin-effects/Invert.cpp'],
	'audacity-limiter': [
		'src/effects/Limiter.cpp',
		'libraries/lib-dynamic-range-processor/CompressorProcessor.cpp',
		'libraries/lib-dynamic-range-processor/SimpleCompressor/GainReductionComputer.cpp',
		'libraries/lib-dynamic-range-processor/SimpleCompressor/LookAheadGainReduction.cpp',
	],
	'audacity-loudness-normalization': [
		'libraries/lib-builtin-effects/LoudnessBase.cpp',
		'libraries/lib-math/EBUR128.cpp',
	],
	'audacity-noise-reduction': ['libraries/lib-builtin-effects/NoiseReductionBase.cpp'],
	'audacity-normalize': ['libraries/lib-builtin-effects/NormalizeBase.cpp'],
	'audacity-paulstretch': ['libraries/lib-builtin-effects/PaulstretchBase.cpp'],
	'audacity-phaser': ['libraries/lib-builtin-effects/PhaserBase.cpp'],
	'audacity-repair': [
		'libraries/lib-builtin-effects/Repair.cpp',
		'libraries/lib-math/InterpolateAudio.cpp',
	],
	'audacity-remove-dc-offset': ['libraries/lib-builtin-effects/NormalizeBase.cpp'],
	'audacity-reverb': ['au3/libraries/au3-builtin-effects/ReverbBase.cpp'],
	'audacity-repeat': ['libraries/lib-builtin-effects/RepeatBase.cpp'],
	'audacity-reverse': ['libraries/lib-builtin-effects/Reverse.cpp'],
	'audacity-classic-filters': ['libraries/lib-builtin-effects/ScienFilterBase.cpp'],
	'audacity-truncate-silence': ['libraries/lib-builtin-effects/TruncSilenceBase.cpp'],
	'audacity-wahwah': ['libraries/lib-builtin-effects/WahWahBase.cpp'],
});

const GRAPHIC_EQ_FREQUENCIES = Object.freeze([
	20, 25, 31, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
	800, 1_000, 1_250, 1_600, 2_000, 2_500, 3_150, 4_000, 5_000, 6_300,
	8_000, 10_000, 12_500, 16_000, 20_000,
]);

const number = (defaultValue, minimum, maximum, options = {}) => ({
	kind: 'number', default: defaultValue, minimum, maximum, ...options,
});
const checkbox = (defaultValue = false) => ({
	kind: 'boolean', default: defaultValue,
});
const select = (defaultValue, options) => ({
	kind: 'enum', default: defaultValue, options,
});
const option = (value) => ({ value });

const definitions = {
	'audacity-amplify': {
		category: 'volume',
		params: {
			gainDb: number(0, -50, 50, { unit: 'dB', step: 0.1 }),
			allowClipping: checkbox(),
		},
	},
	'audacity-auto-duck': {
		category: 'volume',
		requiresControlTrack: true,
		params: {
			duckAmountDb: number(-12, -24, 0, { unit: 'dB', step: 0.1 }),
			innerFadeDown: number(0, 0, 3, { unit: 's', step: 0.01 }),
			innerFadeUp: number(0, 0, 3, { unit: 's', step: 0.01 }),
			outerFadeDown: number(0.5, 0, 3, { unit: 's', step: 0.01 }),
			outerFadeUp: number(0.5, 0, 3, { unit: 's', step: 0.01 }),
			thresholdDb: number(-30, -100, 0, { unit: 'dB', step: 0.1 }),
			maximumPause: number(1, 0, Number.MAX_VALUE, { unit: 's', step: 0.01 }),
		},
	},
	'audacity-bass-treble': {
		category: 'eq',
		params: {
			bassDb: number(0, -30, 30, { unit: 'dB', step: 0.1 }),
			trebleDb: number(0, -30, 30, { unit: 'dB', step: 0.1 }),
			volumeDb: number(0, -30, 30, { unit: 'dB', step: 0.1 }),
		},
	},
	'audacity-click-removal': {
		category: 'repair',
		params: {
			threshold: number(200, 0, 900, { integer: true, step: 1 }),
			maximumWidth: number(20, 0, 40, { unit: 'samples', integer: true, step: 1 }),
		},
	},
	'audacity-change-pitch': {
		category: 'pitch-tempo',
		requiresStaffPad: true,
		params: {
			semitones: number(0, -12, 12, { unit: 'st', step: 0.01 }),
			preserveFormants: checkbox(true),
		},
	},
	'audacity-change-tempo': {
		category: 'pitch-tempo',
		lengthChanging: true,
		requiresStaffPad: true,
		params: {
			tempoPercent: number(0, -50, 100, { unit: '%', step: 0.1 }),
		},
	},
	'audacity-change-speed-pitch': {
		category: 'pitch-tempo',
		lengthChanging: true,
		requiresStaffPad: true,
		params: {
			speedPercent: number(0, -50, 100, { unit: '%', step: 0.1 }),
		},
	},
	'audacity-sliding-stretch': {
		category: 'pitch-tempo',
		lengthChanging: true,
		requiresStaffPad: true,
		params: {
			startTempoPercent: number(0, -50, 100, { unit: '%', step: 0.1 }),
			endTempoPercent: number(0, -50, 100, { unit: '%', step: 0.1 }),
			startPitchSemitones: number(0, -12, 12, { unit: 'st', step: 0.01 }),
			endPitchSemitones: number(0, -12, 12, { unit: 'st', step: 0.01 }),
			preserveFormants: checkbox(true),
		},
	},
	'audacity-compressor': {
		category: 'volume',
		collision: true,
		params: {
			thresholdDb: number(-10, -60, 0, { unit: 'dB', step: 0.1 }),
			makeupGainDb: number(0, -30, 30, { unit: 'dB', step: 0.1 }),
			kneeWidthDb: number(5, 0, 30, { unit: 'dB', step: 0.1 }),
			ratio: number(10, 1, 100, { step: 0.1 }),
			lookaheadMs: number(1, 0, 1_000, { unit: 'ms', step: 0.1 }),
			attackMs: number(30, 0, 200, { unit: 'ms', step: 0.1 }),
			releaseMs: number(150, 0, 1_000, { unit: 'ms', step: 0.1 }),
		},
	},
	'audacity-legacy-compressor': {
		category: 'volume',
		params: {
			thresholdDb: number(-12, -60, -1, { unit: 'dB', step: 0.1 }),
			noiseFloorDb: number(-40, -80, -20, { unit: 'dB', step: 0.1 }),
			ratio: number(2, 1.1, 10, { step: 0.1 }),
			attackSeconds: number(0.2, 0.1, 5, { unit: 's', step: 0.01 }),
			releaseSeconds: number(1, 1, 30, { unit: 's', step: 0.1 }),
			normalize: checkbox(true),
			usePeak: checkbox(),
		},
	},
	'audacity-distortion': {
		category: 'special',
		params: {
			mode: select('hard-clipping', [
				option('hard-clipping'),
				option('soft-clipping'),
				option('soft-overdrive'),
				option('medium-overdrive'),
				option('hard-overdrive'),
				option('cubic'),
				option('even-harmonics'),
				option('expand-compress'),
				option('leveller'),
				option('rectifier'),
				option('hard-limiter'),
			]),
			dcBlock: checkbox(),
			thresholdDb: number(-6, -100, 0, { unit: 'dB', step: 0.1 }),
			noiseFloorDb: number(-70, -80, -20, { unit: 'dB', step: 0.1 }),
			parameter1: number(50, 0, 100, { unit: '%', step: 1 }),
			parameter2: number(50, 0, 100, { unit: '%', step: 1 }),
			repeats: number(1, 0, 5, { integer: true, step: 1 }),
		},
	},
	'audacity-echo': {
		category: 'delay',
		params: {
			delaySeconds: number(1, 0.001, FLOAT_MAX, { unit: 's', step: 0.001 }),
			decay: number(0.5, 0, FLOAT_MAX, { step: 0.01 }),
		},
	},
	'audacity-fade-in': { category: 'fades', params: {} },
	'audacity-fade-out': { category: 'fades', params: {} },
	'audacity-filter-curve-eq': {
		category: 'eq',
		params: {
			points: {
				kind: 'curve', default: [{ frequency: 20, gain: 0 }, { frequency: 20_000, gain: 0 }],
			},
			linearFrequencyScale: checkbox(),
			filterLength: number(8191, 21, 8191, { integer: true, odd: true, step: 2 }),
		},
	},
	'audacity-graphic-eq': {
		category: 'eq',
		params: {
			gains: { kind: 'bands', frequencies: GRAPHIC_EQ_FREQUENCIES, default: GRAPHIC_EQ_FREQUENCIES.map(() => 0), minimum: -20, maximum: 20, step: 0.5, unit: 'dB' },
			interpolation: select('bspline', [
				option('bspline'), option('cosine'), option('cubic'),
			]),
			filterLength: number(8191, 21, 8191, { integer: true, odd: true, step: 2 }),
		},
	},
	'audacity-invert': { category: 'special', params: {} },
	'audacity-limiter': {
		category: 'volume',
		collision: true,
		params: {
			thresholdDb: number(-5, -30, 0, { unit: 'dB', step: 0.1 }),
			makeupTargetDb: number(-1, -30, 0, { unit: 'dB', step: 0.1 }),
			kneeWidthDb: number(2, 0, 10, { unit: 'dB', step: 0.1 }),
			lookaheadMs: number(1, 0, 50, { unit: 'ms', step: 0.1 }),
			releaseMs: number(20, 0, 1_000, { unit: 'ms', step: 0.1 }),
		},
	},
	'audacity-loudness-normalization': {
		category: 'volume',
		params: {
			mode: select('lufs', [option('lufs'), option('rms')]),
			targetLufs: number(-23, -145, 0, { unit: 'LUFS', step: 0.1 }),
			targetRmsDb: number(-20, -145, 0, { unit: 'dB', step: 0.1 }),
			stereoIndependent: checkbox(),
			dualMono: checkbox(true),
		},
	},
	'audacity-noise-reduction': {
		category: 'repair',
		requiresNoiseProfile: true,
		params: {
			reductionDb: number(6, 0, 48, { unit: 'dB', step: 0.1 }),
			sensitivity: number(6, 0.01, 24, { step: 0.01 }),
			frequencySmoothingBands: number(6, 0, 12, { unit: 'bands', integer: true, step: 1 }),
			output: select('reduce', [option('reduce'), option('residue')]),
		},
	},
	'audacity-normalize': {
		category: 'volume',
		params: {
			peakDb: number(-1, -145, 0, { unit: 'dBFS', step: 0.1 }),
			removeDc: checkbox(true),
			applyGain: checkbox(true),
			stereoIndependent: checkbox(),
		},
	},
	'audacity-paulstretch': {
		category: 'special',
		lengthChanging: true,
		params: {
			stretchFactor: number(10, 1, FLOAT_MAX, { step: 0.01 }),
			timeResolution: number(0.25, 0.00099, FLOAT_MAX, { unit: 's', step: 0.001 }),
		},
	},
	'audacity-phaser': {
		category: 'modulation',
		params: {
			stages: number(2, 2, 24, { integer: true, even: true, step: 2 }),
			dryWet: number(128, 0, 255, { integer: true, step: 1 }),
			frequency: number(0.4, 0.001, 4, { unit: 'Hz', step: 0.001 }),
			phaseDegrees: number(0, 0, 360, { unit: '°', step: 0.1 }),
			depth: number(100, 0, 255, { integer: true, step: 1 }),
			feedbackPercent: number(0, -100, 100, { unit: '%', integer: true, step: 1 }),
			outputGainDb: number(-6, -30, 30, { unit: 'dB', step: 0.1 }),
		},
	},
	'audacity-repair': { category: 'repair', requiresContext: true, params: {} },
	'audacity-remove-dc-offset': { category: 'repair', params: {} },
	'audacity-reverb': {
		category: 'delay',
		browserAdaptation: 'schroeder',
		params: {
			roomSize: number(75, 0, 100, { unit: '%', step: 1 }),
			reverberance: number(50, 0, 100, { unit: '%', step: 1 }),
			damping: number(50, 0, 100, { unit: '%', step: 1 }),
			wetGainDb: number(-6, -60, 12, { unit: 'dB', step: 0.1 }),
			dryGainDb: number(0, -60, 12, { unit: 'dB', step: 0.1 }),
			stereoWidth: number(100, 0, 100, { unit: '%', step: 1 }),
			wetOnly: checkbox(),
		},
	},
	'audacity-repeat': {
		category: 'special', lengthChanging: true,
		params: { count: number(1, 1, 2_147_483_647, { integer: true, step: 1 }) },
	},
	'audacity-reverse': { category: 'special', params: {} },
	'audacity-classic-filters': {
		category: 'eq',
		params: {
			family: select('butterworth', [option('butterworth'), option('chebyshev-i'), option('chebyshev-ii')]),
			direction: select('lowpass', [option('lowpass'), option('highpass')]),
			order: number(1, 1, 10, { integer: true, step: 1 }),
			cutoffHz: number(1_000, 1, 23_999, { unit: 'Hz', step: 1 }),
			passbandRippleDb: number(1, 0, 100, { unit: 'dB', step: 0.1 }),
			stopbandAttenuationDb: number(30, 0, 100, { unit: 'dB', step: 0.1 }),
		},
	},
	'audacity-truncate-silence': {
		category: 'special',
		lengthChanging: true,
		params: {
			thresholdDb: number(-20, -80, -20, { unit: 'dB', step: 0.1 }),
			action: select('truncate', [option('truncate'), option('compress')]),
			minimumSilence: number(0.5, 0.001, 10_000, { unit: 's', step: 0.001 }),
			truncateTo: number(0.5, 0, 10_000, { unit: 's', step: 0.001 }),
			compressPercent: number(50, 0, 99.9, { unit: '%', step: 0.1 }),
			independent: checkbox(false),
		},
	},
	'audacity-wahwah': {
		category: 'modulation',
		params: {
			frequency: number(1.5, 0.1, 4, { unit: 'Hz', step: 0.01 }),
			phaseDegrees: number(0, 0, 360, { unit: '°', step: 0.1 }),
			depthPercent: number(70, 0, 100, { unit: '%', integer: true, step: 1 }),
			resonance: number(2.5, 0.1, 10, { step: 0.1 }),
			frequencyOffsetPercent: number(30, 0, 100, { unit: '%', integer: true, step: 1 }),
			outputGainDb: number(-6, -30, 30, { unit: 'dB', step: 0.1 }),
		},
	},
};

for (const [type, definition] of Object.entries(definitions)) {
	definition.labelKey = effectNameCopyKey(type);
	for (const [name, descriptor] of Object.entries(definition.params)) {
		descriptor.labelKey = effectParameterCopyKey(type, name);
		for (const item of descriptor.options || []) {
			item.labelKey = effectOptionCopyKey(type, name, item.value);
		}
	}
}

export const AUDACITY_EFFECT_DEFINITIONS = deepFreeze(definitions);

export const AUDACITY_EFFECT_EXCLUSIONS = deepFreeze([]);

// Native Audacity modules which are deliberately outside the menu-visible
// processing-effect inventory: generators and analyzers are different editor
// operations, while Stereo To Mono is a hidden command in Audacity 3.7.7.
export const AUDACITY_NON_PROCESS_MODULES = deepFreeze({
	DTMF: 'generate',
	Chirp: 'generate',
	Noise: 'generate',
	Silence: 'generate',
	Tone: 'generate',
	'Find Clipping': 'analyze',
	'Stereo To Mono': 'hidden',
});

export function audacityEffectTypes() {
	return Object.keys(AUDACITY_EFFECT_DEFINITIONS);
}

export function audacityEffectLabel(type, copyOrLocale = 'en') {
	const definition = requireDefinition(type);
	return canonicalCopyValue(definition.labelKey, copyOrLocale);
}

export function audacityEffectParameterLabel(type, name, copyOrLocale = 'en') {
	const descriptor = requireDefinition(type).params[name];
	if (!descriptor) throw new RangeError(`Unsupported Audacity effect parameter: ${type}.${name}.`);
	return canonicalCopyValue(descriptor.labelKey, copyOrLocale);
}

export function audacityEffectOptionLabel(type, name, value, copyOrLocale = 'en') {
	const descriptor = requireDefinition(type).params[name];
	const item = descriptor?.options?.find((candidate) => String(candidate.value) === String(value));
	if (!item) throw new RangeError(`Unsupported Audacity effect option: ${type}.${name}.${value}.`);
	return canonicalCopyValue(item.labelKey, copyOrLocale);
}

export function audacityEffectDefaults(type) {
	const definition = requireDefinition(type);
	return Object.fromEntries(Object.entries(definition.params).map(([name, descriptor]) => [name, clone(descriptor.default)]));
}

export function normalizeAudacityEffectParams(type, values = {}) {
	const definition = requireDefinition(type);
	const output = {};
	for (const [name, descriptor] of Object.entries(definition.params)) {
		const value = values[name] ?? clone(descriptor.default);
		if (descriptor.kind === 'number') output[name] = normalizeNumber(value, descriptor, `${type}.${name}`);
		else if (descriptor.kind === 'boolean') output[name] = normalizeBoolean(value);
		else if (descriptor.kind === 'enum') output[name] = normalizeEnum(value, descriptor, `${type}.${name}`);
		else if (descriptor.kind === 'curve') output[name] = normalizeCurve(value, `${type}.${name}`);
		else if (descriptor.kind === 'bands') output[name] = normalizeBands(value, descriptor, `${type}.${name}`);
	}
	return output;
}

export function formatAudacityCurve(points) {
	return normalizeCurve(points, 'curve').map((point) => `${point.frequency}:${point.gain}`).join(', ');
}

export function parseAudacityCurve(value) {
	if (Array.isArray(value)) return normalizeCurve(value, 'curve');
	const points = String(value || '').split(/[;,\n]+/).filter((part) => part.trim()).map((part) => {
		const [frequency, gain] = part.trim().split(/\s*:\s*|\s+/).map(Number);
		return { frequency, gain };
	});
	return normalizeCurve(points, 'curve');
}

export function localized(value, locale = 'en') {
	return localizedValue(value, locale);
}

function requireDefinition(type) {
	const definition = AUDACITY_EFFECT_DEFINITIONS[type];
	if (!definition) throw new RangeError(`Unsupported Audacity effect: ${type}.`);
	return definition;
}

function normalizeNumber(value, descriptor, name) {
	let result = Number(value);
	if (!Number.isFinite(result) || result < descriptor.minimum || result > descriptor.maximum) {
		throw new RangeError(`${name} must be between ${descriptor.minimum} and ${descriptor.maximum}.`);
	}
	if (descriptor.integer) result = Math.round(result);
	if (descriptor.odd && result % 2 === 0) result += result < descriptor.maximum ? 1 : -1;
	// PhaserBase clears the low bit (mStages &= ~1), so odd stage counts are
	// coerced to the preceding even value rather than rounded upward.
	if (descriptor.even && result % 2 !== 0) result -= 1;
	return result;
}

function normalizeBoolean(value) {
	if (typeof value === 'string') return value === 'true' || value === '1' || value === 'on';
	return Boolean(value);
}

function normalizeEnum(value, descriptor, name) {
	const match = descriptor.options.find((item) => String(item.value) === String(value));
	if (!match) throw new RangeError(`${name} is not a supported option.`);
	return match.value;
}

function normalizeCurve(value, name) {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array of curve points.`);
	const points = value.map((point, index) => {
		const frequency = Number(point?.frequency);
		const gain = Number(point?.gain);
		if (!Number.isFinite(frequency) || frequency < 1 || frequency > 24_000) throw new RangeError(`${name}[${index}].frequency must be between 1 and 24000.`);
		if (!Number.isFinite(gain) || gain < -120 || gain > 60) throw new RangeError(`${name}[${index}].gain must be between -120 and 60.`);
		return { frequency, gain };
	}).sort((left, right) => left.frequency - right.frequency);
	for (let index = 1; index < points.length; index += 1) {
		if (points[index].frequency === points[index - 1].frequency) throw new RangeError(`${name} frequencies must be unique.`);
	}
	return points;
}

function normalizeBands(value, descriptor, name) {
	if (!Array.isArray(value) || value.length !== descriptor.frequencies.length) {
		throw new RangeError(`${name} requires ${descriptor.frequencies.length} band gains.`);
	}
	return value.map((gain, index) => {
		const numberValue = Number(gain);
		if (!Number.isFinite(numberValue) || numberValue < descriptor.minimum || numberValue > descriptor.maximum) {
			throw new RangeError(`${name}[${index}] must be between ${descriptor.minimum} and ${descriptor.maximum}.`);
		}
		return numberValue;
	});
}

function clone(value) {
	if (value == null || typeof value !== 'object') return value;
	return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
