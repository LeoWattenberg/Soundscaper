/* SPDX-License-Identifier: AGPL-3.0-only */

import { captureMaskRasterSourceV1 } from '../../common/editor/imaging/mask-raster-source-scope-v1.ts';
import type { MaskRasterSourcePortV1 } from '../../common/editor/imaging/mask-raster-source-port-v1.ts';
import { exportPhotoCatalogArchiveV5, type PhotoCatalogArchiveExportResultV5 } from '../archive/catalog-archive-export-v5.ts';
import { exportPhotoCatalogArchiveV6, type PhotoCatalogArchiveExportResultV6 } from '../archive/catalog-archive-export-v6.ts';
import { borrowPhotoMaskRasterArchiveSourceV1 } from '../archive/mask-raster-archive-source-v1.ts';
import { withPhotoSmartCollectionWriteSignalV1 } from '../catalog/photo-smart-collection-repository-v1.ts';
import { id } from '../catalog/value-validation.ts';
import { capturePhotoDevelopPresetsArchiveV2 } from '../storage/photo-develop-presets-archive-v2.ts';
import { admitPhotoLibraryBackupRequestV1 } from './photo-library-backup-request.ts';
import { borrowPhotoLibraryBackupInventoryPortsV2 } from './photo-library-backup-inventory-v2.ts';
import { capturePhotoLibraryBackupInventoryV3 } from './photo-library-backup-inventory-v3.ts';
import type { PhotoLibraryBackupPortsV5 } from './photo-library-backup-v5.ts';

export interface PhotoLibraryBackupPortsV6 extends PhotoLibraryBackupPortsV5 {
	readonly maskRasters: MaskRasterSourcePortV1;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }

/** Selected backup chooses V6 only for a complete retained brush closure.
 * Before destination/original demand, independently authenticate every body
 * serially under the real source's joined scope, retaining no alpha or bytes.
 * Final body/source fences preserve native destination Close as the ACK. */
export async function exportPhotoLibraryBackupV6(catalogValue: unknown, ports: PhotoLibraryBackupPortsV6,
	optionsValue: unknown = {}): Promise<PhotoCatalogArchiveExportResultV5 | PhotoCatalogArchiveExportResultV6> {
	const catalogId = id(catalogValue, 'backup catalog ID'), options = admitPhotoLibraryBackupRequestV1(optionsValue);
	return withPhotoSmartCollectionWriteSignalV1(options.signal, async signal => {
		const settings = ports.developPresetSettings, readEntry = settings?.readEntry, source = ports.lutResources, withBytes = source?.withBytes;
		if (typeof readEntry !== 'function' || typeof withBytes !== 'function') throw new TypeError('Current backup requires selected preset presence and LUT body capabilities.');
		const presetSettings = { readEntry: (...args: Parameters<typeof readEntry>) => Reflect.apply(readEntry, settings, args) };
		const lutSource: PhotoLibraryBackupPortsV5['lutResources'] = {
			withBytes: <Result>(...args: Parameters<typeof withBytes>) => Reflect.apply(withBytes, source, args) as Promise<Result> };
		// Capturing this optional selected factory frontdoor does not acquire it.
		const maskSource = captureMaskRasterSourceV1(ports.maskRasters);
		const readBody = borrowPhotoMaskRasterArchiveSourceV1(maskSource, signal);
		const borrowed = borrowPhotoLibraryBackupInventoryPortsV2(ports);
		const presets = await capturePhotoDevelopPresetsArchiveV2(presetSettings, catalogId, { signal });
		const inventory = await capturePhotoLibraryBackupInventoryV3(catalogId, borrowed, signal);
		const references = inventory.source.references, verifyPresets = presets.verify, verifyInventory = inventory.verify,
			verifyCatalog = inventory.source.verifyCatalog;
		const verifyBodies = async () => {
			for (const reference of references) await readBody(reference, async () => undefined);
			check(signal);
		};
		const verifyMetadata = async () => {
			await Reflect.apply(verifyCatalog, inventory.source, []); await Reflect.apply(verifyPresets, presets, []);
			await verifyBodies(); await Reflect.apply(verifyPresets, presets, []); await Reflect.apply(verifyCatalog, inventory.source, []);
		};
		const verifySource = async () => {
			// Join final body reads before consuming the saved owner's one-shot
			// fence. Its existing preset/stack/catalog verification stays last.
			await verifyMetadata();
			await Reflect.apply(verifyInventory, inventory, [() => Reflect.apply(verifyPresets, presets, [])]);
		};
		// Saved definitions keep their one-shot final verification after delivery.
		await verifyMetadata(); check(signal);
		let writable = options.writable;
		if (options.createWritable) {
			writable = admitPhotoLibraryBackupRequestV1({ writable: await options.createWritable(), signal }).writable;
			if (writable === undefined) throw new TypeError('Photo backup destination factory must return a native writable stream.');
		}
		check(signal); if (options.createWritable) await verifyMetadata();
		const args = [inventory.source.initial.catalog, inventory.source.originals, inventory.stacks, inventory.state,
			inventory.definitions, presets.row, lutSource] as const;
		const request = { writable, signal, maximumBlobBytes: options.maximumBlobBytes, verifySource };
		if (references.length === 0) return exportPhotoCatalogArchiveV5(...args, request);
		return exportPhotoCatalogArchiveV6(...args, maskSource, request);
	});
}
