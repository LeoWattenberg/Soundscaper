/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoCatalogArchiveReachabilityCurrentV1 } from '../archive/catalog-archive-reachability-current-v1.ts';
import { catalogTransaction } from '../catalog/catalog-transaction.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import type { PhotoCatalogArchiveLutResourceV5 } from '../archive/catalog-archive-contract-v5.ts';
import type { PhotoCatalogArchiveMaskRasterResourceV6 } from '../archive/catalog-archive-contract-v6.ts';
import { assertMediaRestoreOwnerV1, type PhotoMediaRestoreBindingV1 } from './photo-media-restore-read-v1.ts';
import { readMediaRestoreCatalogPageForProfileV1 } from './photo-media-restore-read-v2.ts';
import { readPhotoMediaRestorePresetsForProfileV1, type PhotoMediaRestorePresetBindingForProfileV1 } from './photo-media-restore-presets-v2.ts';
import type { PhotoMediaRestorePresetBindingCurrentV1 } from './photo-media-restore-presets-current-v1.ts';
import { assertPhotoMediaRestoreLutsV1 } from './photo-media-restore-luts-v1.ts';
import { assertPhotoMediaRestoreMaskRastersV1 } from './photo-media-restore-mask-rasters-v1.ts';
import type { PhotoLibraryRestoreAllocationV1 } from './photo-library-restore-ownership-v1.ts';

/** One shared complete Photo/preset identity ledger precedes serial native body
 * authentication; unused declarations are admitted, never renderer authority. */
export async function auditPhotoMediaRestoreResourcesCurrentV1(media: IDBDatabase, catalog: IDBDatabase,
	allocation: PhotoLibraryRestoreAllocationV1, root: PhotoCatalogRootV1, presets: PhotoMediaRestorePresetBindingCurrentV1 | null,
	luts: readonly Readonly<PhotoCatalogArchiveLutResourceV5>[], masks: readonly Readonly<PhotoCatalogArchiveMaskRasterResourceV6>[], signal: AbortSignal): Promise<void> {
	return auditPhotoMediaRestoreResourcesForProfileV1('current4', media, catalog, allocation, root, presets, luts, masks, signal);
}
export async function auditPhotoMediaRestoreResourcesForProfileV1(profile: 'current3' | 'current4', media: IDBDatabase, catalog: IDBDatabase,
	allocation: PhotoLibraryRestoreAllocationV1, root: PhotoCatalogRootV1, presets: PhotoMediaRestorePresetBindingForProfileV1<'current3' | 'current4'> | null,
	luts: readonly Readonly<PhotoCatalogArchiveLutResourceV5>[], masks: readonly Readonly<PhotoCatalogArchiveMaskRasterResourceV6>[], signal: AbortSignal): Promise<void> {
	const closure = createPhotoCatalogArchiveReachabilityCurrentV1();
	await catalogTransaction(media, ['settings'], 'readonly', async stores => {
		await assertMediaRestoreOwnerV1(stores, allocation);
		const row = await readPhotoMediaRestorePresetsForProfileV1(profile, stores.settings!, root.id, presets);
		if (row !== null) closure.addPresetRow(row, root.id);
	}, signal);
	let after: string | null = null, count = 0;
	for (;;) {
		const page: readonly PhotoMediaRestoreBindingV1[] = await readMediaRestoreCatalogPageForProfileV1(profile, catalog, allocation, root, after, signal, photo => closure.addPhoto(photo));
		if (!page.length) break;
		count += page.length; if (count > root.photoCount) throw new Error('Restore resource source contains excess photos.');
		after = `${root.id}|${page[page.length - 1]!.photoId}`;
	}
	const reached = closure.finish();
	if (count !== root.photoCount || JSON.stringify(reached.luts) !== JSON.stringify(luts.map(row => row.reference))
		|| JSON.stringify(reached.brushes) !== JSON.stringify(masks.map(row => row.reference))) throw new Error('Restore reachable and declared resource inventories differ.');
	await catalogTransaction(media, ['settings', 'analysis'], 'readonly', async stores => {
		await assertMediaRestoreOwnerV1(stores, allocation);
		await assertPhotoMediaRestoreLutsV1(stores.analysis!, luts, signal);
		await assertPhotoMediaRestoreMaskRastersV1(stores.analysis!, masks, signal);
	}, signal);
}
