/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoStillSourceV1 } from '../../common/editor/video-visual-model-v24.ts';
import type { VideoEffectLeaf } from '../../common/editor/project-media-types.ts';
import type { VideoMaskMatteGraphV1 } from '../../common/editor/video-mask-matte-v24.ts';

export const LIGHTSCAPER_SCHEMA_FAMILY = 'lightscaper' as const;
export const LIGHTSCAPER_SCHEMA_VERSION = 1 as const;
export const LIGHTSCAPER_CATALOG_LIMITS = Object.freeze({
	maximumDocumentBytes: 2_097_152,
	maximumPhotos: 10_000_000,
	maximumFolders: 10_000,
	maximumKeywords: 10_000,
	maximumCollections: 10_000,
	maximumVersions: 128,
	maximumEffects: 256,
	maximumMasks: 64,
	maximumMemberships: 1_024,
	maximumQueryDepth: 16,
	maximumQueryNodes: 256,
	maximumHistoryEntries: 100,
	maximumHistoryBytes: 16_777_216,
});

export interface LightscaperIdentityV1 {
	readonly schemaFamily: 'lightscaper';
	readonly schemaVersion: 1;
}

/** Virtual hierarchy; these records never grant access to a filesystem path. */
export interface PhotoHierarchyNodeV1 {
	readonly id: string;
	readonly name: string;
	readonly parentId: string | null;
}

export type PhotoFlagV1 = 'unflagged' | 'pick' | 'reject';
export type PhotoColorLabelV1 = 'none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple';

/** Capture-time comparisons use local wall time; unknown offsets remain unknown. */
export type PhotoSmartQueryV1 =
	| Readonly<{ kind: 'all' | 'any'; terms: readonly PhotoSmartQueryV1[] }>
	| Readonly<{ kind: 'not'; term: PhotoSmartQueryV1 }>
	| Readonly<{ kind: 'rating'; minimum: number; maximum: number }>
	| Readonly<{ kind: 'flag'; value: PhotoFlagV1 }>
	| Readonly<{ kind: 'label'; value: PhotoColorLabelV1 }>
	| Readonly<{ kind: 'keyword' | 'folder'; id: string }>
	| Readonly<{ kind: 'file-name'; contains: string }>
	| Readonly<{ kind: 'capture-time'; from: string | null; to: string | null }>;

export type PhotoCollectionV1 =
	| Readonly<{ id: string; name: string; kind: 'manual' }>
	| Readonly<{ id: string; name: string; kind: 'smart'; query: PhotoSmartQueryV1 }>;

/** Root owns hierarchy definitions; photo rows and reverse indexes are stored separately. */
export interface PhotoCatalogRootV1 extends LightscaperIdentityV1 {
	readonly kind: 'photo-catalog';
	readonly id: string;
	readonly name: string;
	readonly revision: number;
	readonly photoCount: number;
	readonly folders: readonly PhotoHierarchyNodeV1[];
	readonly keywords: readonly PhotoHierarchyNodeV1[];
	readonly collections: readonly PhotoCollectionV1[];
}

/** Shared still source, with retained original-byte custody independent of preview pixels. */
export interface PhotoOriginalV1 extends VideoStillSourceV1 {
	readonly byteLength: number;
	readonly retention: 'managed' | 'linked';
}

export interface PhotoCaptureTimeV1 {
	readonly local: string;
	readonly offsetMinutes: number | null;
}

export interface PhotoMetadataV1 {
	readonly fileName: string;
	readonly modifiedTime: string | null;
	readonly captureTime: PhotoCaptureTimeV1 | null;
	readonly orientation: number;
	readonly cameraMake: string | null;
	readonly cameraModel: string | null;
	readonly lens: string | null;
	readonly exposureSeconds: number | null;
	readonly aperture: number | null;
	readonly iso: number | null;
	readonly focalLengthMm: number | null;
	readonly title: string;
	readonly caption: string;
	readonly creator: string;
	readonly copyright: string;
	readonly location: string;
}

export interface PhotoGeometryV1 {
	/** Crop coordinates refer to the original normalized image before rotation. */
	readonly crop: Readonly<{ x: number; y: number; width: number; height: number }> | null;
	readonly rotationDegrees: number;
	readonly flipHorizontal: boolean;
	readonly flipVertical: boolean;
}

export interface PhotoMaskBindingV1 {
	readonly effectId: string;
	readonly maskId: string;
}

export interface PhotoDevelopV1 {
	readonly processVersion: 1;
	readonly effects: readonly VideoEffectLeaf[];
	readonly geometry: PhotoGeometryV1;
	readonly masks: readonly VideoMaskMatteGraphV1[];
	readonly maskBindings: readonly PhotoMaskBindingV1[];
}

export interface PhotoVersionV1 {
	readonly id: string;
	readonly kind: 'master' | 'virtual-copy';
	readonly name: string;
	readonly createdAt: string;
	readonly develop: PhotoDevelopV1;
}

/** One photo is the unit of revision and history; no edit snapshots the whole catalog. */
export interface PhotoDocumentV1 extends LightscaperIdentityV1 {
	readonly kind: 'photo';
	readonly id: string;
	readonly catalogId: string;
	readonly revision: number;
	readonly original: PhotoOriginalV1;
	readonly metadata: PhotoMetadataV1;
	readonly folderId: string | null;
	readonly collectionIds: readonly string[];
	readonly keywordIds: readonly string[];
	readonly rating: number;
	readonly flag: PhotoFlagV1;
	readonly colorLabel: PhotoColorLabelV1;
	readonly versions: readonly PhotoVersionV1[];
	readonly activeVersionId: string;
}

export type LightscaperDocumentV1 = PhotoCatalogRootV1 | PhotoDocumentV1;
