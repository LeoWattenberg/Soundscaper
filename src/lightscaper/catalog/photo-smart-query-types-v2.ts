/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoColorLabelV1, PhotoFlagV1, PhotoMetadataV1 } from './types.ts';

/** Independent predicate protocol; family-v1 documents and parsers remain unchanged. */
export const PHOTO_SMART_QUERY_LIMITS_V2 = Object.freeze({
	maximumDepth: 16, maximumNodes: 256, maximumTextUnits: 256, maximumBytes: 524_288,
});

export type PhotoMetadataTextColumnV2 = 'file-name' | 'title' | 'caption' | 'creator' | 'copyright'
	| 'location' | 'camera-make' | 'camera-model' | 'lens';
export type PhotoMetadataNumberColumnV2 = 'orientation' | 'capture-offset-minutes' | 'exposure-seconds'
	| 'aperture' | 'iso' | 'focal-length-mm' | 'width' | 'height';
export type PhotoMetadataTimeColumnV2 = 'capture-time' | 'modified-time';
export type PhotoMetadataQueryColumnV2 = PhotoMetadataTextColumnV2 | PhotoMetadataNumberColumnV2 | PhotoMetadataTimeColumnV2;

export type PhotoPredicateV2 =
	| Readonly<{ kind: 'all' | 'any'; terms: readonly PhotoPredicateV2[] }>
	| Readonly<{ kind: 'not'; term: PhotoPredicateV2 }>
	| Readonly<{ kind: 'rating'; minimum: number; maximum: number }>
	| Readonly<{ kind: 'flag'; value: PhotoFlagV1 }>
	| Readonly<{ kind: 'label'; value: PhotoColorLabelV1 }>
	| Readonly<{ kind: 'keyword' | 'folder'; id: string }>
	| Readonly<{ kind: 'file-name'; contains: string }>
	| Readonly<{ kind: 'capture-time'; from: string | null; to: string | null }>
	| Readonly<{ kind: 'text'; column: PhotoMetadataTextColumnV2; operator: 'contains' | 'equals' | 'starts-with'; value: string }>
	| Readonly<{ kind: 'number'; column: PhotoMetadataNumberColumnV2; minimum: number | null; maximum: number | null }>
	| Readonly<{ kind: 'time'; column: PhotoMetadataTimeColumnV2; from: string | null; to: string | null }>
	| Readonly<{ kind: 'presence'; column: PhotoMetadataQueryColumnV2; value: 'known' | 'unknown' }>;

export interface PhotoSmartQueryV2 {
	readonly schemaVersion: 2;
	readonly kind: 'photo-smart-query';
	readonly predicate: PhotoPredicateV2;
}

/** Already validated effective values; no original, extraction, develop or storage authority. */
export interface PhotoQuerySubjectV2 {
	readonly metadata: Readonly<PhotoMetadataV1>;
	readonly width: number;
	readonly height: number;
	readonly rating: number;
	readonly flag: PhotoFlagV1;
	readonly colorLabel: PhotoColorLabelV1;
	readonly folderId: string | null;
	readonly keywordIds: readonly string[];
}

export interface PhotoQueryReferencesV2 {
	readonly folders: ReadonlySet<string>;
	readonly keywords: ReadonlySet<string>;
}
