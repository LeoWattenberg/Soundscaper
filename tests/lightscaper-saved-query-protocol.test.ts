/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { admitPhotoSavedQueryPageRequestV1, readPhotoSavedQueryContinuationV1 } from '../src/lightscaper/catalog/photo-smart-collection-query-types-v1.ts';
import { issuePhotoSavedQueryProgressV1, authenticatePhotoSavedQueryProgressV1 } from '../src/lightscaper/catalog/photo-smart-collection-query-progress-v1.ts';
import { smartCollectionRepositoryFixtureV1 as fixture } from './helpers/lightscaper-smart-collection-repository-fixture.ts';

const progress = { schemaVersion: 1 as const, kind: 'saved-photo-query' as const, mode: 'ordinary' as const, catalogId: 'catalog', collectionId: 'saved',
	definitionRevision: 0, collectionStateRevision: 1, definitionSha256: 'a'.repeat(64), querySha256: 'b'.repeat(64),
	catalogRevision: 1, indexRevision: 1, sort: { field: 'photo-id' as const, direction: 'ascending' as const },
	captureBucket: 0 as const, afterKey: ['catalog', 'photo'], stackStateRevision: null, pending: null, stackAudit: null };
const token = { ...progress, progressSha256: 'c'.repeat(64) };

test('closed saved protocol detaches dense positions, freezes nested progress and refuses every unknown/accessor field', () => {
	const supplied = structuredClone(token), admitted = readPhotoSavedQueryContinuationV1(supplied, 'catalog', 'saved', 'ordinary');
	supplied.afterKey[1] = 'mutated'; supplied.sort.direction = 'ascending';
	assert.deepEqual(admitted.afterKey, ['catalog', 'photo']); assert.ok(Object.isFrozen(admitted)); assert.ok(Object.isFrozen(admitted.afterKey)); assert.ok(Object.isFrozen(admitted.sort));
	let probes = 0;
	const sparse: unknown[] = []; sparse.length = 2;
	for (const value of [{ ...token, schemaVersion: 2 }, { ...token, future: true }, { ...token, definitionRevision: -0 },
		{ ...token, collectionStateRevision: Number.MAX_SAFE_INTEGER + 1 }, { ...token, definitionSha256: 'A'.repeat(64) },
		{ ...token, afterKey: sparse }, { ...token, afterKey: ['foreign', 'photo'] }, { ...token, afterKey: ['catalog', 'photo', 'extra'] },
		{ ...token, stackStateRevision: 1 }, { ...token, captureBucket: 1 }, { ...token, [Symbol('hidden')]: true },
		Object.defineProperty({ ...token }, 'sort', { enumerable: true, get() { probes++; return token.sort; } }),
		{ ...token, afterKey: Object.defineProperty(['catalog', 'photo'], '1', { enumerable: true, get() { probes++; return 'photo'; } }) }]) {
		assert.throws(() => readPhotoSavedQueryContinuationV1(value, 'catalog', 'saved', 'ordinary'));
	}
	assert.equal(probes, 0);
});

test('saved physical key grammar preserves all four sorts and known/unknown capture partitions', () => {
	for (const [field, captureBucket, afterKey] of [
		['photo-id', 0, ['catalog', 'photo']], ['file-name', 0, ['catalog', 'i'.repeat(512), 'photo']],
		['rating', 0, ['catalog', 5, 'photo']], ['capture-time', 0, ['catalog', 0, '2026-10-08T12:00:00.000', 'photo']],
		['capture-time', 1, ['catalog', 1, '', 'photo']],
	] as const) {
		const value = { ...token, sort: { field, direction: 'descending' }, captureBucket, afterKey };
		assert.deepEqual(readPhotoSavedQueryContinuationV1(value, 'catalog', 'saved', 'ordinary').afterKey, afterKey);
	}
	for (const afterKey of [['catalog', 6, 'photo']]) assert.throws(() => readPhotoSavedQueryContinuationV1({ ...token,
		sort: { field: 'rating', direction: 'ascending' }, afterKey }, 'catalog', 'saved', 'ordinary'));
	assert.throws(() => readPhotoSavedQueryContinuationV1({ ...token, sort: { field: 'file-name', direction: 'ascending' }, afterKey: ['catalog', 'x'.repeat(513), 'photo'] }, 'catalog', 'saved', 'ordinary'));
});

test('collapsed progress requires exact pending position and disjoint signed count-audit phase', () => {
	const collapsed = { ...token, mode: 'collapsed', stackStateRevision: 3, pending: { photoId: 'photo', stackId: 'stack', stackRevision: 0, nextMember: 1024 } };
	assert.equal(readPhotoSavedQueryContinuationV1(collapsed, 'catalog', 'saved', 'collapsed').pending?.nextMember, 1024);
	for (const patch of [{ stackStateRevision: null }, { pending: { ...collapsed.pending, nextMember: 1025 } },
		{ pending: { ...collapsed.pending, photoId: 'other' } }, { stackAudit: { afterKey: 'catalog|stack', count: 1 } }]) {
		assert.throws(() => readPhotoSavedQueryContinuationV1({ ...collapsed, ...patch }, 'catalog', 'saved', 'collapsed'));
	}
	const audit = { ...collapsed, pending: null, afterKey: null, stackAudit: { afterKey: 'catalog|stack', count: 64 } };
	assert.equal(readPhotoSavedQueryContinuationV1(audit, 'catalog', 'saved', 'collapsed').stackAudit?.count, 64);
	for (const afterKey of ['foreign|stack', 'catalog|', 'catalog|stack|extra']) assert.throws(() => readPhotoSavedQueryContinuationV1({ ...audit,
		stackAudit: { afterKey, count: 64 } }, 'catalog', 'saved', 'collapsed'));
});

test('whole envelope MAC refuses every scalar alteration and remains connection bound without retained definition inventories', async () => {
	const f = await fixture();
	try {
		const issued = issuePhotoSavedQueryProgressV1(f.database, progress); authenticatePhotoSavedQueryProgressV1(f.database, issued);
		for (const patch of [{ collectionId: 'other' }, { definitionRevision: 1 }, { collectionStateRevision: 2 },
			{ definitionSha256: 'd'.repeat(64) }, { querySha256: 'd'.repeat(64) }, { catalogRevision: 2 }, { indexRevision: 2 },
			{ sort: { field: 'photo-id' as const, direction: 'descending' as const } }, { afterKey: ['catalog', 'other'] }]) {
			assert.throws(() => authenticatePhotoSavedQueryProgressV1(f.database, { ...issued, ...patch }), /signature|authentication/iu);
		}
		assert.throws(() => authenticatePhotoSavedQueryProgressV1(new Proxy(f.database, {}), issued), /signature|authentication/iu);
		assert.ok(new TextEncoder().encode(JSON.stringify(issued)).byteLength <= 4096);
		assert.throws(() => admitPhotoSavedQueryPageRequestV1('catalog', 'saved', 'ordinary', { continuation: undefined }));
	} finally { f.database.close(); await f.repository.close(); }
});
