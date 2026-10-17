/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopSelectionV1, ImageDevelopSettingsPacketV1 } from './image-develop-settings-contract-v1.ts';
import type { VideoEffectLeaf } from '../project-media-types.ts';
import { VIDEO_EFFECT_DEFINITIONS, createVideoEffect } from '../video-effects.js';
import { GLOBAL_DEVELOP_EFFECT_TYPES_V1, GLOBAL_DEVELOP_VIDEO_EFFECT_DEFINITIONS_V1, normalizeGlobalDevelopParamsV1 } from '../video-global-develop-v1.ts';
import { normalizeImageDevelopStateV1 } from './image-develop-state-v1.ts';
import { copyImageDevelopGroupsV1, mergeImageDevelopGroupsV1, allocateImageDevelopSettingsIdV1 as allocate } from './image-develop-settings-groups-v1.ts';
import { IMAGE_DEVELOP_LIMITS_V1, type ImageDevelopStateV1 } from './image-develop-contract-v1.ts';
import { array, boolean, compareText, field, number, oneOf, record, unique } from './image-develop-value.ts';

export function copyImageDevelopSettingsV1(value: unknown): ImageDevelopSettingsPacketV1 {
	const input = request(value, ['schemaVersion', 'develop', 'selection']);
	const selection = normalizeImageDevelopSelectionV1(field(input, 'selection'));
	const develop = normalizeImageDevelopStateV1(field(input, 'develop'));
	return bounded(Object.freeze({ schemaVersion: 1, kind: 'photo-develop-settings', selection,
		develop: normalizeImageDevelopStateV1({ processVersion: 1, ...copyImageDevelopGroupsV1(develop, selection) }) }));
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
	return bounded(normalizeImageDevelopStateV1({ processVersion: 1, ...mergeImageDevelopGroupsV1(target, source, selection) }));
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
	const definitions = GLOBAL_DEVELOP_VIDEO_EFFECT_DEFINITIONS_V1[action.effectType].params, params = { ...normalizeGlobalDevelopParamsV1(action.effectType, source.params) };
	for (const [key, delta] of Object.entries(action.changes)) {
		const definition = definitions[key]!;
		params[key] = Math.min(definition.max, Math.max(definition.min, params[key]! + delta));
	}
	const changed = { ...source, params };
	const effects = position < 0 ? [...target.effects, changed] : target.effects.map((effect, index) => index === position ? changed : effect);
	return bounded(normalizeImageDevelopStateV1({ ...target, effects }));
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
