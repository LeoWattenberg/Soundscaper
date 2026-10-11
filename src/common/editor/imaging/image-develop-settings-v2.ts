/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_EFFECT_DEFINITIONS, createVideoEffect } from '../video-effects.js';
import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1 } from '../video-cube-lut-profile-v1.ts';
import { GLOBAL_DEVELOP_VIDEO_EFFECT_DEFINITIONS_V1, normalizeGlobalDevelopParamsV1 } from '../video-global-develop-v1.ts';
import type { VideoEffectLeafV2 } from '../video-effect-leaf-v2.ts';
import type { VideoMaskMatteGraphV1OrV2 } from '../video-mask-matte-name-v2.ts';
import { IMAGE_DEVELOP_LIMITS_V1, type ImageDevelopStateV1 } from './image-develop-contract-v1.ts';
import type { ImageDevelopStateV2 } from './image-develop-state-v2.ts';
import { normalizeImageDevelopStateV1OrV2 } from './image-develop-state-v2.ts';
import type { ImageDevelopSelectionV1, ImageDevelopSettingsPacketV1 } from './image-develop-settings-contract-v1.ts';
import type { ImageDevelopSettingsPacketV2 } from './image-develop-settings-contract-v2.ts';
import { copyImageDevelopGroupsV1, mergeImageDevelopGroupsV1, allocateImageDevelopSettingsIdV1 } from './image-develop-settings-groups-v1.ts';
import { normalizeImageDevelopSettingsPacketV1, normalizeImageDevelopRelativeActionV1, checkImageDevelopSettingsBytesV1 } from './image-develop-settings-v1.ts';
import { array, boolean, compareText, field, oneOf, record, unique } from './image-develop-value.ts';

export function copyImageDevelopSettingsV2(value: unknown): ImageDevelopSettingsPacketV2 {
	const input = request(value, ['schemaVersion', 'develop', 'selection']);
	const selection = normalizeImageDevelopSelectionV2(field(input, 'selection'));
	const develop = normalizeImageDevelopStateV1OrV2(field(input, 'develop'));
	return bounded(Object.freeze({ schemaVersion: 2, kind: 'photo-develop-settings', selection,
		develop: normalizeImageDevelopStateV1OrV2({ processVersion: develop.processVersion, ...copyImageDevelopGroupsV1(develop, selection) }) }));
}

/** A selected body contains exactly its selected groups, including disabled
 * and null LUT instances. References do not prove any body or render resource. */
export function normalizeImageDevelopSettingsPacketV2(value: unknown): ImageDevelopSettingsPacketV2 {
	const input = request(value, ['schemaVersion', 'kind', 'selection', 'develop']);
	if (field(input, 'kind') !== 'photo-develop-settings') throw new RangeError('Unsupported Develop settings packet.');
	const develop = normalizeImageDevelopStateV1OrV2(field(input, 'develop'));
	const packet = copyImageDevelopSettingsV2({ schemaVersion: 2, develop, selection: field(input, 'selection') });
	if (JSON.stringify(packet.develop) !== JSON.stringify(develop)) throw new RangeError('Develop settings payload exceeds its selection.');
	return packet;
}

export function normalizeImageDevelopSettingsPacketV1OrV2(value: unknown): ImageDevelopSettingsPacketV1 | ImageDevelopSettingsPacketV2 {
	const input = record(value, 'Develop settings packet', ['schemaVersion', 'kind', 'selection', 'develop']);
	const version = field(input, 'schemaVersion');
	if (version === 1) return normalizeImageDevelopSettingsPacketV1(input);
	if (version === 2) return normalizeImageDevelopSettingsPacketV2(input);
	throw new RangeError('Unsupported Develop settings version.');
}

