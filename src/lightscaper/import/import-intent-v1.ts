/* SPDX-License-Identifier: AGPL-3.0-only */

import { CATALOG_ORIGINAL_BATCH_SIZE } from '../../common/editor/storage/media-catalog-original-schema.ts';
import type { CatalogOriginalRootV1 } from '../../common/editor/storage/media-catalog-original-schema.ts';
import { field, id, oneOf, record } from '../catalog/value-validation.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import type { PhotoManagedImportPortsV1 } from './managed-import-ports-v1.ts';

export interface PhotoImportIntentV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-import';
	readonly catalogId: string;
	readonly importId: string;
}

export function photoImportIntentKeyV1(catalogId: string): string {
	return `lightscaper-photo-import-v1:${id(catalogId, 'catalog ID')}`;
}

export function normalizePhotoImportIntentV1(value: unknown, catalogId: string): PhotoImportIntentV1 {
	const input = record(value, 'photo import intent', ['schemaVersion', 'kind', 'catalogId', 'importId']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported photo import intent schema.');
	oneOf(field(input, 'kind'), ['photo-import'] as const, 'photo import intent kind');
	if (field(input, 'catalogId') !== catalogId) throw new RangeError('Photo import intent belongs to another catalog.');
	const intent = Object.freeze({ schemaVersion: 1 as const, kind: 'photo-import' as const,
		catalogId: id(catalogId, 'catalog ID'), importId: id(field(input, 'importId'), 'import ID') });
	if (new TextEncoder().encode(JSON.stringify(intent)).byteLength > 1_024) throw new RangeError('Photo import intent exceeds its scalar byte bound.');
	return intent;
}

export async function settlePhotoImportRootsV1(intent: PhotoImportIntentV1, ports: PhotoManagedImportPortsV1, signal?: AbortSignal): Promise<void> {
	let afterKey: string | null = null;
	while (true) {
		signal?.throwIfAborted();
		const page = await ports.media.custody.readPage({ catalogId: intent.catalogId, importId: intent.importId, afterKey }, { signal });
		const promote: string[] = [], release: string[] = [];
		for (const root of page.roots) {
			signal?.throwIfAborted();
			const photo = await ports.catalog.loadPhoto(intent.catalogId, root.photoId);
			if (photo && !photoMatchesOriginalRootV1(photo, root)) throw new Error('Photo import recovery found a conflicting original reference.');
			(photo ? promote : release).push(root.photoId);
			if (promote.length + release.length === CATALOG_ORIGINAL_BATCH_SIZE) await flush();
		}
		await flush();
		if (page.afterKey === null) return;
		afterKey = page.afterKey;

		async function flush(): Promise<void> {
			signal?.throwIfAborted();
			if (promote.length) await ports.media.custody.promote(intent.catalogId, intent.importId, promote, { signal });
			signal?.throwIfAborted();
			if (release.length) await ports.media.custody.releaseStaged(intent.catalogId, intent.importId, release, { signal });
			promote.length = 0; release.length = 0;
		}
	}
}

function photoMatchesOriginalRootV1(photo: PhotoDocumentV1, root: CatalogOriginalRootV1): boolean {
	return photo.catalogId === root.catalogId && photo.id === root.photoId
		&& photo.original.id === root.sourceId && photo.original.storageKey === root.assetId
		&& photo.original.contentSha256 === root.sha256 && photo.original.byteLength === root.size;
}
