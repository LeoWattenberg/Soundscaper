/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopSettingsPortV1 } from '../../src/common/editor/photo-library-develop-settings-port-v1.ts';
import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { PhotoLibrarySessionV1 } from '../../src/lightscaper/controller/photo-library-session.ts';
import type { PhotoLibrarySessionPortsV1 } from '../../src/lightscaper/controller/photo-library-session-ports.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './instrumented-indexeddb-keys.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './lightscaper-catalog-query-fixture.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });
export const developBatchTime = '2026-10-09T12:00:00.000Z';

export async function developBatchFixture() {
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		databaseName: 'develop-batch', verifyOriginal: async () => undefined });
	await repository.createCatalog(queryCatalogRootV1());
	const photos = Array.from({ length: 3 }, (_, index) => queryPhotoV1(index));
	await repository.publishPhotos('catalog', 0, photos);
	const calls = { initialize: 0, locks: 0, close: 0 };
	const fail = async (): Promise<never> => { throw new Error('Unexpected media operation'); };
	const ports: { -readonly [Key in keyof PhotoLibrarySessionPortsV1]: PhotoLibrarySessionPortsV1[Key] } = {
		catalog: repository, initialize: async () => { calls.initialize++; return (await repository.loadCatalog('catalog'))!; },
		closeResources: async () => { calls.close++; },
		exclusive: async (_catalog, run, signal) => { calls.locks++; return run(signal); },
		journal: { get: async () => undefined, putIfAbsent: fail, deleteIfCurrent: fail },
		media: { writeAsset: fail, custody: { findDigestPage: fail, stage: fail, promote: fail, releaseStaged: fail, readPage: fail } },
	};
	const owner = new PhotoLibrarySessionV1(ports);
	const settings = (owner.develop as typeof owner.develop & { readonly settings: PhotoLibraryDevelopSettingsPortV1 }).settings;
	const targets = photos.map(photo => ({ photoId: photo.id, versionId: 'master', expectedRevision: 0 }));
	return { repository, owner, settings, photos, ports, calls, targets,
		close: async () => { await owner.close(); await repository.close(); } };
}
