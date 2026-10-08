/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PixelFrameDescriptorV1 } from './imaging/pixel-frame-contract-v1.ts';
import type { ImageMetadataV1 } from './imaging/image-metadata-model-v1.ts';
import type { PhotoLibraryOrganizationPortV1 } from './photo-library-organization-port-v1.ts';
import type { PhotoLibraryImportSettingsPortV1 } from './photo-library-import-settings-port-v1.ts';
import type { PhotoLibraryBatchRenamePortV1 } from './photo-library-batch-rename-port-v1.ts';
import type { PhotoLibraryBackupPortV1 } from './photo-library-backup-port-v1.ts';
import type { PhotoLibraryOriginalRecoveryPortV1 } from './photo-library-original-recovery-port-v1.ts';

/** Scalar presentation boundary; owning catalog documents stay in the product. */
export interface PhotoLibraryRowV1 {
	readonly id: string;
	readonly fileName: string;
	readonly width: number;
	readonly height: number;
	readonly rating: number;
	readonly flag: 'unflagged' | 'pick' | 'reject';
	readonly colorLabel: 'none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple';
}

export interface PhotoLibraryPageV1 {
	readonly catalogName: string;
	readonly totalCount: number;
	readonly rows: readonly PhotoLibraryRowV1[];
	readonly cursor: string | null;
}

export interface PhotoLibraryImportItemV1 {
	readonly index: number;
	readonly fileName: string;
	readonly photoId: string | null;
	readonly status: 'imported' | 'failed';
	readonly reusedOriginal: boolean;
	readonly message: string | null;
	readonly hasMetadataNotices: boolean;
}

export type PhotoLibraryAttributePatchV1 = Readonly<Partial<Pick<PhotoLibraryRowV1, 'rating' | 'flag' | 'colorLabel'>>>;

/** Descriptive values only; no catalog, version stack or original body crosses this port. */
export interface PhotoLibraryMetadataV1 {
	readonly fileName: string;
	readonly modifiedTime: string | null;
	readonly captureTime: Readonly<{ local: string; offsetMinutes: number | null }> | null;
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

export type PhotoLibraryMetadataPatchV1 = Readonly<Partial<Pick<PhotoLibraryMetadataV1,
	'fileName' | 'title' | 'caption' | 'creator' | 'copyright' | 'location' | 'captureTime'>>>;

export interface PhotoLibraryMetadataSnapshotV1 {
	readonly photoId: string;
	readonly revision: number;
	readonly metadata: PhotoLibraryMetadataV1;
	readonly extracted: Readonly<ImageMetadataV1> | null;
	readonly originalFileName: string;
	readonly originalSha256: string;
}

/** Disposable, already-oriented pixels; no original custody binding reaches UI. */
export type PhotoLibraryPreviewTierV1 = 'thumbnail' | 'fit-screen';
export interface PhotoLibraryPreviewV1 {
	readonly photoId: string;
	readonly tier: PhotoLibraryPreviewTierV1;
	readonly descriptor: Readonly<PixelFrameDescriptorV1>;
	readonly byteLength: number;
	readonly outputSha256: string;
	readonly body: Blob;
}
export type PhotoLibraryPreviewOutcomeV1 =
	| Readonly<{ outcome: 'ready'; preview: Readonly<PhotoLibraryPreviewV1>; cache: 'hit' | 'stored' | 'transient';
		notices: readonly ('persistence-failed' | 'cleanup-failed')[] }>
	| Readonly<{ outcome: 'missing' | 'superseded' }>;

/** Catalog-scoped scalar search; each step scans at most 64 candidates. */
export type PhotoLibraryQueryFilterV1 =
	| Readonly<{ kind: 'folder' | 'keyword' | 'collection'; id: string }>
	| Readonly<{ kind: 'rating'; value: number }>
	| Readonly<{ kind: 'flag'; value: PhotoLibraryRowV1['flag'] }>
	| Readonly<{ kind: 'label'; value: PhotoLibraryRowV1['colorLabel'] }>;
export interface PhotoLibraryQueryV1 {
	readonly text: string;
	readonly filter: PhotoLibraryQueryFilterV1 | null;
	readonly sort: Readonly<{ field: 'photo-id' | 'file-name' | 'capture-time' | 'rating'; direction: 'ascending' | 'descending' }>;
}
export interface PhotoLibraryQueryStepV1 extends PhotoLibraryPageV1 {
	readonly scanned: number;
}
export interface PhotoLibraryQueryBuildProgressV1 {
	readonly processed: number;
	readonly readBytes: number;
	readonly ready: boolean;
}
export type PhotoLibraryDefinitionKindV1 = 'folder' | 'keyword' | 'collection';
export type PhotoLibraryDefinitionRowV1 =
	| Readonly<{ kind: 'folder' | 'keyword'; id: string; name: string; parentId: string | null }>
	| Readonly<{ kind: 'collection'; id: string; name: string; collectionKind: 'manual' | 'smart' }>;
export interface PhotoLibraryDefinitionPageRequestV1 {
	readonly kind: PhotoLibraryDefinitionKindV1;
	readonly parentId?: string | null;
	readonly selectedId?: string | null;
	readonly cursor?: string | null;
	readonly signal?: AbortSignal;
}
export interface PhotoLibraryDefinitionPageV1 {
	readonly rootRevision: number;
	readonly rows: readonly PhotoLibraryDefinitionRowV1[];
	readonly parent: Readonly<{ id: string; name: string; parentId: string | null }> | null;
	readonly selected: PhotoLibraryDefinitionRowV1 | null;
	readonly cursor: string | null;
}

export interface PhotoLibrarySessionPortV1 extends PhotoLibraryOrganizationPortV1, PhotoLibraryImportSettingsPortV1, PhotoLibraryBatchRenamePortV1, PhotoLibraryBackupPortV1, PhotoLibraryOriginalRecoveryPortV1 {
	readQueryStep(options: Readonly<{ query: PhotoLibraryQueryV1; cursor?: string | null; signal?: AbortSignal }>): Promise<PhotoLibraryQueryStepV1>;
	rebuildQueryStep(options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryQueryBuildProgressV1>;
	readDefinitionPage(options: PhotoLibraryDefinitionPageRequestV1): Promise<PhotoLibraryDefinitionPageV1>;
	readPreview(photoId: string, tier: PhotoLibraryPreviewTierV1,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryPreviewOutcomeV1>;
	readPage(options?: Readonly<{ cursor?: string | null; signal?: AbortSignal }>): Promise<PhotoLibraryPageV1>;
	setRating(photoId: string, rating: number, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryRowV1>;
	applyAttributes(photoId: string, changes: PhotoLibraryAttributePatchV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryRowV1>;
	readMetadata(photoId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryMetadataSnapshotV1>;
	applyMetadata(photoId: string, expectedRevision: number, changes: PhotoLibraryMetadataPatchV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryMetadataSnapshotV1>;
	close(): Promise<void>;
}

export type CreatePhotoLibrarySessionV1 = () => Promise<PhotoLibrarySessionPortV1>;
