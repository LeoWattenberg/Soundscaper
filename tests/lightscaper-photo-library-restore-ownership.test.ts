/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoLibraryRestoreAllocationV1, photoLibraryRestoreNamespacesV1, photoLibraryRestoreOwnerMarkerV1,
	assertPhotoLibraryRestoreOwnerMarkerV1, PHOTO_CATALOG_RESTORE_OWNER_STORE_V1, PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1,
	PHOTO_LIBRARY_RESTORE_ALLOCATION_MAXIMUM_BYTES_V1, PHOTO_LIBRARY_RESTORE_OWNER_MAXIMUM_BYTES_V1,
	type PhotoLibraryRestoreOwnerComponentV1 } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';

const allocation = () => ({ schemaVersion: 1, kind: 'photo-library-restore-allocation', operationId: 'a'.repeat(32),
	namespaceToken: 'a'.repeat(32), ownerToken: 'b'.repeat(32), catalogId: 'catalog' });

test('closed allocation detaches caller data and derives separate bounded namespaces without remapping catalog IDs', () => {
	const input = allocation(), normalized = normalizePhotoLibraryRestoreAllocationV1(input);
	assert.deepEqual(normalized, input); assert.notEqual(normalized, input); assert.ok(Object.isFrozen(normalized));
	input.catalogId = 'changed'; input.namespaceToken = 'c'.repeat(32);
	assert.equal(normalized.catalogId, 'catalog'); assert.equal(normalized.namespaceToken, 'a'.repeat(32));
	const names = photoLibraryRestoreNamespacesV1(normalized);
	assert.deepEqual(names, { catalogDatabaseName: `lightscaper-photo-catalog-restore-${'a'.repeat(32)}`,
		mediaDatabaseName: `lightscaper-photo-media-restore-${'a'.repeat(32)}` });
	assert.ok(Object.isFrozen(names)); assert.ok(names.catalogDatabaseName.length <= 128); assert.ok(names.mediaDatabaseName.length <= 128);
	assert.notEqual(names.catalogDatabaseName, names.mediaDatabaseName);
	assert.notEqual(names.catalogDatabaseName, 'lightscaper-photo-catalog-v1'); assert.notEqual(names.mediaDatabaseName, 'lightscaper-photo-media-v2');
	assert.equal(PHOTO_CATALOG_RESTORE_OWNER_STORE_V1, 'photoCatalogRestoreOwners');
	assert.equal(PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1, 'photo-library:restore-owner-v1');
});

test('catalog and media markers bind the same persisted allocation to their exact physical component', () => {
	const descriptor = normalizePhotoLibraryRestoreAllocationV1({ ...allocation(), catalogId: 'z'.repeat(128) });
	for (const component of ['catalog', 'media'] as const) {
		const marker = photoLibraryRestoreOwnerMarkerV1(descriptor, component), names = photoLibraryRestoreNamespacesV1(descriptor);
		assert.deepEqual(marker, { key: PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1, schemaVersion: 1, kind: 'photo-library-restore-owner',
			component, operationId: descriptor.operationId, namespaceToken: descriptor.namespaceToken, ownerToken: descriptor.ownerToken,
			catalogId: descriptor.catalogId, databaseName: component === 'catalog' ? names.catalogDatabaseName : names.mediaDatabaseName });
		assert.ok(Object.isFrozen(marker)); assertPhotoLibraryRestoreOwnerMarkerV1(marker, descriptor, component);
		assertPhotoLibraryRestoreOwnerMarkerV1(structuredClone(marker), structuredClone(descriptor), component);
		assert.ok(new TextEncoder().encode(JSON.stringify(marker)).byteLength <= PHOTO_LIBRARY_RESTORE_OWNER_MAXIMUM_BYTES_V1);
	}
	assert.ok(new TextEncoder().encode(JSON.stringify(descriptor)).byteLength <= PHOTO_LIBRARY_RESTORE_ALLOCATION_MAXIMUM_BYTES_V1);
	assert.equal(PHOTO_LIBRARY_RESTORE_ALLOCATION_MAXIMUM_BYTES_V1, 2_048); assert.equal(PHOTO_LIBRARY_RESTORE_OWNER_MAXIMUM_BYTES_V1, 2_048);
});

test('allocation admission refuses future schemas, mismatched operations, reused owner identity and malformed scalar tokens', () => {
	const patches: readonly Readonly<Record<string, unknown>>[] = [
		{ schemaVersion: 2 }, { kind: 'photo-library' }, { operationId: 'c'.repeat(32) }, { ownerToken: 'a'.repeat(32) },
		{ namespaceToken: 'A'.repeat(32), operationId: 'A'.repeat(32) }, { namespaceToken: 'a'.repeat(31) },
		{ ownerToken: 'b'.repeat(33) }, { ownerToken: 'g'.repeat(32) }, { ownerToken: 17 }, { ownerToken: null },
		{ catalogId: '' }, { catalogId: 'x'.repeat(129) }, { catalogId: '../library' }, { catalogId: 'catalog|photo' },
		{ catalogId: '\u754c' }, { extra: true },
	];
	for (const patch of patches) {
		const value = { ...allocation(), ...patch };
		assert.throws(() => normalizePhotoLibraryRestoreAllocationV1(value));
		assert.throws(() => photoLibraryRestoreNamespacesV1(value));
		assert.throws(() => photoLibraryRestoreOwnerMarkerV1(value, 'catalog'));
	}
	for (const value of [null, undefined, [], 17, new Date()]) assert.throws(() => normalizePhotoLibraryRestoreAllocationV1(value));
});

