/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopSelectionV1, ImageDevelopSettingsPacketV1 } from './image-develop-settings-contract-v1.ts';
import type { VideoEffectLeaf } from '../project-media-types.ts';
import { VIDEO_EFFECT_DEFINITIONS, createVideoEffect } from '../video-effects.js';
import { GLOBAL_DEVELOP_EFFECT_TYPES_V1, GLOBAL_DEVELOP_VIDEO_EFFECT_DEFINITIONS_V1 } from '../video-global-develop-v1.ts';
import { defaultImageDevelopStateV1, normalizeImageDevelopStateV1 } from './image-develop-state-v1.ts';
import { IMAGE_DEVELOP_LIMITS_V1, type ImageDevelopStateV1 } from './image-develop-contract-v1.ts';
import { array, boolean, compareText, field, number, oneOf, record, unique } from './image-develop-value.ts';

export function copyImageDevelopSettingsV1(value: unknown): ImageDevelopSettingsPacketV1 {
	const input = request(value, ['schemaVersion', 'develop', 'selection']);
	const selection = normalizeImageDevelopSelectionV1(field(input, 'selection'));
	const develop = normalizeImageDevelopStateV1(field(input, 'develop'));
	const bound = new Set(develop.maskBindings.map(binding => binding.effectId));
	const effects = develop.effects.filter(effect => selected(effect, selection, bound));
	const ids = new Set(effects.map(effect => effect.id));
	const maskBindings = develop.maskBindings.filter(binding => ids.has(binding.effectId));
	const maskIds = new Set(maskBindings.map(binding => binding.maskId));
	const masks = selection.localAdjustments && selection.effectTypes === 'all' ? develop.masks : develop.masks.filter(mask => maskIds.has(mask.id));
	if (masks.some(mask => mask.inputs.length > 0)) throw new RangeError('External mask media requires an authenticated settings adapter.');
	return bounded(Object.freeze({ schemaVersion: 1, kind: 'photo-develop-settings', selection,
		develop: normalizeImageDevelopStateV1({ processVersion: 1, effects, masks, maskBindings,
			geometry: selection.geometry ? develop.geometry : defaultImageDevelopStateV1().geometry }) }));
}

/** Packet payload is exactly its selection, so persisted or imported packets cannot smuggle other settings. */
export function normalizeImageDevelopSettingsPacketV1(value: unknown): ImageDevelopSettingsPacketV1 {
	const input = request(value, ['schemaVersion', 'kind', 'selection', 'develop']);
	if (field(input, 'kind') !== 'photo-develop-settings') throw new RangeError('Unsupported Develop settings packet.');
	const develop = normalizeImageDevelopStateV1(field(input, 'develop'));
	const packet = copyImageDevelopSettingsV1({ schemaVersion: 1, develop, selection: field(input, 'selection') });
	if (JSON.stringify(packet.develop) !== JSON.stringify(develop)) throw new RangeError('Develop settings payload exceeds its selection.');
	return packet;
}

export function normalizeImageDevelopSelectionV1(value: unknown): Readonly<ImageDevelopSelectionV1> {
	const input = record(value, 'Develop settings selection', ['effectTypes', 'geometry', 'localAdjustments']);
	const types = field(input, 'effectTypes');
	let effectTypes: ImageDevelopSelectionV1['effectTypes'] = 'all';
	if (types !== 'all') {
		const entries = array(types, 'Develop settings effect types', 0, IMAGE_DEVELOP_LIMITS_V1.maximumEffects)
			.map(type => oneOf(type, Object.keys(VIDEO_EFFECT_DEFINITIONS), 'Develop settings effect type'));
		unique(entries, 'Develop settings effect types'); effectTypes = Object.freeze(entries.sort(compareText));
	}
	return Object.freeze({ effectTypes, geometry: boolean(field(input, 'geometry'), 'Develop geometry selection'),
		localAdjustments: boolean(field(input, 'localAdjustments'), 'Develop local selection') });
}

