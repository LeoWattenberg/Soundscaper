/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_EFFECT_DEFINITIONS, createVideoEffect } from '../../video-effects.js';
import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1 } from '../../video-cube-lut-profile-v1.ts';
import { GLOBAL_DEVELOP_VIDEO_EFFECT_DEFINITIONS_V1, normalizeGlobalDevelopParamsV1 } from '../../video-global-develop-v1.ts';
import type { VideoEffectLeafV2 } from '../../video-effect-leaf-v2.ts';
import type { VideoMaskMatteGraphV1OrV2 } from '../../video-mask-matte-name-v2.ts';
import { IMAGE_DEVELOP_LIMITS_V1, type ImageDevelopStateV1 } from '../image-develop-contract-v1.ts';
import { normalizeImageDevelopStateV1OrV2, type ImageDevelopStateV2 } from '../image-develop-state-v2.ts';
import { normalizeImageDevelopStateThroughV3, type ImageDevelopStateThroughV3 } from '../image-develop-state-through-v3.ts';
import { normalizeImageDevelopStateThroughV4, normalizeImageDevelopStateV4, type ImageDevelopStateThroughV4 } from '../image-develop-state-v4.ts';
import type { ImageDevelopSelectionV1, ImageDevelopSettingsPacketV1 } from '../image-develop-settings-contract-v1.ts';
import type { ImageDevelopSettingsPacketV2 } from '../image-develop-settings-contract-v2.ts';
import type { ImageDevelopSelectionV3, ImageDevelopSettingsPacketV3 } from '../image-develop-settings-contract-v3.ts';
import type { ImageDevelopSelectionV4, ImageDevelopSettingsPacketV4 } from '../image-develop-settings-contract-v4.ts';
import { copyImageDevelopGroupsV1, copyImageDevelopGroupsCurrentV1, copyImageDevelopSelectedGroupsV1,
	mergeImageDevelopGroupsV1, mergeImageDevelopGroupsCurrentV1, allocateImageDevelopSettingsIdV1 } from '../image-develop-settings-groups-v1.ts';
import { normalizeImageDevelopSettingsPacketV1, normalizeImageDevelopRelativeActionV1, checkImageDevelopSettingsBytesV1 } from '../image-develop-settings-v1.ts';
import { array, boolean, compareText, field, oneOf, record, unique } from '../image-develop-value.ts';

type Profile = 'legacy2' | 'current3' | 'current4';
type ReferencePolicy = 'external' | 'selected';
type LegacyState = ImageDevelopStateV1 | ImageDevelopStateV2;
type PacketThroughV3 = ImageDevelopSettingsPacketV1 | ImageDevelopSettingsPacketV2 | ImageDevelopSettingsPacketV3;
type Packet = PacketThroughV3 | ImageDevelopSettingsPacketV4;

