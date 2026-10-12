/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import type { PhotoCatalogPackInputV4 } from '../archive/catalog-pack-v4.ts';
import type { PhotoCatalogPackInputV2 } from '../archive/catalog-pack-v2.ts';
import type { PhotoOriginalV1 } from '../catalog/types.ts';
import type { PhotoResourceReferencesCurrentV1 } from '../catalog/photo-resource-reachability-current-v1.ts';
import type { PhotoCatalogSnapshotV1 } from '../catalog/repository-snapshot.ts';
import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { id } from '../catalog/value-validation.ts';
import { capturePhotoLibraryBackupMetadataPreflightCurrentV1 } from './photo-library-backup-metadata-preflight-current-v1.ts';
import type { PhotoLibraryBackupMetadataCatalogCurrentV1 } from './photo-library-backup-metadata-walk-current-v1.ts';

export interface PhotoLibraryBackupSourcePortsCurrentV1 {
	readonly catalog: PhotoLibraryBackupMetadataCatalogCurrentV1;
	readonly loadOriginal: (original: PhotoOriginalV1, signal?: AbortSignal) => Promise<unknown>;
}
interface Scalars {
	readonly initial: PhotoCatalogSnapshotV1;
	readonly references: Readonly<PhotoResourceReferencesCurrentV1>;
	readonly verifyCatalog: () => Promise<void>;
	readonly photoPackCount: number;
}
export type PhotoLibraryBackupSourceCurrentV1 = Scalars & (
	| Readonly<{ requiresCurrentFormat: true; originals: AsyncIterable<PhotoCatalogPackInputV4> }>
	| Readonly<{ requiresCurrentFormat: false; originals: AsyncIterable<PhotoCatalogPackInputV2> }>);
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }

/** Fresh whole metadata precedes each lazy Original read; no document/body
 * cache is retained. Legacy fallback re-admits the genuine whole legacy value. */
export async function capturePhotoLibraryBackupSourceCurrentV1(catalogValue: unknown, ports: PhotoLibraryBackupSourcePortsCurrentV1,
	row: unknown | null, signal?: AbortSignal): Promise<Readonly<PhotoLibraryBackupSourceCurrentV1>> {
	check(signal); const catalogId = id(catalogValue, 'backup catalog ID'), catalog = ports.catalog, loadOriginal = ports.loadOriginal;
	if (typeof loadOriginal !== 'function') throw new TypeError('Current backup original capability is required.');
	const metadata = await capturePhotoLibraryBackupMetadataPreflightCurrentV1(catalogId, catalog, row, signal); check(signal);
	const scalars = { initial: metadata.initial, references: metadata.references, verifyCatalog: metadata.verifyCatalog, photoPackCount: metadata.photoPackCount };
	return metadata.requiresCurrentFormat ? Object.freeze({ ...scalars, requiresCurrentFormat: true, originals: currentOriginals() })
		: Object.freeze({ ...scalars, requiresCurrentFormat: false, originals: legacyOriginals() });

	async function original(photo: { readonly original: PhotoOriginalV1 }): Promise<Blob> {
		check(signal); const body = await Reflect.apply(loadOriginal, ports, [photo.original, signal]); check(signal);
		if (body === null || body === undefined) throw new ReferenceError('The photo backup original is missing.');
		const blob = canonicalMediaContentBlob(body);
		if (blob.size !== photo.original.byteLength) throw new RangeError('The photo backup original byte length differs from its binding.');
		return blob;
	}
	async function* currentOriginals(): AsyncGenerator<PhotoCatalogPackInputV4> {
		for await (const photo of metadata.photos()) yield Object.freeze({ photo, original: await original(photo) });
	}
	async function* legacyOriginals(): AsyncGenerator<PhotoCatalogPackInputV2> {
		for await (const value of metadata.photos()) {
			const photo = normalizePhotoDocumentV1OrV2(value); check(signal);
			yield Object.freeze({ photo, original: await original(photo) });
		}
	}
}
