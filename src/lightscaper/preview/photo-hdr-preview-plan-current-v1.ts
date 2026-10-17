/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { planPixelFrameV1, readPixelFrameDescriptorV1, type PixelFrameDescriptorV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { fitPixelSizeV1 } from '../../common/editor/imaging/pixel-frame-resize-v1.ts';
import { oneOf } from '../catalog/value-validation.ts';
import { isPhotoHdrOriginalBindingCurrentV1, normalizePhotoOriginalBindingCurrentV1, type PhotoHdrOriginalBindingCurrentV1 } from './photo-original-binding-current-v1.ts';
import type { PhotoPreviewTierV1 } from './photo-preview-plan-v1.ts';

export const PHOTO_HDR_PREVIEW_RECIPE_CURRENT_V1 = Object.freeze({ id: 'lightscaper.hdr-original-preview.linear-f32-srgb.rgba8-nearest', version: 1 as const });
export const PHOTO_HDR_PREVIEW_LIMITS_CURRENT_V1 = Object.freeze({ maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 16_777_216 });
export interface PhotoHdrPreviewPlanCurrentV1 {
	readonly schemaVersion: 1; readonly kind: 'photo-hdr-preview-plan'; readonly key: string;
	readonly binding: Readonly<PhotoHdrOriginalBindingCurrentV1>; readonly tier: PhotoPreviewTierV1;
	readonly source: Readonly<PixelFrameDescriptorV1>; readonly output: Readonly<PixelFrameDescriptorV1>;
	readonly recipe: typeof PHOTO_HDR_PREVIEW_RECIPE_CURRENT_V1; readonly byteLength: number;
}
const SIDES = Object.freeze({ thumbnail: 512, 'fit-screen': 2048 });
const FIELDS = ['schemaVersion', 'kind', 'key', 'binding', 'source', 'tier', 'recipe', 'output', 'byteLength'];

/** The immutable Original plus a pinned HDR decoder/display policy determine
 * disposable output; source extents never claim an already decoded byte image. */
export function planPhotoHdrPreviewCurrentV1(value: unknown): Readonly<PhotoHdrPreviewPlanCurrentV1> {
	const input = record(value, 'Current HDR preview request', ['binding', 'tier']);
	const binding = normalizePhotoOriginalBindingCurrentV1(field(input, 'binding', 'Current HDR preview request'));
	if (!isPhotoHdrOriginalBindingCurrentV1(binding)) throw new TypeError('HDR previews require the named Current Original binding.');
	const tier = oneOf(field(input, 'tier', 'Current HDR preview request'), ['thumbnail', 'fit-screen'] as const, 'HDR preview tier');
	const source = Object.freeze({ schemaVersion: 1 as const, width: binding.width, height: binding.height,
		sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const });
	const size = fitPixelSizeV1(binding.width, binding.height, SIDES[tier], SIDES[tier]);
	const output = Object.freeze({ schemaVersion: 1 as const, ...size, sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const });
	const byteLength = planPixelFrameV1(output, PHOTO_HDR_PREVIEW_LIMITS_CURRENT_V1).byteLength;
	const identity = ['lightscaper-photo-hdr-preview', 1, binding, source, tier, PHOTO_HDR_PREVIEW_RECIPE_CURRENT_V1, output];
	const key = `photo-preview-sha256:${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(identity))))}`;
	return Object.freeze({ schemaVersion: 1, kind: 'photo-hdr-preview-plan', key, binding, source, tier, recipe: PHOTO_HDR_PREVIEW_RECIPE_CURRENT_V1, output, byteLength });
}

export function normalizePhotoHdrPreviewPlanCurrentV1(value: unknown): Readonly<PhotoHdrPreviewPlanCurrentV1> {
	const input = record(value, 'Current HDR preview plan', FIELDS), get = (key: string) => field(input, key, 'Current HDR preview plan');
	if (get('schemaVersion') !== 1 || get('kind') !== 'photo-hdr-preview-plan') throw new RangeError('Unsupported Current HDR preview plan.');
	const plan = planPhotoHdrPreviewCurrentV1({ binding: get('binding'), tier: get('tier') });
	const recipe = record(get('recipe'), 'HDR preview recipe', ['id', 'version']);
	if (field(recipe, 'id', 'HDR preview recipe') !== plan.recipe.id || field(recipe, 'version', 'HDR preview recipe') !== plan.recipe.version
		|| get('key') !== plan.key || get('byteLength') !== plan.byteLength
		|| JSON.stringify(readPixelFrameDescriptorV1(get('source'))) !== JSON.stringify(plan.source)
		|| JSON.stringify(readPixelFrameDescriptorV1(get('output'))) !== JSON.stringify(plan.output)) throw new RangeError('Current HDR preview derived metadata changed.');
	return plan;
}
