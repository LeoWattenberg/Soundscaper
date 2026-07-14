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

const EQ_FREQUENCIES = [100, 500, 2_000, 8_000];

/**
 * @typedef {Object} AudioEditorEffect
 * @property {string} id
 * @property {keyof AUDIO_RACK_EFFECT_DEFINITIONS} type
 * @property {boolean} enabled
 * @property {Record<string, *>} params
 * @property {Record<string, *> | null} [context] JSON-safe routing/profile/range metadata
 * @property {Record<string, *> | null} [state] JSON-safe persistent processor/cache metadata
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
		defaults: {
			bands: EQ_FREQUENCIES.map((frequency) => ({ frequency, gain: 0, q: 1 })),
		},
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

export function audioEffectTypes() {
	return Object.keys(AUDIO_RACK_EFFECT_DEFINITIONS);
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
	const definition = AUDIO_EFFECT_DEFINITIONS[type];
	const audacityDefinition = isAudacityRackEffectType(type) ? AUDACITY_EFFECT_DEFINITIONS[type] : null;
	if (!definition && !audacityDefinition) throw new RangeError(`Unsupported audio effect: ${type}.`);
	const params = audacityDefinition
		? normalizeAudacityRackEffectParams(type, {
			...audacityEffectDefaults(type),
			...(options.params || {}),
		})
		: normalizeEffectParams(type, {
			...clone(definition.defaults),
			...(options.params || {}),
		});
	const effect = {
		id: options.id || createStableId('effect'),
		type,
		enabled: options.enabled !== false,
		params,
	};
	if (options.context !== undefined) effect.context = cloneEffectMetadata(options.context, 'effect.context');
	if (options.state !== undefined) effect.state = cloneEffectMetadata(options.state, 'effect.state');
	return effect;
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
	return createEffect(effect.type, effect);
}

export function validateEffect(effect) {
	normalizeEffect(effect);
	return true;
}

export function updateEffect(effect, changes = {}) {
	const options = {
		id: effect.id,
		enabled: changes.enabled ?? effect.enabled,
		params: { ...clone(effect.params), ...(changes.params || {}) },
	};
	const context = mergeEffectMetadata(effect.context, changes, 'context');
	const state = mergeEffectMetadata(effect.state, changes, 'state');
	if (context !== undefined) options.context = context;
	if (state !== undefined) options.state = state;
	return createEffect(changes.type || effect.type, options);
}

export function effectTailFrames(effect, sampleRate = AUDIO_EDITOR_SAMPLE_RATE) {
	const normalized = effect?.id
		? normalizeEffect(effect)
		: createEffect(effect?.type, { ...effect, id: `tail-${effect?.type || 'effect'}` });
	if (!normalized.enabled) return 0;
	if (isAudacityRackEffectType(normalized.type)) {
		return Math.ceil(audacityLiveEffectTailFrames(normalized.type, sampleRate, normalized.params));
	}
	if (normalized.type === 'reverb') {
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

function normalizeEffectParams(type, params) {
	if (type === 'eq') {
		if (!Array.isArray(params.bands) || params.bands.length !== 4) {
			throw new RangeError('The parametric EQ requires exactly four bands.');
		}
		return {
			bands: params.bands.map((band, index) => ({
				frequency: range(band.frequency, 10, 24_000, `eq.bands[${index}].frequency`),
				gain: range(band.gain, -24, 24, `eq.bands[${index}].gain`),
				q: range(band.q, 0.1, 30, `eq.bands[${index}].q`),
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
