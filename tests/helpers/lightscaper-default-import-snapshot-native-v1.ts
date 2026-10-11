/* SPDX-License-Identifier: AGPL-3.0-only */

import { openDatabase, request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { normalizeCatalogOriginalRoot, type CatalogOriginalReferenceV1 } from '../../src/common/editor/storage/media-catalog-original-schema.ts';
import type { StorageRecord } from '../../src/common/editor/storage/media-records.ts';
import type { VideoCubeLutReferenceV1 } from '../../src/common/editor/video-color-cube-lut-v27.ts';
import { openPhotoCatalogDatabaseV1 } from '../../src/lightscaper/catalog/catalog-database.ts';
import { normalizePhotoDocumentV1OrV2 } from '../../src/lightscaper/catalog/photo-document-v2.ts';
import { readStoredPhotoV1OrV2 } from '../../src/lightscaper/catalog/photo-catalog-records-v2.ts';
import { PhotoCatalogRepositoryV2 } from '../../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { readPhotoQueryRowV1, readPhotoQueryBuildStateV1 } from '../../src/lightscaper/catalog/photo-query-index-v1.ts';
import { readPhotoQueryRowV2 } from '../../src/lightscaper/catalog/photo-query-index-v2.ts';
import { readPhotoQueryBuildStateV2 } from '../../src/lightscaper/catalog/photo-query-index-storage-v2.ts';
import { readPhotoSummary } from '../../src/lightscaper/catalog/repository-records.ts';
import { normalizePhotoImportIntentV1, photoImportIntentKeyV1 } from '../../src/lightscaper/import/import-intent-v1.ts';
import { photoDevelopPresetsKeyV1 } from '../../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { normalizePhotoDevelopPresetRowV1OrV2 } from '../../src/lightscaper/storage/photo-develop-preset-row-v2.ts';
import { readPhotoLibrarySessionLocationV2, type PhotoLibrarySessionLocationV2 } from '../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { PHOTO_MEDIA_NAMESPACES_V1 as NAMES, PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';

export const DEFAULT_IMPORT_PRIOR_PNG_V1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQlNf/DwACAwFflwzAewAAAABJRU5ErkJggg==';
export const DEFAULT_IMPORT_CURRENT_PNG_V1 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAHElEQVR4nGP4z8DwHwyB9P/qV7pAuuF//X+gCACcuAyINRgO7QAAAABJRU5ErkJggg==';
export const DEFAULT_IMPORT_CURRENT_SHA256_V1 = 'fdfe0f7d2f827ae8200625a0d5f4c21ee47a2e037b6f6a22fcd36c5012e5614c';
export const DEFAULT_IMPORT_CUBE_V1 = new TextEncoder().encode('LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n');
export const DEFAULT_IMPORT_SETTINGS_V1 = Object.freeze({ rename: Object.freeze({ template: 'received-{sequence}.{extension}', sequenceStart: 7, sequencePadding: 3 }),
	metadata: Object.freeze({ title: 'Default current import', caption: 'Default publication proof', creator: 'Lightscaper native fixture' }), keywordIds: Object.freeze([]) });
export interface DefaultImportLedgerV1 {
	readonly body: boolean; readonly photo: boolean; readonly staged: boolean; readonly retained: boolean; readonly journal: boolean;
}
export type DefaultImportSnapshotV1 = Awaited<ReturnType<typeof readDefaultImportSnapshotNativeV1>>;
export type NativeOutcomeV1<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: unknown };

export async function readDefaultImportSelectionNativeV1(factory: IDBFactory): Promise<Readonly<PhotoLibrarySessionLocationV2>> {
	const anchor = new PhotoMediaStoreV1({ indexedDB: factory, locks: navigator.locks });
	const result = await nativeOutcomeV1(withPhotoLibraryInitializationLockV1(navigator.locks, authority => readPhotoLibrarySessionLocationV2({
		settings: anchor.settingsRepository, initializeDefault: () => Promise.reject(new Error('Qualification selection may not initialize a library.')) }, authority.signal)));
	const cleanup = await nativeOutcomeV1(anchor.close());
	if (!cleanup.ok) throw new AggregateError([...(!result.ok ? [result.error] : []), cleanup.error], 'Selection cleanup failed.');
	if (!result.ok) throw result.error; return result.value;
}

