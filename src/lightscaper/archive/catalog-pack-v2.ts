/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertPhotoMaskRasterPortableV1 } from '../catalog/photo-mask-raster-portability-v1.ts';
import { encodePhotoCatalogPack, readPhotoCatalogPack, measurePhotoCatalogPackRecord,
	PHOTO_CATALOG_PACK_LIMITS, type PhotoCatalogPackInput, type PhotoCatalogPackOptions } from './catalog-pack-codec.ts';

export const PHOTO_CATALOG_PACK_LIMITS_V2 = PHOTO_CATALOG_PACK_LIMITS;
export type PhotoCatalogPackInputV2 = PhotoCatalogPackInput;
export type PhotoCatalogPackOptionsV2 = PhotoCatalogPackOptions;
const profile = Object.freeze({ magic: new TextEncoder().encode('LSCPACK2'), admit: assertPhotoMaskRasterPortableV1 });
export function measurePhotoCatalogPackRecordV2(value: unknown): number { return measurePhotoCatalogPackRecord(value, profile); }
export function encodePhotoCatalogPackV2(records: Iterable<PhotoCatalogPackInputV2> | AsyncIterable<PhotoCatalogPackInputV2>, options: PhotoCatalogPackOptionsV2 = {}) {
	return encodePhotoCatalogPack(records, options, profile);
}
export function readPhotoCatalogPackV2(source: AsyncIterable<Uint8Array>, consume: Parameters<typeof readPhotoCatalogPack>[1], options: PhotoCatalogPackOptionsV2 = {}): Promise<number> {
	return readPhotoCatalogPack(source, consume, options, profile);
}