export function normalizeImageDevelopSelectionV2(value: unknown): Readonly<ImageDevelopSelectionV1> {
	const input = record(value, 'Develop settings selection', ['effectTypes', 'geometry', 'localAdjustments']);
	const types = field(input, 'effectTypes');
	let effectTypes: ImageDevelopSelectionV1['effectTypes'] = 'all';
	if (types !== 'all') {
		const entries = array(types, 'Develop settings effect types', 0, IMAGE_DEVELOP_LIMITS_V1.maximumEffects)
			.map(type => oneOf(type, [...Object.keys(VIDEO_EFFECT_DEFINITIONS), CUBE_LUT_PROFILE_EFFECT_TYPE_V1], 'Develop settings effect type'));
		unique(entries, 'Develop settings effect types'); effectTypes = Object.freeze(entries.sort(compareText));
	}
	return Object.freeze({ effectTypes, geometry: boolean(field(input, 'geometry'), 'Develop geometry selection'),
		localAdjustments: boolean(field(input, 'localAdjustments'), 'Develop local selection') });
}

/** Retain an explicit process2 target. A process1 target promotes only when
 * the merged authored recipe contains a resource instance or named graph. */
export function mergeImageDevelopSettingsV2(value: unknown): ImageDevelopStateV1 | ImageDevelopStateV2 {
	const input = request(value, ['schemaVersion', 'target', 'settings']);
	const target = normalizeImageDevelopStateV1OrV2(field(input, 'target'));
	const packet = normalizeImageDevelopSettingsPacketV1OrV2(field(input, 'settings'));
	const groups = mergeImageDevelopGroupsV1<VideoEffectLeafV2, VideoMaskMatteGraphV1OrV2>(target, packet.develop, packet.selection);
	const processVersion = target.processVersion === 2 || groups.effects.some(effect => effect.type === CUBE_LUT_PROFILE_EFFECT_TYPE_V1)
		|| groups.masks.some(mask => mask.schemaVersion === 2) ? 2 : 1;
	return bounded(normalizeImageDevelopStateV1OrV2({ processVersion, ...groups }));
}

/** Relative scalar quick-develop preserves every retained resource instance;
 * it neither edits a reference nor promotes a numeric-only legacy recipe. */
export function adjustImageDevelopSettingsV2(value: unknown): ImageDevelopStateV1 | ImageDevelopStateV2 {
	const input = request(value, ['schemaVersion', 'target', 'effectType', 'changes']);
	const target = normalizeImageDevelopStateV1OrV2(field(input, 'target'));
	const action = normalizeImageDevelopRelativeActionV1({ effectType: field(input, 'effectType'), changes: field(input, 'changes') });
	if (Object.values(action.changes).every(delta => delta === 0)) return bounded(target);
	const bound = new Set(target.maskBindings.map(binding => binding.effectId));
	const position = target.effects.findIndex(effect => effect.type === action.effectType && effect.enabled && !bound.has(effect.id));
	const source = position < 0 ? createVideoEffect(action.effectType, {
		id: allocateImageDevelopSettingsIdV1(new Set(target.effects.map(effect => effect.id)), 'quick-develop'),
	}) as VideoEffectLeafV2 : target.effects[position]!;
	const definitions = GLOBAL_DEVELOP_VIDEO_EFFECT_DEFINITIONS_V1[action.effectType].params, params = { ...normalizeGlobalDevelopParamsV1(action.effectType, source.params) };
	for (const [key, delta] of Object.entries(action.changes)) {
		const definition = definitions[key]!;
		params[key] = Math.min(definition.max, Math.max(definition.min, params[key]! + delta));
	}
	const changed = { ...source, params };
	const effects = position < 0 ? [...target.effects, changed] : target.effects.map((effect, index) => index === position ? changed : effect);
	return bounded(normalizeImageDevelopStateV1OrV2({ ...target, effects }));
}

function request(value: unknown, fields: readonly string[]) {
	const input = record(value, 'Develop settings request', fields);
	if (field(input, 'schemaVersion') !== 2) throw new RangeError('Unsupported Develop settings version.');
	return input;
}
function bounded<Value>(value: Value): Value { checkImageDevelopSettingsBytesV1(value); return value; }