/** Independent bounded readonly owners inspect state before Session readiness can recover its journal. */
export async function readDefaultImportSnapshotNativeV1(factory: IDBFactory, selected: Readonly<PhotoLibrarySessionLocationV2>,
	priorId: string, priorBytes: Uint8Array, currentBytes: Uint8Array, reference: Readonly<VideoCubeLutReferenceV1>, companion: () => Promise<void>, currentReference: Readonly<CatalogOriginalReferenceV1> | null, path: string | null) {
	nativeCheckV1(selected.allocation === null && selected.pointer.schemaVersion === 1, 'Snapshot requires the actual default profile.');
	const location = selected.location, media = new PhotoMediaStoreV1({ indexedDB: factory, locks: navigator.locks,
		databaseName: location.mediaDatabaseName, preferOpfs: true });
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB: factory, databaseName: location.catalogDatabaseName, verifyOriginal: media.verifyOriginal,
		verifyResources: async (photo, signal) => { await (await media.getCubeLutResources()).verifyPhoto(photo, signal); } });
	const result = await nativeOutcomeV1(read()), failures: unknown[] = [];
	// A default snapshot really opens an original-file worker. Join its ordinary
	// companion before retiring that owner, including when the read failed.
	try { await companion(); } catch (error) { failures.push(error); }
	try { await catalog.close(); } catch (error) { failures.push(error); }
	try { await media.close(); } catch (error) { failures.push(error); }
	if (failures.length) throw new AggregateError([...(!result.ok ? [result.error] : []), ...failures], 'Import snapshot cleanup failed.', !result.ok ? { cause: result.error } : undefined);
	if (!result.ok) throw result.error; return result.value;

	async function read() {
		const snapshot = await catalog.readSnapshot(location.catalogId);
		nativeCheckV1(snapshot !== null, 'Selected catalog snapshot is missing.');
		const projectionStores = ['photos', 'summaries', 'memberships', 'photoQueryRows', 'photoQueryRowsV2', 'photoQueryBuildStates', 'photoQueryBuildStatesV2'] as const;
		const projected = await database(location.catalogDatabaseName, projectionStores, async stores => {
			const records = await Promise.all(projectionStores.map(name => request(store(stores, name).getAll(undefined, name === 'memberships' ? 7 : 3)) as Promise<unknown[]>));
			return Object.fromEntries(projectionStores.map((name, index) => [name, records[index]!])) as Record<typeof projectionStores[number], unknown[]>;
		});
		const documents = projected.photos;
		nativeCheckV1(documents.length >= 1 && documents.length <= 2 && snapshot.catalog.photoCount === documents.length, 'Complete bounded Photo inventory differs from its catalog root.');
		const photos = documents.map(value => normalizePhotoDocumentV1OrV2(readStoredPhotoV1OrV2(value)));
		const expectedSummaries = photos.map(photo => readPhotoSummary({ key: `${photo.catalogId}|${photo.id}`, catalogId: photo.catalogId, photoId: photo.id,
			photoRevision: photo.revision, fileName: photo.metadata.fileName, captureLocal: photo.metadata.captureTime?.local ?? null, rating: photo.rating, flag: photo.flag,
			colorLabel: photo.colorLabel, folderId: photo.folderId, activeVersionId: photo.activeVersionId, originalSha256: photo.original.contentSha256, width: photo.original.width, height: photo.original.height }));
		const expectedRows2 = photos.map((photo, index) => {
			const { fileName: _fileName, captureLocal: _captureLocal, ...identity } = expectedSummaries[index]!;
			return readPhotoQueryRowV2({ ...identity, ...photo.metadata, schemaVersion: 2, keywordIds: photo.keywordIds, collectionIds: photo.collectionIds,
				fileNameSort: photo.metadata.fileName.toLowerCase(), captureBucket: photo.metadata.captureTime === null ? 1 : 0, captureSort: photo.metadata.captureTime?.local ?? '', ratingSort: photo.rating });
		});
		const expectedRows1 = photos.map((photo, index) => readPhotoQueryRowV1({ schemaVersion: 1, key: expectedSummaries[index]!.key, catalogId: photo.catalogId, photoId: photo.id,
			summary: expectedSummaries[index], title: photo.metadata.title, caption: photo.metadata.caption, creator: photo.metadata.creator, location: photo.metadata.location,
			keywordIds: photo.keywordIds, collectionIds: photo.collectionIds, fileNameSort: photo.metadata.fileName.toLowerCase(), captureBucket: photo.metadata.captureTime === null ? 1 : 0,
			captureSort: photo.metadata.captureTime?.local ?? '', ratingSort: photo.rating }));
		const memberships = photos.flatMap(photo => {
			nativeCheckV1(photo.rating === 0 && photo.flag === 'unflagged' && photo.colorLabel === 'none' && photo.folderId === null && photo.keywordIds.length === 0 && photo.collectionIds.length === 0,
				'This native fixture must retain neutral culling and no authored memberships.');
			return ['rating|0', 'flag|unflagged', 'label|none'].map(value => { const scope = `${photo.catalogId}|${value}`; return { key: `${scope}|${photo.id}`, scope, photoKey: `${photo.catalogId}|${photo.id}` }; });
		});
		nativeCheckV1(exactRows(projected.summaries.map(readPhotoSummary), expectedSummaries) && exactRows(projected.photoQueryRows.map(readPhotoQueryRowV1), expectedRows1)
			&& exactRows(projected.photoQueryRowsV2.map(readPhotoQueryRowV2), expectedRows2) && exactRows(projected.memberships, memberships), 'Complete raw summary/query/membership projection differs from full Photo facts.');
		nativeCheckV1(projected.photoQueryBuildStates.length === 1 && projected.photoQueryBuildStatesV2.length === 1, 'Both native query build states must be present exactly once.');
		const build1 = readPhotoQueryBuildStateV1(projected.photoQueryBuildStates[0], location.catalogId), build2 = readPhotoQueryBuildStateV2(projected.photoQueryBuildStatesV2[0], location.catalogId);
		nativeCheckV1(build1.indexedCount === photos.length && build2.indexedCount === photos.length && build1.afterKey === null && build2.afterKey === null,
			'Full native query build counts or cursor disagree with the complete tiny Photo inventory.');
		const prior = photos.find(photo => photo.id === priorId), current = photos.find(photo => photo.id !== priorId) ?? null;
		nativeCheckV1(prior !== undefined && prior.schemaVersion === 1 && prior.versions[0]?.develop.processVersion === 1, 'Actual donor must remain a complete process-one Photo.');
		const raw = await database(location.mediaDatabaseName, ['mediaAssets', 'catalogOriginalRoots', 'videoDerivatives', 'videoDerivativeCacheEntries', 'mediaAssetStaging'], async stores => {
			const [assets, roots, payloads, inventories, staging] = await Promise.all([request(store(stores, 'mediaAssets').getAll(undefined, 3)) as Promise<StorageRecord[]>,
				request(store(stores, 'catalogOriginalRoots').getAll(undefined, 4)) as Promise<unknown[]>, request(store(stores, 'videoDerivatives').count()), request(store(stores, 'videoDerivativeCacheEntries').count()), request(store(stores, 'mediaAssetStaging').getAll(undefined, 2)) as Promise<unknown[]>]);
			// Native schema creation seeds this exact state row; no lease or extra row belongs to this fixture.
			nativeCheckV1(assets.length >= 1 && assets.length <= 2 && roots.length <= 3 && payloads === 0 && inventories === 0
				&& nativeSameV1(staging, [{ key: 'state', kind: 'state', generation: 'initial' }]), `Native original/custody/cache inventory exceeds its fixture closure: ${JSON.stringify({ assets: assets.length, roots: roots.length, payloads, inventories })}`);
			return { assets, roots: roots.map(normalizeCatalogOriginalRoot), cacheJson: JSON.stringify([payloads, inventories, staging]) };
		});
		const originalRecord = raw.assets.find(asset => asset.sourceId === prior.original.storageKey);
		nativeCheckV1(originalRecord !== undefined, 'Selected donor original record is missing.');
		const currentRecord = raw.assets.find(asset => asset.sourceId !== prior.original.storageKey) ?? null;
		if (currentRecord) nativeCheckV1(currentRecord.sha256 === DEFAULT_IMPORT_CURRENT_SHA256_V1 && currentRecord.size === currentBytes.length
			&& currentRecord.storage === 'opfs' && typeof currentRecord.path === 'string' && currentRecord.path === path && currentRecord.blob === undefined,
		'Default new original must be the authentic OPFS record and captured path.');
		nativeCheckV1(originalRecord.storage === 'opfs' && typeof originalRecord.path === 'string', 'Preexisting default original must retain its real OPFS path.');
		const priorFile = await file(originalRecord.path, priorBytes), currentFile = await file(path, currentBytes);
		nativeCheckV1(priorFile.present && currentFile.present === (currentRecord !== null), 'Physical paths and immutable original records disagree.');
		const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(NAMES.opfsDirectoryName);
		const paths: string[] = []; for await (const entry of (directory as FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> }).keys()) {
			paths.push(entry); nativeCheckV1(paths.length <= 2, 'Original directory exceeds the complete two-file closure.'); }
		nativeCheckV1(nativeSameV1(paths.sort(), [originalRecord.path, ...(currentRecord ? [path!] : [])].sort()), 'Complete physical original inventory has an untracked path.');
		const priorBody = await body(prior.original.storageKey, priorBytes), currentBody = currentRecord ? await body(String(currentRecord.sourceId), currentBytes) : null;
		await media.verifyOriginal(prior.original);
		const priorToken = token(originalRecord), currentToken = currentRecord ? token(currentRecord) : null;
		for (const root of raw.roots) {
			const asset = raw.assets.find(value => value.sourceId === root.assetId);
			nativeCheckV1(asset !== undefined && root.catalogId === location.catalogId && root.mediaContentToken === token(asset)
				&& root.sha256 === asset.sha256 && root.size === asset.size, 'Custody root differs from its authenticated original/token.');
		}
		for (const asset of raw.assets) nativeCheckV1(Number(asset.catalogRootCount ?? 0) === raw.roots.filter(root => root.assetId === asset.sourceId).length,
			'Native original root count differs from the complete actual custody inventory.');
		const permanent = await media.mediaRepository.catalogOriginals.readPage({ catalogId: location.catalogId });
		nativeCheckV1(permanent.afterKey === null && nativeSameV1(permanent.roots, raw.roots.filter(root => root.importId === null)), 'Public permanent custody projection is incomplete or differs from native rows.');
		const priorRoots = raw.roots.filter(root => root.photoId === priorId);
		nativeCheckV1(priorRoots.length === 1 && priorRoots[0]?.importId === null && priorRoots[0].assetId === prior.original.storageKey && priorRoots[0].sourceId === prior.original.id,
			'The donor Photo must retain its exact permanent original root.');
		const currentRoots = raw.roots.filter(root => root.photoId !== priorId);
		nativeCheckV1(currentRoots.length <= 1 && (currentRoots.length === 0 || currentRecord !== null && currentRoots[0]?.assetId === currentRecord.sourceId), 'Current custody cannot be duplicated or retain another original.');
		for (const root of currentRoots) nativeCheckV1(currentReference !== null && root.photoId === currentReference.photoId && root.sourceId === currentReference.sourceId
			&& root.assetId === currentReference.assetId && root.sha256 === currentReference.sha256 && root.size === currentReference.size,
			'Current custody differs from the actual captured stage reference.');
		if (current) { nativeCheckV1(current.original.storageKey === currentRecord?.sourceId && current.original.contentSha256 === DEFAULT_IMPORT_CURRENT_SHA256_V1,
			'Published current Photo differs from the authentic default original.');
			for (const root of currentRoots) nativeCheckV1(root.photoId === current.id && root.sourceId === current.original.id, 'Current custody logical IDs differ from the complete published Photo.');
			await media.verifyOriginal(current.original); }
		const resources = await media.getCubeLutResources(), presetRow = normalizePhotoDevelopPresetRowV1OrV2(await media.settingsRepository.get(photoDevelopPresetsKeyV1(location.catalogId)), location.catalogId);
		nativeCheckV1(presetRow.schemaVersion === 2 && presetRow.presets.length === 1, 'Default full process-two preset is missing.');
		await resources.verifyPreset(presetRow.presets[0]); if (current) await resources.verifyPhoto(current);
		const lutSha256 = await resources.source.withBytes(reference, async bytes => { nativeCheckV1(nativeBytesEqualV1(bytes, DEFAULT_IMPORT_CUBE_V1), 'Disabled LUT bytes changed.'); return nativeDigestV1(bytes); });
		const journalValue = await media.settingsRepository.get(photoImportIntentKeyV1(location.catalogId));
		const journal = journalValue === undefined ? null : normalizePhotoImportIntentV1(journalValue, location.catalogId);
		for (const root of currentRoots) nativeCheckV1(root.importId === null || root.importId === journal?.importId, 'Provisional root lacks its exact selected import intent.');
		const ledger: DefaultImportLedgerV1 = Object.freeze({ body: currentRecord !== null, photo: current !== null,
			staged: currentRoots.some(root => root.importId !== null), retained: currentRoots.some(root => root.importId === null), journal: journal !== null });
		const immutableRecord = currentRecord === null ? null : { ...currentRecord }; if (immutableRecord !== null) delete immutableRecord.catalogRootCount;
		return { ledger, catalogJson: JSON.stringify(snapshot), catalogRevision: snapshot.catalog.revision, indexRevision: snapshot.indexRevision, build1, build2,
			prior, priorMetadata: await media.mediaRepository.getAssetMetadata(prior.original.storageKey),
			priorRecordJson: JSON.stringify(originalRecord), priorToken, priorRootsJson: JSON.stringify(priorRoots), priorBody, cacheJson: raw.cacheJson,
			current, currentRecordJson: JSON.stringify(currentRecord), currentImmutableRecordJson: JSON.stringify(immutableRecord), currentMetadata: currentRecord ? await media.mediaRepository.getAssetMetadata(String(currentRecord.sourceId)) : null,
			currentToken, currentFile, priorFile, currentRootsJson: JSON.stringify(currentRoots), currentBody,
			presetRow, lutSha256, journalJson: JSON.stringify(journal), stateJson: JSON.stringify({ snapshot, photos, projected, assets: raw.assets, roots: raw.roots, presetRow, journal }) };
	}
	async function file(path: string | null, expected: Uint8Array) {
		if (path === null) return { present: false, sha256: null, byteLength: null };
		const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(NAMES.opfsDirectoryName);
		let file: File; try { file = await (await directory.getFileHandle(path)).getFile(); }
		catch (error) { if (notFound(error)) return { present: false, sha256: null, byteLength: null }; throw error; }
		nativeCheckV1(file.size === expected.length, 'Actual OPFS original file has an unexpected size.');
		const bytes = new Uint8Array(await file.arrayBuffer());
		try { nativeCheckV1(nativeBytesEqualV1(bytes, expected), 'Actual OPFS original file differs from literal encoded bytes.');
			return { present: true, sha256: await nativeDigestV1(bytes), byteLength: bytes.length }; } finally { bytes.fill(0); }
	}
	async function body(key: string, expected: Uint8Array) {
		const blob = await media.mediaRepository.loadAsset(key); nativeCheckV1(blob !== null && blob.size === expected.length, 'Native immutable original body is missing.');
		const bytes = new Uint8Array(await blob.arrayBuffer());
		try { nativeCheckV1(nativeBytesEqualV1(bytes, expected), 'Encoded original bytes differ from the independent literal.'); return { sha256: await nativeDigestV1(bytes), byteLength: bytes.length }; }
		finally { bytes.fill(0); }
	}
	async function database<Value>(name: string, names: readonly string[], run: (stores: Readonly<Record<string, IDBObjectStore>>) => Promise<Value>): Promise<Value> {
		const database = name === location.catalogDatabaseName ? await openPhotoCatalogDatabaseV1(factory, name, () => undefined) : await openDatabase(factory, name);
		try { return await transact(database, names, 'readonly', run); } finally { database.close(); }
	}
}

