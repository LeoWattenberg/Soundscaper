/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { id, oneOf } from '../catalog/value-validation.ts';

export const PHOTO_CATALOG_RESTORE_OWNER_STORE_V1 = 'photoCatalogRestoreOwners';
export const PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1 = 'photo-library:restore-owner-v1';
export const PHOTO_LIBRARY_RESTORE_ALLOCATION_MAXIMUM_BYTES_V1 = 2_048;
export const PHOTO_LIBRARY_RESTORE_OWNER_MAXIMUM_BYTES_V1 = 2_048;

export interface PhotoLibraryRestoreAllocationV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-library-restore-allocation';
	readonly operationId: string;
	readonly namespaceToken: string;
	readonly ownerToken: string;
	readonly catalogId: string;
}
export interface PhotoLibraryRestoreNamespacesV1 {
	readonly catalogDatabaseName: string;
	readonly mediaDatabaseName: string;
}
export type PhotoLibraryRestoreOwnerComponentV1 = 'catalog' | 'media';
export interface PhotoLibraryRestoreOwnerMarkerV1 {
	readonly key: typeof PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1;
	readonly schemaVersion: 1;
	readonly kind: 'photo-library-restore-owner';
	readonly component: PhotoLibraryRestoreOwnerComponentV1;
	readonly operationId: string;
	readonly namespaceToken: string;
	readonly ownerToken: string;
	readonly catalogId: string;
	readonly databaseName: string;
}

const ALLOCATION_FIELDS = ['schemaVersion', 'kind', 'operationId', 'namespaceToken', 'ownerToken', 'catalogId'] as const;
const OWNER_FIELDS = ['key', 'schemaVersion', 'kind', 'component', 'operationId', 'namespaceToken', 'ownerToken', 'catalogId', 'databaseName'] as const;

/** The caller allocates and durably records both tokens before creation; inequality does not prove entropy. */
export function normalizePhotoLibraryRestoreAllocationV1(value: unknown): Readonly<PhotoLibraryRestoreAllocationV1> {
	const input = readClosedDomainRecord(value, 'photo library restore allocation', ALLOCATION_FIELDS);
	const field = (key: string) => readClosedDomainField(input, key, 'photo library restore allocation');
	if (field('schemaVersion') !== 1 || field('kind') !== 'photo-library-restore-allocation') throw new RangeError('Unsupported photo library restore allocation schema.');
	const operationId = token(field('operationId')), namespaceToken = token(field('namespaceToken')), ownerToken = token(field('ownerToken'));
	if (operationId !== namespaceToken) throw new TypeError('Restore operation and namespace identities disagree.');
	if (ownerToken === namespaceToken) throw new TypeError('Restore ownership requires a distinct externally allocated token.');
	const allocation = Object.freeze({ schemaVersion: 1 as const, kind: 'photo-library-restore-allocation' as const,
		operationId, namespaceToken, ownerToken, catalogId: id(field('catalogId'), 'restore catalog ID') });
	assertByteBudget(allocation, PHOTO_LIBRARY_RESTORE_ALLOCATION_MAXIMUM_BYTES_V1); return allocation;
}

export function photoLibraryRestoreNamespacesV1(value: unknown): Readonly<PhotoLibraryRestoreNamespacesV1> {
	return namespaces(normalizePhotoLibraryRestoreAllocationV1(value));
}

/** A scalar marker describes allocation ownership only, never readiness or permission to delete/publish. */
export function photoLibraryRestoreOwnerMarkerV1(value: unknown, component: PhotoLibraryRestoreOwnerComponentV1): Readonly<PhotoLibraryRestoreOwnerMarkerV1> {
	const allocation = normalizePhotoLibraryRestoreAllocationV1(value), target = oneOf(component, ['catalog', 'media'] as const, 'restore owner component');
	const physical = namespaces(allocation);
	const marker = Object.freeze({ key: PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1, schemaVersion: 1 as const, kind: 'photo-library-restore-owner' as const,
		component: target, operationId: allocation.operationId, namespaceToken: allocation.namespaceToken, ownerToken: allocation.ownerToken,
		catalogId: allocation.catalogId, databaseName: target === 'catalog' ? physical.catalogDatabaseName : physical.mediaDatabaseName });
	assertByteBudget(marker, PHOTO_LIBRARY_RESTORE_OWNER_MAXIMUM_BYTES_V1); return marker;
}

export function assertPhotoLibraryRestoreOwnerMarkerV1(value: unknown, allocation: unknown, component: PhotoLibraryRestoreOwnerComponentV1): void {
	const expected = photoLibraryRestoreOwnerMarkerV1(allocation, component);
	const input = readClosedDomainRecord(value, 'photo library restore owner', OWNER_FIELDS);
	for (const key of OWNER_FIELDS) if (readClosedDomainField(input, key, 'photo library restore owner') !== expected[key]) {
		throw new TypeError('Photo library restore ownership marker differs from its allocation.');
	}
}

function namespaces(allocation: PhotoLibraryRestoreAllocationV1): Readonly<PhotoLibraryRestoreNamespacesV1> {
	return Object.freeze({ catalogDatabaseName: `lightscaper-photo-catalog-restore-${allocation.namespaceToken}`,
		mediaDatabaseName: `lightscaper-photo-media-restore-${allocation.namespaceToken}` });
}
function token(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{32}$/u.test(value)) throw new TypeError('Restore tokens require exactly 32 lowercase hexadecimal characters.');
	return value;
}
function assertByteBudget(value: PhotoLibraryRestoreAllocationV1 | PhotoLibraryRestoreOwnerMarkerV1, maximum: number): void {
	// Only detached closed scalar objects reach JSON; caller toJSON/accessors never participate.
	if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maximum) throw new RangeError('Restore ownership exceeds its scalar byte budget.');
}
