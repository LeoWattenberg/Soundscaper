/* SPDX-License-Identifier: AGPL-3.0-only */

import { fingerprintNativeMediaPlan } from '../native-media-plan-canonical-form.ts';
import { normalizeVideoVisualPresetV1, type VideoVisualPresetV1 } from '../video-visual-preset-v24.ts';
import { IMAGE_DEVELOP_LIMITS_V1, type ImageDevelopStateV1 } from './image-develop-contract-v1.ts';
import type { ImageDevelopStateV2 } from './image-develop-state-v2.ts';
import type { ImageDevelopSettingsPacketV2 } from './image-develop-settings-contract-v2.ts';
import { mergeImageDevelopSettingsV2, normalizeImageDevelopSettingsPacketV2 } from './image-develop-settings-v2.ts';
import { normalizeImageDevelopPresetV1, type ImageDevelopPresetV1 } from './image-develop-preset-v1.ts';
import { field, record } from './image-develop-value.ts';

/** Explicit body successor; the unchanged scalar visual identity binds exact
 * selected reference bytes, not raw bodies, storage or authentication rights. */
export interface ImageDevelopPresetV2 {
	readonly schemaVersion: 2;
	readonly kind: 'image-develop-preset';
	readonly identity: Readonly<VideoVisualPresetV1>;
	readonly settings: Readonly<ImageDevelopSettingsPacketV2>;
}

export function createImageDevelopPresetV2(value: unknown): ImageDevelopPresetV2 {
	const input = request(value, ['schemaVersion', 'id', 'name', 'settings']);
	const settings = normalizeImageDevelopSettingsPacketV2(field(input, 'settings'));
	const identity = normalizeVideoVisualPresetV1({ schemaVersion: 1, kind: 'video-preset', id: field(input, 'id'), name: field(input, 'name'),
		modelKind: 'adjustment-layer', authoredStateSha256: fingerprintNativeMediaPlan(settings).sha256 });
	return bounded(Object.freeze({ schemaVersion: 2, kind: 'image-develop-preset', identity, settings }));
}

export function normalizeImageDevelopPresetV2(value: unknown): ImageDevelopPresetV2 {
	const input = request(value, ['schemaVersion', 'kind', 'identity', 'settings']);
	if (field(input, 'kind') !== 'image-develop-preset') throw new RangeError('Unsupported image Develop preset kind.');
	const identity = normalizeVideoVisualPresetV1(field(input, 'identity'));
	if (identity.modelKind !== 'adjustment-layer') throw new RangeError('Image Develop presets require an adjustment-layer identity.');
	const settings = normalizeImageDevelopSettingsPacketV2(field(input, 'settings'));
	if (identity.authoredStateSha256 !== fingerprintNativeMediaPlan(settings).sha256) throw new RangeError('Image Develop preset settings do not match their identity digest.');
	return bounded(Object.freeze({ schemaVersion: 2, kind: 'image-develop-preset', identity, settings }));
}

export function normalizeImageDevelopPresetV1OrV2(value: unknown): ImageDevelopPresetV1 | ImageDevelopPresetV2 {
	const input = record(value, 'image Develop preset', ['schemaVersion', 'kind', 'identity', 'settings']);
	const version = field(input, 'schemaVersion');
	if (version === 1) return normalizeImageDevelopPresetV1(input);
	if (version === 2) return normalizeImageDevelopPresetV2(input);
	throw new RangeError('Unsupported image Develop preset version.');
}

export function applyImageDevelopPresetV2(value: unknown): ImageDevelopStateV1 | ImageDevelopStateV2 {
	const input = request(value, ['schemaVersion', 'target', 'preset']);
	const preset = normalizeImageDevelopPresetV1OrV2(field(input, 'preset'));
	return mergeImageDevelopSettingsV2({ schemaVersion: 2, target: field(input, 'target'), settings: preset.settings });
}

export function serializeImageDevelopPresetV2(value: unknown): string { return JSON.stringify(normalizeImageDevelopPresetV2(value)); }
export function serializeImageDevelopPresetV1OrV2(value: unknown): string { return JSON.stringify(normalizeImageDevelopPresetV1OrV2(value)); }
export function parseImageDevelopPresetV2(value: unknown): ImageDevelopPresetV2 { return normalizeImageDevelopPresetV2(parse(value)); }
export function parseImageDevelopPresetV1OrV2(value: unknown): ImageDevelopPresetV1 | ImageDevelopPresetV2 { return normalizeImageDevelopPresetV1OrV2(parse(value)); }

function parse(value: unknown): unknown {
	if (typeof value !== 'string') throw new TypeError('Image Develop presets require JSON text.');
	checkBytes(value); return JSON.parse(value) as unknown;
}
function request(value: unknown, fields: readonly string[]) {
	const input = record(value, 'image Develop preset', fields);
	if (field(input, 'schemaVersion') !== 2) throw new RangeError('Unsupported image Develop preset version.');
	return input;
}
function bounded<Value>(value: Value): Value { checkBytes(JSON.stringify(value)); return value; }
function checkBytes(value: string): void {
	if (value.length > IMAGE_DEVELOP_LIMITS_V1.maximumBytes || new TextEncoder().encode(value).byteLength > IMAGE_DEVELOP_LIMITS_V1.maximumBytes) {
		throw new RangeError('Image Develop presets exceed their scalar byte budget.');
	}
}
