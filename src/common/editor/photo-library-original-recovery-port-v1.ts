/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CatalogOriginalRepairBindingV1 } from './storage/media-catalog-original-repair-contract.ts';

export type PhotoLibraryOriginalBodyInspectionV1 = Readonly<
	{ status: 'present' }
	| { status: 'missing'; reason: 'media-row' | 'directory' | 'file' | 'inline-blob' | 'chunk' }
	| { status: 'corrupt'; reason: 'size' | 'digest' }
	| { status: 'unsupported'; storage: string | null }
>;
export interface PhotoLibraryOriginalInspectionFailureV1 { readonly message: string }
export interface PhotoLibraryOriginalInspectionPageV1 {
	readonly schemaVersion: 1;
	readonly catalogId: string;
	readonly catalogName: string;
	readonly revision: number;
	readonly activeImportId: string | null;
	readonly startupFailure: PhotoLibraryOriginalInspectionFailureV1 | null;
	readonly rows: readonly Readonly<{ photoId: string; revision: number; fileName: string;
		binding: CatalogOriginalRepairBindingV1; inspection: PhotoLibraryOriginalBodyInspectionV1 }>[];
	readonly scanned: number;
	readonly cursor: string | null;
}
export interface PhotoLibraryOriginalInspectionOptionsV1 {
	readonly cursor?: string | null;
	readonly signal?: AbortSignal;
}
export interface PhotoLibraryOriginalRestoreTargetV1 {
	readonly schemaVersion: 1;
	readonly catalogRevision: number;
	readonly activeImportId: string | null;
	readonly photoRevision: number;
	readonly binding: CatalogOriginalRepairBindingV1;
}
export interface PhotoLibraryOriginalRestorationOptionsV1 { readonly signal?: AbortSignal }
export interface PhotoLibraryOriginalRestorationReceiptV1 {
	readonly photoId: string;
	readonly assetId: string;
	readonly sha256: string;
	readonly size: number;
	readonly notices: readonly 'cleanup-failed'[];
}

/** Borrowed catalog session; restoration does not imply ordinary recovery completed. */
export interface PhotoLibraryOriginalRecoveryPortV1 {
	inspectOriginals(options?: PhotoLibraryOriginalInspectionOptionsV1): Promise<PhotoLibraryOriginalInspectionPageV1>;
	restoreOriginalBody(target: PhotoLibraryOriginalRestoreTargetV1, selected: Blob,
		options?: PhotoLibraryOriginalRestorationOptionsV1): Promise<PhotoLibraryOriginalRestorationReceiptV1>;
}
