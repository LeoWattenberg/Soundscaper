/* SPDX-License-Identifier: AGPL-3.0-only */

import { capturePhotoLibraryBackupSourceCurrentV1 } from './photo-library-backup-source-current-v1.ts';
import { assertPhotoLibraryBackupCapacityCurrentV1 } from './internal/photo-library-backup-capacity-current-v1.ts';
import { borrowPhotoLibraryBackupInventoryPortsForProfileV1, capturePhotoLibraryBackupInventorySourceForProfileV1,
	type PhotoLibraryBackupInventoryPortsCurrentV1 } from './internal/photo-library-backup-inventory-kernel-v1.ts';
export type { PhotoLibraryBackupInventoryPortsCurrentV1 } from './internal/photo-library-backup-inventory-kernel-v1.ts';

export function borrowPhotoLibraryBackupInventoryPortsCurrentV1(ports: PhotoLibraryBackupInventoryPortsCurrentV1): PhotoLibraryBackupInventoryPortsCurrentV1 {
	return borrowPhotoLibraryBackupInventoryPortsForProfileV1('current3', ports);
}
export async function capturePhotoLibraryBackupInventoryCurrentV1(catalogId: string, borrowed: PhotoLibraryBackupInventoryPortsCurrentV1,
	row: unknown | null, signal?: AbortSignal) {
	const source = await capturePhotoLibraryBackupSourceCurrentV1(catalogId, borrowed, row, signal);
	const inventory = await capturePhotoLibraryBackupInventorySourceForProfileV1('current3', catalogId, borrowed, source, signal);
	const capacity = await capturePhotoLibraryBackupInventorySourceForProfileV1('current3', catalogId, borrowed, source, signal);
	await assertPhotoLibraryBackupCapacityCurrentV1(source.photoPackCount, source.references.luts.length + source.references.brushes.length,
		row !== null, capacity.stacks, capacity.definitions, signal);
	await capacity.verify();
	return inventory;
}
