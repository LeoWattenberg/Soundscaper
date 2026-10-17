/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import { assertNotAborted } from './catalog/catalog-transaction.ts';
import { PhotoCatalogRepositoryV1 } from './catalog/repository.ts';
import { inspectPhotoCatalogRestoreNamespaceV1 } from './catalog/photo-catalog-restore-owner-v1.ts';
import { withPhotoSmartCollectionWriteSignalV1 } from './catalog/photo-smart-collection-repository-v1.ts';
import { name } from './catalog/value-validation.ts';
import { PhotoLibrarySessionV1 } from './controller/photo-library-session.ts';
import { initializeDefaultPhotoLibraryPointerV2 } from './storage/photo-library-default-initializer-v2.ts';
import { readPhotoLibrarySessionLocationV2 } from './storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from './storage/photo-library-namespace-lock-v1.ts';
import { createPhotoLibrarySelectedExclusiveV2 } from './storage/photo-library-selected-exclusive-v2.ts';
import { PhotoMediaStoreV1, type PhotoMediaSettingsRepositoryV1 } from './storage/photo-media-store.ts';
import { inspectPhotoMediaRestoreNamespaceV1 } from './storage/photo-media-restore-namespace-v1.ts';

export interface PhotoLibrarySessionRuntimeOptionsV2 {
	readonly name: string;
	readonly indexedDB?: IDBFactory;
	readonly locks?: LockManager | null;
	readonly signal?: AbortSignal;
	readonly recoverRestores?: (anchorSettings: PhotoMediaSettingsRepositoryV1, signal: AbortSignal) => Promise<void>;
}

