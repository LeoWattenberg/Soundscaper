/* SPDX-License-Identifier: AGPL-3.0-only */

import { exportPhotoCatalogArchiveV3, type PhotoCatalogArchiveExportResultV3 } from '../archive/catalog-archive-export-v3.ts';
import { withPhotoSmartCollectionWriteSignalV1 } from '../catalog/photo-smart-collection-repository-v1.ts';
import { id } from '../catalog/value-validation.ts';
import { admitPhotoLibraryBackupRequestV1 } from './photo-library-backup-request.ts';
import { borrowPhotoLibraryBackupInventoryPorts, capturePhotoLibraryBackupInventory,
	type PhotoLibraryBackupInventoryPorts } from './photo-library-backup-inventory.ts';

export type PhotoLibraryBackupPortsV3 = PhotoLibraryBackupInventoryPorts;

/** Borrow one existing session/lease; authenticate saved inventory before originals or output. */
export async function exportPhotoLibraryBackupV3(catalogValue: unknown, ports: PhotoLibraryBackupPortsV3,
	optionsValue: unknown = {}): Promise<PhotoCatalogArchiveExportResultV3> {
	const catalogId = id(catalogValue, 'backup catalog ID'), options = admitPhotoLibraryBackupRequestV1(optionsValue);
	return withPhotoSmartCollectionWriteSignalV1(options.signal, async signal => {
		const inventory = await capturePhotoLibraryBackupInventory(catalogId, borrowPhotoLibraryBackupInventoryPorts(ports), signal);
		return exportPhotoCatalogArchiveV3(inventory.source.initial.catalog, inventory.source.originals, inventory.stacks,
			inventory.state, inventory.definitions, { ...options, signal, verifySource: inventory.verify });
	});
}
