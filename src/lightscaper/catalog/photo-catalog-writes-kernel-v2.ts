/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { readValidatedPhotoCatalogRootV1 } from './documents.ts';
import { catalogTransaction } from './catalog-transaction.ts';
import { validatePhotoCatalogReferencesV1 } from './photo-document.ts';
import { indexState, photoMemberships, photoStorageKey, photoSummary, readIndexState } from './repository-records.ts';
import { readStoredPhotoV1OrV2 } from './photo-catalog-records-v2.ts';
import { normalizePhotoDocumentV1OrV2 } from './photo-document-v2.ts';
import { normalizePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from './photo-document-current-v1.ts';
import { readStoredPhotoCurrentV1 } from './photo-catalog-records-current-v1.ts';
import { PHOTO_CATALOG_STORES, PhotoCatalogRevisionConflictError } from './repository-types.ts';
import type { PhotoCatalogRootV1 } from './types.ts';
import { projectPhotoQueryRowV1, publishPhotoQueryRowV1, readPhotoQueryBuildStateV1 } from './photo-query-index-v1.ts';
import { projectPhotoQueryRowV2 } from './photo-query-index-v2.ts';
import { publishPhotoQueryRowV2 } from './photo-query-index-storage-v2.ts';

export type PhotoCatalogDocumentModeV2 = 'legacy2' | 'current3';
type CurrentPhoto = PhotoDocumentCurrentV1;
export async function publishPhotosKernelV2(database: IDBDatabase, catalogId: string, expectedRevision: number, values: readonly CurrentPhoto[], mode: PhotoCatalogDocumentModeV2, signal?: AbortSignal): Promise<PhotoCatalogRootV1> {
	const photos = values.map(value => readPhoto(value, mode));
	return catalogTransaction(database, PHOTO_CATALOG_STORES, 'readwrite', async (stores) => {
		const root = await requiredRoot(stores, catalogId);
		if (root.revision !== expectedRevision) throw new PhotoCatalogRevisionConflictError('catalog');
		const state = await requiredState(stores, root);
		for (const photo of photos) {
			validatePhotoCatalogReferencesV1(photo, root);
			if (await request(stores.photos.getKey(photoStorageKey(root.id, photo.id))) !== undefined) throw new RangeError('Photo already exists in this catalog.');
		}
		for (const photo of photos) await writePhoto(stores, photo, 'insert');
		const next = validatedRoot({ ...root, revision: root.revision + 1, photoCount: root.photoCount + photos.length });
		await Promise.all([request(stores.catalogs.put(next)), request(stores.catalogStates.put(indexState(next, state.indexRevision + 1)))]);
		return next;
	}, signal);
}

export async function savePhotoKernelV2(database: IDBDatabase, value: CurrentPhoto, expectedRevision: number, mode: PhotoCatalogDocumentModeV2, signal?: AbortSignal): Promise<CurrentPhoto> {
	const photo = readPhoto(value, mode);
	readPhoto({ ...photo, revision: expectedRevision + 1 }, mode);
	return catalogTransaction(database, PHOTO_CATALOG_STORES, 'readwrite', async (stores) => {
		const root = await requiredRoot(stores, photo.catalogId);
		const state = await requiredState(stores, root);
		validatePhotoCatalogReferencesV1(photo, root);
		const raw: unknown = await request(stores.photos.get(photoStorageKey(photo.catalogId, photo.id)));
		if (raw === undefined) throw new ReferenceError('Photo is missing.');
		const previous = readStoredPhoto(raw, mode, photoStorageKey(photo.catalogId, photo.id));
		if (mode === 'current3' && previous.revision !== expectedRevision) throw new PhotoCatalogRevisionConflictError('photo');
		if (previous.schemaVersion > photo.schemaVersion) throw new RangeError(previous.schemaVersion === 2
			? 'A Photo2 aggregate cannot be downgraded.' : 'A Photo3 aggregate cannot be downgraded.');
		if (previous.revision !== expectedRevision) throw new PhotoCatalogRevisionConflictError('photo');
		if (JSON.stringify(previous.original) !== JSON.stringify(photo.original)) throw new RangeError('Photo edits cannot mutate the original.');
		if (JSON.stringify(previous.extractedMetadata) !== JSON.stringify(photo.extractedMetadata)) throw new RangeError('Photo edits cannot mutate extracted metadata.');
		for (const membership of photoMemberships(previous)) await request(stores.memberships.delete(membership.key));
		const next = { ...photo, revision: previous.revision + 1 };
		// The outer reader validated the candidate; normalization also checks the
		// increment before any next state is published.
		const normalized = readStoredPhoto({ key: photoStorageKey(photo.catalogId, photo.id), document: next }, mode);
		await writePhoto(stores, normalized, 'replace');
		await request(stores.catalogStates.put(indexState(root, state.indexRevision + 1)));
		return normalized;
	}, signal);
}

async function requiredRoot(stores: Readonly<Record<string, IDBObjectStore>>, catalogId: string): Promise<PhotoCatalogRootV1> {
	const value: unknown = await request(stores.catalogs.get(catalogId));
	if (value === undefined) throw new ReferenceError('Photo catalog is missing.');
	const root = validatedRoot(value);
	if (root.id !== catalogId) throw new TypeError('Catalog root disagrees with its storage key.');
	return root;
}

function validatedRoot(value: unknown): PhotoCatalogRootV1 {
	return readValidatedPhotoCatalogRootV1(value);
}

async function requiredState(stores: Readonly<Record<string, IDBObjectStore>>, root: PhotoCatalogRootV1) {
	const state = readIndexState(await request(stores.catalogStates.get(root.id)) as unknown);
	if (state.id !== root.id || state.rootRevision !== root.revision || state.photoCount !== root.photoCount) throw new TypeError('Catalog index state disagrees with its root.');
	return state;
}

async function writePhoto(stores: Readonly<Record<string, IDBObjectStore>>, photo: CurrentPhoto, mode: 'insert' | 'replace'): Promise<void> {
	await request(stores.photos.put({ key: photoStorageKey(photo.catalogId, photo.id), document: photo }));
	await request(stores.summaries.put(photoSummary(photo)));
	let legacy: ReturnType<typeof projectPhotoQueryRowV1> | undefined;
	try { legacy = projectPhotoQueryRowV1(photo); }
	catch (error) {
		// Only this synchronous owned projection limit can retire the legacy profile.
		// Validation and asynchronous publication failures remain transaction failures.
		if (!(error instanceof RangeError) || error.message !== 'Photo query row exceeds its byte budget.') throw error;
	}
	if (legacy) await publishPhotoQueryRowV1(stores, legacy);
	else await retireLegacyQueryProfile(stores, photo.catalogId);
	await publishPhotoQueryRowV2(stores, projectPhotoQueryRowV2(photo), mode);
	for (const membership of photoMemberships(photo)) await request(stores.memberships.put(membership));
}

async function retireLegacyQueryProfile(stores: Readonly<Record<string, IDBObjectStore>>, catalogId: string): Promise<void> {
	const raw: unknown = await request(stores.photoQueryBuildStates.get(catalogId));
	const build = readPhotoQueryBuildStateV1(raw === undefined ? { id: catalogId, schemaVersion: 1, ready: false, afterKey: null, indexedCount: 0 } : raw, catalogId);
	if (raw === undefined && await request(stores.photoQueryRows.index('catalogId').getKey(catalogId)) !== undefined) throw new TypeError('Existing query rows require a consistent build state.');
	await request(stores.photoQueryBuildStates.put({ ...build, ready: false, afterKey: null }));
}

function readPhoto(value: unknown, mode: PhotoCatalogDocumentModeV2): CurrentPhoto {
	return mode === 'legacy2' ? normalizePhotoDocumentV1OrV2(value) : normalizePhotoDocumentCurrentV1(value);
}
function readStoredPhoto(value: unknown, mode: PhotoCatalogDocumentModeV2, key?: string): CurrentPhoto {
	return mode === 'legacy2' ? readStoredPhotoV1OrV2(value, key) : readStoredPhotoCurrentV1(value, key);
}
