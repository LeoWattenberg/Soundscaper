/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { BinaryDerivativeCacheRepositoryV1 } from '../src/common/editor/storage/binary-derivative-cache-repository.ts';
import type { BinaryDerivativeCacheIdentityV1, BinaryDerivativeCacheProfileV1 } from '../src/common/editor/storage/binary-derivative-cache-records.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { freshVerifiedMediaContentDigest } from '../src/common/editor/storage/media-content-provenance.ts';
import { MediaAssetLifecycleCoordinator } from '../src/common/editor/storage/media-asset-lifecycle-coordinator.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { OpfsBinaryWriterPlan } from '../src/common/editor/storage/opfs-repository.ts';
import type { StorageRecord } from '../src/common/editor/storage/media-records.ts';
import { VideoDerivativeRepository } from '../src/common/editor/storage/video-derivative-repository.ts';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { deferred } from './helpers/async-test-control.ts';

const PAYLOAD = 'videoDerivatives', INVENTORY = 'videoDerivativeCacheEntries';
const PROFILE: BinaryDerivativeCacheProfileV1 = Object.freeze({ kind: 'test-preview', keyPrefix: 'test-preview:',
	maximumBytes: 128 * 1024 * 1024, maximumEntries: 1_024, maximumManifestBytes: 4_096, maximumEvictions: 16 });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function identity(index = 0, body = 'body'): BinaryDerivativeCacheIdentityV1 {
	return { schemaVersion: 1, kind: PROFILE.kind, key: `${PROFILE.keyPrefix}${String(index).padStart(5, '0')}`, sourceId: 'source',
		originalSha256: 'a'.repeat(64), originalByteLength: 3, recipeId: 'test.recipe', recipeVersion: 1,
		byteLength: new TextEncoder().encode(body).byteLength, metadata: '{"tier":"thumbnail"}' };
}

let serial = 0;
async function fixture(profile = PROFILE, preferOpfs = false) {
	const name = `binary-cache-${String(++serial)}`, indexedDB = createInstrumentedIndexedDB();
	const database = await openDatabase(indexedDB as unknown as IDBFactory, name);
	const lifecycle = new MediaAssetLifecycleCoordinator(), files = new Map<string, Blob>();
	const writeSpans: number[] = [];
	let paths = 0, onWrite: (() => Promise<void>) | undefined, onDelete: ((path: string) => Promise<void>) | undefined;
	const original = { sourceId: 'source', size: 3, ...freshVerifiedMediaContentDigest('a'.repeat(64)) };
	indexedDB.seedRecord(name, 'mediaAssets', original);
	const binary = {
		async planBinaryWriter(): Promise<OpfsBinaryWriterPlan | null> {
			if (!preferOpfs) return null;
			const path = `cache-${String(++paths)}.blob`;
			const chunks: Uint8Array<ArrayBuffer>[] = [];
			return { path, open: async () => ({ path,
				write: async (bytes, options) => { await onWrite?.(); options?.signal?.throwIfAborted(); writeSpans.push(bytes.byteLength); chunks.push(Uint8Array.from(bytes)); files.set(path, new Blob(chunks)); },
				close: async options => { options?.signal?.throwIfAborted(); }, abort: async () => { files.delete(path); },
			}) };
		},
		async loadBinaryRecord(record: StorageRecord) {
			const blob = record.storage === 'opfs' ? files.get(String(record.path)) : record.blob;
			if (!(blob instanceof Blob)) throw new Error('Missing cache body'); return blob;
		},
		async deletePath(path: string | null | undefined) { if (path) { await onDelete?.(path); files.delete(path); } },
	};
	const cache = new BinaryDerivativeCacheRepositoryV1({ memory: getMemoryDatabase(name), database: async () => database }, binary, lifecycle, profile);
	return { cache, name, indexedDB, database, lifecycle, files, original, binary, writeSpans,
		writeHook: (hook: typeof onWrite) => { onWrite = hook; }, deleteHook: (hook: typeof onDelete) => { onDelete = hook; } };
}

