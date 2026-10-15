/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoCatalogArchiveReachabilityCurrentV1 } from './catalog-archive-reachability-current-v1.ts';
import { encodePhotoCatalogPack, readPhotoCatalogPack, measurePhotoCatalogPackRecord,
	type PhotoCatalogPackOptions, type PhotoCatalogPackCodecProfile } from './catalog-pack-codec.ts';
import type { PhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';

export interface PhotoCatalogPackInputCurrentV1 { readonly photo: PhotoDocumentCurrentV1; readonly original: Blob }
const profile = Object.freeze<PhotoCatalogPackCodecProfile<'current4'>>({ magic: new TextEncoder().encode('LSCPACK4'), documentProfile: 'current4', admit(photo) {
	const closure = createPhotoCatalogArchiveReachabilityCurrentV1(); closure.addPhoto(photo); closure.finish();
} });
export function measurePhotoCatalogPackRecordCurrentV1(value: unknown): number { return measurePhotoCatalogPackRecord(value, profile); }
export function encodePhotoCatalogPackCurrentV1(records: Iterable<PhotoCatalogPackInputCurrentV1> | AsyncIterable<PhotoCatalogPackInputCurrentV1>, options: PhotoCatalogPackOptions = {}) {
	return encodePhotoCatalogPack(records, options, profile);
}
export function readPhotoCatalogPackCurrentV1(source: AsyncIterable<Uint8Array>, consume: (photo: PhotoDocumentCurrentV1, original: AsyncIterable<Uint8Array>) => Promise<void>, options: PhotoCatalogPackOptions = {}) {
	return readPhotoCatalogPack(source, consume, options, profile);
}
