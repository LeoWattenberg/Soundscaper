/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_EFFECT_DEFINITIONS, createVideoEffect } from '../../video-effects.js';
import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1 } from '../../video-cube-lut-profile-v1.ts';
import { GLOBAL_DEVELOP_VIDEO_EFFECT_DEFINITIONS_V1, normalizeGlobalDevelopParamsV1 } from '../../video-global-develop-v1.ts';
import type { VideoEffectLeafV2 } from '../../video-effect-leaf-v2.ts';
import type { VideoMaskMatteGraphV1OrV2 } from '../../video-mask-matte-name-v2.ts';
import { IMAGE_DEVELOP_LIMITS_V1, type ImageDevelopStateV1 } from '../image-develop-contract-v1.ts';
import { normalizeImageDevelopStateV1OrV2, type ImageDevelopStateV2 } from '../image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1, type ImageDevelopStateCurrentV1 } from '../image-develop-state-current-v1.ts';
import type { ImageDevelopSelectionV1, ImageDevelopSettingsPacketV1 } from '../image-develop-settings-contract-v1.ts';
import type { ImageDevelopSettingsPacketV2 } from '../image-develop-settings-contract-v2.ts';
import type { ImageDevelopSelectionV3, ImageDevelopSettingsPacketV3 } from '../image-develop-settings-contract-v3.ts';
import { copyImageDevelopGroupsV1, copyImageDevelopGroupsCurrentV1, copyImageDevelopSelectedGroupsV1,
	mergeImageDevelopGroupsV1, mergeImageDevelopGroupsCurrentV1, allocateImageDevelopSettingsIdV1 } from '../image-develop-settings-groups-v1.ts';
import { normalizeImageDevelopSettingsPacketV1, normalizeImageDevelopRelativeActionV1, checkImageDevelopSettingsBytesV1 } from '../image-develop-settings-v1.ts';
import { array, boolean, compareText, field, oneOf, record, unique } from '../image-develop-value.ts';

type Profile = 'legacy2' | 'current3';
type ReferencePolicy = 'external' | 'selected';
type LegacyState = ImageDevelopStateV1 | ImageDevelopStateV2;
type Packet = ImageDevelopSettingsPacketV1 | ImageDevelopSettingsPacketV2 | ImageDevelopSettingsPacketV3;

export function normalizeImageDevelopSelectionForProfileV1(profile: 'legacy2', value: unknown): Readonly<ImageDevelopSelectionV1>;
export function normalizeImageDevelopSelectionForProfileV1(profile: 'current3', value: unknown): Readonly<ImageDevelopSelectionV3>;
export function normalizeImageDevelopSelectionForProfileV1(profile: Profile, value: unknown): Readonly<ImageDevelopSelectionV1 | ImageDevelopSelectionV3> {
	assertProfile(profile);
	const input = record(value, 'Develop settings selection', profile === 'current3'
		? ['effectTypes', 'geometry', 'localAdjustments', 'repairs'] : ['effectTypes', 'geometry', 'localAdjustments']);
	const types = field(input, 'effectTypes');
	let effectTypes: ImageDevelopSelectionV1['effectTypes'] = 'all';
	if (types !== 'all') {
		const entries = array(types, 'Develop settings effect types', 0, IMAGE_DEVELOP_LIMITS_V1.maximumEffects)
			.map(type => oneOf(type, [...Object.keys(VIDEO_EFFECT_DEFINITIONS), CUBE_LUT_PROFILE_EFFECT_TYPE_V1], 'Develop settings effect type'));
		unique(entries, 'Develop settings effect types'); effectTypes = Object.freeze(entries.sort(compareText));
	}
	const selection = { effectTypes, geometry: boolean(field(input, 'geometry'), 'Develop geometry selection'),
		localAdjustments: boolean(field(input, 'localAdjustments'), 'Develop local selection') };
	return profile === 'current3' ? Object.freeze({ ...selection, repairs: boolean(field(input, 'repairs'), 'Develop repairs selection') }) : Object.freeze(selection);
}