export function nativeOutcomeV1<Value>(work: Promise<Value>): Promise<NativeOutcomeV1<Value>> { return work.then(value => ({ ok: true, value }), (error: unknown) => ({ ok: false, error })); }
export function nativeCheckV1(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export function nativeSameV1(first: unknown, second: unknown): boolean { return JSON.stringify(first) === JSON.stringify(second); }
export function nativeBytesEqualV1(first: Uint8Array, second: Uint8Array): boolean { return first.length === second.length && first.every((value, index) => value === second[index]); }
export async function nativeDigestV1(bytes: Uint8Array): Promise<string> {
	const owned = new Uint8Array(bytes);
	try { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', owned.buffer)), value => value.toString(16).padStart(2, '0')).join(''); }
	finally { owned.fill(0); }
}
function token(value: StorageRecord): string { nativeCheckV1(typeof value.mediaContentToken === 'string' && value.mediaContentToken.length > 0, 'Native immutable original token is missing.'); return value.mediaContentToken; }
function exactRows(actual: readonly unknown[], expected: readonly unknown[]): boolean {
	const key = (value: unknown) => { nativeCheckV1(value !== null && typeof value === 'object' && typeof Reflect.get(value, 'key') === 'string', 'Native projection row key is missing.'); return Reflect.get(value, 'key') as string; };
	const sort = (values: readonly unknown[]) => [...values].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
	return nativeSameV1(sort(actual), sort(expected));
}
function store(stores: Readonly<Record<string, IDBObjectStore>>, name: string): IDBObjectStore { const value = stores[name]; nativeCheckV1(value !== undefined, 'Native store is missing.'); return value; }

function notFound(error: unknown): boolean { try { return Reflect.apply(Object.getOwnPropertyDescriptor(DOMException.prototype, 'name')!.get!, error, []) === 'NotFoundError'; } catch { return false; } }
