/*
 * Repository-owned parametric EQ editor-model definition.
 *
 * The band vocabulary, rack/selection definition, and parameter normalization
 * for the `eq` effect type live here so `effects.js` stays a thin catalogue.
 * `parameters.js` owns the narrow DSP packet boundary; this module owns the
 * user-facing editor model that feeds it.
 */

const EQ_FREQUENCIES = Object.freeze([100, 500, 2_000, 8_000]);

export const PARAMETRIC_EQ_BAND_TYPES = Object.freeze([
	'peaking',
	'lowshelf',
	'highshelf',
	'highpass',
	'lowpass',
	'notch',
]);
export const PARAMETRIC_EQ_SLOPES = Object.freeze([12, 24, 36, 48]);
export const PARAMETRIC_EQ_MAXIMUM_BANDS = 12;

export const PARAMETRIC_EQ_BAND_DEFAULTS = Object.freeze({
	enabled: true,
	type: 'peaking',
	frequency: 1_000,
	gain: 0,
	q: 1,
	slope: 12,
});

export const PARAMETRIC_EQ_BAND_PARAMETER_METADATA = Object.freeze({
	enabled: Object.freeze({
		unit: 'boolean', step: 1, taper: 'discrete', automatable: false,
		automationBlockReason: 'Changing band topology is not sample-offset safe.',
	}),
	type: Object.freeze({
		unit: 'enum', step: 1, taper: 'discrete', automatable: false,
		automationBlockReason: 'Changing filter topology is not sample-offset safe.',
	}),
	slope: Object.freeze({
		unit: 'dB/oct', step: 12, taper: 'discrete', automatable: false,
		automationBlockReason: 'Changing filter topology is not sample-offset safe.',
	}),
});

const PARAMETRIC_EQ_BAND_TYPE_SET = new Set(PARAMETRIC_EQ_BAND_TYPES);
const PARAMETRIC_EQ_SLOPE_SET = new Set(PARAMETRIC_EQ_SLOPES);
const PARAMETRIC_EQ_EFFECT_ALIASES = new Set(['eq', 'parametric-eq', 'parametric_eq']);

export const PARAMETRIC_EQ_DEFAULTS = Object.freeze({
	outputGain: 0,
	bands: Object.freeze(EQ_FREQUENCIES.map((frequency, index) => Object.freeze({
		id: `band-${index + 1}`,
		...PARAMETRIC_EQ_BAND_DEFAULTS,
		frequency,
	}))),
});

/** The `eq` entry merged into the rack and selection effect catalogues. */
export const PARAMETRIC_EQ_EFFECT_DEFINITION = Object.freeze({
	defaults: PARAMETRIC_EQ_DEFAULTS,
	ranges: {
		outputGain: [-24, 24, { unit: 'dB', step: 0.1, taper: 'decibel' }],
		frequency: [10, 24_000, { unit: 'Hz', step: 1, taper: 'logarithmic' }],
		gain: [-24, 24, { unit: 'dB', step: 0.1, taper: 'decibel' }],
		q: [0.1, 30, { unit: 'Q', step: 0.01, taper: 'logarithmic' }],
	},
	bandTypes: PARAMETRIC_EQ_BAND_TYPES,
	slopes: PARAMETRIC_EQ_SLOPES,
	maximumBands: PARAMETRIC_EQ_MAXIMUM_BANDS,
	bandDefaults: PARAMETRIC_EQ_BAND_DEFAULTS,
	bandParameterMetadata: PARAMETRIC_EQ_BAND_PARAMETER_METADATA,
});

/** Legacy and alternate spellings which normalize onto the `eq` type. */
export function isParametricEqEffectAlias(type) {
	return PARAMETRIC_EQ_EFFECT_ALIASES.has(type);
}

/** Validate and canonicalize the editor-model parameters for the `eq` type. */
export function normalizeParametricEqEffectParams(params, effectId = null) {
	if (!Array.isArray(params.bands) || params.bands.length > PARAMETRIC_EQ_MAXIMUM_BANDS) {
		throw new RangeError(`The parametric EQ supports between zero and ${PARAMETRIC_EQ_MAXIMUM_BANDS} bands.`);
	}
	const ids = normalizeParametricEqBandIds(params.bands, effectId);
	return {
		outputGain: range(params.outputGain ?? 0, -24, 24, 'eq.outputGain'),
		bands: params.bands.map((band, index) => ({
			id: ids[index],
			enabled: normalizeBoolean(band?.enabled, true, `eq.bands[${index}].enabled`),
			type: parametricEqBandType(band?.type ?? 'peaking', `eq.bands[${index}].type`),
			frequency: range(band.frequency, 10, 24_000, `eq.bands[${index}].frequency`),
			gain: range(band.gain, -24, 24, `eq.bands[${index}].gain`),
			q: range(band.q, 0.1, 30, `eq.bands[${index}].q`),
			slope: parametricEqSlope(band?.slope ?? 12, `eq.bands[${index}].slope`),
		})),
	};
}

function normalizeParametricEqBandIds(bands, effectId) {
	const explicitIds = new Set();
	const sourceIds = bands.map((band, index) => {
		if (!band || typeof band !== 'object' || Array.isArray(band)) {
			throw new TypeError(`eq.bands[${index}] must be an object.`);
		}
		if (band.id == null || band.id === '') return null;
		if (typeof band.id !== 'string' || !band.id.trim()) {
			throw new TypeError(`eq.bands[${index}].id must be a non-empty string.`);
		}
		const id = band.id.trim();
		if (explicitIds.has(id)) throw new RangeError(`Duplicate parametric EQ band ID: ${id}.`);
		explicitIds.add(id);
		return id;
	});
	const assignedIds = new Set(explicitIds);
	return sourceIds.map((id, index) => {
		if (id) return id;
		const base = `${effectId ? `${effectId}-` : ''}band-${index + 1}`;
		let generated = base;
		let suffix = 2;
		while (assignedIds.has(generated)) generated = `${base}-${suffix++}`;
		assignedIds.add(generated);
		return generated;
	});
}

function parametricEqBandType(value, name) {
	if (typeof value !== 'string' || !PARAMETRIC_EQ_BAND_TYPE_SET.has(value)) {
		throw new RangeError(`${name} must be one of ${PARAMETRIC_EQ_BAND_TYPES.join(', ')}.`);
	}
	return value;
}

function parametricEqSlope(value, name) {
	const slope = Number(value);
	if (!PARAMETRIC_EQ_SLOPE_SET.has(slope)) {
		throw new RangeError(`${name} must be one of ${PARAMETRIC_EQ_SLOPES.join(', ')}.`);
	}
	return slope;
}

function normalizeBoolean(value, defaultValue, name) {
	if (value === undefined) return defaultValue;
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean.`);
	return value;
}

function range(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	}
	return number;
}