export function copyImageDevelopSettingsForProfileV1(profile: 'legacy2', value: unknown): ImageDevelopSettingsPacketV2;
export function copyImageDevelopSettingsForProfileV1(profile: 'current3', value: unknown, policy?: ReferencePolicy): ImageDevelopSettingsPacketV3;
export function copyImageDevelopSettingsForProfileV1(profile: Profile, value: unknown, policy: ReferencePolicy = 'external'): ImageDevelopSettingsPacketV2 | ImageDevelopSettingsPacketV3 {
	assertProfile(profile);
	const input = request(profile, value, ['schemaVersion', 'develop', 'selection']);
	if (profile === 'legacy2') {
		const selection = normalizeImageDevelopSelectionForProfileV1('legacy2', field(input, 'selection'));
		const develop = normalizeImageDevelopStateV1OrV2(field(input, 'develop'));
		return bounded(Object.freeze({ schemaVersion: 2, kind: 'photo-develop-settings', selection,
			develop: normalizeImageDevelopStateV1OrV2({ processVersion: develop.processVersion, ...copyImageDevelopGroupsV1(develop, selection) }) }));
	}
	const selection = normalizeImageDevelopSelectionForProfileV1('current3', field(input, 'selection'));
	const develop = normalizeImageDevelopStateCurrentV1(field(input, 'develop'));
	const groups = policy === 'selected' ? copyImageDevelopSelectedGroupsV1(develop, selection) : copyImageDevelopGroupsCurrentV1(develop, selection);
	const copied = develop.processVersion === 3
		? { processVersion: 3, ...groups, repairs: selection.repairs ? develop.repairs : { schemaVersion: 1, spots: [] } }
		: { processVersion: develop.processVersion, ...groups };
	return bounded(Object.freeze({ schemaVersion: 3, kind: 'photo-develop-settings', selection,
		develop: normalizeImageDevelopStateCurrentV1(copied) }));
}

export function normalizeImageDevelopSettingsPacketForProfileV1(profile: 'legacy2', value: unknown): ImageDevelopSettingsPacketV2;
export function normalizeImageDevelopSettingsPacketForProfileV1(profile: 'current3', value: unknown, policy?: ReferencePolicy): ImageDevelopSettingsPacketV3;
export function normalizeImageDevelopSettingsPacketForProfileV1(profile: Profile, value: unknown, policy: ReferencePolicy = 'external'): ImageDevelopSettingsPacketV2 | ImageDevelopSettingsPacketV3 {
	assertProfile(profile);
	const input = request(profile, value, ['schemaVersion', 'kind', 'selection', 'develop']);
	if (field(input, 'kind') !== 'photo-develop-settings') throw new RangeError('Unsupported Develop settings packet.');
	const develop = normalizeState(profile, field(input, 'develop'));
	const copy = { schemaVersion: profile === 'legacy2' ? 2 : 3, develop, selection: field(input, 'selection') };
	const packet = profile === 'legacy2' ? copyImageDevelopSettingsForProfileV1('legacy2', copy) : copyImageDevelopSettingsForProfileV1('current3', copy, policy);
	if (JSON.stringify(packet.develop) !== JSON.stringify(develop)) throw new RangeError('Develop settings payload exceeds its selection.');
	return packet;
}

export function normalizeImageDevelopSettingsPacketCurrentForProfileV1(profile: 'legacy2', value: unknown): ImageDevelopSettingsPacketV1 | ImageDevelopSettingsPacketV2;
export function normalizeImageDevelopSettingsPacketCurrentForProfileV1(profile: 'current3', value: unknown, policy?: ReferencePolicy): Packet;
export function normalizeImageDevelopSettingsPacketCurrentForProfileV1(profile: Profile, value: unknown, policy: ReferencePolicy = 'external'): Packet {
	assertProfile(profile);
	const input = record(value, 'Develop settings packet', ['schemaVersion', 'kind', 'selection', 'develop']);
	const version = field(input, 'schemaVersion');
	if (version === 1) return normalizeImageDevelopSettingsPacketV1(input);
	if (version === 2) return normalizeImageDevelopSettingsPacketForProfileV1('legacy2', input);
	if (profile === 'current3' && version === 3) return normalizeImageDevelopSettingsPacketForProfileV1('current3', input, policy);
	throw new RangeError('Unsupported Develop settings version.');
}

