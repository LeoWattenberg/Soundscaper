/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import type { PhotoCatalogPackInputV2 } from '../archive/catalog-pack-v2.ts';
import type { PhotoCatalogSnapshotV1 } from '../catalog/repository-snapshot.ts';
import type { PhotoOriginalV1 } from '../catalog/types.ts';
import { id } from '../catalog/value-validation.ts';
import { capturePhotoLibraryBackupMetadataPreflightV1, type PhotoLibraryBackupMetadataCatalogV1 } from './photo-library-backup-metadata-preflight-v1.ts';

export interface PhotoLibraryBackupSourcePortsV2 {
	readonly catalog: PhotoLibraryBackupMetadataCatalogV1;
	readonly loadOriginal: (original: PhotoOriginalV1, signal?: AbortSignal) => Promise<unknown>;
}
export interface PhotoLibraryBackupSourceV2 {
	readonly initial: PhotoCatalogSnapshotV1;
	readonly originals: AsyncIterable<PhotoCatalogPackInputV2>;
	readonly verifyCatalog: () => Promise<void>;
}

/** Complete metadata preflight borrows existing repositories and opens no
 * original/resource body or writer. Original bodies stay lazy and serial. */
export async function capturePhotoLibraryBackupSourceV2(catalogValue: unknown, ports: PhotoLibraryBackupSourcePortsV2,
	signal?: AbortSignal): Promise<PhotoLibraryBackupSourceV2> {
	const catalogId = id(catalogValue, 'backup catalog ID'); check(signal);
	const catalog = ports.catalog, loadOriginal = ports.loadOriginal;
	if (typeof loadOriginal !== 'function') throw new TypeError('Current backup original capability is required.');
	const metadata = await capturePhotoLibraryBackupMetadataPreflightV1(catalogId, catalog, signal); check(signal);
	return Object.freeze({ initial: metadata.initial, originals: originals(), verifyCatalog: metadata.verifyCatalog });

	async function* originals(): AsyncGenerator<PhotoCatalogPackInputV2> {
		for await (const photo of metadata.photos()) {
			check(signal);
			const body = await Reflect.apply(loadOriginal, ports, [photo.original, signal]); check(signal);
			if (body === null || body === undefined) throw new ReferenceError('The photo backup original is missing.');
			const original = canonicalMediaContentBlob(body);
			if (original.size !== photo.original.byteLength) throw new RangeError('The photo backup original byte length differs from its binding.');
			yield Object.freeze({ photo, original });
		}
	}
}

const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
