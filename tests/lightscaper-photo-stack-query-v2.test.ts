/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readPhotoStackQueryPageV2 } from '../src/lightscaper/catalog/photo-stack-query-v2.ts';
import { admitPhotoStackQueryPageRequestV2, readPhotoStackQueryContinuationV2, type PhotoStackQueryPageV2 } from '../src/lightscaper/catalog/photo-stack-query-types-v2.ts';
import { normalizePhotoCatalogQueryV2, type PhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { readPhotoQueryPageV2 } from '../src/lightscaper/catalog/photo-query-pages-v2.ts';
import { readPhotoStackQueryPageV1 } from '../src/lightscaper/catalog/photo-stack-query-pages-v1.ts';
import { readPhotoStackQueryContinuationV1 } from '../src/lightscaper/catalog/photo-stack-query-types-v1.ts';
import { stackMetadataQueryFixtureV2, mutateStackQueryStoreV2 } from './helpers/lightscaper-photo-stack-query-v2-fixture.ts';

const ordinary = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', sort: { field: 'file-name', direction: 'ascending' } });
const isoQuery = normalizePhotoCatalogQueryV2({ ...ordinary, predicate: { kind: 'number', column: 'iso', minimum: 200, maximum: 200 } });
type Fixture = Awaited<ReturnType<typeof stackMetadataQueryFixtureV2>>;
const ids = (count: number) => Array.from({ length: count }, (_, n) => `photo-${String(n + 1)}`);

async function collect(f: Fixture, query: PhotoCatalogQueryV2 = ordinary) {
	let continuation: PhotoStackQueryPageV2['continuation'] = null;
	const found: string[] = [], pages: PhotoStackQueryPageV2[] = [];
	do {
		const before = f.indexedDB.stats.getRequests.length;
		const page = await readPhotoStackQueryPageV2(f.database, f.root.id, { query, continuation });
		assert.ok(page.scanned <= 64 && page.items.length <= 64); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		assert.ok(f.indexedDB.stats.getRequests.slice(before).filter(row => row.store === 'photoQueryRowsV2').length <= 64);
		assert.equal(f.indexedDB.stats.getAllRequests.length, 0); assert.equal(f.indexedDB.stats.countRequests.length, 0);
		if (page.continuation) assert.ok(new TextEncoder().encode(JSON.stringify(page.continuation)).byteLength <= 4_096);
		found.push(...page.items.map(row => row.photoId)); pages.push(page); continuation = page.continuation;
		assert.ok(pages.length < 1_100, 'signed bounded progress must advance');
	} while (continuation);
	return { found, pages };
}

test('collapsed V2 selects the matching metadata cover globally and exposes fresh scalar root context', async () => {
	const f = await stackMetadataQueryFixtureV2();
	try {
		await f.group(['photo-1', 'photo-65', 'photo-130'], 'photo-130');
		const result = await collect(f), expected = ids(130).filter(id => !['photo-1', 'photo-65'].includes(id));
		assert.deepEqual(result.found, expected); assert.equal(new Set(result.found).size, result.found.length);
		for (const page of result.pages) {
			assert.equal(page.schemaVersion, 2); assert.equal(page.kind, 'collapsed-photo-query-page'); assert.equal(page.catalogId, f.root.id);
			assert.equal(page.catalogRevision, f.root.revision + 1); assert.equal(page.stateRevision, 1);
			assert.equal(page.catalogName, f.root.name); assert.equal(page.totalCount, 130); assert.ok(page.indexRevision > 0);
		}
		assert.equal(f.indexedDB.stats.getRequests.some(row => row.store === 'photos'), false);
	} finally { await f.close(); }
});

test('metadata-excluded cover falls back to the first global matching member in either direction', async () => {
	const f = await stackMetadataQueryFixtureV2();
	try {
		await f.group(['photo-65', 'photo-130', 'photo-1'], 'photo-130');
		for (const direction of ['ascending', 'descending'] as const) {
			const query = normalizePhotoCatalogQueryV2({ ...isoQuery, sort: { ...isoQuery.sort, direction } });
			const result = await collect(f, query), winner = direction === 'ascending' ? 'photo-1' : 'photo-65';
			const expected = ids(129).filter(id => !['photo-1', 'photo-65'].includes(id) || id === winner);
			assert.deepEqual(result.found, direction === 'ascending' ? expected : expected.reverse());
			const plain = await readPhotoQueryPageV2(f.database, f.root.id, { query }); assert.ok(plain.items.every(row => row.photoId !== 'photo-130'));
		}
	} finally { await f.close(); }
});

test('eligible cover authenticates every130 members through bounded pending pages before emitting', async () => {
	const f = await stackMetadataQueryFixtureV2();
	try {
		await f.group(ids(130), 'photo-1');
		const first = await readPhotoStackQueryPageV2(f.database, f.root.id, { query: ordinary });
		assert.deepEqual(first.items, []); assert.ok(first.continuation?.pending); assert.equal(first.scanned, 64);
		const result = await collect(f); assert.deepEqual(result.found, ['photo-1']); assert.ok(result.pages.length >= 3);
		const inspected = new Set(f.indexedDB.stats.getRequests.filter(row => row.store === 'photoStackMemberships').map(row => row.key));
		for (const photoId of ids(130)) assert.ok(inspected.has(`${f.root.id}|${photoId}`));
	} finally { await f.close(); }
});

test('signed V2 progress rejects tampering, another physical connection identity, and V1 token admission', async () => {
	const f = await stackMetadataQueryFixtureV2();
	try {
		await f.group(ids(130), 'photo-1');
		const first = await readPhotoStackQueryPageV2(f.database, f.root.id, { query: ordinary }); assert.ok(first.continuation?.pending);
		for (const patch of [{ pending: { ...first.continuation.pending, nextMember: 130 } }, { stateRevision: 0 }, { progressSha256: '0'.repeat(64) }]) {
			await assert.rejects(readPhotoStackQueryPageV2(f.database, f.root.id, { query: ordinary, continuation: { ...first.continuation, ...patch } }), /signature|authentication|progress/iu);
		}
		// Fake factory returns the same DB object; native browser qualification must use two genuine connections.
		await assert.rejects(readPhotoStackQueryPageV2(new Proxy(f.database, {}), f.root.id, { query: ordinary, continuation: first.continuation }), /signature|authentication/iu);
		assert.throws(() => readPhotoStackQueryContinuationV1(first.continuation, f.root.id, ordinary));
		const old = await readPhotoStackQueryPageV1(f.database, f.root.id, { query: { text: '', filter: null, sort: ordinary.sort } });
		assert.ok(old.continuation); assert.throws(() => readPhotoStackQueryContinuationV2(old.continuation, f.root.id, ordinary));
		await assert.rejects(readPhotoStackQueryPageV2(f.database, f.root.id, { query: isoQuery, continuation: first.continuation }), /query/iu);
	} finally { await f.close(); }
});

test('resumed member corruption and missing reverse/forward bindings refuse before any representative', async () => {
	for (const storeName of ['photoQueryRowsV2', 'photoStackMemberships']) {
		const f = await stackMetadataQueryFixtureV2();
		try {
			await f.group(ids(130), 'photo-1'); const page = await readPhotoStackQueryPageV2(f.database, f.root.id, { query: ordinary }); assert.ok(page.continuation);
			await mutateStackQueryStoreV2(f.database, storeName, store => { store.delete(`${f.root.id}|photo-100`); });
			await assert.rejects(readPhotoStackQueryPageV2(f.database, f.root.id, { query: ordinary, continuation: page.continuation }), /missing|membership|reverse/iu);
		} finally { await f.close(); }
	}
});

test('fresh metadata or grouping edits invalidate pending continuations instead of mixing snapshots', async () => {
	for (const owner of ['photo', 'stack'] as const) {
		const f = await stackMetadataQueryFixtureV2();
		try {
			const stack = await f.group(ids(130), 'photo-1'), page = await readPhotoStackQueryPageV2(f.database, f.root.id, { query: ordinary }); assert.ok(page.continuation);
			if (owner === 'photo') {
				const photo = await f.repository.loadPhoto(f.root.id, 'photo-2'); assert.ok(photo);
				await f.repository.savePhoto({ ...photo, metadata: { ...photo.metadata, cameraMake: 'Edited' } }, photo.revision);
			} else await f.repository.saveStack({ ...stack, coverPhotoId: 'photo-2' }, stack.revision,
				{ expectedCatalogRevision: f.root.revision + 1, expectedStateRevision: 1 });
			await assert.rejects(readPhotoStackQueryPageV2(f.database, f.root.id, { query: ordinary, continuation: page.continuation }), /revision/iu);
		} finally { await f.close(); }
	}
});

test('hostile requests and pre/late cancellation preserve exact reasons and join underlying transactions', async () => {
	const f = await stackMetadataQueryFixtureV2();
	try {
		await f.group(ids(130), 'photo-1'); let calls = 0;
		const before = f.indexedDB.stats.getRequests.length;
		await assert.rejects(readPhotoStackQueryPageV2(f.database, f.root.id, Object.defineProperty({}, 'query', {
			enumerable: true, get() { calls++; return ordinary; } })));
		const reason = new Proxy({}, { getPrototypeOf() { throw new Error('Abort reasons are opaque.'); } });
		await assert.rejects(readPhotoStackQueryPageV2(f.database, f.root.id, { signal: AbortSignal.abort(reason) }), error => error === reason);
		assert.equal(calls, 0); assert.equal(f.indexedDB.stats.getRequests.length, before);
		const stop = new AbortController(); f.indexedDB.onNextGetForStore('photoQueryRowsV2', () => { stop.abort(reason); });
		await assert.rejects(readPhotoStackQueryPageV2(f.database, f.root.id, { query: ordinary, signal: stop.signal }), error => error === reason);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await f.close(); }
});

test('V2 closed request admission refuses unknown versions and sparse/accessor predicates without invocation', () => {
	let calls = 0;
	const sparse: unknown[] = []; sparse.length = 1;
	for (const request of [{ query: { ...ordinary, schemaVersion: 3 } }, { future: true }, { query: { ...ordinary,
		predicate: { kind: 'all', terms: sparse } } }, { query: { ...ordinary, predicate: { kind: 'number', column: 'iso',
			get minimum() { calls++; return 200; }, maximum: 200 } } }]) assert.throws(() => admitPhotoStackQueryPageRequestV2('catalog-1', request));
	assert.equal(calls, 0);
});

test('65 grouping pairs authenticate key-only count pages before metadata representatives', async () => {
	const f = await stackMetadataQueryFixtureV2();
	try {
		for (let index = 0; index < 65; index++) await f.group([`photo-${String(index * 2 + 1)}`, `photo-${String(index * 2 + 2)}`],
			`photo-${String(index * 2 + 1)}`, `stack-${String(index).padStart(3, '0')}`, index);
		const first = await readPhotoStackQueryPageV2(f.database, f.root.id, { query: isoQuery });
		assert.deepEqual(first.items, []); assert.equal(first.scanned, 64); assert.equal(first.continuation?.stackAudit?.count, 64);
		assert.equal(first.continuation?.pending, null);
		const result = await collect(f, isoQuery); assert.deepEqual(result.found, ids(130).filter((_, index) => index % 2 === 0));
		assert.equal(result.pages.at(-1)?.stateRevision, 65);
	} finally { await f.close(); }
});

test('dense1024 reversed membership uses metadata eligibility and global unknown-date-last order both ways', async () => {
	const f = await stackMetadataQueryFixtureV2(1_024, (index, source) => ({ metadata: { ...source.metadata,
		fileName: `Photo ${String(index).padStart(4, '0')}.png`, iso: index === 1_024 ? 800 : 200,
		captureTime: index % 3 === 0 ? null : { local: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString().slice(0, 19), offsetMinutes: null } } }));
	try {
		await f.group(ids(1_024).reverse(), 'photo-1024');
		for (const direction of ['ascending', 'descending'] as const) {
			const query = normalizePhotoCatalogQueryV2({ ...isoQuery, sort: { field: 'capture-time', direction } });
			let continuation: PhotoStackQueryPageV2['continuation'] = null, winner: string | undefined, steps = 0;
			do {
				const page = await readPhotoStackQueryPageV2(f.database, f.root.id, { query, continuation });
				assert.ok(page.scanned <= 64 && page.items.length <= 64);
				winner = page.items[0]?.photoId; continuation = page.continuation; steps++;
				if (!winner) { assert.ok(continuation?.pending); assert.ok(steps < 25); }
			} while (winner === undefined && continuation);
			assert.equal(winner, direction === 'ascending' ? 'photo-1' : 'photo-1022'); assert.ok(steps >= 17);
		}
	} finally { await f.close(); }
});

test('Build2 readiness/count, grouping count and corrupt effective rows refuse output', async () => {
	for (const corruption of ['not-ready', 'build-count', 'stack-count', 'metadata', 'projection'] as const) {
		const f = await stackMetadataQueryFixtureV2(2);
		try {
			await f.group(['photo-1', 'photo-2'], 'photo-1');
			if (corruption === 'not-ready' || corruption === 'build-count') await mutateStackQueryStoreV2(f.database, 'photoQueryBuildStatesV2', store => {
				store.put({ id: f.root.id, schemaVersion: 2, ready: corruption !== 'not-ready', afterKey: null, indexedCount: corruption === 'build-count' ? 1 : 2 });
			});
			else if (corruption === 'stack-count') await mutateStackQueryStoreV2(f.database, 'photoStacks', store => { store.delete(`${f.root.id}|stack`); });
			else {
				const row = f.indexedDB.records(f.databaseName, 'photoQueryRowsV2')[0] as Record<string, unknown>;
				await mutateStackQueryStoreV2(f.database, 'photoQueryRowsV2', store => { store.put({ ...row,
					...(corruption === 'metadata' ? { iso: Number.NaN } : { fileNameSort: 'forged' }) }); });
			}
			await assert.rejects(readPhotoStackQueryPageV2(f.database, f.root.id, { query: ordinary }));
			assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { await f.close(); }
	}
});

test('every missing metadata hierarchy reference refuses before scanning any Row2 even under a true OR', async () => {
	const f = await stackMetadataQueryFixtureV2(2);
	try {
		const query = normalizePhotoCatalogQueryV2({ ...ordinary, predicate: { kind: 'any', terms: [
			{ kind: 'presence', column: 'title', value: 'known' }, { kind: 'keyword', id: 'missing' },
		] } });
		const before = f.indexedDB.stats.getRequests.length;
		await assert.rejects(readPhotoStackQueryPageV2(f.database, f.root.id, { query }), ReferenceError);
		assert.deepEqual(f.indexedDB.stats.getRequests.slice(before).filter(row => row.store === 'photoQueryRowsV2'), []);
	} finally { await f.close(); }
});

test('sparse metadata matches resume empty pages and use effective authored facts without widening text search', async () => {
	const f = await stackMetadataQueryFixtureV2(130, (index, source) => ({ metadata: { ...source.metadata,
		fileName: `Photo ${String(index).padStart(4, '0')}.png`, copyright: index === 129 ? 'Searchable effective rights' : '', cameraMake: null } }));
	try {
		const query = normalizePhotoCatalogQueryV2({ ...ordinary, predicate: { kind: 'all', terms: [
			{ kind: 'text', column: 'copyright', operator: 'contains', value: 'EFFECTIVE RIGHTS' },
			{ kind: 'presence', column: 'camera-make', value: 'unknown' },
		] } });
		const result = await collect(f, query); assert.deepEqual(result.found, ['photo-129']);
		assert.deepEqual(result.pages.slice(0, 2).map(page => page.items), [[], []]);
		assert.deepEqual((await collect(f, normalizePhotoCatalogQueryV2({ ...ordinary, text: 'effective rights' }))).found, []);
	} finally { await f.close(); }
});
