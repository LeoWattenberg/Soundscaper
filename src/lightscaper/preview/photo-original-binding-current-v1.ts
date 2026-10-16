/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { planPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { IMAGE_HDR_ORIGINAL_LIMITS_V1, IMAGE_HDR_ORIGINAL_MIME_TYPE_V1 } from '../../common/editor/imaging/image-hdr-original-profile-v1.ts';
import type { PhotoOriginalV1 } from '../catalog/types.ts';
import { id, integer } from '../catalog/value-validation.ts';
import { normalizePhotoPreviewOriginalBindingV1, type PhotoPreviewOriginalBindingV1 } from './photo-preview-plan-v1.ts';

export const PHOTO_HDR_ORIGINAL_MIME_CURRENT_V1 = IMAGE_HDR_ORIGINAL_MIME_TYPE_V1;
export const PHOTO_HDR_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1 = IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumEncodedBytes;
export const PHOTO_HDR_ORIGINAL_SOURCE_LIMITS_CURRENT_V1 = Object.freeze({ maximumSidePixels: IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumSide,
	maximumPixels: IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumPixels, maximumBytes: IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumDecodedBytes });
export interface PhotoHdrOriginalBindingCurrentV1 extends PhotoPreviewOriginalBindingV1 { readonly sourceKind: 'hdr-original' }
export type PhotoOriginalBindingCurrentV1 = PhotoPreviewOriginalBindingV1 | PhotoHdrOriginalBindingCurrentV1;
const FIELDS = ['catalogId', 'photoId', 'originalId', 'storageKey', 'contentSha256', 'byteLength', 'width', 'height'];

/** An explicit Current source policy, never a widened permanent preview record.
 * The discriminator authorizes only bounded HDR parsing, not the body's pixels. */
export function normalizePhotoOriginalBindingCurrentV1(value: unknown): Readonly<PhotoOriginalBindingCurrentV1> {
	const input = record(value, 'Current Original binding', [...FIELDS, 'sourceKind'], FIELDS);
	if (!Object.hasOwn(input, 'sourceKind')) return normalizePhotoPreviewOriginalBindingV1(input);
	const get = (key: string) => field(input, key, 'Current Original binding');
	if (get('sourceKind') !== 'hdr-original') throw new RangeError('Unsupported Current Original source kind.');
	const digest = get('contentSha256');
	if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest)) throw new TypeError('HDR Original requires a lowercase SHA-256.');
	const binding = Object.freeze({ sourceKind: 'hdr-original' as const,
		catalogId: id(get('catalogId'), 'HDR catalog'), photoId: id(get('photoId'), 'HDR photo'),
		originalId: id(get('originalId'), 'HDR Original'), storageKey: id(get('storageKey'), 'HDR Original storage key'),
		contentSha256: digest, byteLength: integer(get('byteLength'), 1, PHOTO_HDR_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1, 'HDR Original byte length'),
		width: integer(get('width'), 1, PHOTO_HDR_ORIGINAL_SOURCE_LIMITS_CURRENT_V1.maximumSidePixels, 'HDR Original width'),
		height: integer(get('height'), 1, PHOTO_HDR_ORIGINAL_SOURCE_LIMITS_CURRENT_V1.maximumSidePixels, 'HDR Original height') });
	planPixelFrameV1({ schemaVersion: 1, width: binding.width, height: binding.height,
		sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, PHOTO_HDR_ORIGINAL_SOURCE_LIMITS_CURRENT_V1);
	return binding;
}

/** Called only after the complete selected Photo and Original were admitted. */
export function capturePhotoOriginalBindingCurrentV1(value: unknown, original: PhotoOriginalV1): Readonly<PhotoOriginalBindingCurrentV1> {
	if (original.mimeType !== PHOTO_HDR_ORIGINAL_MIME_CURRENT_V1) return normalizePhotoPreviewOriginalBindingV1(value);
	const input = record(value, 'HDR Original identity', FIELDS);
	const captured = Object.fromEntries(FIELDS.map(key => [key, field(input, key, 'HDR Original identity')]));
	return normalizePhotoOriginalBindingCurrentV1({ ...captured, sourceKind: 'hdr-original' });
}

export function isPhotoHdrOriginalBindingCurrentV1(binding: Readonly<PhotoOriginalBindingCurrentV1>): binding is Readonly<PhotoHdrOriginalBindingCurrentV1> {
	return Object.hasOwn(binding, 'sourceKind');
}
