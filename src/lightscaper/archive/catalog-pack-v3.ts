/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoMaskRasterReachabilityV1 } from '../catalog/photo-mask-raster-reachability-v1.ts';
import { encodePhotoCatalogPack, readPhotoCatalogPack, measurePhotoCatalogPackRecord,
	PHOTO_CATALOG_PACK_LIMITS, type PhotoCatalogPackInput, type PhotoCatalogPackOptions } from './catalog-pack-codec.ts';

export const PHOTO_CATALOG_PACK_LIMITS_V3 = PHOTO_CATALOG_PACK_LIMITS;
export type PhotoCatalogPackInputV3 = PhotoCatalogPackInput;
export type PhotoCatalogPackOptionsV3 = PhotoCatalogPackOptions;
const profile = Object.freeze({ magic: new TextEncoder().encode('LSCPACK3'), admit(photo: PhotoCatalogPackInput['photo']) {
	const closure = createPhotoMaskRasterReachabilityV1(); closure.addPhoto(photo); closure.finish();
} });
/** This format carries retained brush references; enclosing archive6 owns their authenticated bodies. */
export function measurePhotoCatalogPackRecordV3(value: unknown): number { return measurePhotoCatalogPackRecord(value, profile); }
export function encodePhotoCatalogPackV3(records: Iterable<PhotoCatalogPackInputV3> | AsyncIterable<PhotoCatalogPackInputV3>, options: PhotoCatalogPackOptionsV3 = {}) {
	return encodePhotoCatalogPack(records, options, profile);
}
export function readPhotoCatalogPackV3(source: AsyncIterable<Uint8Array>, consume: Parameters<typeof readPhotoCatalogPack>[1], options: PhotoCatalogPackOptionsV3 = {}): Promise<number> {
	return readPhotoCatalogPack(source, consume, options, profile);
}