test('paired publication and point load bind the manifest, current trusted original and exact output body', async () => {
	const f = await fixture();
	try {
		assert.deepEqual(await f.cache.store(identity(), new Blob(['body']), hash('body')), { outcome: 'stored' });
		const loaded = await f.cache.load(identity()); assert.ok(loaded);
		assert.deepEqual(loaded.identity, identity()); assert.equal(loaded.outputSha256, hash('body')); assert.equal(await loaded.body.text(), 'body');
		assert.equal(f.indexedDB.recordCount(f.name, PAYLOAD), 1); assert.equal(f.indexedDB.recordCount(f.name, INVENTORY), 1);
		assert.equal(f.indexedDB.stats.getAllRequests.length, 0);
		assert.equal(await f.cache.load(identity(1)), null);
		assert.ok(Object.isFrozen(loaded.identity));
	} finally { f.database.close(); }
});

test('body hash/size, identity/profile and unsafe objects refuse before any staged body', async () => {
	const f = await fixture(PROFILE, true); let reads = 0;
	try {
		await assert.rejects(f.cache.store(identity(), new Blob(['body']), hash('wrong')), /digest/iu);
		await assert.rejects(f.cache.store(identity(), new Blob(['large']), hash('large')), /size|length/iu);
		for (const value of [{ ...identity(), schemaVersion: 2 }, { ...identity(), kind: 'video' }, { ...identity(), key: 'other:1' },
			{ ...identity(), metadata: '{ "tier": "thumbnail" }' }, { ...identity(), metadata: 'x'.repeat(4_097) }, { ...identity(), extra: 1 },
			Object.defineProperty({ ...identity() }, 'metadata', { enumerable: true, get() { reads++; return '{}'; } })]) {
			await assert.rejects(f.cache.store(value, new Blob(['body']), hash('body')));
		}
		assert.equal(reads, 0); assert.equal(f.files.size, 0); assert.equal(f.indexedDB.recordCount(f.name, PAYLOAD), 0);
	} finally { f.database.close(); }
});

test('unverified originals refuse and replacing only their private token during preparation fences publication', async () => {
	const f = await fixture(PROFILE, true);
	try {
		f.indexedDB.seedRecord(f.name, 'mediaAssets', { ...f.original, mediaContentDigestVersion: 0 });
		await assert.rejects(f.cache.store(identity(), new Blob(['body']), hash('body')), /trusted|original/iu);
		f.indexedDB.seedRecord(f.name, 'mediaAssets', f.original);
		f.writeHook(async () => { f.indexedDB.seedRecord(f.name, 'mediaAssets', { ...f.original, ...freshVerifiedMediaContentDigest('a'.repeat(64)) }); });
		await assert.rejects(f.cache.store(identity(), new Blob(['body']), hash('body')), /changed|original/iu);
		assert.equal(f.files.size, 0); assert.equal(f.indexedDB.recordCount(f.name, PAYLOAD), 0); assert.equal(f.indexedDB.recordCount(f.name, INVENTORY), 0);
	} finally { f.database.close(); }
});

test('each paired request failure rolls back both records and disposes only its unpublished OPFS body', async () => {
	for (const store of [PAYLOAD, INVENTORY]) {
		const f = await fixture(PROFILE, true);
		try {
			f.indexedDB.failNextPutForStore(store, new Error('Injected pair failure'));
			await assert.rejects(f.cache.store(identity(), new Blob(['body']), hash('body')), /pair failure/iu);
			assert.equal(f.indexedDB.recordCount(f.name, PAYLOAD), 0); assert.equal(f.indexedDB.recordCount(f.name, INVENTORY), 0);
			assert.equal(f.files.size, 0); assert.equal(f.indexedDB.recordCount(f.name, 'mediaAssets'), 1);
		} finally { f.database.close(); }
	}
});

