/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryOriginalRestoreTargetV1, PhotoLibraryOriginalRestorationOptionsV1,
	PhotoLibraryOriginalRestorationReceiptV1 } from '../../common/editor/photo-library-original-recovery-port-v1.ts';
import { normalizeCatalogOriginalRepairBindingV1, readCatalogOriginalRepairSignalV1 } from '../../common/editor/storage/media-catalog-original-repair-contract.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import { field, id, integer, record } from '../catalog/value-validation.ts';
import { normalizePhotoImportIntentV1, photoImportIntentKeyV1 } from '../import/import-intent-v1.ts';
import type { PhotoLibrarySessionPortsV1 } from './photo-library-session-ports.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import type { KeyValueRepository } from '../../common/editor/storage/key-value-repository.ts';

export interface PhotoOriginalRestorationPortsCore {
	readonly catalog: { loadCatalog(catalogId: string): Promise<unknown>; loadPhoto(catalogId: string, photoId: string): Promise<unknown> };
	readonly journal: Pick<KeyValueRepository, 'get'>;
	readonly originalRestoration: NonNullable<PhotoLibrarySessionPortsV1['originalRestoration']>;
}
type Projection = Pick<PhotoDocumentV1, 'id' | 'catalogId' | 'revision' | 'original'>;

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
export async function restorePhotoLibraryOriginalBodyCore(catalogId: string, ports: PhotoOriginalRestorationPortsCore, target: PhotoLibraryOriginalRestoreTargetV1,
	selected: Blob, signal: AbortSignal, normalizePhoto: (value: unknown) => Projection): Promise<PhotoLibraryOriginalRestorationReceiptV1> {
	check(signal);
	const catalog = ports.catalog, journal = ports.journal, restoration = ports.originalRestoration;
	const loadCatalog = catalog.loadCatalog, loadPhoto = catalog.loadPhoto, get = journal.get, restore = restoration.restoreCatalogOriginalBody;
	for (const method of [loadCatalog, loadPhoto, get, restore]) if (typeof method !== 'function') throw new TypeError('Original restoration requires complete captured capabilities.');
	check(signal);
	if (catalogId !== target.binding.catalogId) throw new Error('Restoration target belongs to another catalog.');
	const stored = await Reflect.apply(loadCatalog, catalog, [catalogId]); check(signal);
	const root = validateLightscaperDocumentV1(stored);
	if (root.kind !== 'photo-catalog' || root.id !== catalogId || root.revision !== target.catalogRevision) throw new Error('Restoration catalog identity or revision changed.');
	check(signal);
	const intent = await Reflect.apply(get, journal, [photoImportIntentKeyV1(catalogId)]); check(signal);
	const importId = intent === undefined ? null : normalizePhotoImportIntentV1(intent, catalogId).importId;
	check(signal);
	if (importId !== target.activeImportId || (target.binding.importId !== null && target.binding.importId !== importId)) {
		throw new Error('Restoration active import identity changed.');
	}
	const storedPhoto = await Reflect.apply(loadPhoto, catalog, [catalogId, target.binding.photoId]); check(signal);
	const photo = normalizePhoto(storedPhoto); check(signal);
	if (photo.catalogId !== catalogId || photo.id !== target.binding.photoId || photo.revision !== target.photoRevision) {
		throw new Error('Restoration photo identity or revision changed.');
	}
	const original = photo.original;
	if (original.retention !== 'managed') throw new Error('Only managed original bodies can be restored.');
	const binding = normalizeCatalogOriginalRepairBindingV1({ catalogId, importId: target.binding.importId, photoId: photo.id,
		sourceId: original.id, assetId: original.storageKey, sha256: original.contentSha256,
		size: original.byteLength, name: original.name, mimeType: original.mimeType });
	if (JSON.stringify(binding) !== JSON.stringify(target.binding)) throw new Error('Restoration immutable original binding changed.');
	check(signal);
	const value = await Reflect.apply(restore, restoration, [binding, selected, { signal }]);
	// A completed durable body wins late cancellation. Only exact scalar ACKs
	// can escape; catalog lock cleanup remains the outer Session's ownership.
	const receipt = record(value, 'original restoration acknowledgement', ['assetId', 'sha256', 'size']);
	if (field(receipt, 'assetId') !== binding.assetId || field(receipt, 'sha256') !== binding.sha256 || field(receipt, 'size') !== binding.size) {
		throw new Error('Original restoration acknowledgement disagrees with its immutable binding.');
	}
	return Object.freeze({ photoId: photo.id, assetId: binding.assetId, sha256: binding.sha256,
		size: binding.size, notices: Object.freeze([]) });
}

const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
