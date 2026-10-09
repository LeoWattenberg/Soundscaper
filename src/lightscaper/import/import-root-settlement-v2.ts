/* SPDX-License-Identifier: AGPL-3.0-only */

import { CATALOG_ORIGINAL_BATCH_SIZE, normalizeCatalogOriginalRoot } from '../../common/editor/storage/media-catalog-original-schema.ts';
import { createPhotoCubeLutReachabilityV1 } from '../catalog/photo-cube-lut-reachability-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import type { PhotoImportIntentV1 } from './import-intent-v1.ts';
import type { PhotoManagedImportPortsV2 } from './managed-import-ports-v2.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
type Photo = ReturnType<typeof normalizePhotoDocumentV1OrV2>;
export function checkManagedImportSignalV2(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }

/** No metadata-only resource admission: retain complete owning traversal and
 * serial selected-media authentication before publication or root promotion. */
export async function verifyManagedImportResourcesV2(photo: Photo, ports: PhotoManagedImportPortsV2, signal?: AbortSignal): Promise<void> {
	checkManagedImportSignalV2(signal);
	const closure = createPhotoCubeLutReachabilityV1(); closure.addPhoto(photo);
	if (closure.finish().length === 0) return;
	if (!ports.verifyResources) throw new TypeError('Current photo resources require selected-library verification.');
	await ports.verifyResources(photo, signal); checkManagedImportSignalV2(signal);
}

/** Recovery has only the unchanged closed Root1 scalar authority. Admit each
 * complete current document before comparing every available root binding;
 * a local lost-ACK candidate separately binds complete immutable source facts. */
export async function settlePhotoImportRootsV2(intent: PhotoImportIntentV1, ports: PhotoManagedImportPortsV2, signal?: AbortSignal): Promise<void> {
	let afterKey: string | null = null;
	while (true) {
		checkManagedImportSignalV2(signal);
		const page = await ports.media.custody.readPage({ catalogId: intent.catalogId, importId: intent.importId, afterKey }, { signal });
		checkManagedImportSignalV2(signal);
		const promote: string[] = [], release: string[] = [];
		for (const value of page.roots) {
			checkManagedImportSignalV2(signal);
			const root = normalizeCatalogOriginalRoot(value);
			if (root.catalogId !== intent.catalogId || root.importId !== intent.importId) throw new Error('Photo import recovery found a foreign original root.');
			const stored = await ports.catalog.loadPhoto(intent.catalogId, root.photoId);
			checkManagedImportSignalV2(signal);
			const photo = stored === null ? null : normalizePhotoDocumentV1OrV2(stored);
			checkManagedImportSignalV2(signal);
			if (photo && (photo.catalogId !== root.catalogId || photo.id !== root.photoId || photo.original.id !== root.sourceId
				|| photo.original.storageKey !== root.assetId || photo.original.contentSha256 !== root.sha256 || photo.original.byteLength !== root.size)) {
				throw new Error('Photo import recovery found a conflicting original reference.');
			}
			if (photo) await verifyManagedImportResourcesV2(photo, ports, signal);
			(photo ? promote : release).push(root.photoId);
			if (promote.length + release.length === CATALOG_ORIGINAL_BATCH_SIZE) await flush();
		}
		await flush();
		if (page.afterKey === null) return;
		afterKey = page.afterKey;
		async function flush(): Promise<void> {
			checkManagedImportSignalV2(signal);
			if (promote.length) await ports.media.custody.promote(intent.catalogId, intent.importId, promote, { signal });
			checkManagedImportSignalV2(signal);
			if (release.length) await ports.media.custody.releaseStaged(intent.catalogId, intent.importId, release, { signal });
			promote.length = 0; release.length = 0;
		}
	}
}
