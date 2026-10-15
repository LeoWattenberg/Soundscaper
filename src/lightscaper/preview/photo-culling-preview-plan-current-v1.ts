/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import manifest from '../../../config/lightscaper-libraw-runtime-manifest.json';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { admitPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-admission-v1.ts';
import { fitPixelSizeV1 } from '../../common/editor/imaging/pixel-frame-resize-v1.ts';
import { readPixelFrameDescriptorV1, type PixelFrameDescriptorV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { normalizePhotoPreviewOriginalBindingV1, PHOTO_PREVIEW_SOURCE_LIMITS_V1,
	type PhotoPreviewOriginalBindingV1, type PhotoPreviewTierV1 } from './photo-preview-plan-v1.ts';
import { oneOf } from '../catalog/value-validation.ts';

export const PHOTO_CULLING_PREVIEW_RECIPE_CURRENT_V1 = Object.freeze({
	id: 'lightscaper.raw-culling.camera-embedded.rgba8-contain-nearest', version: 1 as const,
	decoder: Object.freeze({ id: 'libraw' as const, version: '0.22.2' as const, abiVersion: 1 as const, sha256: manifest.runtime.sha256 }),
	orientation: 'already-oriented-exif-v1' as const, cameraFit: 'contain-centered-round-v1' as const,
	sampling: 'nearest-top-left-v1' as const, background: 'opaque-black' as const, fallback: 'original-extent-nearest-v1' as const,
});
const SIDES = Object.freeze({ thumbnail: 512, 'fit-screen': 2048 });
const FIELDS = ['schemaVersion', 'kind', 'key', 'binding', 'source', 'originalExtent', 'tier', 'recipe', 'output', 'byteLength'];
const RECIPE_FIELDS = ['id', 'version', 'decoder', 'orientation', 'cameraFit', 'sampling', 'background', 'fallback'];
const UTF8 = new TextEncoder();

export interface PhotoCullingPreviewPlanCurrentV1 {
	readonly schemaVersion: 1; readonly kind: 'photo-culling-preview-plan'; readonly key: string;
	readonly binding: Readonly<PhotoPreviewOriginalBindingV1>; readonly source: 'camera-embedded';
	/** Retained Original metadata, never a claim about embedded camera pixels. */
	readonly originalExtent: Readonly<{ width: number; height: number }>;
	readonly tier: PhotoPreviewTierV1; readonly recipe: typeof PHOTO_CULLING_PREVIEW_RECIPE_CURRENT_V1;
	readonly output: Readonly<PixelFrameDescriptorV1>; readonly byteLength: number;
}

/** The immutable Original and fixed preference determine the key before any
 * camera preview is read. Its independent crop/extent is not part of identity. */
export function planPhotoCullingPreviewCurrentV1(value: unknown): Readonly<PhotoCullingPreviewPlanCurrentV1> {
	const input = record(value, 'Current culling preview request', ['binding', 'tier', 'source']);
	const binding = normalizePhotoPreviewOriginalBindingV1(field(input, 'binding', 'Current culling preview request'));
	const source = oneOf(field(input, 'source', 'Current culling preview request'), ['camera-embedded'] as const, 'Current culling source');
	admitPixelFrameV1({ schemaVersion: 1, width: binding.width, height: binding.height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
		{ limits: PHOTO_PREVIEW_SOURCE_LIMITS_V1 });
	const tier = oneOf(field(input, 'tier', 'Current culling preview request'), ['thumbnail', 'fit-screen'] as const, 'Current culling tier');
	const originalExtent = Object.freeze({ width: binding.width, height: binding.height });
	const output = Object.freeze({ schemaVersion: 1 as const, ...fitPixelSizeV1(binding.width, binding.height, SIDES[tier], SIDES[tier]),
		sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const });
	const byteLength = admitPixelFrameV1(output, { limits: { maximumSidePixels: SIDES[tier], maximumPixels: SIDES[tier] ** 2, maximumBytes: SIDES[tier] ** 2 * 4 } }).byteLength;
	const recipe = PHOTO_CULLING_PREVIEW_RECIPE_CURRENT_V1;
	const key = `photo-preview-sha256:${bytesToHex(sha256(UTF8.encode(JSON.stringify(['lightscaper-photo-culling-preview', 1, binding, source, originalExtent, tier, recipe, output]))))}`;
	return Object.freeze({ schemaVersion: 1, kind: 'photo-culling-preview-plan', key, binding, source, originalExtent, tier, recipe, output, byteLength });
}

/** Reconstruct all derived scalars and pin every nested policy field. */
export function normalizePhotoCullingPreviewPlanCurrentV1(value: unknown): Readonly<PhotoCullingPreviewPlanCurrentV1> {
	const input = record(value, 'Current culling preview plan', FIELDS), get = (key: string) => field(input, key, 'Current culling preview plan');
	if (get('schemaVersion') !== 1 || get('kind') !== 'photo-culling-preview-plan') throw new RangeError('Unsupported Current culling preview plan.');
	const plan = planPhotoCullingPreviewCurrentV1({ binding: get('binding'), source: get('source'), tier: get('tier') });
	const extent = record(get('originalExtent'), 'Current culling Original metadata extent', ['width', 'height']);
	if (field(extent, 'width', 'Original metadata extent') !== plan.originalExtent.width || field(extent, 'height', 'Original metadata extent') !== plan.originalExtent.height) {
		throw new RangeError('Current culling Original metadata extent changed.');
	}
	const recipe = record(get('recipe'), 'Current culling preview recipe', RECIPE_FIELDS);
	const decoder = record(field(recipe, 'decoder', 'Current culling preview recipe'), 'Current culling decoder', ['id', 'version', 'abiVersion', 'sha256']);
	for (const [key, expected] of Object.entries(plan.recipe.decoder)) if (field(decoder, key, 'Current culling decoder') !== expected) throw new RangeError('Current culling decoder pin changed.');
	for (const key of RECIPE_FIELDS) if (key !== 'decoder' && field(recipe, key, 'Current culling preview recipe') !== plan.recipe[key as Exclude<keyof typeof plan.recipe, 'decoder'>]) {
		throw new RangeError('Current culling preview recipe changed.');
	}
	if (get('key') !== plan.key || get('byteLength') !== plan.byteLength || JSON.stringify(readPixelFrameDescriptorV1(get('output'))) !== JSON.stringify(plan.output)) {
		throw new RangeError('Current culling preview derived fields changed.');
	}
	return plan;
}
