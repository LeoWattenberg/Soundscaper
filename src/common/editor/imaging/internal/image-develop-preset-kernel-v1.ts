/* SPDX-License-Identifier: AGPL-3.0-only */

import { fingerprintNativeMediaPlan } from '../../native-media-plan-canonical-form.ts';
import { normalizeVideoVisualPresetV1 } from '../../video-visual-preset-v24.ts';
import type { ImageDevelopStateV1 } from '../image-develop-contract-v1.ts';
import type { ImageDevelopStateV2 } from '../image-develop-state-v2.ts';
import type { ImageDevelopStateThroughV3 } from '../image-develop-state-through-v3.ts';
import type { ImageDevelopStateThroughV4 } from '../image-develop-state-v4.ts';
import { IMAGE_DEVELOP_LIMITS_V1 } from '../image-develop-contract-v1.ts';
import { normalizeImageDevelopPresetV1, type ImageDevelopPresetV1 } from '../image-develop-preset-v1.ts';
import type { ImageDevelopPresetV2 } from '../image-develop-preset-v2.ts';
import type { ImageDevelopPresetV3 } from '../image-develop-preset-v3.ts';
import type { ImageDevelopPresetV4 } from '../image-develop-preset-v4.ts';
import { mergeImageDevelopSettingsV2, normalizeImageDevelopSettingsPacketV2 } from '../image-develop-settings-v2.ts';
import { mergeImageDevelopSettingsV3, normalizeImageDevelopSettingsPacketV3 } from '../image-develop-settings-v3.ts';
import { normalizeImageDevelopSelectedSettingsPacketV3 } from '../image-develop-settings-selected-v3.ts';
import { mergeImageDevelopSettingsV4, normalizeImageDevelopSettingsPacketV4 } from '../image-develop-settings-v4.ts';
import { normalizeImageDevelopSelectedSettingsPacketV4 } from '../image-develop-settings-selected-v4.ts';
import { field, record } from '../image-develop-value.ts';

type Profile = 'legacy2' | 'current3' | 'current4';
type ReferencePolicy = 'external' | 'selected';
type PresetThroughV3 = ImageDevelopPresetV1 | ImageDevelopPresetV2 | ImageDevelopPresetV3;
type Preset = PresetThroughV3 | ImageDevelopPresetV4;

export function createImageDevelopPresetForProfileV1(profile: 'legacy2', value: unknown): ImageDevelopPresetV2;
export function createImageDevelopPresetForProfileV1(profile: 'current3', value: unknown, policy?: ReferencePolicy): ImageDevelopPresetV3;
export function createImageDevelopPresetForProfileV1(profile: 'current4', value: unknown, policy?: ReferencePolicy): ImageDevelopPresetV4;
export function createImageDevelopPresetForProfileV1(profile: Profile, value: unknown, policy: ReferencePolicy = 'external'): ImageDevelopPresetV2 | ImageDevelopPresetV3 | ImageDevelopPresetV4 {
	assertProfile(profile, policy);
	const input = request(profile, value, ['schemaVersion', 'id', 'name', 'settings']);
	const settings = normalizeSettings(profile, field(input, 'settings'), policy);
	const identity = normalizeVideoVisualPresetV1({ schemaVersion: 1, kind: 'video-preset', id: field(input, 'id'), name: field(input, 'name'),
		modelKind: 'adjustment-layer', authoredStateSha256: fingerprintNativeMediaPlan(settings).sha256 });
	return settings.schemaVersion === 2 ? bounded(Object.freeze({ schemaVersion: 2, kind: 'image-develop-preset', identity, settings }))
		: settings.schemaVersion === 3 ? bounded(Object.freeze({ schemaVersion: 3, kind: 'image-develop-preset', identity, settings }))
			: bounded(Object.freeze({ schemaVersion: 4, kind: 'image-develop-preset', identity, settings }));
}

export function normalizeImageDevelopPresetForProfileV1(profile: 'legacy2', value: unknown): ImageDevelopPresetV2;
export function normalizeImageDevelopPresetForProfileV1(profile: 'current3', value: unknown, policy?: ReferencePolicy): ImageDevelopPresetV3;
export function normalizeImageDevelopPresetForProfileV1(profile: 'current4', value: unknown, policy?: ReferencePolicy): ImageDevelopPresetV4;
export function normalizeImageDevelopPresetForProfileV1(profile: Profile, value: unknown, policy: ReferencePolicy = 'external'): ImageDevelopPresetV2 | ImageDevelopPresetV3 | ImageDevelopPresetV4 {
	assertProfile(profile, policy);
	const input = request(profile, value, ['schemaVersion', 'kind', 'identity', 'settings']);
	if (field(input, 'kind') !== 'image-develop-preset') throw new RangeError('Unsupported image Develop preset kind.');
	const identity = normalizeVideoVisualPresetV1(field(input, 'identity'));
	if (identity.modelKind !== 'adjustment-layer') throw new RangeError('Image Develop presets require an adjustment-layer identity.');
	const settings = normalizeSettings(profile, field(input, 'settings'), policy);
	if (identity.authoredStateSha256 !== fingerprintNativeMediaPlan(settings).sha256) throw new RangeError('Image Develop preset settings do not match their identity digest.');
	return settings.schemaVersion === 2 ? bounded(Object.freeze({ schemaVersion: 2, kind: 'image-develop-preset', identity, settings }))
		: settings.schemaVersion === 3 ? bounded(Object.freeze({ schemaVersion: 3, kind: 'image-develop-preset', identity, settings }))
			: bounded(Object.freeze({ schemaVersion: 4, kind: 'image-develop-preset', identity, settings }));
}

