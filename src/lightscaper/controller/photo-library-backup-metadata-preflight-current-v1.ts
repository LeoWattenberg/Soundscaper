/* SPDX-License-Identifier: AGPL-3.0-only */

import { measurePhotoCatalogPackRecordV4 } from '../archive/catalog-pack-v4.ts';
import { createPhotoCatalogArchiveReachabilityCurrentV1 } from '../archive/catalog-archive-reachability-current-v1.ts';
import type { PhotoResourceReferencesCurrentV1 } from '../catalog/photo-resource-reachability-current-v1.ts';
import { normalizePhotoDevelopPresetRowCurrentV1 } from '../storage/photo-develop-preset-row-current-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { createPhotoLibraryBackupPackCounterCurrentV1 } from './internal/photo-library-backup-capacity-current-v1.ts';
import { capturePhotoLibraryBackupMetadataWalkCurrentV1, type PhotoLibraryBackupMetadataCatalogCurrentV1,
	type PhotoLibraryBackupMetadataWalkCurrentV1 } from './photo-library-backup-metadata-walk-current-v1.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
export interface PhotoLibraryBackupMetadataPreflightCurrentV1 extends PhotoLibraryBackupMetadataWalkCurrentV1 {
	readonly references: Readonly<PhotoResourceReferencesCurrentV1>;
	readonly requiresCurrentFormat: boolean;
	readonly photoPackCount: number;
}

/** Full Photos and exact native preset row form one portable namespace/identity
 * proof before any body. Only scalar closure survives the complete metadata walk. */
export async function capturePhotoLibraryBackupMetadataPreflightCurrentV1(catalogId: string, catalog: PhotoLibraryBackupMetadataCatalogCurrentV1,
	rowValue: unknown | null, signal?: AbortSignal): Promise<Readonly<PhotoLibraryBackupMetadataPreflightCurrentV1>> {
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }; check();
	const closure = createPhotoCatalogArchiveReachabilityCurrentV1();
	const row = rowValue === null ? null : normalizePhotoDevelopPresetRowCurrentV1(rowValue, catalogId);
	if (row !== null) closure.addPresetRow(row, catalogId);
	let requiresCurrentFormat = row?.schemaVersion === 3, completed = false;
	const packs = createPhotoLibraryBackupPackCounterCurrentV1('photo');
	const admitted = new Map<string, string>();
	const metadata = await capturePhotoLibraryBackupMetadataWalkCurrentV1(catalogId, catalog, photo => {
		const bytes = measurePhotoCatalogPackRecordV4(photo);
		if (!completed) { packs.add(bytes); requiresCurrentFormat ||= photo.schemaVersion === 3; closure.addPhoto(photo); return; }
		if (photo.schemaVersion === 3 && !requiresCurrentFormat) throw new PhotoCatalogRevisionConflictError('photo');
		const current = createPhotoCatalogArchiveReachabilityCurrentV1(); current.addPhoto(photo); const references = current.finish();
		for (const reference of [...references.luts, ...references.brushes]) if (admitted.get(reference.storageKey) !== JSON.stringify(reference)) {
			throw new PhotoCatalogRevisionConflictError('photo');
		}
	}, signal);
	const references = closure.finish(); completed = true; check();
	for (const reference of [...references.luts, ...references.brushes]) admitted.set(reference.storageKey, JSON.stringify(reference));
	return Object.freeze({ ...metadata, references, requiresCurrentFormat, photoPackCount: packs.finish() });
}
