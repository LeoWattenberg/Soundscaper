/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { id } from '../catalog/value-validation.ts';
import { normalizePhotoLibraryRestoreAllocationV1, photoLibraryRestoreNamespacesV1 } from './photo-library-restore-ownership-v1.ts';

export const PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2 = 'lightscaper-photo-catalog-v1';
export const PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2 = 'lightscaper-photo-media-v2';
export const PHOTO_LIBRARY_LOCATION_POINTER_MAXIMUM_BYTES_V2 = 1_024;
export interface PhotoLibraryLocationPointerV1 { readonly schemaVersion: 1; readonly kind: 'photo-library'; readonly catalogId: string }
export interface PhotoLibraryLocationPointerV2 { readonly schemaVersion: 2; readonly kind: 'photo-library'; readonly catalogId: string; readonly namespaceToken: string }
export type PhotoLibraryLocationPointer = Readonly<PhotoLibraryLocationPointerV1 | PhotoLibraryLocationPointerV2>;
export interface PhotoLibraryLocationV2 {
	readonly catalogId: string;
	readonly namespaceToken: string | null;
	readonly catalogDatabaseName: string;
	readonly mediaDatabaseName: string;
}
const LEGACY_FIELDS = ['schemaVersion', 'kind', 'catalogId'] as const;
const RESTORED_FIELDS = [...LEGACY_FIELDS, 'namespaceToken'] as const;

/** Preserve the validated stored field order: native key/value CAS includes insertion order. */
export function readPhotoLibraryLocationPointerV2(value: unknown): PhotoLibraryLocationPointer {
	const input = readClosedDomainRecord(value, 'photo library location', RESTORED_FIELDS, LEGACY_FIELDS);
	const field = (key: string) => readClosedDomainField(input, key, 'photo library location');
	const version = field('schemaVersion');
	if ((version !== 1 && version !== 2) || field('kind') !== 'photo-library') throw new RangeError('Unsupported photo library location schema.');
	readClosedDomainRecord(input, 'photo library location', version === 1 ? LEGACY_FIELDS : RESTORED_FIELDS);
	id(field('catalogId'), 'photo library catalog ID');
	if (version === 2 && (typeof field('namespaceToken') !== 'string' || !/^[a-f0-9]{32}$/u.test(field('namespaceToken') as string))) {
		throw new TypeError('Photo library namespace requires 32 lowercase hexadecimal characters.');
	}
	const detached: Record<string, unknown> = {};
	for (const key of Object.keys(input)) detached[key] = field(key);
	if (new TextEncoder().encode(JSON.stringify(detached)).byteLength > PHOTO_LIBRARY_LOCATION_POINTER_MAXIMUM_BYTES_V2) throw new RangeError('Photo library pointer exceeds its scalar byte bound.');
	return Object.freeze(detached) as unknown as PhotoLibraryLocationPointer;
}

export function photoLibraryRestorePointerV2(value: unknown): Readonly<PhotoLibraryLocationPointerV2> {
	const allocation = normalizePhotoLibraryRestoreAllocationV1(value);
	return Object.freeze({ schemaVersion: 2, kind: 'photo-library', catalogId: allocation.catalogId, namespaceToken: allocation.namespaceToken });
}

/** The host supplies allocation from its validated permanent commit read from the fixed anchor. */
export function resolvePhotoLibraryLocationV2(value: unknown, committedAllocation?: unknown): Readonly<PhotoLibraryLocationV2> {
	const pointer = readPhotoLibraryLocationPointerV2(value);
	if (pointer.schemaVersion === 1) return Object.freeze({ catalogId: pointer.catalogId, namespaceToken: null,
		catalogDatabaseName: PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2, mediaDatabaseName: PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2 });
	const allocation = normalizePhotoLibraryRestoreAllocationV1(committedAllocation);
	if (pointer.catalogId !== allocation.catalogId || pointer.namespaceToken !== allocation.namespaceToken) throw new TypeError('Photo library pointer differs from its committed allocation.');
	return Object.freeze({ catalogId: pointer.catalogId, namespaceToken: pointer.namespaceToken, ...photoLibraryRestoreNamespacesV1(allocation) });
}
