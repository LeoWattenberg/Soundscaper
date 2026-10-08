/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryOriginalRestoreTargetV1, PhotoLibraryOriginalRestorationOptionsV1,
	PhotoLibraryOriginalRestorationReceiptV1 } from '../../common/editor/photo-library-original-recovery-port-v1.ts';
import { normalizeCatalogOriginalRepairBindingV1, readCatalogOriginalRepairSignalV1 } from '../../common/editor/storage/media-catalog-original-repair-contract.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import { field, id, integer, record } from '../catalog/value-validation.ts';
import { normalizePhotoImportIntentV1, photoImportIntentKeyV1 } from '../import/import-intent-v1.ts';
import type { PhotoLibrarySessionPortsV1 } from './photo-library-session-ports.ts';

type Ports = Pick<PhotoLibrarySessionPortsV1, 'catalog' | 'journal'> & {
	readonly originalRestoration: NonNullable<PhotoLibrarySessionPortsV1['originalRestoration']>;
};

export function admitPhotoLibraryOriginalRestorationRequestV1(value: unknown, options: PhotoLibraryOriginalRestorationOptionsV1):
	Readonly<{ target: PhotoLibraryOriginalRestoreTargetV1; signal?: AbortSignal }> {
	const input = record(value, 'original restoration target', ['schemaVersion', 'catalogRevision', 'activeImportId', 'photoRevision', 'binding']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported original restoration target schema.');
	const target = Object.freeze({ schemaVersion: 1 as const,
		catalogRevision: integer(field(input, 'catalogRevision'), 0, Number.MAX_SAFE_INTEGER, 'restoration catalog revision'),
		activeImportId: field(input, 'activeImportId') === null ? null : id(field(input, 'activeImportId'), 'restoration active import ID'),
		photoRevision: integer(field(input, 'photoRevision'), 0, Number.MAX_SAFE_INTEGER, 'restoration photo revision'),
		binding: normalizeCatalogOriginalRepairBindingV1(field(input, 'binding')) });
	return Object.freeze({ target, signal: readCatalogOriginalRepairSignalV1(options) });
}

/** Borrowed pre-ready catalog lease; no readiness/recovery or document mutation occurs here. */
export async function restorePhotoLibraryOriginalBodyV1(catalogId: string, ports: Ports, target: PhotoLibraryOriginalRestoreTargetV1,
	selected: Blob, signal: AbortSignal): Promise<PhotoLibraryOriginalRestorationReceiptV1> {
	signal.throwIfAborted();
	if (catalogId !== target.binding.catalogId) throw new Error('Restoration target belongs to another catalog.');
	const stored = await ports.catalog.loadCatalog(catalogId); signal.throwIfAborted();
	const root = validateLightscaperDocumentV1(stored);
	if (root.kind !== 'photo-catalog' || root.id !== catalogId || root.revision !== target.catalogRevision) throw new Error('Restoration catalog identity or revision changed.');
	const intent = await ports.journal.get(photoImportIntentKeyV1(catalogId)); signal.throwIfAborted();
	const importId = intent === undefined ? null : normalizePhotoImportIntentV1(intent, catalogId).importId;
	if (importId !== target.activeImportId || (target.binding.importId !== null && target.binding.importId !== importId)) {
		throw new Error('Restoration active import identity changed.');
	}
	const storedPhoto = await ports.catalog.loadPhoto(catalogId, target.binding.photoId); signal.throwIfAborted();
	const photo = validateLightscaperDocumentV1(storedPhoto);
	if (photo.kind !== 'photo' || photo.catalogId !== catalogId || photo.id !== target.binding.photoId || photo.revision !== target.photoRevision) {
		throw new Error('Restoration photo identity or revision changed.');
	}
	const original = photo.original;
	if (original.retention !== 'managed') throw new Error('Only managed original bodies can be restored.');
	const binding = normalizeCatalogOriginalRepairBindingV1({ catalogId, importId: target.binding.importId, photoId: photo.id,
		sourceId: original.id, assetId: original.storageKey, sha256: original.contentSha256,
		size: original.byteLength, name: original.name, mimeType: original.mimeType });
	if (JSON.stringify(binding) !== JSON.stringify(target.binding)) throw new Error('Restoration immutable original binding changed.');
	signal.throwIfAborted();
	const value = await ports.originalRestoration.restoreCatalogOriginalBody(binding, selected, { signal });
	// A completed durable body wins late cancellation. Only exact scalar ACKs
	// can escape; catalog lock cleanup remains the outer Session's ownership.
	const receipt = record(value, 'original restoration acknowledgement', ['assetId', 'sha256', 'size']);
	if (field(receipt, 'assetId') !== binding.assetId || field(receipt, 'sha256') !== binding.sha256 || field(receipt, 'size') !== binding.size) {
		throw new Error('Original restoration acknowledgement disagrees with its immutable binding.');
	}
	return Object.freeze({ photoId: photo.id, assetId: binding.assetId, sha256: binding.sha256,
		size: binding.size, notices: Object.freeze([]) });
}
