/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed scalar acknowledgement of an installed library; resources stay with the product runtime. */
export interface PhotoLibraryRestoreReceiptV1 {
	readonly catalogId: string;
	readonly catalogName: string;
	readonly photoCount: number;
	readonly stackCount: number;
	readonly savedCollectionCount: number;
	readonly originalCount: number;
	readonly originalByteLength: number;
	readonly notices: readonly ('cleanup-failed' | 'publication-reconciled')[];
}
export interface PhotoLibraryRestoreRuntimeV1 {
	restoreArchive(blob: Blob, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<PhotoLibraryRestoreReceiptV1>>;
	close(): Promise<void>;
}
export type LoadPhotoLibraryRestoreRuntimeV1 = () => Promise<PhotoLibraryRestoreRuntimeV1>;