export function normalizeImageDevelopSelectionForProfileV1(profile: 'legacy2', value: unknown): Readonly<ImageDevelopSelectionV1>;
export function normalizeImageDevelopSelectionForProfileV1(profile: 'current3', value: unknown): Readonly<ImageDevelopSelectionV3>;
export function normalizeImageDevelopSelectionForProfileV1(profile: 'current4', value: unknown): Readonly<ImageDevelopSelectionV4>;
export function normalizeImageDevelopSelectionForProfileV1(profile: Profile, value: unknown): Readonly<ImageDevelopSelectionV1 | ImageDevelopSelectionV3 | ImageDevelopSelectionV4> {
	assertProfile(profile);
	if (profile === 'current4') return selection4(value);
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
export function copyImageDevelopSettingsForProfileV1(profile: 'current4', value: unknown, policy?: ReferencePolicy): ImageDevelopSettingsPacketV4;
export function copyImageDevelopSettingsForProfileV1(profile: Profile, value: unknown, policy: ReferencePolicy = 'external'): ImageDevelopSettingsPacketV2 | ImageDevelopSettingsPacketV3 | ImageDevelopSettingsPacketV4 {
	assertProfile(profile);
	if (profile === 'current4') return copy4(value, policy);
	const input = request(profile, value, ['schemaVersion', 'develop', 'selection']);
	if (profile === 'legacy2') {
		const selection = normalizeImageDevelopSelectionForProfileV1('legacy2', field(input, 'selection'));
		const develop = normalizeImageDevelopStateV1OrV2(field(input, 'develop'));
		return bounded(Object.freeze({ schemaVersion: 2, kind: 'photo-develop-settings', selection,
			develop: normalizeImageDevelopStateV1OrV2({ processVersion: develop.processVersion, ...copyImageDevelopGroupsV1(develop, selection) }) }));
	}
	const selection = normalizeImageDevelopSelectionForProfileV1('current3', field(input, 'selection'));
	const develop = normalizeImageDevelopStateThroughV3(field(input, 'develop'));
	const groups = policy === 'selected' ? copyImageDevelopSelectedGroupsV1(develop, selection) : copyImageDevelopGroupsCurrentV1(develop, selection);
	const copied = develop.processVersion === 3
		? { processVersion: 3, ...groups, repairs: selection.repairs ? develop.repairs : { schemaVersion: 1, spots: [] } }
		: { processVersion: develop.processVersion, ...groups };
	return bounded(Object.freeze({ schemaVersion: 3, kind: 'photo-develop-settings', selection,
		develop: normalizeImageDevelopStateThroughV3(copied) }));
}

export function normalizeImageDevelopSettingsPacketForProfileV1(profile: 'legacy2', value: unknown): ImageDevelopSettingsPacketV2;
export function normalizeImageDevelopSettingsPacketForProfileV1(profile: 'current3', value: unknown, policy?: ReferencePolicy): ImageDevelopSettingsPacketV3;
export function normalizeImageDevelopSettingsPacketForProfileV1(profile: 'current4', value: unknown, policy?: ReferencePolicy): ImageDevelopSettingsPacketV4;
export function normalizeImageDevelopSettingsPacketForProfileV1(profile: Profile, value: unknown, policy: ReferencePolicy = 'external'): ImageDevelopSettingsPacketV2 | ImageDevelopSettingsPacketV3 | ImageDevelopSettingsPacketV4 {
	assertProfile(profile);
	if (profile === 'current4') {
		const input = request(profile, value, ['schemaVersion', 'kind', 'selection', 'develop']);
		if (field(input, 'kind') !== 'photo-develop-settings') throw new RangeError('Unsupported Develop settings packet.');
		const develop = normalizeImageDevelopStateThroughV4(field(input, 'develop'));
		const packet = copy4({ schemaVersion: 4, develop, selection: field(input, 'selection') }, policy);
		if (JSON.stringify(packet.develop) !== JSON.stringify(develop)) throw new RangeError('Develop settings payload exceeds its selection.');
		return packet;
	}
	const input = request(profile, value, ['schemaVersion', 'kind', 'selection', 'develop']);
	if (field(input, 'kind') !== 'photo-develop-settings') throw new RangeError('Unsupported Develop settings packet.');
	const develop = normalizeState(profile, field(input, 'develop'));
	const copy = { schemaVersion: profile === 'legacy2' ? 2 : 3, develop, selection: field(input, 'selection') };
	const packet = profile === 'legacy2' ? copyImageDevelopSettingsForProfileV1('legacy2', copy) : copyImageDevelopSettingsForProfileV1('current3', copy, policy);
	if (JSON.stringify(packet.develop) !== JSON.stringify(develop)) throw new RangeError('Develop settings payload exceeds its selection.');
	return packet;
}

export function normalizeImageDevelopSettingsPacketCurrentForProfileV1(profile: 'legacy2', value: unknown): ImageDevelopSettingsPacketV1 | ImageDevelopSettingsPacketV2;
export function normalizeImageDevelopSettingsPacketCurrentForProfileV1(profile: 'current3', value: unknown, policy?: ReferencePolicy): PacketThroughV3;
export function normalizeImageDevelopSettingsPacketCurrentForProfileV1(profile: 'current4', value: unknown, policy?: ReferencePolicy): Packet;
export function normalizeImageDevelopSettingsPacketCurrentForProfileV1(profile: Profile, value: unknown, policy: ReferencePolicy = 'external'): Packet {
	assertProfile(profile);
	const input = record(value, 'Develop settings packet', ['schemaVersion', 'kind', 'selection', 'develop']);
	const version = field(input, 'schemaVersion');
	if (version === 1) return normalizeImageDevelopSettingsPacketV1(input);
	if (version === 2) return normalizeImageDevelopSettingsPacketForProfileV1('legacy2', input);
	if (profile !== 'legacy2' && version === 3) return normalizeImageDevelopSettingsPacketForProfileV1('current3', input, policy);
	if (profile === 'current4' && version === 4) return normalizeImageDevelopSettingsPacketForProfileV1('current4', input, policy);
	throw new RangeError('Unsupported Develop settings version.');
}

export function mergeImageDevelopSettingsForProfileV1(profile: 'legacy2', value: unknown): LegacyState;
export function mergeImageDevelopSettingsForProfileV1(profile: 'current3', value: unknown, policy?: ReferencePolicy): ImageDevelopStateThroughV3;
export function mergeImageDevelopSettingsForProfileV1(profile: 'current4', value: unknown, policy?: ReferencePolicy): ImageDevelopStateThroughV4;
export function mergeImageDevelopSettingsForProfileV1(profile: Profile, value: unknown, policy: ReferencePolicy = 'external'): ImageDevelopStateThroughV4 {
	assertProfile(profile);
	if (profile === 'current4') return merge4(value, policy);
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
		return bounded(normalizeImageDevelopStateThroughV3({ processVersion: 3, ...groups, repairs }));
	}
	const processVersion = target.processVersion === 2 || groups.effects.some(effect => effect.type === CUBE_LUT_PROFILE_EFFECT_TYPE_V1)
		|| groups.masks.some(mask => mask.schemaVersion === 2) ? 2 : 1;
	return bounded(normalizeImageDevelopStateV1OrV2({ processVersion, ...groups }));
}

