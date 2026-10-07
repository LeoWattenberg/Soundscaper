/* SPDX-License-Identifier: AGPL-3.0-only */

import { readCursorPage, request } from '../../common/editor/storage/indexeddb-backend.ts';
import { validateLightscaperDocumentV1 } from './documents.ts';
import { catalogTransaction } from './catalog-transaction.ts';
import { validatePhotoCatalogReferencesV1 } from './photo-document.ts';
import { filterScope, indexState, photoMemberships, photoStorageKey, photoSummary, readIndexState, readStoredPhoto } from './repository-records.ts';
import { PHOTO_CATALOG_STORES, PhotoCatalogRevisionConflictError } from './repository-types.ts';
import type { PhotoCatalogRootV1, PhotoDocumentV1 } from './types.ts';

export async function createCatalog(database: IDBDatabase, root: PhotoCatalogRootV1): Promise<void> {
	if (root.revision !== 0 || root.photoCount !== 0) throw new RangeError('A new catalog requires revision zero and no photos.');
	await catalogTransaction(database, ['catalogs', 'catalogStates'], 'readwrite', async (stores) => {
		if (await request(stores.catalogs.getKey(root.id)) !== undefined) throw new RangeError('Photo catalog already exists.');
		await Promise.all([request(stores.catalogs.put(root)), request(stores.catalogStates.put(indexState(root, 0)))]);
	});
}

export async function publishPhotos(database: IDBDatabase, catalogId: string, expectedRevision: number, photos: readonly PhotoDocumentV1[], signal?: AbortSignal): Promise<PhotoCatalogRootV1> {
	return catalogTransaction(database, PHOTO_CATALOG_STORES, 'readwrite', async (stores) => {
		const root = await requiredRoot(stores, catalogId);
		if (root.revision !== expectedRevision) throw new PhotoCatalogRevisionConflictError('catalog');
		const state = await requiredState(stores, root);
		for (const photo of photos) {
			validatePhotoCatalogReferencesV1(photo, root);
			if (await request(stores.photos.getKey(photoStorageKey(root.id, photo.id))) !== undefined) throw new RangeError('Photo already exists in this catalog.');
		}
		for (const photo of photos) await writePhoto(stores, photo);
		const next = validatedRoot({ ...root, revision: root.revision + 1, photoCount: root.photoCount + photos.length });
		await Promise.all([request(stores.catalogs.put(next)), request(stores.catalogStates.put(indexState(next, state.indexRevision + 1)))]);
		return next;
	}, signal);
}

export async function savePhoto(database: IDBDatabase, photo: PhotoDocumentV1, expectedRevision: number, signal?: AbortSignal): Promise<PhotoDocumentV1> {
	return catalogTransaction(database, PHOTO_CATALOG_STORES, 'readwrite', async (stores) => {
		const root = await requiredRoot(stores, photo.catalogId);
		const state = await requiredState(stores, root);
		validatePhotoCatalogReferencesV1(photo, root);
		const raw: unknown = await request(stores.photos.get(photoStorageKey(photo.catalogId, photo.id)));
		if (raw === undefined) throw new ReferenceError('Photo is missing.');
		const previous = readStoredPhoto(raw);
		if (previous.revision !== expectedRevision) throw new PhotoCatalogRevisionConflictError('photo');
		if (JSON.stringify(previous.original) !== JSON.stringify(photo.original)) throw new RangeError('Photo edits cannot mutate the original.');
		if (JSON.stringify(previous.extractedMetadata) !== JSON.stringify(photo.extractedMetadata)) throw new RangeError('Photo edits cannot mutate extracted metadata.');
		for (const membership of photoMemberships(previous)) await request(stores.memberships.delete(membership.key));
		const next = { ...photo, revision: previous.revision + 1 };
		// The outer reader validated the candidate; normalization also checks the
		// increment before any next state is published.
		const normalized = readStoredPhoto({ key: photoStorageKey(photo.catalogId, photo.id), document: next });
		await writePhoto(stores, normalized);
		await request(stores.catalogStates.put(indexState(root, state.indexRevision + 1)));
		return normalized;
	}, signal);
}

export async function saveCatalog(database: IDBDatabase, candidate: PhotoCatalogRootV1, expectedRevision: number, signal?: AbortSignal): Promise<PhotoCatalogRootV1> {
	return catalogTransaction(database, ['catalogs', 'catalogStates', 'memberships'], 'readwrite', async (stores) => {
		const previous = await requiredRoot(stores, candidate.id);
		if (previous.revision !== expectedRevision) throw new PhotoCatalogRevisionConflictError('catalog');
		if (candidate.photoCount !== previous.photoCount) throw new RangeError('Only photo publication changes the catalog photo count.');
		const state = await requiredState(stores, previous);
		const nextFolders = new Set(candidate.folders.map((node) => node.id));
		const nextKeywords = new Set(candidate.keywords.map((node) => node.id));
		const nextCollections = new Set(candidate.collections.filter((collection) => collection.kind === 'manual').map((collection) => collection.id));
		const removals = [
			...previous.folders.filter((node) => !nextFolders.has(node.id)).map((node) => ({ kind: 'folder' as const, id: node.id })),
			...previous.keywords.filter((node) => !nextKeywords.has(node.id)).map((node) => ({ kind: 'keyword' as const, id: node.id })),
			...previous.collections.filter((collection) => collection.kind === 'manual' && !nextCollections.has(collection.id)).map((collection) => ({ kind: 'collection' as const, id: collection.id })),
		];
		for (const filter of removals) {
			const references = await readCursorPage(stores.memberships.index('scope'), {
				query: filterScope(previous.id, filter), limit: 1, project: (_value, key) => key,
			});
			if (references.length > 0) throw new ReferenceError('Cannot remove a hierarchy or manual collection still referenced by photos.');
		}
		const next = validatedRoot({ ...candidate, revision: previous.revision + 1 });
		await Promise.all([request(stores.catalogs.put(next)), request(stores.catalogStates.put(indexState(next, state.indexRevision + 1)))]);
		return next;
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
	const root = validateLightscaperDocumentV1(value);
	if (root.kind !== 'photo-catalog') throw new TypeError('Stored catalog requires a root document.');
	return root;
}

async function requiredState(stores: Readonly<Record<string, IDBObjectStore>>, root: PhotoCatalogRootV1) {
	const state = readIndexState(await request(stores.catalogStates.get(root.id)) as unknown);
	if (state.id !== root.id || state.rootRevision !== root.revision || state.photoCount !== root.photoCount) throw new TypeError('Catalog index state disagrees with its root.');
	return state;
}

async function writePhoto(stores: Readonly<Record<string, IDBObjectStore>>, photo: PhotoDocumentV1): Promise<void> {
	await request(stores.photos.put({ key: photoStorageKey(photo.catalogId, photo.id), document: photo }));
	await request(stores.summaries.put(photoSummary(photo)));
	for (const membership of photoMemberships(photo)) await request(stores.memberships.put(membership));
}
