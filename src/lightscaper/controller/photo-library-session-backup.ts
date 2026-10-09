/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryBackupOptionsV1, PhotoLibraryBackupResultV1 } from '../../common/editor/photo-library-backup-port-v1.ts';
import { borrowPhotoLibraryBackupInventoryPortsV2 } from './photo-library-backup-inventory-v2.ts';
import { admitPhotoLibraryBackupRequestV1 } from './photo-library-backup-request.ts';
import type { PhotoLibrarySessionPortsV2 } from './photo-library-session-ports-v2.ts';
import { borrowPhotoDevelopPresetEntryReaderV2 } from '../storage/photo-develop-preset-read-v2.ts';
import { capturePhotoCubeLutSource } from './photo-cube-lut-source-binding.ts';

interface Host {
	readonly ports: PhotoLibrarySessionPortsV2;
	readonly presetSettings: PhotoLibrarySessionPortsV2['developPresetSettings'];
	readonly mutate: <Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
/** Capture scalar/source capabilities before borrowing the selected writer; heavy archive code stays lazy. */
export async function backupPhotoLibrarySession(host: Host, options: PhotoLibraryBackupOptionsV1 = {}): Promise<PhotoLibraryBackupResultV1> {
	const request = admitPhotoLibraryBackupRequestV1(options), { ports, presetSettings, mutate } = host;
	const backup = ports.backup, stacks = ports.stacks, catalog = ports.catalog, resources = ports.cubeLutResources;
	if (!backup || !stacks || !presetSettings || !resources) throw new Error('Photo catalog backup is unavailable.');
	const snapshot = backup.readSnapshot, capture = backup.captureSmartCollectionArchiveV1, loadOriginal = backup.loadOriginal,
		summaries = catalog.readSummaryPage, photo = catalog.loadPhoto;
	const borrowed = borrowPhotoLibraryBackupInventoryPortsV2({ catalog: {
		readSnapshot: (...args) => Reflect.apply(snapshot, backup, args),
		captureSmartCollectionArchiveV1: (...args) => Reflect.apply(capture, backup, args),
		readSummaryPage: (...args) => Reflect.apply(summaries, catalog, args),
		loadPhoto: (...args) => Reflect.apply(photo, catalog, args),
	}, stacks, loadOriginal: (...args) => Reflect.apply(loadOriginal, backup, args) });
	const readEntry = borrowPhotoDevelopPresetEntryReaderV2(presetSettings);
	const completed: { result: PhotoLibraryBackupResultV1 | null } = { result: null };
	try {
		return await mutate(async (catalogId, signal) => {
			Reflect.apply(CHECK, signal, []);
			const lutResources = capturePhotoCubeLutSource((await Reflect.apply(resources, ports, [])).source);
			const { exportPhotoLibraryBackupV5 } = await import('./photo-library-backup-v5.ts'); Reflect.apply(CHECK, signal, []);
			const result = await exportPhotoLibraryBackupV5(catalogId, { ...borrowed, developPresetSettings: { readEntry }, lutResources }, { ...request, signal });
			completed.result = Object.freeze({ catalogId, catalogName: result.document.catalog.name, photoCount: result.document.catalog.photoCount,
				byteLength: result.byteLength, blob: result.blob, notices: Object.freeze([]) });
			return completed.result;
		}, request.signal);
	} catch (error) {
		if (completed.result === null) throw error;
		return Object.freeze({ ...completed.result, notices: Object.freeze(['cleanup-failed'] as const) });
	}
}