export function mergeImageDevelopSettingsForProfileV1(profile: 'legacy2', value: unknown): LegacyState;
export function mergeImageDevelopSettingsForProfileV1(profile: 'current3', value: unknown, policy?: ReferencePolicy): ImageDevelopStateCurrentV1;
export function mergeImageDevelopSettingsForProfileV1(profile: Profile, value: unknown, policy: ReferencePolicy = 'external'): ImageDevelopStateCurrentV1 {
	assertProfile(profile);
	const input = request(profile, value, ['schemaVersion', 'target', 'settings']);
	const target = normalizeState(profile, field(input, 'target'));
	const packet = profile === 'legacy2' ? normalizeImageDevelopSettingsPacketCurrentForProfileV1('legacy2', field(input, 'settings'))
		: normalizeImageDevelopSettingsPacketCurrentForProfileV1('current3', field(input, 'settings'), policy);
	// Legacy packets retain their original grouping semantics when donated to
	// a Current target; only an explicit packet3 selects independent locals.
	const groups = packet.schemaVersion === 3 ? mergeImageDevelopGroupsCurrentV1<VideoEffectLeafV2, VideoMaskMatteGraphV1OrV2>(target, packet.develop, packet.selection)
		: mergeImageDevelopGroupsV1<VideoEffectLeafV2, VideoMaskMatteGraphV1OrV2>(target, packet.develop, packet.selection);
	const repairSelection = packet.schemaVersion === 3 && packet.selection.repairs;
	if (target.processVersion === 3 || repairSelection) {
		const repairs = repairSelection && packet.develop.processVersion === 3 ? packet.develop.repairs
			: repairSelection || target.processVersion !== 3 ? { schemaVersion: 1, spots: [] } : target.repairs;
		return bounded(normalizeImageDevelopStateCurrentV1({ processVersion: 3, ...groups, repairs }));
	}
	const processVersion = target.processVersion === 2 || groups.effects.some(effect => effect.type === CUBE_LUT_PROFILE_EFFECT_TYPE_V1)
		|| groups.masks.some(mask => mask.schemaVersion === 2) ? 2 : 1;
	return bounded(normalizeImageDevelopStateV1OrV2({ processVersion, ...groups }));
}

export function adjustImageDevelopSettingsForProfileV1(profile: 'legacy2', value: unknown): LegacyState;
export function adjustImageDevelopSettingsForProfileV1(profile: 'current3', value: unknown): ImageDevelopStateCurrentV1;
export function adjustImageDevelopSettingsForProfileV1(profile: Profile, value: unknown): ImageDevelopStateCurrentV1 {
	assertProfile(profile);
	const input = request(profile, value, ['schemaVersion', 'target', 'effectType', 'changes']);
	const target = normalizeState(profile, field(input, 'target'));
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
	return bounded(normalizeState(profile, { ...target, effects }));
}

function request(profile: Profile, value: unknown, fields: readonly string[]) {
	const input = record(value, 'Develop settings request', fields);
	if (field(input, 'schemaVersion') !== (profile === 'legacy2' ? 2 : 3)) throw new RangeError('Unsupported Develop settings version.');
	return input;
}
function normalizeState(profile: Profile, value: unknown): Readonly<ImageDevelopStateCurrentV1> {
	return profile === 'legacy2' ? normalizeImageDevelopStateV1OrV2(value) : normalizeImageDevelopStateCurrentV1(value);
}
function bounded<Value>(value: Value): Value { checkImageDevelopSettingsBytesV1(value); return value; }

function assertProfile(value: unknown): asserts value is Profile {
	if (value !== 'legacy2' && value !== 'current3') throw new RangeError('Unsupported fixed Develop profile.');
}
