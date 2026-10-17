/* SPDX-License-Identifier: AGPL-3.0-only */

import { capturePhotoLibraryBackupSourceV2, type PhotoLibraryBackupSourceV2 } from './photo-library-backup-source-v2.ts';
import { borrowPhotoLibraryBackupInventoryPortsForProfileV1, capturePhotoLibraryBackupInventorySourceForProfileV1,
	type PhotoLibraryBackupInventoryPortsV2 } from './internal/photo-library-backup-inventory-kernel-v1.ts';
export type { PhotoLibraryBackupInventoryPortsV2 } from './internal/photo-library-backup-inventory-kernel-v1.ts';

export function borrowPhotoLibraryBackupInventoryPortsV2(ports: PhotoLibraryBackupInventoryPortsV2): PhotoLibraryBackupInventoryPortsV2 {
	return borrowPhotoLibraryBackupInventoryPortsForProfileV1('legacy2', ports);
}
export async function capturePhotoLibraryBackupInventoryV2(catalogId: string, borrowed: PhotoLibraryBackupInventoryPortsV2, signal?: AbortSignal) {
	const source = await capturePhotoLibraryBackupSourceV2(catalogId, borrowed, signal);
	return capturePhotoLibraryBackupInventorySourceV2(catalogId, borrowed, source, signal);
}
export function capturePhotoLibraryBackupInventorySourceV2<Source extends PhotoLibraryBackupSourceV2>(catalogId: string,
	borrowed: PhotoLibraryBackupInventoryPortsV2, source: Source, signal?: AbortSignal) {
	return capturePhotoLibraryBackupInventorySourceForProfileV1('legacy2', catalogId, borrowed, source, signal);
}
