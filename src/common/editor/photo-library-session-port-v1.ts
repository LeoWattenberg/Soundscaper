/* SPDX-License-Identifier: AGPL-3.0-only */

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

export interface PhotoLibrarySessionPortV1 {
	readPage(options?: Readonly<{ cursor?: string | null; signal?: AbortSignal }>): Promise<PhotoLibraryPageV1>;
	importFiles(files: readonly File[], options?: Readonly<{ signal?: AbortSignal }>): Promise<readonly PhotoLibraryImportItemV1[]>;
	setRating(photoId: string, rating: number, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryRowV1>;
	close(): Promise<void>;
}

export type CreatePhotoLibrarySessionV1 = () => Promise<PhotoLibrarySessionPortV1>;
