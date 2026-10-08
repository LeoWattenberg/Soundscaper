/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { preparePhotoImportGestureV1 } from '../../src/lightscaper/import/photo-import-preparation-v1.ts';
import { importManagedPhotosV1 } from '../../src/lightscaper/import/managed-import-v1.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { openDefaultPhotoCatalogV1 } from '../../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { createPhotoLibrarySessionV1 } from '../../src/lightscaper/photo-library-session-runtime.ts';
import { PHOTO_LARGE_LIBRARY_SPECIFICATION_V1 as SPEC, PHOTO_LARGE_LIBRARY_PNG_BASE64_V1,
	createLargeLibraryPhotoBatchV1, largeLibraryPhotoIdV1 } from '../../src/lightscaper/quality/large-library-workload-v1.ts';

function owners() {
	const media = new PhotoMediaStoreV1(), catalog = new PhotoCatalogRepositoryV1({ indexedDB, verifyOriginal: media.verifyOriginal });
	return { media, catalog, close: async () => { await Promise.all([catalog.close(), media.close()]); } };
}

function file(name = 'Fixture.png') {
	return new File([Uint8Array.from(atob(PHOTO_LARGE_LIBRARY_PNG_BASE64_V1), character => character.charCodeAt(0))], name,
		{ type: 'image/png', lastModified: Date.UTC(2026, 9, 8, 12) });
}

