/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoCatalogRepositoryV1 } from './catalog/repository.ts';
import { PhotoLibrarySessionV1 } from './controller/photo-library-session.ts';
import { PhotoMediaStoreV1 } from './storage/photo-media-store.ts';
import { openDefaultPhotoCatalogV1 } from './storage/photo-library-catalog-pointer.ts';

/** Lazy product composition; no resource or database is opened by importing it. */
export function createPhotoLibrarySessionV1(options: Readonly<{ name: string }>): PhotoLibrarySessionV1 {
	const media = new PhotoMediaStoreV1();
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB: globalThis.indexedDB, verifyOriginal: media.verifyOriginal });
	return new PhotoLibrarySessionV1({ catalog, media: { writeAsset: media.mediaRepository.writeAsset,
		custody: media.mediaRepository.catalogOriginals }, journal: media.settingsRepository, settings: media.settingsRepository,
		initialize: async signal => {
			await media.ready(); signal.throwIfAborted();
			return openDefaultPhotoCatalogV1({ catalog, settings: media.settingsRepository }, { name: options.name, signal });
		},
		createPreviewScheduler: async catalogId => {
			const { PhotoPreviewSchedulerV1 } = await import('./preview/photo-preview-scheduler-v1.ts');
			return new PhotoPreviewSchedulerV1({ catalogId, loadPhoto: photoId => catalog.loadPhoto(catalogId, photoId),
				loadOriginal: (key, signal) => media.mediaRepository.loadAsset(key, { signal }), cache: media.getPreviewCache() });
		},
		closeResources: async () => {
			const outcomes = await Promise.allSettled([catalog.close(), media.close()]);
			const errors = outcomes.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason as unknown);
			if (errors.length) throw new AggregateError(errors, 'Photo library resource cleanup failed.');
		},
	});
}