export function adjustImageDevelopSettingsForProfileV1(profile: 'legacy2', value: unknown): LegacyState;
export function adjustImageDevelopSettingsForProfileV1(profile: 'current3', value: unknown): ImageDevelopStateThroughV3;
export function adjustImageDevelopSettingsForProfileV1(profile: 'current4', value: unknown): ImageDevelopStateThroughV4;
export function adjustImageDevelopSettingsForProfileV1(profile: Profile, value: unknown): ImageDevelopStateThroughV4 {
	assertProfile(profile);
	if (profile === 'current4') {
		const input = request(profile, value, ['schemaVersion', 'target', 'effectType', 'changes']);
		const target = normalizeImageDevelopStateThroughV4(field(input, 'target'));
		const adjusted = adjustImageDevelopSettingsForProfileV1('current3', { schemaVersion: 3, target: computational3(target), effectType: field(input, 'effectType'), changes: field(input, 'changes') });
		return target.processVersion === 4 ? normalizeImageDevelopStateV4({ ...adjusted, processVersion: 4, rawDevelopment: target.rawDevelopment }) : adjusted;
	}
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
	if (field(input, 'schemaVersion') !== (profile === 'legacy2' ? 2 : profile === 'current3' ? 3 : 4)) throw new RangeError('Unsupported Develop settings version.');
	return input;
}
function normalizeState(profile: 'legacy2' | 'current3', value: unknown): Readonly<ImageDevelopStateThroughV3> {
	return profile === 'legacy2' ? normalizeImageDevelopStateV1OrV2(value) : normalizeImageDevelopStateThroughV3(value);
}
function bounded<Value>(value: Value): Value { checkImageDevelopSettingsBytesV1(value); return value; }

