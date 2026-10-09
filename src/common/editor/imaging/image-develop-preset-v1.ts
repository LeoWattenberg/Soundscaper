/* SPDX-License-Identifier: AGPL-3.0-only */

import { fingerprintNativeMediaPlan } from '../native-media-plan-canonical-form.ts';
import { normalizeVideoVisualPresetV1, type VideoVisualPresetV1 } from '../video-visual-preset-v24.ts';
import { IMAGE_DEVELOP_LIMITS_V1, type ImageDevelopStateV1 } from './image-develop-contract-v1.ts';
import type { ImageDevelopSettingsPacketV1 } from './image-develop-settings-contract-v1.ts';
import { mergeImageDevelopSettingsV1, normalizeImageDevelopSettingsPacketV1 } from './image-develop-settings-v1.ts';
import { field, record } from './image-develop-value.ts';

/** The existing shared visual identity authenticates a closed, portable settings body. */
export interface ImageDevelopPresetV1 {
	readonly schemaVersion: 1;
	readonly kind: 'image-develop-preset';
	readonly identity: Readonly<VideoVisualPresetV1>;
	readonly settings: Readonly<ImageDevelopSettingsPacketV1>;
}

export function createImageDevelopPresetV1(value: unknown): ImageDevelopPresetV1 {
	const input = request(value, ['schemaVersion', 'id', 'name', 'settings']);
	const settings = normalizeImageDevelopSettingsPacketV1(field(input, 'settings'));
	const identity = normalizeVideoVisualPresetV1({ schemaVersion: 1, kind: 'video-preset', id: field(input, 'id'), name: field(input, 'name'),
		modelKind: 'adjustment-layer', authoredStateSha256: fingerprintNativeMediaPlan(settings).sha256 });
	return bounded(Object.freeze({ schemaVersion: 1, kind: 'image-develop-preset', identity, settings }));
}

export function normalizeImageDevelopPresetV1(value: unknown): ImageDevelopPresetV1 {
	const input = request(value, ['schemaVersion', 'kind', 'identity', 'settings']);
	if (field(input, 'kind') !== 'image-develop-preset') throw new RangeError('Unsupported image Develop preset kind.');
	const identity = normalizeVideoVisualPresetV1(field(input, 'identity'));
	if (identity.modelKind !== 'adjustment-layer') throw new RangeError('Image Develop presets require an adjustment-layer identity.');
	const settings = normalizeImageDevelopSettingsPacketV1(field(input, 'settings'));
	if (identity.authoredStateSha256 !== fingerprintNativeMediaPlan(settings).sha256) throw new RangeError('Image Develop preset settings do not match their identity digest.');
	return bounded(Object.freeze({ schemaVersion: 1, kind: 'image-develop-preset', identity, settings }));
}

/** Every apply uses the shared settings picker semantics; a preset never donates photo or media authority. */
export function applyImageDevelopPresetV1(value: unknown): ImageDevelopStateV1 {
	const input = request(value, ['schemaVersion', 'target', 'preset']);
	const preset = normalizeImageDevelopPresetV1(field(input, 'preset'));
	return mergeImageDevelopSettingsV1({ schemaVersion: 1, target: field(input, 'target'), settings: preset.settings });
}

export function serializeImageDevelopPresetV1(value: unknown): string { return JSON.stringify(normalizeImageDevelopPresetV1(value)); }
export function parseImageDevelopPresetV1(value: unknown): ImageDevelopPresetV1 {
	if (typeof value !== 'string') throw new TypeError('Image Develop presets require JSON text.');
	checkBytes(value);
	return normalizeImageDevelopPresetV1(JSON.parse(value) as unknown);
}

function request(value: unknown, fields: readonly string[]) {
	const input = record(value, 'image Develop preset', fields);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported image Develop preset version.');
	return input;
}
function bounded<Value>(value: Value): Value { checkBytes(JSON.stringify(value)); return value; }
function checkBytes(value: string): void {
	if (value.length > IMAGE_DEVELOP_LIMITS_V1.maximumBytes || new TextEncoder().encode(value).byteLength > IMAGE_DEVELOP_LIMITS_V1.maximumBytes) {
		throw new RangeError('Image Develop presets exceed their scalar byte budget.');
	}
}
