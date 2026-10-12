/* SPDX-License-Identifier: AGPL-3.0-only */

import { captureMaskRasterSourceV1 } from '../../common/editor/imaging/mask-raster-source-scope-v1.ts';
import type { MaskRasterSourcePortV1 } from '../../common/editor/imaging/mask-raster-source-port-v1.ts';
import { exportPhotoCatalogArchiveV5, type PhotoCatalogArchiveExportResultV5 } from '../archive/catalog-archive-export-v5.ts';
import { exportPhotoCatalogArchiveV6, type PhotoCatalogArchiveExportResultV6 } from '../archive/catalog-archive-export-v6.ts';
import { exportPhotoCatalogArchiveV7, type PhotoCatalogArchiveExportResultV7 } from '../archive/catalog-archive-export-v7.ts';
import { borrowPhotoMaskRasterArchiveSourceV1 } from '../archive/mask-raster-archive-source-v1.ts';
import { borrowPhotoCubeLutArchiveSourceV1, type PhotoCubeLutArchiveSourceV1 } from '../archive/cube-lut-archive-source-v1.ts';
import { withPhotoSmartCollectionWriteSignalV1 } from '../catalog/photo-smart-collection-repository-v1.ts';
import { id } from '../catalog/value-validation.ts';
import { capturePhotoDevelopPresetsArchiveCurrentV1 } from '../storage/photo-develop-presets-archive-current-v1.ts';
import type { PhotoDevelopPresetArchiveSettingsPortV1 } from '../storage/photo-develop-presets-archive-v2.ts';
import { normalizePhotoDevelopPresetRowV1OrV2 } from '../storage/photo-develop-preset-row-v2.ts';
import { admitPhotoLibraryBackupRequestV1 } from './photo-library-backup-request.ts';
import { borrowPhotoLibraryBackupInventoryPortsCurrentV1, capturePhotoLibraryBackupInventoryCurrentV1,
	type PhotoLibraryBackupInventoryPortsCurrentV1 } from './photo-library-backup-inventory-current-v1.ts';

export interface PhotoLibraryBackupPortsCurrentV1 extends PhotoLibraryBackupInventoryPortsCurrentV1 {
	readonly developPresetSettings: PhotoDevelopPresetArchiveSettingsPortV1;
	readonly lutResources: PhotoCubeLutArchiveSourceV1;
	readonly maskRasters: MaskRasterSourcePortV1;
}
export type PhotoLibraryBackupResultCurrentV1 = PhotoCatalogArchiveExportResultV5 | PhotoCatalogArchiveExportResultV6 | PhotoCatalogArchiveExportResultV7;
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }

/** Whole Photo3 or sticky Row3 selects7; genuinely complete legacy values keep
 * exact5/6 bytes. Complete metadata/namespace/combined closure precedes every
 * body, Original and destination; serial body scopes retain no resource cache. */
export async function exportPhotoLibraryBackupCurrentV1(catalogValue: unknown, ports: PhotoLibraryBackupPortsCurrentV1,
	optionsValue: unknown = {}): Promise<PhotoLibraryBackupResultCurrentV1> {
	let firstSignal: AbortSignal | undefined;
	if (optionsValue !== null && typeof optionsValue === 'object') { const native = Object.getOwnPropertyDescriptor(optionsValue, 'signal');
		if (native && Object.hasOwn(native, 'value')) { firstSignal = native.value as AbortSignal | undefined; check(firstSignal); } }
	let options: ReturnType<typeof admitPhotoLibraryBackupRequestV1>, catalogId: string;
	try { options = admitPhotoLibraryBackupRequestV1(optionsValue); check(options.signal); catalogId = id(catalogValue, 'backup catalog ID'); }
	catch (error) { check(firstSignal); throw error; }
	return withPhotoSmartCollectionWriteSignalV1(options.signal, async signal => {
		const settings = ports.developPresetSettings, readEntry = settings?.readEntry, source = ports.lutResources, withBytes = source?.withBytes;
		if (typeof readEntry !== 'function' || typeof withBytes !== 'function') throw new TypeError('Current backup requires selected preset and LUT body capabilities.');
		const presetSettings = { readEntry: (...args: Parameters<typeof readEntry>) => Reflect.apply(readEntry, settings, args) };
		const lutSource: PhotoCubeLutArchiveSourceV1 = {
			withBytes: <Result>(...args: Parameters<typeof withBytes>) => Reflect.apply(withBytes, source, args) as Promise<Result> };
		const maskSource = captureMaskRasterSourceV1(ports.maskRasters), readMask = borrowPhotoMaskRasterArchiveSourceV1(maskSource, signal),
			readLut = borrowPhotoCubeLutArchiveSourceV1(lutSource, signal);
		const borrowed = borrowPhotoLibraryBackupInventoryPortsCurrentV1(ports);
		const presets = await capturePhotoDevelopPresetsArchiveCurrentV1(presetSettings, catalogId, { signal });
		const inventory = await capturePhotoLibraryBackupInventoryCurrentV1(catalogId, borrowed, presets.row, signal);
		const references = inventory.source.references, verifyPresets = presets.verify, verifyInventory = inventory.verify,
			verifyCatalog = inventory.source.verifyCatalog;
		const verifyBodies = async () => {
			for (const reference of references.luts) await readLut(reference, async () => undefined);
			for (const reference of references.brushes) await readMask(reference, async () => undefined);
			check(signal);
		};
		const verifyMetadata = async () => {
			await Reflect.apply(verifyCatalog, inventory.source, []); await Reflect.apply(verifyPresets, presets, []);
			await verifyBodies(); await Reflect.apply(verifyPresets, presets, []); await Reflect.apply(verifyCatalog, inventory.source, []);
		};
		const verifySource = async () => {
			await verifyMetadata();
			// The saved owner's one-shot proof is consumed only after every final
			// body/source outcome joins, still bracketed by preset/stack/root checks.
			await Reflect.apply(verifyInventory, inventory, [() => Reflect.apply(verifyPresets, presets, [])]);
		};
		await verifyMetadata(); check(signal);
		let writable = options.writable;
		if (options.createWritable) {
			writable = admitPhotoLibraryBackupRequestV1({ writable: await options.createWritable(), signal }).writable;
			if (writable === undefined) throw new TypeError('Photo backup destination factory must return a native writable stream.');
		}
		check(signal); if (options.createWritable) await verifyMetadata();
		const sourceView = inventory.source, request = { writable, signal, maximumBlobBytes: options.maximumBlobBytes, verifySource };
		if (sourceView.requiresCurrentFormat) return exportPhotoCatalogArchiveV7(sourceView.initial.catalog, sourceView.originals, inventory.stacks,
			inventory.state, inventory.definitions, presets.row, lutSource, maskSource, request);
		// This is full strict legacy admission of actual legacy values, never a
		// process/Photo projection or a transport permission inferred from active settings.
		const row = presets.row === null ? null : normalizePhotoDevelopPresetRowV1OrV2(presets.row, catalogId);
		const args = [sourceView.initial.catalog, sourceView.originals, inventory.stacks, inventory.state, inventory.definitions, row, lutSource] as const;
		return references.brushes.length ? exportPhotoCatalogArchiveV6(...args, maskSource, request) : exportPhotoCatalogArchiveV5(...args, request);
	});
}
