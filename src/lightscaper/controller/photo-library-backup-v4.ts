/* SPDX-License-Identifier: AGPL-3.0-only */

import { exportPhotoCatalogArchiveV4, type PhotoCatalogArchiveExportResultV4 } from '../archive/catalog-archive-export-v4.ts';
import { withPhotoSmartCollectionWriteSignalV1 } from '../catalog/photo-smart-collection-repository-v1.ts';
import { id } from '../catalog/value-validation.ts';
import { capturePhotoDevelopPresetsArchiveV1, type PhotoDevelopPresetArchiveSettingsPortV1 } from '../storage/photo-develop-presets-archive-v1.ts';
import { admitPhotoLibraryBackupRequestV1 } from './photo-library-backup-request.ts';
import { borrowPhotoLibraryBackupInventoryPorts, capturePhotoLibraryBackupInventory,
	type PhotoLibraryBackupInventoryPorts } from './photo-library-backup-inventory.ts';

export interface PhotoLibraryBackupPortsV4 extends PhotoLibraryBackupInventoryPorts {
	readonly developPresetSettings: PhotoDevelopPresetArchiveSettingsPortV1;
}

/** One existing Session writer captures, emits and reauthenticates the selected preset row before output close. */
export async function exportPhotoLibraryBackupV4(catalogValue: unknown, ports: PhotoLibraryBackupPortsV4,
	optionsValue: unknown = {}): Promise<PhotoCatalogArchiveExportResultV4> {
	const catalogId = id(catalogValue, 'backup catalog ID'), options = admitPhotoLibraryBackupRequestV1(optionsValue);
	return withPhotoSmartCollectionWriteSignalV1(options.signal, async signal => {
		const settings = ports.developPresetSettings, readEntry = settings?.readEntry;
		if (typeof readEntry !== 'function') throw new TypeError('Develop preset backup requires its selected point-entry capability.');
		const borrowed = borrowPhotoLibraryBackupInventoryPorts(ports), presetSettings = { readEntry: readEntry.bind(settings) };
		const presets = await capturePhotoDevelopPresetsArchiveV1(presetSettings, catalogId, { signal });
		const inventory = await capturePhotoLibraryBackupInventory(catalogId, borrowed, signal);
		const verifyPresets = presets.verify.bind(presets), verifyInventory = inventory.verify.bind(inventory);
		return exportPhotoCatalogArchiveV4(inventory.source.initial.catalog, inventory.source.originals, inventory.stacks,
			inventory.state, inventory.definitions, presets.row, { ...options, signal, verifySource: () => verifyInventory(verifyPresets) });
	});
}
