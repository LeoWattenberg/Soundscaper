/* SPDX-License-Identifier: AGPL-3.0-only */

import { type DeliveryPreset, DeliveryPresetError, validateDeliveryPreset } from './delivery-preset.ts';

/**
 * The saved delivery-preset collection.
 *
 * This deliberately mirrors `effect-presets.js` — same state shape, same
 * verbs, same import collision rule — because the export dialog reuses the
 * effect-preset controls, and two preset stores that behaved differently
 * behind identical controls would be a trap for whoever touched them next.
 */

export const DELIVERY_PRESETS_SCHEMA_VERSION = 1;

export interface DeliveryPresetState {
	readonly schemaVersion: number;
	readonly presets: readonly DeliveryPreset[];
}

export function createDeliveryPresetState(value: unknown = {}): DeliveryPresetState {
	const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	if (source.schemaVersion != null && source.schemaVersion !== DELIVERY_PRESETS_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported delivery preset schema: ${String(source.schemaVersion)}.`);
	}
	const presets = Array.isArray(source.presets) ? source.presets.map(validateDeliveryPreset) : [];
	if (new Set(presets.map(({ id }) => id)).size !== presets.length) {
		throw new RangeError('Delivery preset IDs must be unique.');
	}
	return freezeState(presets);
}

export function listDeliveryPresets(
	state: unknown,
	kind: DeliveryPreset['kind'] | null = null,
): readonly DeliveryPreset[] {
	return createDeliveryPresetState(state).presets.filter((preset) => !kind || preset.kind === kind);
}

export function applyDeliveryPreset(state: unknown, presetId: unknown): DeliveryPreset {
	const id = nonEmptyString(presetId, 'presetId');
	const preset = createDeliveryPresetState(state).presets.find((candidate) => candidate.id === id);
	if (!preset) throw new ReferenceError(`Delivery preset ${id} does not exist.`);
	return preset;
}

export function saveDeliveryPresetToState(state: unknown, options: {
	id?: string;
	label: string;
	kind: DeliveryPreset['kind'];
	format: string;
	settings?: Readonly<Record<string, unknown>>;
	licensingRowId?: string | null;
	fallbackPresetId?: string | null;
	now?: string;
	idFactory?: () => string;
}): { state: DeliveryPresetState; preset: DeliveryPreset } {
	const current = createDeliveryPresetState(state);
	const now = timestamp(options.now);
	const requestedId = String(options.id ?? '').trim();
	const existing = requestedId ? current.presets.find((preset) => preset.id === requestedId) : null;
	if (requestedId && !existing) {
		throw new ReferenceError(`Delivery preset ${requestedId} does not exist.`);
	}
	if (existing && existing.kind !== options.kind) {
		throw new DeliveryPresetError('A delivery preset cannot change kind.');
	}
	const preset = validateDeliveryPreset({
		schemaVersion: 1,
		id: existing?.id || presetId(options.idFactory),
		label: options.label ?? existing?.label,
		kind: options.kind,
		format: options.format,
		settings: options.settings ?? {},
		licensingRowId: options.licensingRowId ?? null,
		fallbackPresetId: options.fallbackPresetId ?? null,
		createdAt: existing?.createdAt || now,
		updatedAt: now,
	});
	const presets = existing
		? current.presets.map((candidate) => (candidate.id === preset.id ? preset : candidate))
		: [...current.presets, preset];
	return { state: freezeState(presets), preset };
}

export function deleteDeliveryPreset(state: unknown, presetIdValue: unknown): DeliveryPresetState {
	const current = createDeliveryPresetState(state);
	const id = nonEmptyString(presetIdValue, 'presetId');
	if (!current.presets.some((preset) => preset.id === id)) {
		throw new ReferenceError(`Delivery preset ${id} does not exist.`);
	}
	return freezeState(current.presets.filter((preset) => preset.id !== id));
}

export function exportDeliveryPreset(state: unknown, presetIdValue: unknown): string {
	const preset = applyDeliveryPreset(state, presetIdValue);
	return `${JSON.stringify({
		schemaVersion: DELIVERY_PRESETS_SCHEMA_VERSION,
		presets: [preset],
	}, null, 2)}\n`;
}

/**
 * Import presets, keeping both sides of an id collision. A colliding id whose
 * content differs is re-minted rather than overwriting what the user already
 * had, which is the same rule the effect-preset importer follows.
 */
export function importDeliveryPresets(state: unknown, input: unknown, options: {
	idFactory?: () => string;
} = {}): DeliveryPresetState {
	const current = createDeliveryPresetState(state);
	let parsed: unknown;
	try {
		parsed = typeof input === 'string' ? JSON.parse(input) : input;
	} catch (cause) {
		throw new SyntaxError(
			`Invalid delivery preset JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
		);
	}
	const imported = createDeliveryPresetState(parsed).presets;
	if (!imported.length) throw new RangeError('The delivery preset file is empty.');
	const byId = new Map(current.presets.map((preset) => [preset.id, preset]));
	for (const preset of imported) {
		let id = preset.id;
		if (byId.has(id) && canonicalJson(byId.get(id)) !== canonicalJson(preset)) {
			id = presetId(options.idFactory);
		}
		byId.set(id, validateDeliveryPreset({ ...preset, id }));
	}
	return freezeState([...byId.values()]);
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	const row = value as Readonly<Record<string, unknown>>;
	return `{${Object.keys(row).sort().map(
		(key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`,
	).join(',')}}`;
}

function presetId(idFactory?: () => string): string {
	const value = typeof idFactory === 'function'
		? idFactory()
		: globalThis.crypto?.randomUUID?.() || `delivery-preset-${Math.random().toString(36).slice(2)}`;
	return nonEmptyString(value, 'preset.id');
}

function timestamp(value?: string): string {
	const date = value == null ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Delivery preset timestamp is invalid.');
	return date.toISOString();
}

function nonEmptyString(value: unknown, name: string): string {
	const result = String(value ?? '').trim();
	if (!result) throw new TypeError(`${name} must be a non-empty string.`);
	return result;
}

function freezeState(presets: readonly DeliveryPreset[]): DeliveryPresetState {
	return Object.freeze({
		schemaVersion: DELIVERY_PRESETS_SCHEMA_VERSION,
		presets: Object.freeze([...presets]),
	});
}
