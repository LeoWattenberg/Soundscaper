/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Audacity's factory effect presets, restated in the editor's own parameter
 * vocabulary. `factory-preset-tables.js` holds the upstream rows; this module
 * is where a row becomes something the preset bar can select.
 *
 * Two effects need more than a rename. Upstream's equalization presets are
 * frequency and gain curves that reach past the editor's Nyquist ceiling, so
 * they are truncated the way `EqualizationCurvesList::setCurve` truncates
 * them: linearly in decibels over a logarithmic frequency axis. Graphic EQ
 * offers a subset of the same curves through third-octave sliders, so its band
 * gains are read off that curve and clipped to the slider range, which is what
 * upstream's sliders do with a curve that leaves their reach.
 */

import { AUDIO_EDITOR_SAMPLE_RATE } from '../project.js';
import { effectPresetCopyKey } from '../../i18n/canonical-extras.js';
import { AUDACITY_EFFECT_DEFINITIONS, normalizeAudacityEffectParams } from './manifest.js';
import {
	AUDACITY_COMPRESSOR_FACTORY_PRESET_ROWS,
	AUDACITY_DISTORTION_FACTORY_PRESET_ROWS,
	AUDACITY_DISTORTION_MODES,
	AUDACITY_EQUALIZATION_FACTORY_PRESET_CURVES,
	AUDACITY_LIMITER_FACTORY_PRESET_ROWS,
	AUDACITY_REVERB_FACTORY_PRESET_ROWS,
} from './factory-preset-tables.js';

export { AUDACITY_FACTORY_PRESET_SOURCE, AUDACITY_FACTORY_PRESET_UPSTREAM_FILES } from './factory-preset-tables.js';

/** Namespace that keeps a factory preset identity apart from a saved one. */
export const AUDACITY_FACTORY_PRESET_ID_PREFIX = 'audacity-factory';

/** The lowest frequency upstream's logarithmic curve axis represents. */
const CURVE_FLOOR_HZ = 20;
/** Curve points above the editor's Nyquist frequency cannot be represented. */
const CURVE_CEILING_HZ = AUDIO_EDITOR_SAMPLE_RATE / 2;
const CURVE_GAIN_LIMIT = Object.freeze({ minimum: -120, maximum: 60 });

export const AUDACITY_EFFECT_FACTORY_PRESETS = deepFreeze({
	'audacity-compressor': dynamicsPresets(
		'audacity-compressor',
		AUDACITY_COMPRESSOR_FACTORY_PRESET_ROWS,
		['thresholdDb', 'makeupGainDb', 'kneeWidthDb', 'ratio', 'lookaheadMs', 'attackMs', 'releaseMs'],
	),
	'audacity-distortion': distortionPresets(),
	'audacity-filter-curve-eq': filterCurvePresets(),
	'audacity-graphic-eq': graphicEqualizerPresets(),
	'audacity-limiter': dynamicsPresets(
		'audacity-limiter',
		AUDACITY_LIMITER_FACTORY_PRESET_ROWS,
		['thresholdDb', 'makeupTargetDb', 'kneeWidthDb', 'lookaheadMs', 'releaseMs'],
	),
	'audacity-reverb': reverbPresets(),
});

const PRESETS_BY_ID = new Map(
	Object.values(AUDACITY_EFFECT_FACTORY_PRESETS).flat().map((preset) => [preset.id, preset]),
);

/** Whether an identifier names a factory preset rather than a saved one. */
export function isAudacityFactoryPresetId(value) {
	return String(value ?? '').startsWith(`${AUDACITY_FACTORY_PRESET_ID_PREFIX}:`);
}

/** Every factory preset, or those of one effect; unknown effects have none. */
export function audacityFactoryPresets(effectType = null) {
	if (effectType == null) return Object.values(AUDACITY_EFFECT_FACTORY_PRESETS).flat();
	return Object.hasOwn(AUDACITY_EFFECT_FACTORY_PRESETS, effectType)
		? AUDACITY_EFFECT_FACTORY_PRESETS[effectType]
		: [];
}

/** One factory preset by identifier, or null when nothing carries it. */
export function audacityFactoryPreset(presetId) {
	return PRESETS_BY_ID.get(String(presetId ?? '')) || null;
}

function reverbPresets() {
	return AUDACITY_REVERB_FACTORY_PRESET_ROWS.map(([
		name, roomSize, preDelay, reverberance, damping, toneLow, toneHigh,
		wetGainDb, dryGainDb, stereoWidth, wetOnly,
	]) => factoryPreset('audacity-reverb', name, {
		roomSize, preDelay, reverberance, damping, toneLow, toneHigh,
		wetGainDb, dryGainDb, stereoWidth, wetOnly,
	}));
}