function assertProfile(value: unknown): asserts value is Profile {
	if (value !== 'legacy2' && value !== 'current3' && value !== 'current4') throw new RangeError('Unsupported fixed Develop profile.');
}

function selection4(value: unknown): Readonly<ImageDevelopSelectionV4> {
	const input = record(value, 'Develop settings selection4', ['effectTypes', 'geometry', 'localAdjustments', 'repairs', 'rawDevelopment']);
	const legacy = normalizeImageDevelopSelectionForProfileV1('current3', { effectTypes: field(input, 'effectTypes'), geometry: field(input, 'geometry'),
		localAdjustments: field(input, 'localAdjustments'), repairs: field(input, 'repairs') });
	return Object.freeze({ ...legacy, rawDevelopment: boolean(field(input, 'rawDevelopment'), 'RAW development selection') });
}
function selection3(value: ImageDevelopSelectionV4): ImageDevelopSelectionV3 {
	return { effectTypes: value.effectTypes, geometry: value.geometry, localAdjustments: value.localAdjustments, repairs: value.repairs };
}
function computational3(value: ImageDevelopStateThroughV4): ImageDevelopStateThroughV3 {
	if (value.processVersion !== 4) return value;
	return normalizeImageDevelopStateThroughV3({ processVersion: 3, effects: value.effects, geometry: value.geometry,
		masks: value.masks, maskBindings: value.maskBindings, repairs: value.repairs });
}
function copy4(value: unknown, policy: ReferencePolicy): ImageDevelopSettingsPacketV4 {
	const input = request('current4', value, ['schemaVersion', 'develop', 'selection']);
	const selection = selection4(field(input, 'selection')), source = normalizeImageDevelopStateThroughV4(field(input, 'develop'));
	const copied = copyImageDevelopSettingsForProfileV1('current3', { schemaVersion: 3, develop: computational3(source), selection: selection3(selection) }, policy);
	const develop = source.processVersion === 4 ? normalizeImageDevelopStateV4({ ...copied.develop, processVersion: 4,
		rawDevelopment: selection.rawDevelopment ? source.rawDevelopment : { schemaVersion: 1, mode: 'canonical' } }) : copied.develop;
	return bounded(Object.freeze({ schemaVersion: 4, kind: 'photo-develop-settings', selection, develop }));
}
function merge4(value: unknown, policy: ReferencePolicy): ImageDevelopStateThroughV4 {
	const input = request('current4', value, ['schemaVersion', 'target', 'settings']);
	const target = normalizeImageDevelopStateThroughV4(field(input, 'target'));
	const packet = normalizeImageDevelopSettingsPacketCurrentForProfileV1('current4', field(input, 'settings'), policy);
	const projected = packet.schemaVersion === 4 ? { schemaVersion: 3, kind: packet.kind, selection: selection3(packet.selection), develop: computational3(packet.develop) } : packet;
	const merged = mergeImageDevelopSettingsForProfileV1('current3', { schemaVersion: 3, target: computational3(target), settings: projected }, policy);
	const selected = packet.schemaVersion === 4 && packet.selection.rawDevelopment;
	if (target.processVersion !== 4 && !(selected && packet.develop.processVersion === 4)) return merged;
	const rawDevelopment = selected ? packet.develop.processVersion === 4 ? packet.develop.rawDevelopment : { schemaVersion: 1, mode: 'canonical' }
		: target.processVersion === 4 ? target.rawDevelopment : { schemaVersion: 1, mode: 'canonical' };
	return normalizeImageDevelopStateV4({ ...merged, processVersion: 4,
		repairs: merged.processVersion === 3 ? merged.repairs : { schemaVersion: 1, spots: [] }, rawDevelopment });
}
