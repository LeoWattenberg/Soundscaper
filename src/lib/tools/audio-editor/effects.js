import { AUDIO_EDITOR_SAMPLE_RATE, createStableId } from './project.js';
import {
	AUDACITY_EFFECT_DEFINITIONS,
	audacityEffectDefaults,
	audacityEffectLabel,
	normalizeAudacityEffectParams,
} from './audacity-effects/manifest.js';
import {
	audacityLiveEffectCapability,
	audacityLiveEffectTailFrames,
} from './audacity-effects/live.js';
import { canonicalCopyValue, effectNameCopyKey } from '../../../i18n/canonical-extras.js';

const EQ_FREQUENCIES = Object.freeze([100, 500, 2_000, 8_000]);
export const MISSING_EFFECT_TYPE = 'missing';

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

const PARAMETRIC_EQ_BAND_TYPE_SET = new Set(PARAMETRIC_EQ_BAND_TYPES);
const PARAMETRIC_EQ_SLOPE_SET = new Set(PARAMETRIC_EQ_SLOPES);
const PARAMETRIC_EQ_EFFECT_ALIASES = new Set(['eq', 'parametric-eq', 'parametric_eq']);
const PARAMETRIC_EQ_DEFAULTS = Object.freeze({
	outputGain: 0,
	bands: Object.freeze(EQ_FREQUENCIES.map((frequency, index) => Object.freeze({
		id: `band-${index + 1}`,
		enabled: true,
		type: 'peaking',
		frequency,
		gain: 0,
		q: 1,
		slope: 12,
	}))),
});

/**
 * @typedef {Object} AudioEditorEffect
 * @property {string} id
 * @property {keyof AUDIO_RACK_EFFECT_DEFINITIONS} type
 * @property {boolean} enabled
 * @property {Record<string, *>} params
 * @property {Record<string, *> | null} [context] JSON-safe routing/profile/range metadata
 * @property {Record<string, *> | null} [state] JSON-safe persistent processor/cache metadata
 * @property {true} [bypassed] Missing effects are always bypassed locally
 * @property {{name: string, nativeId: string, reason: string, source: string}} [missing]
 * @property {*} [opaqueAudacityNode]
 */

export const AUDIO_EFFECT_DEFINITIONS = Object.freeze({
	highpass: {
		defaults: { frequency: 80, q: 0.707 },
		ranges: { frequency: [10, 20_000], q: [0.1, 30] },
	},
	lowpass: {
		defaults: { frequency: 18_000, q: 0.707 },
		ranges: { frequency: [10, 24_000], q: [0.1, 30] },
	},
	eq: {
		defaults: PARAMETRIC_EQ_DEFAULTS,
		ranges: {
			outputGain: [-24, 24],
			frequency: [10, 24_000],
			gain: [-24, 24],
			q: [0.1, 30],
		},
		bandTypes: PARAMETRIC_EQ_BAND_TYPES,
		slopes: PARAMETRIC_EQ_SLOPES,
		maximumBands: PARAMETRIC_EQ_MAXIMUM_BANDS,
	},
	compressor: {
		defaults: { threshold: -24, knee: 30, ratio: 4, attack: 0.003, release: 0.25, makeupGain: 0 },
		ranges: {
			threshold: [-100, 0], knee: [0, 40], ratio: [1, 20], attack: [0, 1], release: [0.01, 2], makeupGain: [-24, 24],
		},
	},
	limiter: {
		defaults: { ceiling: -1, lookahead: 0.005, release: 0.1 },
		ranges: { ceiling: [-24, 0], lookahead: [0, 0.1], release: [0.01, 2] },
	},
	gate: {
		defaults: { threshold: -50, attack: 0.005, hold: 0.05, release: 0.1, rangeDb: -80 },
		ranges: { threshold: [-100, 0], attack: [0, 1], hold: [0, 2], release: [0.01, 3], rangeDb: [-100, 0] },
	},
	reverb: {
		defaults: { mix: 0.2, decay: 2, preDelay: 0.01 },
		ranges: { mix: [0, 1], decay: [0.1, 10], preDelay: [0, 1] },
	},
	delay: {
		defaults: { time: 0.25, feedback: 0.3, mix: 0.2 },
		ranges: { time: [0.001, 5], feedback: [0, 0.95], mix: [0, 1] },
	},
});

