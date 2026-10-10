/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryV2 } from '../../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { createPhotoLibrarySessionV3 } from '../../src/lightscaper/photo-library-session-runtime-v3.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { emptyPhotoMetadataV1 } from '../../src/lightscaper/catalog/photo-metadata.ts';
import { planPhotoPreviewV1 } from '../../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { defaultPhotoDevelopV1 } from '../../src/lightscaper/catalog/develop-state.ts';

/** Actual runtime3 and native repositories; tests supply their owning native IDB fixture. */
export async function seedCurrentAppPhoto(indexedDB: IDBFactory, locks: LockManager = currentAppLocks()) {
	const options = { name: 'Current library', indexedDB, locks }, initial = await createPhotoLibrarySessionV3(options);
	let catalogId: string;
	try { catalogId = (await initial.developImport.listPresets()).catalogId; } finally { await initial.close(); }
	const media = new PhotoMediaStoreV1({ indexedDB, locks, preferOpfs: false });
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB, verifyOriginal: media.verifyOriginal });
	const bytes = new Uint8Array([1, 2, 3]), original = new Blob([bytes], { type: 'image/png' });
	const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
	const photo = normalizePhotoDocumentV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo', id: 'current-photo', catalogId, revision: 0,
		original: { schemaVersion: 1, kind: 'still', id: 'source', name: 'Current.png', mimeType: 'image/png', storageKey: 'current-original',
			contentSha256: digest, width: 1, height: 1, hasAlpha: false, byteLength: bytes.length, retention: 'managed' },
		metadata: emptyPhotoMetadataV1('Current.png'), folderId: null, collectionIds: [], keywordIds: [], rating: 0, flag: 'unflagged', colorLabel: 'none',
		activeVersionId: 'master', versions: [{ id: 'master', kind: 'master', name: 'Original', createdAt: '2026-10-09T00:00:00.000Z', develop: defaultPhotoDevelopV1() }] });
	try {
		await media.ready(); await media.mediaRepository.writeAsset(photo.original.storageKey, original);
		const root = await catalog.loadCatalog(catalogId); if (!root) throw new ReferenceError('Current root missing.');
		await catalog.publishPhotos(catalogId, root.revision, [photo]);
		await media.mediaRepository.catalogOriginals.retain(catalogId, [{ photoId: photo.id, assetId: photo.original.storageKey, sourceId: photo.original.id, sha256: digest, size: bytes.length }]);
		const pixels = new Uint8Array([64, 128, 192, 255]), plan = planPhotoPreviewV1({ binding: { catalogId, photoId: photo.id, originalId: photo.original.id,
			storageKey: photo.original.storageKey, contentSha256: digest, byteLength: bytes.length, width: 1, height: 1 }, tier: 'fit-screen',
			source: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' } });
		const outputSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(byte => byte.toString(16).padStart(2, '0')).join('');
		await media.getPreviewCache().store({ schemaVersion: 1, kind: 'photo-preview', key: plan.key, binding: plan.binding, tier: plan.tier, recipe: plan.recipe,
			descriptor: plan.output, byteLength: plan.byteLength, outputSha256, body: new Blob([pixels]) });
	} finally { await Promise.all([media.close(), catalog.close()]); }
	return { options, photo, createSession: () => createPhotoLibrarySessionV3(options) };
}

/** Authenticate the actual selected namespace, including a private same-ID restored library. */
export async function readResidentPhotoLibraryCurrent(photoIds: readonly string[], indexedDB: IDBFactory = globalThis.indexedDB,
	beforeClose?: () => Promise<void>) {
	if (photoIds.length > 64) throw new RangeError('Current UI observation exceeds one page.');
	const anchor = new PhotoMediaStoreV1({ indexedDB });
	let media: PhotoMediaStoreV1 | null = null, catalog: PhotoCatalogRepositoryV2 | null = null;
	try {
		await anchor.ready();
		const selection = await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw new ReferenceError('Observation cannot initialize a library.'); } });
		media = selection.allocation ? new PhotoMediaStoreV1({ indexedDB, databaseName: selection.location.mediaDatabaseName, preferOpfs: false }) : anchor;
		const resources = await media.getCubeLutResources();
		catalog = new PhotoCatalogRepositoryV2({ indexedDB, databaseName: selection.location.catalogDatabaseName,
			verifyOriginal: media.verifyOriginal, verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal) });
		const root = await catalog.loadCatalog(selection.location.catalogId), photos = [];
		for (const id of photoIds) {
			const photo = await catalog.loadPhoto(selection.location.catalogId, id); if (!photo) throw new ReferenceError('Current photo missing.');
			await media.verifyOriginal(photo.original); await resources.verifyPhoto(photo);
			const body = await media.mediaRepository.loadAsset(photo.original.storageKey); if (!(body instanceof Blob)) throw new TypeError('Original body missing.');
			photos.push({ photo, bytes: [...new Uint8Array(await body.arrayBuffer())] });
		}
		await beforeClose?.();
		return { root, namespace: selection.location.namespaceToken, photos };
	} finally { await Promise.all([catalog?.close(), media?.close(), anchor.close()]); }
}

/** Observe only canvas publication; source/cache/resource algorithms remain production owners. */
export function currentAppCanvasBoundary() {
	const keys = ['HTMLCanvasElement', 'CanvasRenderingContext2D', 'ImageData'] as const, prior = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	const painted: number[][] = [];
	class Context { getContextAttributes() { return { alpha: true, colorSpace: 'srgb' }; } putImageData(image: { data: Uint8ClampedArray }) { painted.push([...image.data]); } }
	class Canvas { get width() { return 0; } set width(_value: number) {} get height() { return 0; } set height(_value: number) {} getContext() { return new Context(); } }
	class Image { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} }
	for (const [index, value] of [Canvas, Context, Image].entries()) Object.defineProperty(globalThis, keys[index]!, { configurable: true, value });
	return { painted, restore() { for (const [index, key] of keys.entries()) { const saved = prior[index]; if (saved) Object.defineProperty(globalThis, key, saved); else Reflect.deleteProperty(globalThis, key); } } };
}

/** Namespace lease double with the real selected runtime's nesting/order checks. */
export function currentAppLocks(): LockManager {
	const held = new Set<string>();
	return { async request(name: string, _options: unknown, consume: (lock: unknown) => Promise<unknown>) {
		if (held.has(name)) return consume(null); held.add(name);
		try { return await consume({ name, mode: 'exclusive' }); } finally { held.delete(name); }
	} } as unknown as LockManager;
}
