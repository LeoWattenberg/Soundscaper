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
} from './audacity-effects/live-capabilities.js';
import { canonicalCopyValue, effectNameCopyKey } from '../i18n/canonical-extras.js';
import { normalizeNativePluginEffect, updateNativePluginEffect } from './native-plugin-effect.ts';
import {
	REVIEWED_UTILITY_GAIN_SELECTION_EFFECT_DEFINITION, REVIEWED_UTILITY_GAIN_SELECTION_EFFECT_LABEL,
	REVIEWED_UTILITY_GAIN_SELECTION_EFFECT_TYPE,
} from './reviewed-effects/selection-effect-contract.ts';
import { projectEffectTailFramesV21 } from './project-effect-tail-v21.ts';
import {
	PARAMETRIC_EQ_BAND_TYPES,
	PARAMETRIC_EQ_EFFECT_DEFINITION,
	PARAMETRIC_EQ_MAXIMUM_BANDS,
	PARAMETRIC_EQ_SLOPES,
	isParametricEqEffectAlias,
	normalizeParametricEqEffectParams,
} from './parametric-eq/effect-definition.js';

export const MISSING_EFFECT_TYPE = 'missing';

export { PARAMETRIC_EQ_BAND_TYPES, PARAMETRIC_EQ_MAXIMUM_BANDS, PARAMETRIC_EQ_SLOPES };

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
		ranges: {
			frequency: [10, 20_000, { unit: 'Hz', step: 1, taper: 'logarithmic' }],
			q: [0.1, 30, { unit: 'Q', step: 0.01, taper: 'logarithmic' }],
		},
	},
	lowpass: {
		defaults: { frequency: 18_000, q: 0.707 },
		ranges: {
			frequency: [10, 24_000, { unit: 'Hz', step: 1, taper: 'logarithmic' }],
			q: [0.1, 30, { unit: 'Q', step: 0.01, taper: 'logarithmic' }],
		},
	},
	eq: PARAMETRIC_EQ_EFFECT_DEFINITION,
	compressor: {
		defaults: { threshold: -24, knee: 30, ratio: 4, attack: 0.003, release: 0.25, makeupGain: 0 },
		ranges: {
			threshold: [-100, 0, { unit: 'dB', step: 0.1, taper: 'decibel' }],
			knee: [0, 40, { unit: 'dB', step: 0.1, taper: 'linear' }],
			ratio: [1, 20, { unit: ':1', step: 0.1, taper: 'logarithmic' }],
			attack: [0, 1, { unit: 's', step: 0.001, taper: 'linear' }],
			release: [0.01, 2, { unit: 's', step: 0.001, taper: 'logarithmic' }],
			makeupGain: [-24, 24, { unit: 'dB', step: 0.1, taper: 'decibel', automatable: false, automationBlockReason: 'Makeup gain currently changes the native effect graph topology.' }],
		},
	},
	limiter: {
		defaults: { ceiling: -1, lookahead: 0.005, release: 0.1 },
		ranges: {
			ceiling: [-24, 0, { unit: 'dB', step: 0.1, taper: 'decibel' }],
			lookahead: [0, 0.1, { unit: 's', step: 0.001, taper: 'linear' }],
			release: [0.01, 2, { unit: 's', step: 0.001, taper: 'logarithmic' }],
		},
	},
	gate: {
		defaults: { threshold: -50, attack: 0.005, hold: 0.05, release: 0.1, rangeDb: -80 },
		ranges: {
			threshold: [-100, 0, { unit: 'dB', step: 0.1, taper: 'decibel' }],
			attack: [0, 1, { unit: 's', step: 0.001, taper: 'linear' }],
			hold: [0, 2, { unit: 's', step: 0.001, taper: 'linear' }],
			release: [0.01, 3, { unit: 's', step: 0.001, taper: 'logarithmic' }],
			rangeDb: [-100, 0, { unit: 'dB', step: 0.1, taper: 'decibel' }],
		},
	},
	reverb: {
		defaults: { mix: 0.2, decay: 2, preDelay: 0.01 },
		ranges: {
			mix: [0, 1, { unit: 'ratio', step: 0.01, taper: 'linear', automatable: false, automationBlockReason: 'Reverb parameters currently rebuild the native effect graph.' }],
			decay: [0.1, 10, { unit: 's', step: 0.01, taper: 'logarithmic', automatable: false, automationBlockReason: 'Reverb parameters currently rebuild the native effect graph.' }],
			preDelay: [0, 1, { unit: 's', step: 0.001, taper: 'linear', automatable: false, automationBlockReason: 'Reverb parameters currently rebuild the native effect graph.' }],
		},
	},
	delay: {
		defaults: { time: 0.25, feedback: 0.3, mix: 0.2 },
		ranges: {
			time: [0.001, 5, { unit: 's', step: 0.001, taper: 'logarithmic' }],
			feedback: [0, 0.95, { unit: 'ratio', step: 0.01, taper: 'linear' }],
			mix: [0, 1, { unit: 'ratio', step: 0.01, taper: 'linear' }],
		},
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
	[REVIEWED_UTILITY_GAIN_SELECTION_EFFECT_TYPE]: REVIEWED_UTILITY_GAIN_SELECTION_EFFECT_DEFINITION,
});

