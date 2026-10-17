/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoCatalogArchiveReachabilityCurrentV1 } from './catalog-archive-reachability-current-v1.ts';
import type { PhotoDocumentThroughV3 } from '../catalog/photo-document-through-v3.ts';
import { encodePhotoCatalogPack, readPhotoCatalogPack, measurePhotoCatalogPackRecord,
	PHOTO_CATALOG_PACK_LIMITS, type PhotoCatalogPackOptions, type PhotoCatalogPackInputForProfile, type PhotoCatalogPackCodecProfile } from './catalog-pack-codec.ts';

export const PHOTO_CATALOG_PACK_LIMITS_V4 = PHOTO_CATALOG_PACK_LIMITS;
export type PhotoCatalogPackInputV4 = PhotoCatalogPackInputForProfile<'current3'>;
export type PhotoCatalogPackOptionsV4 = PhotoCatalogPackOptions;
const profile = Object.freeze<PhotoCatalogPackCodecProfile<'current3'>>({ magic: new TextEncoder().encode('LSCPACK4'), documentProfile: 'current3', admit(photo) {
	const closure = createPhotoCatalogArchiveReachabilityCurrentV1(); closure.addPhoto(photo); closure.finish();
} });
/** Explicit Current metadata framing; archive7 owns exact referenced bodies. */
export function measurePhotoCatalogPackRecordV4(value: unknown): number { return measurePhotoCatalogPackRecord(value, profile); }
export function encodePhotoCatalogPackV4(records: Iterable<PhotoCatalogPackInputV4> | AsyncIterable<PhotoCatalogPackInputV4>, options: PhotoCatalogPackOptionsV4 = {}) {
	return encodePhotoCatalogPack(records, options, profile);
}
export function readPhotoCatalogPackV4(source: AsyncIterable<Uint8Array>, consume: (photo: PhotoDocumentThroughV3, original: AsyncIterable<Uint8Array>) => Promise<void>, options: PhotoCatalogPackOptionsV4 = {}): Promise<number> {
	return readPhotoCatalogPack(source, consume, options, profile);
}
