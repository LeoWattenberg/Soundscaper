/* SPDX-License-Identifier: AGPL-3.0-only */

import type { KeyValueRepository } from '../../common/editor/storage/key-value-repository.ts';
import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import type { PhotoCatalogRepositoryV1 } from '../catalog/repository.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import { id, name } from '../catalog/value-validation.ts';
import { withPhotoCatalogWriteLockV1, type PhotoCatalogImportExclusiveV1 } from '../import/catalog-write-lock-v1.ts';

export const PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 = 'photo-library:default';
export const PHOTO_LIBRARY_INITIALIZATION_LOCK_ID_V1 = 'photo-library-default';
export const PHOTO_LIBRARY_CATALOG_POINTER_MAXIMUM_BYTES_V1 = 1_024;

export interface PhotoLibraryCatalogPointerV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-library';
	readonly catalogId: string;
}

/** Trusted scalar ownership ports, independent of the importing session. */
export interface PhotoLibraryCatalogPointerPortsV1 {
	readonly catalog: Pick<PhotoCatalogRepositoryV1, 'loadCatalog' | 'createCatalog'>;
	readonly settings: Pick<KeyValueRepository, 'get' | 'putIfAbsent'>;
	readonly exclusive?: PhotoCatalogImportExclusiveV1;
	readonly createId?: () => string;
}

/** Open one durable default library; recovery runs later under its actual catalog lock. */
export async function openDefaultPhotoCatalogV1(ports: PhotoLibraryCatalogPointerPortsV1,
	options: Readonly<{ name: string; signal?: AbortSignal }>): Promise<PhotoCatalogRootV1> {
	const input = readClosedDomainRecord(options, 'photo library initialization', ['name', 'signal'], ['name']);
	const catalogName = name(readClosedDomainField(input, 'name', 'photo library initialization'), 'catalog name');
	const signal = Object.hasOwn(input, 'signal') ? readClosedDomainField(input, 'signal', 'photo library initialization') : undefined;
	if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Photo library initialization requires a cancellation signal.');
	signal?.throwIfAborted();
	return (ports.exclusive ?? withPhotoCatalogWriteLockV1)(PHOTO_LIBRARY_INITIALIZATION_LOCK_ID_V1, async (admitted) => {
		admitted?.throwIfAborted();
		const current = await ports.settings.get(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1);
		admitted?.throwIfAborted();
		if (current !== undefined) return openPointer(current, ports, admitted);
		const catalogId = id((ports.createId ?? (() => `catalog-${crypto.randomUUID()}`))(), 'default catalog ID');
		const candidate = readRoot({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
			id: catalogId, name: catalogName, revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] }, catalogId);
		admitted?.throwIfAborted();
		try { await ports.catalog.createCatalog(candidate); }
		catch (failure) {
			admitted?.throwIfAborted();
			let recovered: PhotoCatalogRootV1 | null;
			try {
				const value = await ports.catalog.loadCatalog(catalogId);
				admitted?.throwIfAborted();
				recovered = value === null ? null : readRoot(value, catalogId);
			} catch (reconciliationFailure) {
				admitted?.throwIfAborted();
				throw new AggregateError([failure, reconciliationFailure], 'Default catalog creation could not be reconciled.', { cause: reconciliationFailure });
			}
			if (!recovered || !matchesEmptyCandidate(recovered, candidate)) throw failure;
		}
		admitted?.throwIfAborted();
		const pointer = readPointer({ schemaVersion: 1, kind: 'photo-library', catalogId });
		let published: boolean;
		try { published = await ports.settings.putIfAbsent(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1, pointer); }
		catch (failure) {
			// A lost acknowledgement may have published a valid pointer. Read-only
			// reconciliation cannot remove or replace any durable winner.
			try {
				const winner = await ports.settings.get(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1);
				if (winner !== undefined) return await openPointer(winner, ports);
			} catch (reconciliationFailure) {
				throw new AggregateError([failure, reconciliationFailure], 'Default library pointer publication could not be reconciled.', { cause: reconciliationFailure });
			}
			throw failure;
		}
		// An acknowledged scalar commit wins cancellation arriving with its ack.
		if (published) return candidate;
		admitted?.throwIfAborted();
		const winner = await ports.settings.get(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1);
		admitted?.throwIfAborted();
		if (winner === undefined) throw new Error('The winning photo library pointer is missing.');
		return openPointer(winner, ports, admitted);
	}, signal);
}

async function openPointer(value: unknown, ports: PhotoLibraryCatalogPointerPortsV1,
	signal?: AbortSignal): Promise<PhotoCatalogRootV1> {
	const pointer = readPointer(value);
	signal?.throwIfAborted();
	const root = await ports.catalog.loadCatalog(pointer.catalogId);
	signal?.throwIfAborted();
	if (root === null) throw new ReferenceError('The default photo library catalog is missing.');
	return readRoot(root, pointer.catalogId);
}

function readPointer(value: unknown): Readonly<PhotoLibraryCatalogPointerV1> {
	const input = readClosedDomainRecord(value, 'photo library pointer', ['schemaVersion', 'kind', 'catalogId']);
	const field = (key: string) => readClosedDomainField(input, key, 'photo library pointer');
	if (field('schemaVersion') !== 1 || field('kind') !== 'photo-library') throw new RangeError('Unsupported photo library pointer schema.');
	const pointer = Object.freeze({ schemaVersion: 1 as const, kind: 'photo-library' as const,
		catalogId: id(field('catalogId'), 'default catalog ID') });
	if (new TextEncoder().encode(JSON.stringify(pointer)).byteLength > PHOTO_LIBRARY_CATALOG_POINTER_MAXIMUM_BYTES_V1) {
		throw new RangeError('Photo library pointer exceeds its scalar byte bound.');
	}
	return pointer;
}

function readRoot(value: unknown, catalogId: string): PhotoCatalogRootV1 {
	const document = validateLightscaperDocumentV1(value);
	if (document.kind !== 'photo-catalog' || document.id !== catalogId) throw new TypeError('Default photo catalog identity disagrees with its pointer.');
	return document;
}

function matchesEmptyCandidate(root: PhotoCatalogRootV1, candidate: PhotoCatalogRootV1): boolean {
	return root.name === candidate.name && root.revision === 0 && root.photoCount === 0
		&& root.folders.length === 0 && root.keywords.length === 0 && root.collections.length === 0;
}
