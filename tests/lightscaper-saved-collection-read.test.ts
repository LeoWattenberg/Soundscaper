/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { admitPhotoLibrarySavedPageRequestV1, admitPhotoLibrarySavedSnapshotRequestV1, admitPhotoLibrarySavedQueryRequestV1 } from '../src/lightscaper/controller/photo-library-saved-collection-admission-v1.ts';
import { readPhotoLibrarySavedPageV1, readPhotoLibrarySavedSnapshotV1, readPhotoLibrarySavedQueryStepV1 } from '../src/lightscaper/controller/photo-library-saved-collection-read-v1.ts';
import { photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { smartCollectionDefinitionV1 as definition, smartCollectionRepositoryFixtureV1 as fixture } from './helpers/lightscaper-smart-collection-repository-fixture.ts';

test('actual repository page and atomic snapshot expose only detached presentation scalars', async () => {
	const f = await fixture(); f.seed(65);
	try {
		const first = await readPhotoLibrarySavedPageV1(f.repository, 'catalog', admitPhotoLibrarySavedPageRequestV1());
		assert.equal(first.items.length, 64); assert.ok(first.cursor);
		assert.deepEqual(Object.keys(first.items[0]!).sort(), ['id', 'name', 'revision']);
		const next = await readPhotoLibrarySavedPageV1(f.repository, 'catalog', admitPhotoLibrarySavedPageRequestV1({ cursor: first.cursor }));
		assert.equal(next.items.length, 1); assert.equal(next.cursor, null);
		const snapshot = await readPhotoLibrarySavedSnapshotV1(f.repository, 'catalog', admitPhotoLibrarySavedSnapshotRequestV1({ collectionId: 'saved-0064' }));
		assert.equal(snapshot.definition?.id, 'saved-0064'); assert.equal(snapshot.context.collectionCount, 65);
		assert.deepEqual(JSON.parse(snapshot.definition!.queryJson) as unknown, { ...definition().query, text: 'landscape' });
		assert.equal(Object.hasOwn(snapshot, 'root'), false); assert.ok(Object.isFrozen(snapshot.definition));
	} finally { f.database.close(); await f.repository.close(); }
});

test('selected snapshot rejects wrong pair and context before publishing scalar data', async () => {
	const request = admitPhotoLibrarySavedSnapshotRequestV1({ collectionId: 'saved' });
	const context = { catalogId: 'catalog', catalogRevision: 0, indexRevision: 0, collectionStateRevision: 0, collectionCount: 1 };
	for (const value of [
		{ schemaVersion: 1, kind: 'photo-smart-collection-snapshot', selectedId: 'other', context, definition: definition() },
		{ schemaVersion: 1, kind: 'photo-smart-collection-snapshot', selectedId: 'saved', context: { ...context, catalogId: 'foreign' }, definition: definition() },
	]) await assert.rejects(readPhotoLibrarySavedSnapshotV1({ readSmartCollectionSnapshotV1: async () => value }, 'catalog', request));
});

const digest = 'a'.repeat(64);
function queryPage(mode: 'ordinary' | 'collapsed' = 'ordinary') {
	return { schemaVersion: 1, kind: 'saved-photo-query-page', mode, catalogId: 'catalog', catalogName: 'Catalog', totalCount: 1,
		catalogRevision: 2, indexRevision: 3, collectionId: 'saved', collectionName: 'Saved', definitionRevision: 1,
		collectionStateRevision: 2, definitionSha256: digest, querySha256: 'b'.repeat(64), stackStateRevision: mode === 'ordinary' ? null : 0,
		items: [photoSummary(queryPhotoV1(0))], scanned: 1, continuation: null };
}
function cursor(mode: 'ordinary' | 'collapsed' = 'ordinary') {
	const page = queryPage(mode);
	return { schemaVersion: 1, kind: 'saved-photo-query', mode, catalogId: page.catalogId, collectionId: page.collectionId,
		definitionRevision: page.definitionRevision, collectionStateRevision: page.collectionStateRevision,
		definitionSha256: page.definitionSha256, querySha256: page.querySha256, catalogRevision: page.catalogRevision,
		indexRevision: page.indexRevision, sort: { field: 'photo-id', direction: 'ascending' }, captureBucket: 0,
		afterKey: ['catalog', 'photo-000000'], stackStateRevision: page.stackStateRevision, pending: null, stackAudit: null, progressSha256: 'c'.repeat(64) };
}

test('saved query projects the actual bounded page without another snapshot, and collapsed work may exceed photo count', async () => {
	let calls = 0;
	const repository = { readSmartCollectionQueryPageV1: async () => { calls++; return queryPage(); },
		readSmartCollectionStackQueryPageV1: async () => { calls++; return { ...queryPage('collapsed'), scanned: 64 }; } };
	const ordinary = await readPhotoLibrarySavedQueryStepV1(repository, 'catalog', admitPhotoLibrarySavedQueryRequestV1({ collectionId: 'saved', mode: 'ordinary' }));
	assert.equal(ordinary.rows.length, 1); assert.equal(Object.hasOwn(ordinary.context, 'collectionCount'), false);
	assert.deepEqual(Object.keys(ordinary.rows[0]!).sort(), ['colorLabel', 'fileName', 'flag', 'height', 'id', 'rating', 'width']);
	const collapsed = await readPhotoLibrarySavedQueryStepV1(repository, 'catalog', admitPhotoLibrarySavedQueryRequestV1({ collectionId: 'saved', mode: 'collapsed' }));
	assert.equal(collapsed.scanned, 64); assert.equal(collapsed.totalCount, 1); assert.equal(calls, 2);
});

test('saved query checks incoming and emitted identity, every row and closed native output', async () => {
	const incoming = cursor(), request = admitPhotoLibrarySavedQueryRequestV1({ collectionId: 'saved', mode: 'ordinary', cursor: JSON.stringify(incoming) });
	const valid = queryPage();
	for (const value of [
		{ ...valid, definitionRevision: 2 }, { ...valid, querySha256: 'd'.repeat(64) }, { ...valid, collectionStateRevision: 3 },
		{ ...valid, mode: 'collapsed' }, { ...valid, future: true }, { ...valid, scanned: 65 },
		{ ...valid, items: [valid.items[0], valid.items[0]] }, { ...valid, items: [{ ...valid.items[0], catalogId: 'foreign' }] },
		{ ...valid, continuation: { ...incoming, definitionSha256: 'd'.repeat(64) } },
		{ ...valid, continuation: { ...incoming, sort: { ...incoming.sort, direction: 'descending' } } },
	]) await assert.rejects(readPhotoLibrarySavedQueryStepV1({ readSmartCollectionQueryPageV1: async () => value,
		readSmartCollectionStackQueryPageV1: async () => { throw new Error('Wrong mode'); } }, 'catalog', request));
	let calls = 0;
	await assert.rejects(readPhotoLibrarySavedQueryStepV1({ readSmartCollectionQueryPageV1: async () => { calls++; return valid; },
		readSmartCollectionStackQueryPageV1: async () => { throw new Error('Wrong mode'); } }, 'foreign', request));
	assert.equal(calls, 0);
});

test('saved reads join a held port through cancellation and refuse a late signal accessor without evaluating it', async () => {
	const held = deferred<unknown>(), stop = new AbortController(); let settled = false, gets = 0;
	const work = readPhotoLibrarySavedPageV1({ readSmartCollectionPage: async () => held.promise }, 'catalog',
		admitPhotoLibrarySavedPageRequestV1({ signal: stop.signal }));
	const finished = work.then(() => { settled = true; }, () => { settled = true; });
	stop.abort(17); await new Promise<void>(resolve => setTimeout(resolve, 0)); assert.equal(settled, false);
	held.resolve({ items: [], continuation: null }); await assert.rejects(work, error => error === 17); await finished;
	const signal = new AbortController().signal;
	await assert.rejects(readPhotoLibrarySavedPageV1({ readSmartCollectionPage: async () => {
		Object.defineProperty(signal, 'reason', { get() { gets++; return null; } }); return { items: [], continuation: null };
	} }, 'catalog', admitPhotoLibrarySavedPageRequestV1({ signal })), /native cancellation/iu);
	assert.equal(gets, 0);
});

test('maximal Unicode summary page is bounded and rejects overflow, duplicates and mismatched continuation', async () => {
	const f = await fixture(); f.seed(64);
	try {
		const page = await f.repository.readSmartCollectionPage('catalog');
		const items = page.items.map(row => ({ ...row, name: '\ud800'.repeat(256) }));
		const repo = { readSmartCollectionPage: async () => ({ ...page, items }) };
		const accepted = await readPhotoLibrarySavedPageV1(repo, 'catalog', admitPhotoLibrarySavedPageRequestV1());
		assert.equal(accepted.items.length, 64); assert.ok(new TextEncoder().encode(JSON.stringify(accepted.items)).byteLength < 262144);
		for (const bad of [
			{ ...page, items: [...items, items[0]] }, { ...page, items: [items[0], items[0]] },
			{ ...page, items, continuation: { ...page.continuation, afterKey: '["catalog","wrong"]' } },
			{ ...page, items, future: true },
		]) await assert.rejects(readPhotoLibrarySavedPageV1({ readSmartCollectionPage: async () => bad }, 'catalog', admitPhotoLibrarySavedPageRequestV1()));
	} finally { f.database.close(); await f.repository.close(); }
});

test('actual stored Query2 executes through scalar ordinary and collapsed saved continuations', async () => {
	const f = await fixture();
	try {
		await f.repository.saveSmartCollection({ ...definition(), query: normalizePhotoCatalogQueryV2() }, null, await f.writeOptions());
		for (let offset = 0, revision = 1; offset < 70; offset += 16, revision++) {
			await f.repository.publishPhotos('catalog', revision, Array.from({ length: Math.min(16, 70 - offset) }, (_, index) => queryPhotoV1(offset + index)));
		}
		for (const mode of ['ordinary', 'collapsed'] as const) {
			const first = await readPhotoLibrarySavedQueryStepV1(f.repository, 'catalog', admitPhotoLibrarySavedQueryRequestV1({ collectionId: 'saved', mode }));
			assert.equal(first.rows.length, 64); assert.equal(first.scanned, 64); assert.ok(first.cursor);
			const second = await readPhotoLibrarySavedQueryStepV1(f.repository, 'catalog', admitPhotoLibrarySavedQueryRequestV1({ collectionId: 'saved', mode, cursor: first.cursor }));
			assert.equal(second.rows.length, 6); assert.equal(second.cursor, null);
			assert.deepEqual([...first.rows, ...second.rows].map(row => row.id), Array.from({ length: 70 }, (_, index) => queryPhotoV1(index).id));
		}
	} finally { f.database.close(); await f.repository.close(); }
});

test('private lifetime override cancels the owning read without copying its admitted request or touching the caller signal', async () => {
	const caller = new AbortController(), lifetime = new AbortController(), held = deferred<void>();
	let nativeSignal: AbortSignal | undefined, settled = false;
	const admitted = admitPhotoLibrarySavedPageRequestV1({ signal: caller.signal });
	const work = readPhotoLibrarySavedPageV1({ readSmartCollectionPage: async (_id, options) => {
		nativeSignal = options.signal; await held.promise; return { items: [], continuation: null };
	} }, 'catalog', admitted, lifetime.signal);
	const outcome = work.then(() => { settled = true; }, () => { settled = true; });
	try {
		lifetime.abort(17); await new Promise<void>(resolve => setTimeout(resolve, 0));
		assert.equal(nativeSignal?.aborted, true); assert.equal(caller.signal.aborted, false); assert.equal(settled, false);
		held.resolve(); await assert.rejects(work, error => error === 17); await outcome;
		assert.equal(admitPhotoLibrarySavedPageRequestV1(admitted), admitted);
	} finally { held.resolve(); await outcome; }
});