test('publication accounts replacements and evicts bounded scalar metadata without reading inventory bodies', async () => {
	const f = await fixture({ ...PROFILE, maximumBytes: 8, maximumEntries: 2 }, true);
	try {
		for (const index of [0, 1, 2]) await f.cache.store(identity(index), new Blob(['body']), hash('body'));
		assert.equal(await f.cache.load(identity(0)), null);
		assert.equal(f.files.size, 2);
		await f.cache.store(identity(2, 'larger'), new Blob(['larger']), hash('larger'));
		assert.equal(await f.cache.load(identity(1)), null); assert.equal(f.files.size, 1);
		assert.equal((await f.cache.load(identity(2, 'larger')))?.body.size, 6);
		assert.equal(f.indexedDB.stats.getAllRequests.length, 0);
		assert.equal(f.indexedDB.stats.cursorRequests.some((request: { store: string; index: string | null }) => request.store === PAYLOAD && request.index === null), false);
	} finally { f.database.close(); }
});

test('publication pressure changes no pair and explicit trim removes at most16 before bounded retry', async () => {
	const f = await fixture(PROFILE, true);
	try {
		for (let index = 0; index < 18; index++) await f.cache.store(identity(index), new Blob(['body']), hash('body'));
		const narrow = new BinaryDerivativeCacheRepositoryV1({ memory: getMemoryDatabase(f.name), database: async () => f.database }, f.binary, f.lifecycle,
			{ ...PROFILE, maximumEntries: 1 });
		assert.deepEqual(await narrow.store(identity(99), new Blob(['body']), hash('body')), { outcome: 'pressure' });
		assert.equal(f.files.size, 18); assert.equal(f.indexedDB.recordCount(f.name, PAYLOAD), 18);
		assert.deepEqual(await narrow.trim(), { removedEntries: 16, removedBytes: 64, more: true });
		assert.equal(f.files.size, 2);
		assert.deepEqual(await narrow.store(identity(99), new Blob(['body']), hash('body')), { outcome: 'stored' });
		assert.equal(f.files.size, 1);
	} finally { f.database.close(); }
});

test('corrupt, missing, future and mismatched pairs refuse instead of becoming trusted cache hits', async () => {
	for (const mutation of ['missing', 'manifest', 'digest', 'size', 'body'] as const) {
		const f = await fixture();
		try {
			await f.cache.store(identity(), new Blob(['body']), hash('body'));
			const payload = f.indexedDB.records(f.name, PAYLOAD)[0];
			if (mutation === 'missing') f.indexedDB.seedRecord(f.name, INVENTORY, { ...payload, key: 'different' }, identity().key);
			if (mutation === 'manifest') f.indexedDB.seedRecord(f.name, PAYLOAD, { ...payload, binaryDerivativeManifest: JSON.stringify({ ...identity(), schemaVersion: 2 }) });
			if (mutation === 'digest') f.indexedDB.seedRecord(f.name, PAYLOAD, { ...payload, outputSha256: hash('other') });
			if (mutation === 'size') f.indexedDB.seedRecord(f.name, PAYLOAD, { ...payload, size: 99 });
			if (mutation === 'body') f.indexedDB.seedRecord(f.name, PAYLOAD, { ...payload, blob: new Blob(['evil']) });
			await assert.rejects(f.cache.load(identity()));
		} finally { f.database.close(); }
	}
});

test('original replacement makes a cache miss even when bytes and claimed digest stay the same', async () => {
	const f = await fixture();
	try {
		await f.cache.store(identity(), new Blob(['body']), hash('body'));
		f.indexedDB.seedRecord(f.name, 'mediaAssets', { ...f.original, ...freshVerifiedMediaContentDigest('a'.repeat(64)) });
		assert.equal(await f.cache.load(identity()), null);
	} finally { f.database.close(); }
});

test('postcommit cancellation and disposal failure preserve the stored acknowledgment and replacement body', async () => {
	const f = await fixture(PROFILE, true), cancellation = new AbortController(), failure = new Error('Disposal failed');
	try {
		await f.cache.store(identity(), new Blob(['body']), hash('body'));
		f.deleteHook(async () => { cancellation.abort(); throw failure; });
		const result = await f.cache.store(identity(), new Blob(['body']), hash('body'), cancellation.signal);
		assert.equal(result.outcome, 'stored'); assert.deepEqual(result.cleanupErrors, [failure]);
		assert.equal((await f.cache.load(identity()))?.body.size, 4);
	} finally { f.database.close(); }
});

