/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { preparePhotoImportGestureV1 } from '../../src/lightscaper/import/photo-import-preparation-v1.ts';
import { importManagedPhotosV1 } from '../../src/lightscaper/import/managed-import-v1.ts';
import { PhotoMediaStoreV1, PHOTO_MEDIA_NAMESPACES_V1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { openDefaultPhotoCatalogV1 } from '../../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { createPhotoLibrarySessionV1 } from '../../src/lightscaper/photo-library-session-runtime.ts';
import { openPhotoCatalogDatabaseV1 } from '../../src/lightscaper/catalog/catalog-database.ts';
import { PHOTO_CATALOG_DATABASE_VERSION, PHOTO_CATALOG_STORES } from '../../src/lightscaper/catalog/repository-types.ts';
import { PHOTO_QUERY_INDEXES_V1 } from '../../src/lightscaper/catalog/photo-query-index-v1.ts';
import { PHOTO_QUERY_INDEXES_V2 } from '../../src/lightscaper/catalog/photo-query-index-v2.ts';
import { openDatabase, request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { isMediaContentToken, trustedMediaContentSha256 } from '../../src/common/editor/storage/media-content-provenance.ts';
import type { StorageRecord } from '../../src/common/editor/storage/media-records.ts';
import { publishLargePhotoLibrarySeedBatchV1 } from './lightscaper-large-library-seed-publication.ts';
import { formatLargePhotoLibrarySeedPhaseV1, PHOTO_LIBRARY_SEED_DIAGNOSTIC_KIND_V1,
	createLargePhotoLibraryQueryTransactionObserverV1 } from './lightscaper-large-library-seed-diagnostic.ts';
import type { PhotoLibrarySeedPhaseV1, PhotoLibraryQueryTransactionObservationV1 } from './lightscaper-large-library-seed-diagnostic.ts';
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

async function assertSeedSchema(database: IDBDatabase) {
	if (database.version !== PHOTO_CATALOG_DATABASE_VERSION
		|| JSON.stringify(Array.from(database.objectStoreNames).sort()) !== JSON.stringify([...PHOTO_CATALOG_STORES].sort())) {
		throw new Error('Native seed catalog differs from the exact production schema.');
	}
	await transact(database, ['photoQueryRows', 'photoQueryRowsV2'], 'readonly', stores => {
		for (const [name, indexes] of [['photoQueryRows', PHOTO_QUERY_INDEXES_V1], ['photoQueryRowsV2', PHOTO_QUERY_INDEXES_V2]] as const) {
			const store = stores[name];
			if (store.keyPath !== 'key' || store.autoIncrement
				|| JSON.stringify(Array.from(store.indexNames).sort()) !== JSON.stringify(['catalogId', ...Object.keys(indexes)].sort())) throw new Error('Native query index inventory changed.');
			for (const [sort, fields] of [['catalogId', 'catalogId'], ...Object.entries(indexes)] as const) {
				const index = store.index(sort);
				if (JSON.stringify(index.keyPath) !== JSON.stringify(fields) || index.unique || index.multiEntry) throw new Error('Native query index geometry changed.');
			}
		}
	});
}

/** One point read after owning readiness; no root/body inventory is materialized. */
async function originalCustody(assetId: string) {
	const database = await openDatabase(indexedDB, PHOTO_MEDIA_NAMESPACES_V1.databaseName);
	try {
		return await transact(database, 'mediaAssets', 'readonly', async stores => {
			const record = await request(stores.mediaAssets.get(assetId)) as StorageRecord | undefined;
			if (!record || record.sourceId !== assetId || !isMediaContentToken(record.mediaContentToken)
				|| trustedMediaContentSha256(record) !== SPEC.sourceSha256 || record.size !== SPEC.sourceByteLength
				|| !Number.isSafeInteger(record.catalogRootCount)) throw new Error('Native original custody differs from the pinned fixture.');
			return { token: record.mediaContentToken, storage: record.storage, path: record.path, roots: record.catalogRootCount };
		});
	} finally { database.close(); }
}

let queryObservation: PhotoLibraryQueryTransactionObservationV1 | null = null;
export function startLargePhotoLibraryQueryTransactionObservationV1(): void {
	if (queryObservation) throw new RangeError('A query diagnostic is already active.');
	queryObservation = createLargePhotoLibraryQueryTransactionObserverV1(IDBDatabase.prototype, 'lightscaper-photo-catalog-v1');
}
export function finishLargePhotoLibraryQueryTransactionObservationV1() {
	if (!queryObservation) throw new ReferenceError('No query diagnostic is active.');
	const observation = queryObservation; queryObservation = null;
	observation.stop(); return observation.snapshot();
}

/** Native catalog/custody setup: reuse one decoded original, independently of measured ordinary import. */
export async function seedLargePhotoLibraryNativeV1() {
	const f = owners(), started = performance.now();
	const elapsed = () => Math.round(performance.now() - started);
	const mark = (phase: Exclude<PhotoLibrarySeedPhaseV1['phase'], 'publication-progress'>, event: 'begin' | 'end', from: number | null = null) => {
		console.log(formatLargePhotoLibrarySeedPhaseV1({ kind: PHOTO_LIBRARY_SEED_DIAGNOSTIC_KIND_V1, schemaVersion: 1,
			phase, event, elapsedMs: elapsed(), durationMs: from === null ? null : Math.round(performance.now() - from) }));
	};
	try {
		mark('readiness', 'begin');
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
		mark('readiness', 'end', started);
		const managedStarted = performance.now(); mark('managed-import', 'begin');
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
			const beforeCustody = await originalCustody(first.original.storageKey);
			if (beforeCustody.roots !== 1) throw new Error('Initial managed original must retain one catalog root.');
			mark('managed-import', 'end', managedStarted);
			const schemaStarted = performance.now(); mark('schema', 'begin');
			const database = await openPhotoCatalogDatabaseV1(indexedDB, 'lightscaper-photo-catalog-v1', () => undefined);
			const retain = f.media.mediaRepository.catalogOriginals.retain.bind(f.media.mediaRepository.catalogOriginals);
			const trace = { photos: 0, nativeTransactions: 0, pointReads: 0, nativeWrites: 0,
				maximumResidentPhotos: 0, maximumAdmittedBytes: 0, getAllRequests: 0, cursorRequests: 0 };
			let retainDurationMs = 0, publicationDurationMs = 0, nextProgress = 5000;
			try {
				await assertSeedSchema(database);
				mark('schema', 'end', schemaStarted);
				for (let offset = 1; offset < SPEC.photoCount; offset += SPEC.publicationBatchSize) {
					const publicationStarted = performance.now(), previousRetain = retainDurationMs;
					if (offset === 1) mark('first-publication', 'begin');
					const batch = createLargeLibraryPhotoBatchV1(outcome.photo, offset);
					maximumPublishedBatchPhotos = Math.max(maximumPublishedBatchPhotos, batch.length);
					const result = await publishLargePhotoLibrarySeedBatchV1(database, root, batch, async photos => {
						const retainStarted = performance.now();
						if (offset === 1) mark('first-retain', 'begin');
						await retain(root.id, photos.map(photo => ({ photoId: photo.id, assetId: photo.original.storageKey,
							sourceId: photo.original.id, sha256: photo.original.contentSha256, size: photo.original.byteLength })));
						retainDurationMs += performance.now() - retainStarted;
						if (offset === 1) mark('first-retain', 'end', retainStarted);
					});
					publicationDurationMs += Math.max(0, performance.now() - publicationStarted - (retainDurationMs - previousRetain));
					if (offset === 1) mark('first-publication', 'end', publicationStarted);
					root = result.root;
					for (const key of ['photos', 'nativeTransactions', 'pointReads', 'nativeWrites', 'getAllRequests', 'cursorRequests'] as const) trace[key] += result.trace[key];
					trace.maximumResidentPhotos = Math.max(trace.maximumResidentPhotos, result.trace.maximumResidentPhotos);
					trace.maximumAdmittedBytes = Math.max(trace.maximumAdmittedBytes, result.trace.admittedBytes);
					if (root.photoCount >= nextProgress) {
						console.log(formatLargePhotoLibrarySeedPhaseV1({ kind: PHOTO_LIBRARY_SEED_DIAGNOSTIC_KIND_V1, schemaVersion: 1,
							phase: 'publication-progress', event: 'progress', elapsedMs: elapsed(), durationMs: null,
							photoCount: root.photoCount, batchCount: trace.nativeTransactions, retainDurationMs: Math.round(retainDurationMs),
							publicationDurationMs: Math.round(publicationDurationMs), pointReads: trace.pointReads, nativeWrites: trace.nativeWrites,
							maximumResidentPhotos: trace.maximumResidentPhotos, maximumAdmittedBytes: trace.maximumAdmittedBytes,
							getAllRequests: trace.getAllRequests, cursorRequests: trace.cursorRequests }));
						nextProgress += 5000;
					}
				}
			} finally { database.close(); }
			const custodyStarted = performance.now(); mark('final-custody', 'begin');
			const afterCustody = await originalCustody(first.original.storageKey);
			if (afterCustody.roots !== SPEC.photoCount || afterCustody.token !== beforeCustody.token
				|| afterCustody.storage !== beforeCustody.storage || afterCustody.path !== beforeCustody.path) throw new Error('Seed publication changed original identity or custody count.');
			mark('final-custody', 'end', custodyStarted);
			const digestStarted = performance.now(); mark('digest', 'begin');
			const body = await f.media.mediaRepository.loadAsset(first.original.storageKey);
			if (!(body instanceof Blob)) throw new Error('Fixture original is missing after native publication.');
			const originalActualSha256 = await hash(body);
			if (root.photoCount !== SPEC.photoCount || originalActualSha256 !== SPEC.sourceSha256) throw new Error('Native fixture differs from its pinned source/count.');
			mark('digest', 'end', digestStarted);
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