/** Resolve the fixed settings anchor before constructing either selected resource. V1 bootstrap stays separate. */
export async function createPhotoLibrarySessionV2(options: PhotoLibrarySessionRuntimeOptionsV2): Promise<PhotoLibrarySessionV1> {
	const input = readClosedDomainRecord(options, 'photo library runtime', ['name', 'indexedDB', 'locks', 'signal', 'recoverRestores'], ['name']);
	const field = (key: string) => readClosedDomainField(input, key, 'photo library runtime');
	const catalogName = name(field('name'), 'catalog name');
	const factory = (Object.hasOwn(input, 'indexedDB') ? field('indexedDB') : globalThis.indexedDB) as IDBFactory | undefined;
	if (!factory || typeof factory.open !== 'function') throw new TypeError('A durable IndexedDB factory is required.');
	const locks = (Object.hasOwn(input, 'locks') ? field('locks') : globalThis.navigator?.locks ?? null) as LockManager | null;
	const signal = (Object.hasOwn(input, 'signal') ? field('signal') : undefined) as AbortSignal | undefined;
	const recover = Object.hasOwn(input, 'recoverRestores') ? field('recoverRestores') : undefined;
	if (recover !== undefined && typeof recover !== 'function') throw new TypeError('Photo library restore recovery must be callable.');
	return withPhotoSmartCollectionWriteSignalV1(signal, async privateSignal => {
		assertNotAborted(privateSignal);
		const anchor = new PhotoMediaStoreV1({ indexedDB: factory, locks });
		let media: PhotoMediaStoreV1 | null = null, catalog: PhotoCatalogRepositoryV1 | null = null;
		const closeResources = async () => {
			const owners = new Set<PhotoMediaStoreV1 | PhotoCatalogRepositoryV1>([anchor]);
			if (media) owners.add(media); if (catalog) owners.add(catalog);
			const results = await Promise.allSettled([...owners].map(owner => owner.close()));
			const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
			if (errors.length) throw new AggregateError(errors, 'Photo library resource cleanup failed.');
		};
		try {
			await anchor.ready(); assertNotAborted(privateSignal);
			// Recovery owns restore -> namespace -> brief initializer order; never lend it an initializer lease.
			if (recover) { await (recover as NonNullable<PhotoLibrarySessionRuntimeOptionsV2['recoverRestores']>)(anchor.settingsRepository, privateSignal ?? new AbortController().signal); assertNotAborted(privateSignal); }
			const selection = await withPhotoLibraryInitializationLockV1(locks, authority => readPhotoLibrarySessionLocationV2({
				settings: anchor.settingsRepository, initializeDefault: () => initializeDefaultPhotoLibraryPointerV2({
					settings: anchor.settingsRepository, indexedDB: factory, name: catalogName, authority }) }, authority.signal), privateSignal);
			assertNotAborted(privateSignal);
			const exclusive = createPhotoLibrarySelectedExclusiveV2(anchor.settingsRepository, selection, locks);
			await exclusive(selection.location.catalogId, async admitted => {
				if (selection.allocation) {
					const options = { indexedDB: factory, allocation: selection.allocation, signal: admitted };
					if (await inspectPhotoCatalogRestoreNamespaceV1(options) !== 'owned'
						|| await inspectPhotoMediaRestoreNamespaceV1(options) !== 'owned') throw new Error('Selected photo library allocation owner or namespace profile differs.');
				}
				assertNotAborted(admitted);
				media = selection.allocation ? new PhotoMediaStoreV1({ indexedDB: factory, locks,
					databaseName: selection.location.mediaDatabaseName, preferOpfs: false }) : anchor;
				catalog = new PhotoCatalogRepositoryV1({ indexedDB: factory, databaseName: selection.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
				await media.ready(); assertNotAborted(admitted);
				if (!await catalog.loadCatalog(selection.location.catalogId)) throw new ReferenceError('Selected photo library catalog is missing.');
				assertNotAborted(admitted);
			}, privateSignal);
			assertNotAborted(privateSignal);
			const selectedMedia = media!, selectedCatalog = catalog!, catalogId = selection.location.catalogId;
			const loadOriginal = selectedMedia.mediaRepository.loadAsset;
			return new PhotoLibrarySessionV1({ catalog: selectedCatalog, stacks: selectedCatalog, smartCollections: selectedCatalog,
				media: { writeAsset: selectedMedia.mediaRepository.writeAsset, custody: selectedMedia.mediaRepository.catalogOriginals },
				journal: selectedMedia.settingsRepository, settings: anchor.settingsRepository,
				developPresetSettings: selectedMedia.settingsRepository, exclusive,
				initialize: async admitted => { assertNotAborted(admitted); const root = await selectedCatalog.loadCatalog(catalogId);
					assertNotAborted(admitted); if (!root) throw new ReferenceError('Selected photo library catalog is missing.'); return root; },
				originalInspection: { inspect: (binding, admitted) => selectedMedia.mediaRepository.inspectCatalogOriginalBody(binding, { signal: admitted }) },
				originalRestoration: { restoreCatalogOriginalBody: (...args) => selectedMedia.mediaRepository.restoreCatalogOriginalBody(...args) },
				backup: { readSnapshot: selectedCatalog.readSnapshot.bind(selectedCatalog), captureSmartCollectionArchiveV1: selectedCatalog.captureSmartCollectionArchiveV1.bind(selectedCatalog),
					loadOriginal: async (original, admitted) => { await selectedMedia.verifyOriginal(original, admitted); assertNotAborted(admitted);
						return loadOriginal(original.storageKey, { signal: admitted, expectedSize: original.byteLength }); } },
				createPreviewScheduler: async id => { const { PhotoPreviewSchedulerV1 } = await import('./preview/photo-preview-scheduler-v1.ts');
					return new PhotoPreviewSchedulerV1({ catalogId: id, loadPhoto: photoId => selectedCatalog.loadPhoto(id, photoId),
						loadOriginal: (key, admitted) => loadOriginal(key, { signal: admitted }), cache: selectedMedia.getPreviewCache() }); },
				closeResources });
		} catch (primary) {
			try { await closeResources(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Photo library composition and cleanup failed.', { cause: cleanup }); }
			throw primary;
		}
	});
}
