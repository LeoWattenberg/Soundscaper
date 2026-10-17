/* SPDX-License-Identifier: AGPL-3.0-only */

import { capturePhotoLibraryBackupInventorySourceV2, type PhotoLibraryBackupInventoryPortsV2 } from './photo-library-backup-inventory-v2.ts';
import { capturePhotoLibraryBackupSourceV3 } from './photo-library-backup-source-v3.ts';

/** Complete mixed-resource closure first; companion wire formats and their
 * captured one-shot verification remain owned by the existing inventory. */
export async function capturePhotoLibraryBackupInventoryV3(catalogId: string, borrowed: PhotoLibraryBackupInventoryPortsV2,
	signal?: AbortSignal) {
	const source = await capturePhotoLibraryBackupSourceV3(catalogId, borrowed, signal);
	return capturePhotoLibraryBackupInventorySourceV2(catalogId, borrowed, source, signal);
}