test('own scalar descriptors refuse accessors, symbols, inherited fields and arbitrary JSON behavior without invoking them', () => {
	let probes = 0;
	for (const field of Object.keys(allocation())) {
		const input = Object.defineProperty(allocation(), field, { enumerable: true, get() { probes++; throw new Error('getter'); } });
		assert.throws(() => normalizePhotoLibraryRestoreAllocationV1(input));
	}
	for (const input of [Object.assign(allocation(), { [Symbol('hidden')]: 1 }),
		Object.defineProperty(allocation(), 'toJSON', { value() { probes++; throw new Error('toJSON'); } }),
		Object.defineProperty(allocation(), 'ownerToken', { value: 'b'.repeat(32), enumerable: false }),
		Object.create(allocation()) as unknown,
	]) {
		assert.throws(() => normalizePhotoLibraryRestoreAllocationV1(input));
	}
	const proxy = new Proxy(allocation(), { get() { probes++; throw new Error('proxy get'); } });
	assert.deepEqual(normalizePhotoLibraryRestoreAllocationV1(proxy), allocation());
	assert.equal(probes, 0);
});

test('fresh namespaces differ for the same archived catalog and do not adopt caller namespace names', () => {
	const first = allocation(), second = { ...allocation(), operationId: 'c'.repeat(32), namespaceToken: 'c'.repeat(32) };
	const a = photoLibraryRestoreNamespacesV1(first), b = photoLibraryRestoreNamespacesV1(second);
	assert.notEqual(a.catalogDatabaseName, b.catalogDatabaseName); assert.notEqual(a.mediaDatabaseName, b.mediaDatabaseName);
	assert.throws(() => photoLibraryRestoreNamespacesV1({ ...first, catalogDatabaseName: a.catalogDatabaseName }));
	assert.throws(() => normalizePhotoLibraryRestoreAllocationV1({ ...first, databaseName: a.catalogDatabaseName }));
	assert.throws(() => assertPhotoLibraryRestoreOwnerMarkerV1(photoLibraryRestoreOwnerMarkerV1(first, 'catalog'), second, 'catalog'));
});

test('marker authority refuses every altered scalar, foreign components and additional fields', () => {
	const descriptor = allocation(), marker = photoLibraryRestoreOwnerMarkerV1(descriptor, 'catalog');
	const patches: readonly Readonly<Record<string, unknown>>[] = [
		{ key: 'owner' }, { schemaVersion: 2 }, { kind: 'photo-import' }, { component: 'media' },
		{ operationId: 'c'.repeat(32) }, { namespaceToken: 'c'.repeat(32) }, { ownerToken: 'c'.repeat(32) },
		{ catalogId: 'foreign' }, { databaseName: 'lightscaper-photo-catalog-v1' },
		{ databaseName: photoLibraryRestoreNamespacesV1(descriptor).mediaDatabaseName }, { extra: true },
	];
	for (const patch of patches) assert.throws(() => assertPhotoLibraryRestoreOwnerMarkerV1({ ...marker, ...patch }, descriptor, 'catalog'));
	assert.throws(() => assertPhotoLibraryRestoreOwnerMarkerV1(marker, { ...descriptor, ownerToken: 'c'.repeat(32) }, 'catalog'));
	assert.throws(() => assertPhotoLibraryRestoreOwnerMarkerV1(marker, descriptor, 'media'));
	for (const component of ['other', null, 17]) {
		assert.throws(() => photoLibraryRestoreOwnerMarkerV1(descriptor, component as PhotoLibraryRestoreOwnerComponentV1));
		assert.throws(() => assertPhotoLibraryRestoreOwnerMarkerV1(marker, descriptor, component as PhotoLibraryRestoreOwnerComponentV1));
	}
});

test('marker admission refuses accessors and symbol/toJSON additions without calling caller code', () => {
	const descriptor = allocation(), marker = photoLibraryRestoreOwnerMarkerV1(descriptor, 'media'); let probes = 0;
	for (const field of Object.keys(marker)) {
		const input = Object.defineProperty({ ...marker }, field, { enumerable: true, get() { probes++; throw new Error('getter'); } });
		assert.throws(() => assertPhotoLibraryRestoreOwnerMarkerV1(input, descriptor, 'media'));
	}
	assert.throws(() => assertPhotoLibraryRestoreOwnerMarkerV1({ ...marker, [Symbol('hidden')]: true }, descriptor, 'media'));
	assert.throws(() => assertPhotoLibraryRestoreOwnerMarkerV1({ ...marker, toJSON() { probes++; return marker; } }, descriptor, 'media'));
	assert.equal(probes, 0);
});