/** Insert the donated group at the first replaced target position; retain unselected order and IDs. */
export function mergeImageDevelopSettingsV1(value: unknown): ImageDevelopStateV1 {
	const input = request(value, ['schemaVersion', 'target', 'settings']);
	const target = normalizeImageDevelopStateV1(field(input, 'target'));
	const packet = normalizeImageDevelopSettingsPacketV1(field(input, 'settings')), source = packet.develop, selection = packet.selection;
	if (selection.effectTypes === 'all' && selection.localAdjustments) {
		return bounded(normalizeImageDevelopStateV1({ ...source, geometry: selection.geometry ? source.geometry : target.geometry }));
	}
	const bound = new Set(target.maskBindings.map(binding => binding.effectId));
	const retained = target.effects.filter(effect => !selected(effect, selection, bound));
	const retainedIds = new Set(retained.map(effect => effect.id));
	const effectIds = new Map<string, string>(), reserved = new Set([...retainedIds, ...source.effects.map(effect => effect.id)]);
	const effects = source.effects.map(effect => {
		const id = retainedIds.has(effect.id) ? allocate(reserved, 'copied-effect') : effect.id;
		effectIds.set(effect.id, id); return { ...effect, id };
	});
	const retainedMaskIds = new Set(target.maskBindings.filter(binding => retainedIds.has(binding.effectId)).map(binding => binding.maskId));
	const formerlyBoundMasks = new Set(target.maskBindings.map(binding => binding.maskId));
	const masks = target.masks.filter(mask => retainedMaskIds.has(mask.id) || !formerlyBoundMasks.has(mask.id));
	const maskIds = new Map<string, string>();
	const reservedMasks = new Set([...masks.map(mask => mask.id), ...source.masks.map(mask => mask.id)]);
	for (const mask of source.masks) {
		const existing = masks.find(candidate => candidate.id === mask.id);
		if (existing && JSON.stringify(existing) === JSON.stringify(mask)) { maskIds.set(mask.id, mask.id); continue; }
		const id = existing ? allocate(reservedMasks, 'copied-mask') : mask.id;
		maskIds.set(mask.id, id); masks.push({ ...mask, id });
	}
	const insertion = target.effects.findIndex(effect => selected(effect, selection, bound));
	const position = insertion < 0 ? retained.length : insertion;
	const maskBindings = [...target.maskBindings.filter(binding => retainedIds.has(binding.effectId)),
		...source.maskBindings.map(binding => ({ effectId: effectIds.get(binding.effectId)!, maskId: maskIds.get(binding.maskId)! }))];
	return bounded(normalizeImageDevelopStateV1({ processVersion: 1, effects: [...retained.slice(0, position), ...effects, ...retained.slice(position)],
		geometry: selection.geometry ? source.geometry : target.geometry, masks, maskBindings }));
}

export function normalizeImageDevelopRelativeActionV1(value: unknown) {
	const input = record(value, 'relative Develop action', ['effectType', 'changes']);
	const effectType = oneOf(field(input, 'effectType'), GLOBAL_DEVELOP_EFFECT_TYPES_V1, 'relative Develop effect type');
	const params = GLOBAL_DEVELOP_VIDEO_EFFECT_DEFINITIONS_V1[effectType].params;
	const changes = record(field(input, 'changes'), 'relative Develop deltas', Object.keys(params), []);
	if (!Object.keys(changes).length) throw new RangeError('Relative Develop requires at least one delta.');
	const detached: Record<string, number> = {};
	for (const key of Object.keys(changes)) {
		const parameter = params[key]!;
		detached[key] = number(field(changes, key), parameter.min - parameter.max, parameter.max - parameter.min, 'relative Develop delta');
	}
	return Object.freeze({ effectType, changes: Object.freeze(detached) });
}

/** Add a delta to the first enabled unmasked instance. Clamp at its shared range; other instances keep their order. */
export function adjustImageDevelopSettingsV1(value: unknown): ImageDevelopStateV1 {
	const input = request(value, ['schemaVersion', 'target', 'effectType', 'changes']);
	const target = normalizeImageDevelopStateV1(field(input, 'target'));
	const action = normalizeImageDevelopRelativeActionV1({ effectType: field(input, 'effectType'), changes: field(input, 'changes') });
	if (Object.values(action.changes).every(delta => delta === 0)) return bounded(target);
	const bound = new Set(target.maskBindings.map(binding => binding.effectId));
	const position = target.effects.findIndex(effect => effect.type === action.effectType && effect.enabled && !bound.has(effect.id));
	const source = position < 0 ? createVideoEffect(action.effectType, {
		id: allocate(new Set(target.effects.map(effect => effect.id)), 'quick-develop'),
	}) as VideoEffectLeaf : target.effects[position]!;
	const definitions = GLOBAL_DEVELOP_VIDEO_EFFECT_DEFINITIONS_V1[action.effectType].params, params = { ...source.params };
	for (const [key, delta] of Object.entries(action.changes)) {
		const definition = definitions[key]!;
		params[key] = Math.min(definition.max, Math.max(definition.min, params[key]! + delta));
	}
	const changed = { ...source, params };
	const effects = position < 0 ? [...target.effects, changed] : target.effects.map((effect, index) => index === position ? changed : effect);
	return bounded(normalizeImageDevelopStateV1({ ...target, effects }));
}

function selected(effect: VideoEffectLeaf, selection: ImageDevelopSelectionV1, bound: ReadonlySet<string>): boolean {
	return (selection.effectTypes === 'all' || selection.effectTypes.includes(effect.type)) && (selection.localAdjustments || !bound.has(effect.id));
}

function allocate(reserved: Set<string>, prefix: string): string {
	for (let index = 1; index <= IMAGE_DEVELOP_LIMITS_V1.maximumEffects + IMAGE_DEVELOP_LIMITS_V1.maximumMasks + 1; index++) {
		const id = `${prefix}-${String(index)}`;
		if (!reserved.has(id)) { reserved.add(id); return id; }
	}
	throw new RangeError('Develop settings ID allocation exceeded its bound.');
}

function request(value: unknown, fields: readonly string[]) {
	const input = record(value, 'Develop settings request', fields);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported Develop settings version.');
	return input;
}

export function checkImageDevelopSettingsBytesV1(value: unknown): void { bounded(value); }
function bounded<Value>(value: Value): Value {
	const text = JSON.stringify(value);
	if (text.length > IMAGE_DEVELOP_LIMITS_V1.maximumBytes
		|| new TextEncoder().encode(text).byteLength > IMAGE_DEVELOP_LIMITS_V1.maximumBytes) {
		throw new RangeError('Develop settings exceed their scalar byte budget.');
	}
	return value;
}