/** Audacity effects whose business logic has a bounded live-streaming form. */
export const AUDACITY_RACK_EFFECT_TYPES = Object.freeze([
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

const AUDACITY_RACK_EFFECT_TYPE_SET = new Set(AUDACITY_RACK_EFFECT_TYPES);

/** All definitions accepted in a track or master rack. */
export const AUDIO_RACK_EFFECT_DEFINITIONS = Object.freeze({
	...AUDIO_EFFECT_DEFINITIONS,
	...Object.fromEntries(AUDACITY_RACK_EFFECT_TYPES.map((type) => [type, AUDACITY_EFFECT_DEFINITIONS[type]])),
});

/** All effects which can be previewed and destructively applied to a selection. */
export const AUDIO_SELECTION_EFFECT_DEFINITIONS = Object.freeze({
	...AUDACITY_EFFECT_DEFINITIONS,
	eq: Object.freeze({
		...AUDIO_EFFECT_DEFINITIONS.eq,
		preRollSeconds: 10,
	}),
});

export function audioEffectTypes() {
	return Object.keys(AUDIO_RACK_EFFECT_DEFINITIONS);
}

export function audioSelectionEffectTypes() {
	return Object.keys(AUDIO_SELECTION_EFFECT_DEFINITIONS);
}

export function audioSelectionEffectDefinition(type) {
	const definition = AUDIO_SELECTION_EFFECT_DEFINITIONS[type];
	if (!definition) throw new RangeError(`Unsupported selection effect: ${type}.`);
	return definition;
}

export function audioSelectionEffectLabel(type, copyOrLocale = 'en') {
	return AUDACITY_EFFECT_DEFINITIONS[type]
		? audacityEffectLabel(type, copyOrLocale)
		: audioEffectLabel(type, copyOrLocale);
}

export function audioSelectionEffectDefaults(type, effectId = null) {
	if (AUDACITY_EFFECT_DEFINITIONS[type]) return audacityEffectDefaults(type);
	audioSelectionEffectDefinition(type);
	return normalizeEffectParams(type, clone(AUDIO_EFFECT_DEFINITIONS[type].defaults), effectId);
}

export function normalizeAudioSelectionEffectParams(type, params = {}, effectId = null) {
	if (AUDACITY_EFFECT_DEFINITIONS[type]) return normalizeAudacityEffectParams(type, params);
	audioSelectionEffectDefinition(type);
	return normalizeEffectParams(type, {
		...clone(AUDIO_EFFECT_DEFINITIONS[type].defaults),
		...clone(params),
	}, effectId);
}

export function isAudacityRackEffectType(type) {
	return AUDACITY_RACK_EFFECT_TYPE_SET.has(type);
}

export function audioEffectLabel(type, copyOrLocale = 'en') {
	if (isAudacityRackEffectType(type)) return audacityEffectLabel(type, copyOrLocale);
	if (!AUDIO_EFFECT_DEFINITIONS[type]) throw new RangeError(`Unsupported audio effect: ${type}.`);
	return canonicalCopyValue(effectNameCopyKey(type), copyOrLocale);
}

export function audioEffectParamRange(type, name) {
	if (isAudacityRackEffectType(type)) {
		const liveRange = audacityLiveEffectCapability(type).paramRanges?.[name];
		if (liveRange) return [...liveRange];
		const descriptor = AUDACITY_EFFECT_DEFINITIONS[type]?.params?.[name];
		return descriptor?.kind === 'number' ? [descriptor.minimum, descriptor.maximum] : null;
	}
	const range = AUDIO_EFFECT_DEFINITIONS[type]?.ranges?.[name];
	return range ? [...range] : null;
}

/** @returns {AudioEditorEffect} */
export function createEffect(type, options = {}) {
	if (type === MISSING_EFFECT_TYPE) return createMissingEffect(options);
	const definition = AUDIO_EFFECT_DEFINITIONS[type];
	const audacityDefinition = isAudacityRackEffectType(type) ? AUDACITY_EFFECT_DEFINITIONS[type] : null;
	if (!definition && !audacityDefinition) throw new RangeError(`Unsupported audio effect: ${type}.`);
	const id = options.id || createStableId('effect');
	const params = audacityDefinition
		? normalizeAudacityRackEffectParams(type, {
			...audacityEffectDefaults(type),
			...(options.params || {}),
		})
		: normalizeEffectParams(type, {
			...clone(definition.defaults),
			...(options.params || {}),
		}, id);
	const effect = {
		id,
		type,
		enabled: options.enabled !== false,
		params,
	};
	if (options.context !== undefined) effect.context = cloneEffectMetadata(options.context, 'effect.context');
	if (options.state !== undefined) effect.state = cloneEffectMetadata(options.state, 'effect.state');
	return effect;
}

/**
 * Create an unavailable rack item which retains a foreign plug-in's identity
 * and opaque state without ever making that state executable in the browser.
 *
 * @returns {AudioEditorEffect}
 */
export function createMissingEffect(options = {}) {
	const id = options.id || createStableId('effect');
	if (typeof id !== 'string' || !id) throw new TypeError('Every effect needs a stable ID.');
	const metadata = options.missing;
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
		throw new TypeError('A missing effect needs compatibility metadata.');
	}
	const name = boundedNonEmptyString(metadata.name, 'missing effect name');
	const nativeId = boundedNonEmptyString(metadata.nativeId, 'missing effect native ID', 64 * 1024);
	const reason = boundedNonEmptyString(metadata.reason, 'missing effect reason');
	const source = boundedNonEmptyString(metadata.source || 'aup4', 'missing effect source');
	const effect = {
		id,
		type: MISSING_EFFECT_TYPE,
		enabled: options.enabled !== false,
		bypassed: true,
		params: {},
		missing: { name, nativeId, reason, source },
	};
	if (options.opaqueAudacityNode !== undefined) {
		effect.opaqueAudacityNode = clonePersistentValue(options.opaqueAudacityNode, 'effect.opaqueAudacityNode');
	}
	return effect;
}

/** Return the exact English fallback used when no localized UI copy is supplied. */
export function missingEffectLabel(effect) {
	const normalized = normalizeEffect(effect);
	if (normalized.type !== MISSING_EFFECT_TYPE) throw new TypeError('A missing effect is required.');
	return `Missing: ${normalized.missing.name}`;
}

function normalizeAudacityRackEffectParams(type, params) {
	const normalized = normalizeAudacityEffectParams(type, params);
	for (const [name, [minimum, maximum]] of Object.entries(audacityLiveEffectCapability(type).paramRanges || {})) {
		range(normalized[name], minimum, maximum, `${type}.${name}`);
	}
	return normalized;
}

export function normalizeEffect(effect) {
	if (!effect || typeof effect !== 'object') throw new TypeError('An effect is required.');
	if (typeof effect.id !== 'string' || !effect.id) throw new TypeError('Every effect needs a stable ID.');
	if (effect.type === MISSING_EFFECT_TYPE) return createMissingEffect(effect);
	const type = PARAMETRIC_EQ_EFFECT_ALIASES.has(effect.type) ? 'eq' : effect.type;
	return createEffect(type, { ...effect, type });
}

export function validateEffect(effect) {
	normalizeEffect(effect);
	return true;
}

export function updateEffect(effect, changes = {}) {
	const current = normalizeEffect(effect);
	if (current.type === MISSING_EFFECT_TYPE && (!changes.type || changes.type === MISSING_EFFECT_TYPE)) {
		return createMissingEffect({
			...current,
			enabled: changes.enabled ?? current.enabled,
		});
	}
	const options = {
		id: current.id,
		enabled: changes.enabled ?? current.enabled,
		params: { ...clone(current.params), ...(changes.params || {}) },
	};
	const context = mergeEffectMetadata(current.context, changes, 'context');
	const state = mergeEffectMetadata(current.state, changes, 'state');
	if (context !== undefined) options.context = context;
	if (state !== undefined) options.state = state;
	return createEffect(changes.type || current.type, options);
}

export function effectTailFrames(effect, sampleRate = AUDIO_EDITOR_SAMPLE_RATE) {
	const normalized = effect?.id
		? normalizeEffect(effect)
		: createEffect(effect?.type, { ...effect, id: `tail-${effect?.type || 'effect'}` });
	if (!normalized.enabled || normalized.bypassed === true || normalized.type === MISSING_EFFECT_TYPE) return 0;
	if (isAudacityRackEffectType(normalized.type)) {
		return Math.ceil(audacityLiveEffectTailFrames(normalized.type, sampleRate, normalized.params));
	}
	if (normalized.type === 'reverb' && normalized.params.mix > 0) {
		return Math.ceil((normalized.params.preDelay + normalized.params.decay) * sampleRate);
	}
	if (normalized.type === 'delay' && normalized.params.mix > 0) {
		const repeatsToMinus60Db = normalized.params.feedback > 0
			? Math.ceil(Math.log(0.001) / Math.log(normalized.params.feedback))
			: 1;
		return Math.ceil(normalized.params.time * Math.max(1, repeatsToMinus60Db) * sampleRate);
	}
	return 0;
}

export function rackTailFrames(effects, sampleRate = AUDIO_EDITOR_SAMPLE_RATE, maximumSeconds = 10) {
	const maximum = Math.round(maximumSeconds * sampleRate);
	const tail = (effects || []).reduce((total, effect) => Math.min(maximum, total + effectTailFrames(effect, sampleRate)), 0);
	return Math.min(maximum, tail);
}

/**
 * Return the longest audible insert path through track, routed bus, and master
 * racks. Group and send racks run in parallel, so only the longest bus rack is
 * added to each track path.
 */
export function projectEffectTailFrames(project, {
	trackId = null,
	includeMaster = true,
	maximumSeconds = 10,
} = {}) {
	const sampleRate = Number.isSafeInteger(project?.sampleRate) && project.sampleRate > 0
		? project.sampleRate
		: AUDIO_EDITOR_SAMPLE_RATE;
	const maximum = Math.max(0, Math.round(maximumSeconds * sampleRate));
	const rackTail = (owner) => owner?.effectsActive === false
		? 0
		: rackTailFrames(owner?.effects || [], sampleRate, maximumSeconds);
	const tracks = (project?.tracks || []).filter((track) => (
		track?.type !== 'label'
		&& track?.type !== 'video'
		&& (trackId == null || String(track.id) === String(trackId))
	));
	const groups = new Map((project?.mixer?.groups || []).map((bus) => [String(bus.id), bus]));
	const sends = new Map((project?.mixer?.sends || []).map((bus) => [String(bus.id), bus]));
	const longestTrackPath = tracks.reduce((longest, track) => {
		const route = project?.mixer?.routes?.[String(track.id)] || {};
		const busTails = [0];
		if (route.groupId != null) busTails.push(rackTail(groups.get(String(route.groupId))));
		for (const [sendId, gain] of Object.entries(route.sends || {})) {
			if (Number(gain) > 0) busTails.push(rackTail(sends.get(String(sendId))));
		}
		return Math.max(longest, rackTail(track) + Math.max(...busTails));
	}, 0);
	const masterTail = includeMaster ? rackTail(project?.master) : 0;
	return Math.min(maximum, longestTrackPath + masterTail);
}

function normalizeEffectParams(type, params, effectId = null) {
	if (type === 'eq') {
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

	const definition = AUDIO_EFFECT_DEFINITIONS[type];
	const output = {};
	for (const [name, [minimum, maximum]] of Object.entries(definition.ranges)) {
		output[name] = range(params[name], minimum, maximum, `${type}.${name}`);
	}
	return output;
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

function normalizeBoolean(value, defaultValue, name) {
	if (value === undefined) return defaultValue;
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean.`);
	return value;
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

function range(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	}
	return number;
}

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function mergeEffectMetadata(current, changes, key) {
	if (!Object.prototype.hasOwnProperty.call(changes, key)) {
		return current === undefined ? undefined : cloneEffectMetadata(current, `effect.${key}`);
	}
	const next = changes[key];
	if (next === null) return null;
	if (!isPlainObject(next)) return cloneEffectMetadata(next, `effect.${key}`);
	const base = isPlainObject(current) ? current : {};
	return cloneEffectMetadata({ ...base, ...next }, `effect.${key}`);
}

function cloneEffectMetadata(value, name) {
	if (value === null) return null;
	if (!isPlainObject(value)) throw new TypeError(`${name} must be a JSON-safe object or null.`);
	return cloneJsonValue(value, name, new Set());
}

function boundedNonEmptyString(value, name, maximumCodeUnits = 1_024) {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	if (value.length > maximumCodeUnits) throw new RangeError(`${name} exceeds its size limit.`);
	return value;
}

function clonePersistentValue(value, name) {
	if (typeof structuredClone === 'function') {
		try {
			return structuredClone(value);
		} catch {
			throw new TypeError(`${name} must be cloneable.`);
		}
	}
	return clonePersistentValueFallback(value, name, new Set());
}

function clonePersistentValueFallback(value, name, ancestors) {
	if (value === null || ['string', 'boolean', 'undefined'].includes(typeof value)) return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new RangeError(`${name} numbers must be finite.`);
		return value;
	}
	if (value instanceof Uint8Array) return value.slice();
	if (value instanceof ArrayBuffer) return value.slice(0);
	if (typeof value !== 'object') throw new TypeError(`${name} must be cloneable.`);
	if (ancestors.has(value)) throw new TypeError(`${name} must not contain circular references.`);
	if (!Array.isArray(value) && !isPlainObject(value)) throw new TypeError(`${name} must be cloneable.`);
	ancestors.add(value);
	const output = Array.isArray(value) ? [] : {};
	for (const [key, item] of Object.entries(value)) {
		output[key] = clonePersistentValueFallback(item, `${name}.${key}`, ancestors);
	}
	ancestors.delete(value);
	return output;
}

function cloneJsonValue(value, name, ancestors) {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new RangeError(`${name} numbers must be finite.`);
		return value;
	}
	if (typeof value !== 'object') throw new TypeError(`${name} must contain only JSON-safe values.`);
	if (ancestors.has(value)) throw new TypeError(`${name} must not contain circular references.`);
	if (!Array.isArray(value) && !isPlainObject(value)) {
		throw new TypeError(`${name} must contain only plain objects and arrays.`);
	}

	ancestors.add(value);
	let output;
	if (Array.isArray(value)) {
		output = Array.from(value, (item, index) => cloneJsonValue(item, `${name}[${index}]`, ancestors));
	} else {
		output = {};
		for (const [key, item] of Object.entries(value)) {
			Object.defineProperty(output, key, {
				value: cloneJsonValue(item, `${name}.${key}`, ancestors),
				enumerable: true,
				configurable: true,
				writable: true,
			});
		}
	}
	ancestors.delete(value);
	return output;
}

function isPlainObject(value) {
	if (!value || typeof value !== 'object') return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