function distortionPresets() {
	return AUDACITY_DISTORTION_FACTORY_PRESET_ROWS.map(([
		name, tableIndex, dcBlock, thresholdDb, noiseFloorDb, parameter1, parameter2, repeats,
	]) => {
		const mode = AUDACITY_DISTORTION_MODES[tableIndex];
		if (!mode) throw new RangeError(`Unsupported distortion table type: ${tableIndex}.`);
		return factoryPreset('audacity-distortion', name, {
			mode, dcBlock: Boolean(dcBlock), thresholdDb, noiseFloorDb, parameter1, parameter2, repeats,
		});
	});
}

function dynamicsPresets(effectType, rows, parameterNames) {
	return rows.map(([name, ...values]) => factoryPreset(
		effectType,
		name,
		Object.fromEntries(parameterNames.map((parameter, index) => [parameter, values[index]])),
	));
}

function filterCurvePresets() {
	return AUDACITY_EQUALIZATION_FACTORY_PRESET_CURVES.map((curve) => factoryPreset(
		'audacity-filter-curve-eq', curve.name, { points: representableCurve(curve.points) },
	));
}

function graphicEqualizerPresets() {
	const descriptor = AUDACITY_EFFECT_DEFINITIONS['audacity-graphic-eq'].params.gains;
	return AUDACITY_EQUALIZATION_FACTORY_PRESET_CURVES.filter((curve) => curve.graphic).map((curve) => factoryPreset(
		'audacity-graphic-eq',
		curve.name,
		{
			gains: descriptor.frequencies.map((frequency) => quantize(
				clamp(curveGainAt(curve.points, frequency), descriptor.minimum, descriptor.maximum),
				descriptor.step,
			)),
		},
	));
}

/**
 * An upstream curve reduced to points the editor's curve control can hold.
 *
 * Points beyond either end of the representable range are replaced by the
 * value the curve has at that end, so the shape inside the audible range is
 * the one upstream would filter with.
 */
function representableCurve(points) {
	const inRange = points
		.filter(([frequency]) => frequency >= CURVE_FLOOR_HZ && frequency <= CURVE_CEILING_HZ)
		.map(([frequency, gain]) => ({ frequency, gain: clamp(gain, CURVE_GAIN_LIMIT.minimum, CURVE_GAIN_LIMIT.maximum) }));
	const curve = [...inRange];
	if (points.some(([frequency]) => frequency < CURVE_FLOOR_HZ) && inRange[0]?.frequency !== CURVE_FLOOR_HZ) {
		curve.unshift(edgePoint(points, CURVE_FLOOR_HZ));
	}
	if (points.some(([frequency]) => frequency > CURVE_CEILING_HZ) && inRange.at(-1)?.frequency !== CURVE_CEILING_HZ) {
		curve.push(edgePoint(points, CURVE_CEILING_HZ));
	}
	return curve;
}

function edgePoint(points, frequency) {
	return {
		frequency,
		gain: clamp(curveGainAt(points, frequency), CURVE_GAIN_LIMIT.minimum, CURVE_GAIN_LIMIT.maximum),
	};
}

/**
 * The curve's gain at one frequency: linear in decibels over a logarithmic
 * frequency axis, holding the end values beyond the outermost points, which is
 * how both upstream's envelope and this editor's filter read a curve.
 */
function curveGainAt(points, frequency) {
	if (frequency <= points[0][0]) return points[0][1];
	const last = points.at(-1);
	if (frequency >= last[0]) return last[1];
	const upper = points.findIndex(([candidate]) => candidate >= frequency);
	const [leftFrequency, leftGain] = points[upper - 1];
	const [rightFrequency, rightGain] = points[upper];
	const amount = (Math.log(frequency) - Math.log(leftFrequency))
		/ (Math.log(rightFrequency) - Math.log(leftFrequency));
	return leftGain + (rightGain - leftGain) * amount;
}

function factoryPreset(effectType, name, params) {
	return {
		id: `${AUDACITY_FACTORY_PRESET_ID_PREFIX}:${effectType}:${slug(name)}`,
		effectType,
		name,
		labelKey: effectPresetCopyKey(effectType, name),
		params: normalizeAudacityEffectParams(effectType, params),
		custom: false,
	};
}

function slug(name) {
	return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function clamp(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, value));
}

function quantize(value, step) {
	return step > 0 ? Math.round(value / step) * step : value;
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