export function normalizeImageDevelopPresetCurrentForProfileV1(profile: 'legacy2', value: unknown): ImageDevelopPresetV1 | ImageDevelopPresetV2;
export function normalizeImageDevelopPresetCurrentForProfileV1(profile: 'current3', value: unknown, policy?: ReferencePolicy): PresetThroughV3;
export function normalizeImageDevelopPresetCurrentForProfileV1(profile: 'current4', value: unknown, policy?: ReferencePolicy): Preset;
export function normalizeImageDevelopPresetCurrentForProfileV1(profile: Profile, value: unknown, policy: ReferencePolicy = 'external'): Preset {
	assertProfile(profile, policy);
	const input = record(value, 'image Develop preset', ['schemaVersion', 'kind', 'identity', 'settings']);
	const version = field(input, 'schemaVersion');
	if (version === 1) return normalizeImageDevelopPresetV1(input);
	if (version === 2) return normalizeImageDevelopPresetForProfileV1('legacy2', input);
	if (profile !== 'legacy2' && version === 3) return normalizeImageDevelopPresetForProfileV1('current3', input, policy);
	if (profile === 'current4' && version === 4) return normalizeImageDevelopPresetForProfileV1('current4', input, policy);
	throw new RangeError('Unsupported image Develop preset version.');
}

export function applyImageDevelopPresetForProfileV1(profile: 'legacy2', value: unknown): ImageDevelopStateV1 | ImageDevelopStateV2;
export function applyImageDevelopPresetForProfileV1(profile: 'current3', value: unknown): ImageDevelopStateThroughV3;
export function applyImageDevelopPresetForProfileV1(profile: 'current4', value: unknown): ImageDevelopStateThroughV4;
export function applyImageDevelopPresetForProfileV1(profile: Profile, value: unknown): ImageDevelopStateThroughV4 {
	assertProfile(profile, 'external');
	const input = request(profile, value, ['schemaVersion', 'target', 'preset']);
	if (profile === 'legacy2') {
		const preset = normalizeImageDevelopPresetCurrentForProfileV1('legacy2', field(input, 'preset'));
		return mergeImageDevelopSettingsV2({ schemaVersion: 2, target: field(input, 'target'), settings: preset.settings });
	}
	if (profile === 'current4') {
		const preset = normalizeImageDevelopPresetCurrentForProfileV1('current4', field(input, 'preset'));
		return mergeImageDevelopSettingsV4({ schemaVersion: 4, target: field(input, 'target'), settings: preset.settings });
	}
	const preset = normalizeImageDevelopPresetCurrentForProfileV1('current3', field(input, 'preset'));
	return mergeImageDevelopSettingsV3({ schemaVersion: 3, target: field(input, 'target'), settings: preset.settings });
}

export function readImageDevelopPresetJsonV1(value: unknown): unknown {
	if (typeof value !== 'string') throw new TypeError('Image Develop presets require JSON text.');
	checkBytes(value); return JSON.parse(value) as unknown;
}
function request(profile: Profile, value: unknown, fields: readonly string[]) {
	const input = record(value, 'image Develop preset', fields);
	if (field(input, 'schemaVersion') !== (profile === 'legacy2' ? 2 : profile === 'current3' ? 3 : 4)) throw new RangeError('Unsupported image Develop preset version.');
	return input;
}
function bounded<Value>(value: Value): Value { checkBytes(JSON.stringify(value)); return value; }
function checkBytes(value: string): void {
	if (value.length > IMAGE_DEVELOP_LIMITS_V1.maximumBytes || new TextEncoder().encode(value).byteLength > IMAGE_DEVELOP_LIMITS_V1.maximumBytes) {
		throw new RangeError('Image Develop presets exceed their scalar byte budget.');
	}
}
function assertProfile(profile: unknown, policy: unknown): void {
	if (profile !== 'legacy2' && profile !== 'current3' && profile !== 'current4') throw new RangeError('Unsupported fixed preset profile.');
	if (policy !== 'external' && policy !== 'selected' || profile === 'legacy2' && policy !== 'external') throw new RangeError('Unsupported preset reference policy.');
}
function normalizeSettings(profile: Profile, value: unknown, policy: ReferencePolicy) {
	if (profile === 'legacy2') return normalizeImageDevelopSettingsPacketV2(value);
	if (profile === 'current3') return policy === 'selected' ? normalizeImageDevelopSelectedSettingsPacketV3(value) : normalizeImageDevelopSettingsPacketV3(value);
	return policy === 'selected' ? normalizeImageDevelopSelectedSettingsPacketV4(value) : normalizeImageDevelopSettingsPacketV4(value);
}
