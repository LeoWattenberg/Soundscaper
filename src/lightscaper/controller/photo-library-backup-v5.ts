/* SPDX-License-Identifier: AGPL-3.0-only */

import { exportPhotoCatalogArchiveV5, type PhotoCatalogArchiveExportResultV5 } from '../archive/catalog-archive-export-v5.ts';
import type { PhotoCubeLutArchiveSourceV1 } from '../archive/cube-lut-archive-source-v1.ts';
import { withPhotoSmartCollectionWriteSignalV1 } from '../catalog/photo-smart-collection-repository-v1.ts';
import { id } from '../catalog/value-validation.ts';
import { capturePhotoDevelopPresetsArchiveV2, type PhotoDevelopPresetArchiveSettingsPortV1 } from '../storage/photo-develop-presets-archive-v2.ts';
import { admitPhotoLibraryBackupRequestV1 } from './photo-library-backup-request.ts';
import { borrowPhotoLibraryBackupInventoryPortsV2, capturePhotoLibraryBackupInventoryV2, type PhotoLibraryBackupInventoryPortsV2 } from './photo-library-backup-inventory-v2.ts';

export interface PhotoLibraryBackupPortsV5 extends PhotoLibraryBackupInventoryPortsV2 {
	readonly developPresetSettings: PhotoDevelopPresetArchiveSettingsPortV1;
	readonly lutResources: PhotoCubeLutArchiveSourceV1;
}

/** Existing selected writer only: complete mixed sources and immutable bodies
 * are authenticated and reverified before destination close. No Session switch. */
export async function exportPhotoLibraryBackupV5(catalogValue: unknown, ports: PhotoLibraryBackupPortsV5,
	optionsValue: unknown = {}): Promise<PhotoCatalogArchiveExportResultV5> {
	const catalogId = id(catalogValue, 'backup catalog ID'), options = admitPhotoLibraryBackupRequestV1(optionsValue);
	return withPhotoSmartCollectionWriteSignalV1(options.signal, async signal => {
		const settings = ports.developPresetSettings, readEntry = settings?.readEntry, source = ports.lutResources, withBytes = source?.withBytes;
		if (typeof readEntry !== 'function' || typeof withBytes !== 'function') throw new TypeError('Current backup requires selected preset presence and LUT body capabilities.');
		const presetSettings = { readEntry: (...args: Parameters<typeof readEntry>) => Reflect.apply(readEntry, settings, args) };
		const lutSource: PhotoCubeLutArchiveSourceV1 = { withBytes: <T>(...args: Parameters<PhotoCubeLutArchiveSourceV1['withBytes']>) =>
			Reflect.apply(withBytes, source, args) as Promise<T> };
		const borrowed = borrowPhotoLibraryBackupInventoryPortsV2(ports);
		const presets = await capturePhotoDevelopPresetsArchiveV2(presetSettings, catalogId, { signal });
		const inventory = await capturePhotoLibraryBackupInventoryV2(catalogId, borrowed, signal);
		const verifyPresets = presets.verify, verifyInventory = inventory.verify;
		return exportPhotoCatalogArchiveV5(inventory.source.initial.catalog, inventory.source.originals, inventory.stacks,
			inventory.state, inventory.definitions, presets.row, lutSource, { ...options, signal,
				verifySource: () => Reflect.apply(verifyInventory, inventory, [() => Reflect.apply(verifyPresets, presets, [])]) });
	});
}
