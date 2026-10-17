/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { admitPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-admission-v1.ts';
import { readPixelFrameDescriptorV1, type PixelFrameDescriptorV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { fitPixelSizeV1 } from '../../common/editor/imaging/pixel-frame-resize-v1.ts';
import { id, integer, oneOf } from '../catalog/value-validation.ts';

export type PhotoPreviewTierV1 = 'thumbnail' | 'fit-screen';
export interface PhotoPreviewOriginalBindingV1 {
	readonly catalogId: string; readonly photoId: string; readonly originalId: string; readonly storageKey: string;
	readonly contentSha256: string; readonly byteLength: number; readonly width: number; readonly height: number;
}
export const PHOTO_PREVIEW_SOURCE_LIMITS_V1 = Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 67_108_864 });
export const PHOTO_PREVIEW_RECIPE_V1 = Object.freeze({ id: 'lightscaper.original-preview.rgba8-nearest', version: 1 as const });
const TIER_SIDES = Object.freeze({ thumbnail: 512, 'fit-screen': 2048 });
const BINDING_FIELDS = ['catalogId', 'photoId', 'originalId', 'storageKey', 'contentSha256', 'byteLength', 'width', 'height'];
const PLAN_FIELDS = ['schemaVersion', 'kind', 'key', 'binding', 'source', 'tier', 'recipe', 'output', 'byteLength'];
const encode = new TextEncoder();

export interface PhotoPreviewPlanV1 {
	readonly schemaVersion: 1; readonly kind: 'photo-preview-plan'; readonly key: string;
	readonly binding: Readonly<PhotoPreviewOriginalBindingV1>; readonly source: Readonly<PixelFrameDescriptorV1>;
	readonly tier: PhotoPreviewTierV1; readonly recipe: typeof PHOTO_PREVIEW_RECIPE_V1;
	readonly output: Readonly<PixelFrameDescriptorV1>; readonly byteLength: number;
}

/** Photo ownership is separate from the shared pixel descriptor and processing kernel. */
export function normalizePhotoPreviewOriginalBindingV1(value: unknown): Readonly<PhotoPreviewOriginalBindingV1> {
	const input = record(value, 'photo preview original binding', BINDING_FIELDS);
	const get = (key: string) => field(input, key, 'photo preview original binding');
	const digest = get('contentSha256');
	if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest)) throw new TypeError('Photo preview original binding requires a lowercase SHA-256.');
	return Object.freeze({ catalogId: id(get('catalogId'), 'preview catalog'), photoId: id(get('photoId'), 'preview photo'),
		originalId: id(get('originalId'), 'preview original'), storageKey: id(get('storageKey'), 'preview original storage key'),
		contentSha256: digest, byteLength: integer(get('byteLength'), 1, 67_108_864, 'preview original byte length'),
		width: integer(get('width'), 1, 8192, 'preview original width'), height: integer(get('height'), 1, 8192, 'preview original height') });
}

/** Prove source and tier budgets before pixel traversal or output allocation. */
export function planPhotoPreviewV1(value: unknown): Readonly<PhotoPreviewPlanV1> {
	const input = record(value, 'photo preview request', ['binding', 'source', 'tier']);
	const binding = normalizePhotoPreviewOriginalBindingV1(field(input, 'binding', 'photo preview request'));
	const source = admitPixelFrameV1(field(input, 'source', 'photo preview request'), { limits: PHOTO_PREVIEW_SOURCE_LIMITS_V1 }).descriptor;
	if (binding.width !== source.width || binding.height !== source.height) throw new RangeError('Photo preview source disagrees with its original binding.');
	const tier = oneOf(field(input, 'tier', 'photo preview request'), ['thumbnail', 'fit-screen'] as const, 'preview tier');
	const dimensions = fitPixelSizeV1(source.width, source.height, TIER_SIDES[tier], TIER_SIDES[tier]);
	const output = Object.freeze({ ...source, ...dimensions });
	const byteLength = admitPixelFrameV1(output, { limits: { maximumSidePixels: TIER_SIDES[tier], maximumPixels: TIER_SIDES[tier] ** 2, maximumBytes: TIER_SIDES[tier] ** 2 * 4 } }).byteLength;
	const identity = ['lightscaper-photo-preview', 1, binding, source, tier, PHOTO_PREVIEW_RECIPE_V1, output];
	const key = `photo-preview-sha256:${bytesToHex(sha256(encode.encode(JSON.stringify(identity))))}`;
	return Object.freeze({ schemaVersion: 1, kind: 'photo-preview-plan', key, binding, source, tier, recipe: PHOTO_PREVIEW_RECIPE_V1, output, byteLength });
}

/** Persisted plans must reproduce the maintained recipe and every derived scalar. */
export function normalizePhotoPreviewPlanV1(value: unknown): Readonly<PhotoPreviewPlanV1> {
	const input = record(value, 'photo preview plan', PLAN_FIELDS), get = (key: string) => field(input, key, 'photo preview plan');
	if (get('schemaVersion') !== 1 || get('kind') !== 'photo-preview-plan') throw new RangeError('Unsupported photo preview plan schema or kind.');
	const plan = planPhotoPreviewV1({ binding: get('binding'), source: get('source'), tier: get('tier') });
	const recipe = record(get('recipe'), 'photo preview recipe', ['id', 'version']);
	if (field(recipe, 'id', 'photo preview recipe') !== plan.recipe.id || field(recipe, 'version', 'photo preview recipe') !== plan.recipe.version) throw new RangeError('Unsupported photo preview recipe.');
	const output = readPixelFrameDescriptorV1(get('output'));
	if (JSON.stringify(output) !== JSON.stringify(plan.output) || get('byteLength') !== plan.byteLength || get('key') !== plan.key) throw new RangeError('Photo preview plan derived fields or binding changed.');
	return plan;
}
