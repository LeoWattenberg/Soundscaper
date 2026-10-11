/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import { measurePhotoCatalogPackRecordV3 } from '../archive/catalog-pack-v3.ts';
import { createPhotoMaskRasterReachabilityV1 } from '../catalog/photo-mask-raster-reachability-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { capturePhotoLibraryBackupMetadataWalkV1, type PhotoLibraryBackupMetadataCatalogV1,
	type PhotoLibraryBackupMetadataWalkV1 } from './photo-library-backup-metadata-walk-v1.ts';

export interface PhotoLibraryBackupMetadataPreflightV2 extends PhotoLibraryBackupMetadataWalkV1 {
	readonly references: readonly Readonly<BrushMaskResourceReferenceV1>[];
}

/** Complete retained metadata precedes any body source. Only canonical scalar
 * references survive; lazy original walks re-admit each Photo against that
 * closure and the same catalog/index fences, without a Photo/body cache. */
export async function capturePhotoLibraryBackupMetadataPreflightV2(catalogValue: unknown,
	catalogPort: PhotoLibraryBackupMetadataCatalogV1, signal?: AbortSignal): Promise<Readonly<PhotoLibraryBackupMetadataPreflightV2>> {
	const collector = createPhotoMaskRasterReachabilityV1();
	const capture: { references?: readonly Readonly<BrushMaskResourceReferenceV1>[] } = {};
	const admitted = new Map<string, string>();
	const metadata = await capturePhotoLibraryBackupMetadataWalkV1(catalogValue, catalogPort, photo => {
		measurePhotoCatalogPackRecordV3(photo);
		if (capture.references === undefined) { collector.addPhoto(photo); return; }
		const current = createPhotoMaskRasterReachabilityV1(); current.addPhoto(photo);
		for (const reference of current.finish()) if (admitted.get(reference.storageKey) !== JSON.stringify(reference)) {
			throw new PhotoCatalogRevisionConflictError('photo');
		}
	}, signal);
	const references = collector.finish(); capture.references = references;
	for (const reference of references) admitted.set(reference.storageKey, JSON.stringify(reference));
	return Object.freeze({ ...metadata, references });
}
