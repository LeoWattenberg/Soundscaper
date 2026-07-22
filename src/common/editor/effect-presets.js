import {
	AUDIO_SELECTION_EFFECT_DEFINITIONS,
	normalizeAudioSelectionEffectParams,
} from './effects.js';

export const AUDIO_EDITOR_EFFECT_PRESETS_SCHEMA_VERSION = 1;

export function createAudioEditorEffectPresets(value = {}) {
	const source = value && typeof value === 'object' ? value : {};
	if (source.schemaVersion != null && source.schemaVersion !== AUDIO_EDITOR_EFFECT_PRESETS_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported effect preset schema: ${source.schemaVersion}.`);
	}
	const presets = Array.isArray(source.presets) ? source.presets.map(normalizePreset) : [];
	assertUniquePresetIds(presets);
	return freezeState(presets);
}

export function listAudioEditorEffectPresets(state, effectType = null) {
	const normalized = createAudioEditorEffectPresets(state);
	return normalized.presets.filter((preset) => !effectType || preset.effectType === effectType);
}

export function saveAudioEditorEffectPreset(state, options = {}) {
	const current = createAudioEditorEffectPresets(state);
	const effectType = effectTypeValue(options.effectType);
	const now = timestamp(options.now);
	const requestedId = String(options.id || '').trim();
	const existing = requestedId ? current.presets.find((preset) => preset.id === requestedId) : null;
	if (requestedId && !existing) throw new ReferenceError(`Effect preset ${requestedId} does not exist.`);
	if (existing && existing.effectType !== effectType) throw new RangeError('An effect preset cannot change effect type.');
	const preset = normalizePreset({
		id: existing?.id || presetId(options.idFactory),
		effectType,
		name: options.name ?? existing?.name,
		params: options.params,
		createdAt: existing?.createdAt || now,
		updatedAt: now,
	});
	const presets = existing
		? current.presets.map((candidate) => candidate.id === preset.id ? preset : candidate)
		: [...current.presets, preset];
	return { state: freezeState(presets), preset };
}

export function deleteAudioEditorEffectPreset(state, presetIdValue) {
	const current = createAudioEditorEffectPresets(state);
	const id = nonEmptyString(presetIdValue, 'presetId');
	if (!current.presets.some((preset) => preset.id === id)) throw new ReferenceError(`Effect preset ${id} does not exist.`);
	return freezeState(current.presets.filter((preset) => preset.id !== id));
}

export function applyAudioEditorEffectPreset(state, presetIdValue) {
	const id = nonEmptyString(presetIdValue, 'presetId');
	const preset = createAudioEditorEffectPresets(state).presets.find((candidate) => candidate.id === id);
	if (!preset) throw new ReferenceError(`Effect preset ${id} does not exist.`);
	return preset;
}

export function exportAudioEditorEffectPreset(state, presetIdValue) {
	const preset = applyAudioEditorEffectPreset(state, presetIdValue);
	return JSON.stringify({ schemaVersion: AUDIO_EDITOR_EFFECT_PRESETS_SCHEMA_VERSION, presets: [preset] }, null, 2);
}

export function importAudioEditorEffectPresets(state, input, options = {}) {
	const current = createAudioEditorEffectPresets(state);
	let parsed;
	try {
		parsed = typeof input === 'string' ? JSON.parse(input) : input;
	} catch (cause) {
		throw new SyntaxError(`Invalid effect preset JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
	}
	const imported = createAudioEditorEffectPresets(parsed).presets;
	if (!imported.length) throw new RangeError('The effect preset file is empty.');
	const byId = new Map(current.presets.map((preset) => [preset.id, preset]));
	for (const preset of imported) {
		let id = preset.id;
		if (byId.has(id) && JSON.stringify(byId.get(id)) !== JSON.stringify(preset)) {
			id = presetId(options.idFactory);
		}
		byId.set(id, normalizePreset({ ...preset, id }));
	}
	return freezeState([...byId.values()]);
}

function normalizePreset(value) {
	if (!value || typeof value !== 'object') throw new TypeError('An effect preset must be an object.');
	const effectType = effectTypeValue(value.effectType);
	return Object.freeze({
		id: nonEmptyString(value.id, 'preset.id'),
		effectType,
		name: nonEmptyString(value.name, 'preset.name'),
		params: Object.freeze(normalizeAudioSelectionEffectParams(effectType, value.params || {})),
		createdAt: timestamp(value.createdAt),
		updatedAt: timestamp(value.updatedAt),
	});
}

function effectTypeValue(value) {
	const effectType = nonEmptyString(value, 'effectType');
	if (!AUDIO_SELECTION_EFFECT_DEFINITIONS[effectType]) throw new RangeError(`Unsupported effect preset type: ${effectType}.`);
	return effectType;
}

function presetId(idFactory) {
	const value = typeof idFactory === 'function'
		? idFactory()
		: globalThis.crypto?.randomUUID?.() || `preset-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return nonEmptyString(value, 'preset.id');
}

function timestamp(value) {
	const date = value == null ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Effect preset timestamp is invalid.');
	return date.toISOString();
}

function nonEmptyString(value, name) {
	const result = String(value ?? '').trim();
	if (!result) throw new TypeError(`${name} must be a non-empty string.`);
	return result;
}

function assertUniquePresetIds(presets) {
	if (new Set(presets.map(({ id }) => id)).size !== presets.length) throw new RangeError('Effect preset IDs must be unique.');
}

function freezeState(presets) {
	return Object.freeze({
		schemaVersion: AUDIO_EDITOR_EFFECT_PRESETS_SCHEMA_VERSION,
		presets: Object.freeze([...presets]),
	});
}
