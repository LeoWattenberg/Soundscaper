/* SPDX-License-Identifier: AGPL-3.0-only */

import { exportPhotoCatalogArchiveV1, type PhotoCatalogArchiveExportResult } from '../archive/catalog-archive-export.ts';
import { exportPhotoCatalogArchiveV2, type PhotoCatalogArchiveExportResultV2 } from '../archive/catalog-archive-export-v2.ts';
import { id } from '../catalog/value-validation.ts';
import { admitPhotoLibraryBackupRequestV1 } from './photo-library-backup-request.ts';
import { capturePhotoLibraryBackupStacksV1, type PhotoLibraryBackupStackPortsV1 } from './photo-library-backup-stacks-v1.ts';
import { capturePhotoLibraryBackupSourceV1, type PhotoLibraryBackupSourcePortsV1 } from './photo-library-backup-source-v1.ts';

export interface PhotoLibraryBackupPortsV1 extends PhotoLibraryBackupSourcePortsV1 {
	readonly stacks?: PhotoLibraryBackupStackPortsV1;
}

/** Caller lends the session/catalog lease until the archive destination settles. */
export async function exportPhotoLibraryBackupV1(catalogValue: unknown, ports: PhotoLibraryBackupPortsV1,
	optionsValue: unknown = {}): Promise<PhotoCatalogArchiveExportResult | PhotoCatalogArchiveExportResultV2> {
	const catalogId = id(catalogValue, 'backup catalog ID');
	const options = admitPhotoLibraryBackupRequestV1(optionsValue), signal = options.signal;
	const source = await capturePhotoLibraryBackupSourceV1(catalogId, ports, signal);
	if (ports.stacks) {
		const stacks = await capturePhotoLibraryBackupStacksV1(source.initial, ports.stacks, source.verifyCatalog, signal);
		return exportPhotoCatalogArchiveV2(source.initial.catalog, source.originals, stacks, options);
	}
	return exportPhotoCatalogArchiveV1(source.initial.catalog, source.originals, options);
}
