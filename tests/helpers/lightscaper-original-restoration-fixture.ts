/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { PhotoLibraryOriginalRecoveryPortV1, PhotoLibraryOriginalRestoreTargetV1 } from '../../src/common/editor/photo-library-original-recovery-port-v1.ts';
import { openDatabase, request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { PhotoLibrarySessionV1 } from '../../src/lightscaper/controller/photo-library-session.ts';
import type { PhotoLibrarySessionPortsV1 } from '../../src/lightscaper/controller/photo-library-session-ports.ts';
import { importManagedPhotosV1 } from '../../src/lightscaper/import/managed-import-v1.ts';
import { photoImportIntentKeyV1 } from '../../src/lightscaper/import/import-intent-v1.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';

export async function originalRestorationFixture(context: TestContext, provisional = false) {
	const backing = createInstrumentedIndexedDB(), indexedDB = backing as unknown as IDBFactory;
	const mediaName = `lightscaper-restoration-${crypto.randomUUID()}`;
	const media = new PhotoMediaStoreV1({ indexedDB, databaseName: mediaName, locks: null, preferOpfs: false, syncWorkerClient: null });
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB, databaseName: `${mediaName}-catalog`, verifyOriginal: media.verifyOriginal });
	const source = photoArchiveFixture(), calls: string[] = [];
	const initial = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Recovery library', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	await catalog.createCatalog(initial);
	const managed = { catalog, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
		journal: media.settingsRepository, exclusive: async <Result>(_id: string, run: (signal?: AbortSignal) => Promise<Result>, signal?: AbortSignal) => run(signal) };
	if (provisional) {
		const stop = new AbortController();
		await assert.rejects(importManagedPhotosV1(initial.id, [source], { ...managed, createImportId: () => 'import-1',
			catalog: { loadCatalog: (...args) => catalog.loadCatalog(...args), loadPhoto: (...args) => catalog.loadPhoto(...args),
				publishPhotos: async (...args) => { const saved = await catalog.publishPhotos(...args); stop.abort(); return saved; } } }, { signal: stop.signal }), { name: 'AbortError' });
	} else {
		await media.mediaRepository.writeAsset(source.photo.original.storageKey, source.original,
			{ name: source.photo.original.name, mimeType: source.photo.original.mimeType });
		await media.mediaRepository.catalogOriginals.retain(initial.id, [{ photoId: source.photo.id, sourceId: source.photo.original.id,
			assetId: source.photo.original.storageKey, sha256: source.photo.original.contentSha256, size: source.original.size }]);
		await catalog.publishPhotos(initial.id, 0, [source.photo]);
	}
	const database = await openDatabase(indexedDB, mediaName);
	let active = false;
	let cleanup: () => Promise<void> = async () => undefined;
	const ports: { -readonly [Key in keyof PhotoLibrarySessionPortsV1]: PhotoLibrarySessionPortsV1[Key] } = {
		...managed,
		initialize: async () => { calls.push('initialize'); const root = await catalog.loadCatalog(initial.id); if (!root) throw new Error('Catalog missing'); return root; },
		exclusive: async (_id, run, signal) => {
			if (active) throw new Error('Nested catalog lease'); active = true; calls.push('lease');
			try { const result = await run(signal); await cleanup(); return result; }
			finally { active = false; calls.push('release'); }
		},
		originalInspection: { inspect: (binding, signal) => media.mediaRepository.inspectCatalogOriginalBody(binding, { signal }) },
		originalRestoration: { restoreCatalogOriginalBody: (...args) => {
			assert.equal(active, true); calls.push('restore'); return media.mediaRepository.restoreCatalogOriginalBody(...args);
		} },
		closeResources: async () => { calls.push('close'); await catalog.close(); await media.close(); },
	};
	const session = new PhotoLibrarySessionV1(ports) as PhotoLibrarySessionV1 & PhotoLibraryOriginalRecoveryPortV1;
	context.after(async () => { await session.close(); database.close(); });
	return { backing, mediaName, database, media, catalog, source, ports, session, calls,
		cleanup: (run: typeof cleanup) => { cleanup = run; },
		active: () => active,
		removeMediaRow: () => transact(database, 'mediaAssets', 'readwrite', ({ mediaAssets }) => request(mediaAssets.delete(source.photo.original.storageKey))),
		target: async (): Promise<PhotoLibraryOriginalRestoreTargetV1> => {
			let page = await session.inspectOriginals(); if (!page.rows.length && page.cursor) page = await session.inspectOriginals({ cursor: page.cursor });
			const row = page.rows[0]; assert.ok(row);
			return Object.freeze({ schemaVersion: 1, catalogRevision: page.revision, activeImportId: page.activeImportId,
				photoRevision: row.revision, binding: row.binding });
		},
		intent: () => media.settingsRepository.get(photoImportIntentKeyV1(initial.id)),
	};
}
