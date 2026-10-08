/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readPhotoLibraryLocationPointerV2, photoLibraryRestorePointerV2, resolvePhotoLibraryLocationV2 } from '../src/lightscaper/storage/photo-library-location-v2.ts';
import { photoLibraryRestoreNamespacesV1 } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';

const allocation = { schemaVersion: 1 as const, kind: 'photo-library-restore-allocation' as const,
	operationId: 'a'.repeat(32), namespaceToken: 'a'.repeat(32), ownerToken: 'b'.repeat(32), catalogId: 'catalog' };

test('legacy pointer keeps its exact closed document and fixed namespaces', () => {
	const raw = { catalogId: 'catalog', kind: 'photo-library', schemaVersion: 1 };
	const pointer = readPhotoLibraryLocationPointerV2(raw);
	assert.deepEqual(Object.keys(pointer), Object.keys(raw)); assert.deepEqual(pointer, raw); assert.equal(Object.isFrozen(pointer), true);
	assert.deepEqual(resolvePhotoLibraryLocationV2(pointer), { catalogId: 'catalog', namespaceToken: null,
		catalogDatabaseName: 'lightscaper-photo-catalog-v1', mediaDatabaseName: 'lightscaper-photo-media-v2' });
});

test('restored location derives both physical names from a matching committed allocation', () => {
	const pointer = photoLibraryRestorePointerV2(allocation), names = photoLibraryRestoreNamespacesV1(allocation);
	assert.deepEqual(pointer, { schemaVersion: 2, kind: 'photo-library', catalogId: 'catalog', namespaceToken: allocation.namespaceToken });
	assert.deepEqual(resolvePhotoLibraryLocationV2(pointer, allocation), { catalogId: 'catalog', namespaceToken: allocation.namespaceToken, ...names });
	assert.throws(() => resolvePhotoLibraryLocationV2(pointer));
	assert.throws(() => resolvePhotoLibraryLocationV2(pointer, { ...allocation, catalogId: 'other' }));
	assert.throws(() => resolvePhotoLibraryLocationV2(pointer, { ...allocation, namespaceToken: 'c'.repeat(32), operationId: 'c'.repeat(32) }));
});

test('pointer detachment preserves every permitted input ordering and suppresses Proxy property reads', () => {
	for (const schemaVersion of [1, 2]) {
		const raw = schemaVersion === 1 ? { kind: 'photo-library', catalogId: 'catalog', schemaVersion }
			: { namespaceToken: allocation.namespaceToken, catalogId: 'catalog', schemaVersion, kind: 'photo-library' };
		let gets = 0; const pointer = readPhotoLibraryLocationPointerV2(new Proxy(raw, { get() { gets++; throw new Error('Property read.'); } }));
		assert.deepEqual(Object.keys(pointer), Object.keys(raw)); raw.catalogId = 'changed'; assert.equal(pointer.catalogId, 'catalog'); assert.equal(gets, 0);
	}
});

test('future, incomplete, accessor and arbitrary-name pointers fail closed without invoking behavior', () => {
	let gets = 0; const legacy = { schemaVersion: 1, kind: 'photo-library', catalogId: 'catalog' };
	for (const value of [{ ...legacy, schemaVersion: 3 }, { ...legacy, namespaceToken: allocation.namespaceToken },
		{ ...legacy, schemaVersion: 2 }, { ...legacy, catalogId: '../escape' }, { ...legacy, databaseName: 'other' },
		{ ...legacy, get catalogId() { gets++; throw new Error('Getter.'); } }, { ...legacy, toJSON() { gets++; return legacy; } },
		{ ...legacy, [Symbol('extra')]: true }, Object.create(legacy), { ...legacy, schemaVersion: 2, namespaceToken: 'A'.repeat(32) }]) {
		assert.throws(() => readPhotoLibraryLocationPointerV2(value));
	}
	assert.equal(gets, 0);
});
