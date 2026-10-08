/* SPDX-License-Identifier: AGPL-3.0-only */

import type { KeyValueRepository } from '../../common/editor/storage/key-value-repository.ts';
import { PhotoCatalogRepositoryV1 } from '../catalog/repository.ts';
import { openDefaultPhotoCatalogV1, type PhotoLibraryCatalogPointerV1 } from './photo-library-catalog-pointer.ts';
import { PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2, readPhotoLibraryLocationPointerV2 } from './photo-library-location-v2.ts';
import type { PhotoLibraryWriteAuthorityV1 } from './photo-library-namespace-lock-v1.ts';

export interface PhotoLibraryDefaultInitializerOptionsV2 {
	readonly settings: Pick<KeyValueRepository, 'get' | 'putIfAbsent'>;
	readonly indexedDB: IDBFactory;
	readonly name: string;
	readonly authority: PhotoLibraryWriteAuthorityV1;
}

/** Borrow the already-held initializer lease; never initialize or recover an old Session. */
export async function initializeDefaultPhotoLibraryPointerV2(options: PhotoLibraryDefaultInitializerOptionsV2): Promise<Readonly<PhotoLibraryCatalogPointerV1>> {
	const assertActive = options.authority.assertActive.bind(options.authority), signal = options.authority.signal;
	const settings = { get: options.settings.get.bind(options.settings), putIfAbsent: options.settings.putIfAbsent.bind(options.settings) };
	assertActive();
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB: options.indexedDB, databaseName: PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2,
		verifyOriginal: async () => { throw new Error('An empty default catalog cannot publish original bodies.'); } });
	let result: PhotoLibraryCatalogPointerV1 | undefined, failed = false, primary: unknown;
	try {
		const root = await openDefaultPhotoCatalogV1({ catalog, settings, exclusive: async (_id, run) => { assertActive(); return run(signal); } },
			{ name: options.name, signal });
		// The old initializer owns its native pointer ACK. Do not probe cancellation after it.
		result = readPhotoLibraryLocationPointerV2({ schemaVersion: 1, kind: 'photo-library', catalogId: root.id }) as PhotoLibraryCatalogPointerV1;
	} catch (error) { failed = true; primary = error; }
	try { await catalog.close(); }
	catch (cleanup) { if (failed) throw new AggregateError([primary, cleanup], 'Default library initialization and cleanup failed.', { cause: cleanup }); throw cleanup; }
	if (failed) throw primary;
	return result!;
}