test('same-turn maintenance fences admission and drains an OPFS write held before publication', async () => {
	const f = await fixture(PROFILE, true), held = deferred<void>(), started = deferred<void>();
	try {
		f.writeHook(async () => { started.resolve(); await held.promise; });
		const writing = f.cache.store(identity(), new Blob(['body']), hash('body'));
		await started.promise;
		assert.equal(f.lifecycle.activePaths().size, 1);
		const maintenance = f.lifecycle.beginMaintenance({ permanent: true }), draining = maintenance.abortActive();
		let drained = false; void draining.then(() => { drained = true; });
		await Promise.resolve(); assert.equal(drained, false);
		held.resolve(); await assert.rejects(writing, /cancel|abort|maintenance/iu); await draining;
		assert.equal(f.files.size, 0); assert.equal(f.indexedDB.recordCount(f.name, PAYLOAD), 0);
		await assert.rejects(f.cache.load(identity()), /closed/iu);
	} finally { held.resolve(); f.database.close(); }
});

test('maintenance in the same turn aborts before a captured database can publish', async () => {
	const f = await fixture();
	try {
		const writing = f.cache.store(identity(), new Blob(['body']), hash('body'));
		const maintenance = f.lifecycle.beginMaintenance({ permanent: true });
		const draining = maintenance.abortActive();
		await assert.rejects(writing); await draining;
		assert.equal(f.indexedDB.recordCount(f.name, PAYLOAD), 0);
	} finally { f.database.close(); }
});

test('1025 scoped metadata rows refuse bounded inventory, while unrelated prefixes are not collected', async () => {
	const f = await fixture();
	try {
		await f.cache.store(identity(), new Blob(['body']), hash('body'));
		const sample = f.indexedDB.records(f.name, INVENTORY)[0];
		for (let index = 1; index < 1_025; index++) {
			const candidate = identity(index);
			const originalManifest = JSON.parse(String(sample.binaryDerivativeManifest)) as Record<string, unknown>;
			f.indexedDB.seedRecord(f.name, INVENTORY, { ...sample, key: candidate.key,
				binaryDerivativeManifest: JSON.stringify({ ...originalManifest, key: candidate.key }) });
		}
		await assert.rejects(f.cache.trim(), /inventory|1024|1,024/iu);
		assert.equal(f.indexedDB.stats.getAllRequests.length, 0);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.database.close(); }
});

test('trim compares exact tokens and preserves a replacement published after its scalar snapshot', async () => {
	const f = await fixture(PROFILE, true);
	try {
		await f.cache.store(identity(0), new Blob(['body']), hash('body'));
		await f.cache.store(identity(1), new Blob(['body']), hash('body'));
		const old = f.indexedDB.records(f.name, PAYLOAD)[0];
		const replacement = { ...old, cacheToken: 'cache-replacement', path: 'replacement.blob' };
		f.files.set('replacement.blob', new Blob(['body']));
		f.indexedDB.onNextGetForStore(PAYLOAD, () => {
			f.indexedDB.seedRecord(f.name, PAYLOAD, replacement); f.indexedDB.seedRecord(f.name, INVENTORY, replacement);
		});
		const narrow = new BinaryDerivativeCacheRepositoryV1({ memory: getMemoryDatabase(f.name), database: async () => f.database }, f.binary, f.lifecycle, { ...PROFILE, maximumEntries: 0 });
		assert.deepEqual(await narrow.trim(), { removedEntries: 1, removedBytes: 4, more: true });
		assert.equal(await (await f.cache.load(identity(0)))?.body.text(), 'body');
		assert.equal(f.files.has('replacement.blob'), true);
	} finally { f.database.close(); }
});