async function hash(body: Blob) {
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await body.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Native catalog/custody setup: reuse one decoded original, independently of measured ordinary import. */
export async function seedLargePhotoLibraryNativeV1() {
	const f = owners(), started = performance.now();
	try {
		await f.media.ready();
		const initial = await openDefaultPhotoCatalogV1({ catalog: f.catalog, settings: f.media.settingsRepository }, { name: 'Large photo library' });
		if (initial.photoCount !== 0) throw new RangeError('Large-library setup requires an isolated empty catalog.');
		let root = await f.catalog.saveCatalog(normalizePhotoCatalogRootV1({ ...initial,
			folders: [{ id: 'folder-one', name: 'Fixture folder', parentId: null }],
			keywords: [{ id: 'landscape', name: 'Landscape', parentId: null }],
			collections: [{ id: 'manual', name: 'Fixture collection', kind: 'manual' },
				{ id: 'smart', name: 'Fixture picks', kind: 'smart', query: { kind: 'all', terms: [
					{ kind: 'rating', minimum: 4, maximum: 5 }, { kind: 'keyword', id: 'landscape' },
					{ kind: 'not', term: { kind: 'flag', value: 'reject' } },
				] } }],
		}), initial.revision);
		const source = file();
		const prepared = preparePhotoImportGestureV1({ files: [source], catalog: root, createdAt: '2026-10-08T12:00:00.000Z',
			ownership: [{ photoId: largeLibraryPhotoIdV1(0), originalId: 'large-original-source', originalStorageKey: 'large-original-storage', masterVersionId: 'large-master-00000' }] });
		let maximumPublishedBatchPhotos = 0;
		for await (const outcome of prepared) {
			if (outcome.outcome !== 'prepared') throw outcome.error;
			const first = createLargeLibraryPhotoBatchV1(outcome.photo, 0)[0]!;
			const receipts = await importManagedPhotosV1(root.id, [{ photo: first, original: outcome.original }], {
				catalog: f.catalog, media: { writeAsset: f.media.mediaRepository.writeAsset, custody: f.media.mediaRepository.catalogOriginals }, journal: f.media.settingsRepository,
			});
			if (receipts.length !== 1 || receipts[0]?.status !== 'imported') throw new Error('Large-library initial original publication failed.');
			root = (await f.catalog.loadCatalog(root.id))!;
			for (let offset = 1; offset < SPEC.photoCount; offset += SPEC.publicationBatchSize) {
				const batch = createLargeLibraryPhotoBatchV1(outcome.photo, offset);
				maximumPublishedBatchPhotos = Math.max(maximumPublishedBatchPhotos, batch.length);
				await f.media.mediaRepository.catalogOriginals.retain(root.id, batch.map(photo => ({ photoId: photo.id,
					assetId: photo.original.storageKey, sourceId: photo.original.id, sha256: photo.original.contentSha256, size: photo.original.byteLength })));
				root = await f.catalog.publishPhotos(root.id, root.revision, batch);
			}
			const body = await f.media.mediaRepository.loadAsset(first.original.storageKey);
			if (!(body instanceof Blob)) throw new Error('Fixture original is missing after native publication.');
			const originalActualSha256 = await hash(body);
			if (root.photoCount !== SPEC.photoCount || originalActualSha256 !== SPEC.sourceSha256) throw new Error('Native fixture differs from its pinned source/count.');
			return { catalogId: root.id, photoCount: root.photoCount, maximumPublishedBatchPhotos, sourceByteLength: body.size,
				originalActualSha256, setupDurationMs: performance.now() - started, firstPhotoId: first.id,
				lastPhotoId: largeLibraryPhotoIdV1(SPEC.photoCount - 1), filenameAscendingFirst: largeLibraryPhotoIdV1(SPEC.photoCount - 1) };
		}
		throw new Error('Fixture preparation returned no source.');
	} finally { await f.close(); }
}

/** Normal production gesture against the populated catalog; no fixture preparation bypasses this measurement. */
export async function measureLargePhotoLibraryImportNativeV1(trial: number) {
	if (!Number.isInteger(trial) || trial < 0 || trial > 5) throw new RangeError('Import measurement is bounded to one warm-up and five trials.');
	const session = createPhotoLibrarySessionV1({ name: 'Large photo library' });
	try {
		const before = await session.readPage();
		if (before.totalCount < SPEC.photoCount) throw new RangeError('Measured import requires the populated fixture.');
		const selected = Array.from({ length: 64 }, (_, index) => file(`Measured-${trial}-${String(index).padStart(2, '0')}.png`));
		const started = performance.now(), receipts = await session.importFiles(selected);
		const durationMs = performance.now() - started, after = await session.readPage();
		if (receipts.length !== 64 || receipts.some(receipt => receipt.status !== 'imported' || !receipt.reusedOriginal)
			|| after.totalCount !== before.totalCount + 64) throw new Error('Measured native import lost a photo or duplicated original bytes.');
		return { durationMs, beforeCount: before.totalCount, afterCount: after.totalCount, imported: receipts.length };
	} finally { await session.close(); }
}

export async function observeLargePhotoLibraryQueryNativeV1() {
	const session = createPhotoLibrarySessionV1({ name: 'Large photo library' });
	try {
		let cursor: string | null = null, maximumCandidatePhotos = 0, steps = 0, matches = 0, resultId: string | null = null;
		const started = performance.now();
		do {
			const page = await session.readQueryStep({ query: { text: SPEC.sparseSearchText, sort: { field: 'photo-id', direction: 'ascending' }, filter: null }, cursor });
			maximumCandidatePhotos = Math.max(maximumCandidatePhotos, page.scanned); matches += page.rows.length;
			if (page.rows.length) resultId = page.rows[0]!.id;
			cursor = page.cursor;
			if (++steps > Math.ceil((SPEC.photoCount + 384) / SPEC.presentationPageSize) + 2) throw new RangeError('Sparse fixture query failed to advance within its candidate bound.');
		} while (cursor !== null);
		return { matches, resultId, maximumCandidatePhotos, steps, durationMs: performance.now() - started };
	} finally { await session.close(); }
}

/** Read-only post-interaction digest of the exact fixture original. */
export async function observeLargePhotoLibraryOriginalNativeV1() {
	const f = owners();
	try {
		await f.media.ready();
		const root = await openDefaultPhotoCatalogV1({ catalog: f.catalog, settings: f.media.settingsRepository }, { name: 'Large photo library' });
		const photo = await f.catalog.loadPhoto(root.id, largeLibraryPhotoIdV1(0));
		if (!photo) throw new ReferenceError('The fixture original owner is missing.');
		const body = await f.media.mediaRepository.loadAsset(photo.original.storageKey);
		if (!(body instanceof Blob)) throw new ReferenceError('The fixture original body is missing.');
		return { sourceByteLength: body.size, originalActualSha256: await hash(body) };
	} finally { await f.close(); }
}