export function audioEffectTypes() {
	return Object.keys(AUDIO_RACK_EFFECT_DEFINITIONS);
}

export function audioSelectionEffectTypes() {
	return Object.keys(AUDIO_SELECTION_EFFECT_DEFINITIONS);
}

function ownMapValue(record, key) { return Object.hasOwn(record, key) ? record[key] : undefined; }
export function audioSelectionEffectDefinition(type) {
	const definition = ownMapValue(AUDIO_SELECTION_EFFECT_DEFINITIONS, type);
	if (!definition) throw new RangeError(`Unsupported selection effect: ${type}.`);
	return definition;
}

export function audioSelectionEffectLabel(type, copyOrLocale = 'en') {
	if (type === REVIEWED_UTILITY_GAIN_SELECTION_EFFECT_TYPE) return REVIEWED_UTILITY_GAIN_SELECTION_EFFECT_LABEL;
	return ownMapValue(AUDACITY_EFFECT_DEFINITIONS, type)
		? audacityEffectLabel(type, copyOrLocale)
		: audioEffectLabel(type, copyOrLocale);
}

export function audioSelectionEffectDefaults(type, effectId = null) {
	if (ownMapValue(AUDACITY_EFFECT_DEFINITIONS, type)) return audacityEffectDefaults(type);
	const definition = audioSelectionEffectDefinition(type);
	return normalizeEffectParams(type, clone(definition.defaults), effectId);
}

export function normalizeAudioSelectionEffectParams(type, params = {}, effectId = null) {
	if (ownMapValue(AUDACITY_EFFECT_DEFINITIONS, type)) return normalizeAudacityEffectParams(type, params);
	const definition = audioSelectionEffectDefinition(type);
	return normalizeEffectParams(type, {
		...clone(definition.defaults),
		...clone(params),
	}, effectId);
}

export function isAudacityRackEffectType(type) {
	return AUDACITY_RACK_EFFECT_TYPE_SET.has(type);
}

export function audioEffectLabel(type, copyOrLocale = 'en') {
	if (isAudacityRackEffectType(type)) return audacityEffectLabel(type, copyOrLocale);
	if (!ownMapValue(AUDIO_EFFECT_DEFINITIONS, type)) throw new RangeError(`Unsupported audio effect: ${type}.`);
	return canonicalCopyValue(effectNameCopyKey(type), copyOrLocale);
}

export function audioEffectParamRange(type, name) {
	if (isAudacityRackEffectType(type)) {
		const liveRange = ownMapValue(audacityLiveEffectCapability(type).paramRanges ?? {}, name);
		if (liveRange) return [...liveRange];
		const descriptor = ownMapValue(AUDACITY_EFFECT_DEFINITIONS[type].params, name);
		return descriptor?.kind === 'number' ? [descriptor.minimum, descriptor.maximum] : null;
	}
	const range = ownMapValue(ownMapValue(AUDIO_EFFECT_DEFINITIONS, type)?.ranges ?? {}, name);
	return range ? range.slice(0, 2) : null;
}

/** Selectable values for a native effect parameter, or null when it is numeric. */
export function audioEffectParamChoices(type, name) {
	const definition = ownMapValue(AUDIO_EFFECT_DEFINITIONS, type)
		?? ownMapValue(AUDIO_SELECTION_EFFECT_DEFINITIONS, type);
	const choice = ownMapValue(definition?.choices ?? {}, name);
	return choice ? [...choice.options] : null;
}

/** @returns {AudioEditorEffect} */
export function createEffect(type, options = {}) {
	if (type === MISSING_EFFECT_TYPE) return createMissingEffect(options);
	const definition = ownMapValue(AUDIO_EFFECT_DEFINITIONS, type);
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
	if (effect.type === 'native-plugin') return normalizeNativePluginEffect(effect);
	if (effect.type === MISSING_EFFECT_TYPE) return createMissingEffect(effect);
	const type = isParametricEqEffectAlias(effect.type) ? 'eq' : effect.type;
	return createEffect(type, { ...effect, type });
}

export function validateEffect(effect) {
	normalizeEffect(effect);
	return true;
}

export function updateEffect(effect, changes = {}) {
	const current = normalizeEffect(effect);
	if (current.type === 'native-plugin') return updateNativePluginEffect(current, changes);
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
	const v21Tail = projectEffectTailFramesV21(project, { trackId, includeMaster, maximum, rackTail });
	if (v21Tail !== null) return v21Tail;
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
	if (type === 'eq') return normalizeParametricEqEffectParams(params, effectId);

	const definition = ownMapValue(AUDIO_EFFECT_DEFINITIONS, type) ?? ownMapValue(AUDIO_SELECTION_EFFECT_DEFINITIONS, type);
	const output = {};
	for (const [name, [minimum, maximum, metadata]] of Object.entries(definition.ranges)) {
		const value = range(params[name], minimum, maximum, `${type}.${name}`);
		output[name] = metadata?.integer ? Math.round(value) : value;
	}
	for (const [name, choice] of Object.entries(definition.choices ?? {})) {
		output[name] = choiceValue(params[name], choice.options, `${type}.${name}`);
	}
	return output;
}

function choiceValue(value, options, name) {
	const match = options.find((option) => String(option) === String(value));
	if (match === undefined) throw new RangeError(`${name} is not a supported option.`);
	return match;
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