test('disposal preserves current original, staging and replacement references to a detached cache path', async () => {
	for (const owner of ['mediaAssets', 'mediaAssetStaging', INVENTORY] as const) {
		const f = await fixture(PROFILE, true);
		try {
			await f.cache.store(identity(0), new Blob(['body']), hash('body'));
			const old = f.indexedDB.records(f.name, PAYLOAD)[0], path = String(old.path);
			if (owner === 'mediaAssets') f.indexedDB.seedRecord(f.name, owner, { sourceId: 'other-original', storage: 'opfs', path });
			if (owner === 'mediaAssetStaging') f.indexedDB.seedRecord(f.name, owner, { key: 'staged-other', kind: 'asset', path });
			if (owner === INVENTORY) f.indexedDB.seedRecord(f.name, owner, { ...old, key: 'other-cache:current' });
			await f.cache.store(identity(0), new Blob(['body']), hash('body'));
			assert.equal(f.files.has(path), true, `${owner} remains authoritative during disposal`);
			assert.equal((await f.cache.load(identity(0)))?.body.size, 4);
		} finally { f.database.close(); }
	}
});

test('replacing an original during cached body hashing cannot return the prior generation', async () => {
	const f = await fixture();
	try {
		await f.cache.store(identity(), new Blob(['body']), hash('body'));
		const bodyPort = { ...f.binary, loadBinaryRecord: async (record: StorageRecord) => {
			f.indexedDB.seedRecord(f.name, 'mediaAssets', { ...f.original, ...freshVerifiedMediaContentDigest('a'.repeat(64)) });
			return f.binary.loadBinaryRecord(record);
		} };
		const cache = new BinaryDerivativeCacheRepositoryV1({ memory: getMemoryDatabase(f.name), database: async () => f.database }, bodyPort, f.lifecycle, PROFILE);
		assert.equal(await cache.load(identity()), null);
	} finally { f.database.close(); }
});

test('durable cache refuses an unavailable database and validates raised or open profile bounds', async () => {
	const f = await fixture();
	try {
		const cache = new BinaryDerivativeCacheRepositoryV1({ memory: getMemoryDatabase(f.name), database: async () => null }, f.binary, f.lifecycle, PROFILE);
		await assert.rejects(cache.store(identity(), new Blob(['body']), hash('body')), /durable/iu);
		for (const profile of [{ ...PROFILE, maximumEntries: 1_025 }, { ...PROFILE, maximumBytes: PROFILE.maximumBytes + 1 },
			{ ...PROFILE, maximumManifestBytes: 4_097 }, { ...PROFILE, maximumEvictions: 17 }, { ...PROFILE, extra: true }]) {
			assert.throws(() => new BinaryDerivativeCacheRepositoryV1({ memory: getMemoryDatabase(f.name), database: async () => f.database }, f.binary, f.lifecycle, profile));
		}
		assert.equal(f.indexedDB.recordCount(f.name, PAYLOAD), 0);
	} finally { f.database.close(); }
});

test('an OPFS writer refusal uses the existing IndexedDB Blob fallback after joining stage cleanup', async () => {
	const f = await fixture(PROFILE, true);
	try {
		f.writeHook(async () => { throw new Error('OPFS quota refusal'); });
		assert.deepEqual(await f.cache.store(identity(), new Blob(['body']), hash('body')), { outcome: 'stored' });
		assert.equal(f.files.size, 0);
		assert.equal(f.indexedDB.records(f.name, PAYLOAD)[0].storage, 'indexeddb-blob');
		assert.equal(await (await f.cache.load(identity()))?.body.text(), 'body');
	} finally { f.database.close(); }
});

