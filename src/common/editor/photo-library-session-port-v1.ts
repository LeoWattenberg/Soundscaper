/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageMetadataV1 } from './imaging/image-metadata-model-v1.ts';

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

export interface PhotoLibrarySessionPortV1 {
	readPage(options?: Readonly<{ cursor?: string | null; signal?: AbortSignal }>): Promise<PhotoLibraryPageV1>;
	importFiles(files: readonly File[], options?: Readonly<{ signal?: AbortSignal }>): Promise<readonly PhotoLibraryImportItemV1[]>;
	setRating(photoId: string, rating: number, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryRowV1>;
	applyAttributes(photoId: string, changes: PhotoLibraryAttributePatchV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryRowV1>;
	readMetadata(photoId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryMetadataSnapshotV1>;
	applyMetadata(photoId: string, expectedRevision: number, changes: PhotoLibraryMetadataPatchV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryMetadataSnapshotV1>;
	close(): Promise<void>;
}

export type CreatePhotoLibrarySessionV1 = () => Promise<PhotoLibrarySessionPortV1>;