test('Video publication, trim, listing and deletion leave other cache kinds under their own profile', async () => {
	const f = await fixture();
	try {
		await f.cache.store(identity(), new Blob(['body']), hash('body'));
		const video = new VideoDerivativeRepository({ memory: getMemoryDatabase(f.name), database: async () => f.database }, new OpfsRepository({ preferOpfs: false }),
			{ cacheLimits: { maximumEntries: 1, maximumBytes: 4 } });
		await video.saveDerivative('source', { type: 'thumbnail', blob: new Blob(['vid']) });
		assert.equal((await f.cache.load(identity()))?.body.size, 4);
		await video.saveDerivative('source', { type: 'poster', blob: new Blob(['vid']) });
		assert.equal((await f.cache.load(identity()))?.body.size, 4);
		assert.equal((await video.allDerivativeRecords()).length, 1);
		assert.equal((await video.trimDerivatives({ maximumEntries: 0, maximumBytes: 0 })).removedEntries, 1);
		assert.equal((await f.cache.load(identity()))?.body.size, 4);
		await video.saveDerivative('source', { type: 'thumbnail', blob: new Blob(['vid']) });
		assert.equal((await video.listDerivatives('source')).length, 1);
		await video.deleteDerivative('source');
		assert.equal((await f.cache.load(identity()))?.body.size, 4);
		assert.equal(f.indexedDB.recordCount(f.name, PAYLOAD), 1); assert.equal(f.indexedDB.recordCount(f.name, INVENTORY), 1);
	} finally { f.database.close(); }
});

test('prefix inventory seeks across unrelated namespaces without collecting their records', async () => {
	const f = await fixture();
	try {
		await f.cache.store(identity(), new Blob(['body']), hash('body'));
		for (let index = 0; index < 2_000; index++) {
			f.indexedDB.seedRecord(f.name, INVENTORY, { key: `aaaa:${String(index)}`, unexpected: new Blob(['other body']) });
			f.indexedDB.seedRecord(f.name, INVENTORY, { key: `zzzz:${String(index)}`, unexpected: new Blob(['other body']) });
		}
		const start = f.indexedDB.stats.cursorRequests.length;
		const narrow = new BinaryDerivativeCacheRepositoryV1({ memory: getMemoryDatabase(f.name), database: async () => f.database }, f.binary, f.lifecycle, { ...PROFILE, maximumEntries: 0 });
		assert.deepEqual(await narrow.trim(), { removedEntries: 1, removedBytes: 4, more: false });
		const delivered = f.indexedDB.stats.cursorRequests.slice(start).reduce((count: number, cursor: { delivered: number }) => count + cursor.delivered, 0);
		assert.ok(delivered <= 8, `prefix seek delivered ${String(delivered)} records`);
		assert.equal(f.indexedDB.recordCount(f.name, INVENTORY), 4_000);
		assert.equal(f.indexedDB.stats.getAllRequests.length, 0);
	} finally { f.database.close(); }
});

test('a body above one read span uses4MiB staging chunks and remains exact after caller buffers are wiped', async () => {
	const f = await fixture(PROFILE, true), body = 'X'.repeat(4 * 1024 * 1024 + 3);
	try {
		await f.cache.store(identity(0, body), new Blob([body]), hash(body));
		assert.deepEqual(f.writeSpans, [4 * 1024 * 1024, 3]);
		const loaded = await f.cache.load(identity(0, body)); assert.ok(loaded);
		assert.equal(loaded.outputSha256, hash(body)); assert.equal(await loaded.body.text(), body);
	} finally { f.database.close(); }
});

test('primary publication and staged disposal failures remain separately reviewable', async () => {
	const f = await fixture(PROFILE, true), primary = new Error('Pair write failed'), cleanup = new Error('File cleanup failed');
	try {
		f.indexedDB.failNextPutForStore(INVENTORY, primary);
		f.deleteHook(async () => { throw cleanup; });
		await assert.rejects(f.cache.store(identity(), new Blob(['body']), hash('body')), (error: unknown) => {
			assert.ok(error instanceof AggregateError); assert.equal(error.cause, primary); assert.deepEqual(error.errors, [primary, cleanup]); return true;
		});
		assert.equal(f.indexedDB.recordCount(f.name, INVENTORY), 0); assert.equal(f.indexedDB.recordCount(f.name, PAYLOAD), 0);
		assert.equal(f.indexedDB.recordCount(f.name, 'mediaAssets'), 1);
	} finally { f.database.close(); }
});
