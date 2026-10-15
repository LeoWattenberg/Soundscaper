/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { BinaryDerivativeCacheRepositoryV1, type BinaryDerivativeCachePortV1, type BinaryDerivativeCacheIdentityV1 } from '../src/common/editor/storage/binary-derivative-cache-repository.ts';
import { normalizeBinaryDerivativeCacheIdentityV1 } from '../src/common/editor/storage/binary-derivative-cache-records.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { freshVerifiedMediaContentDigest } from '../src/common/editor/storage/media-content-provenance.ts';
import { MediaAssetLifecycleCoordinator } from '../src/common/editor/storage/media-asset-lifecycle-coordinator.ts';
import { PhotoPreviewCacheV1, PHOTO_PREVIEW_CACHE_PROFILE_V1 } from '../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { planPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { preparePhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import { planPhotoCullingPreviewCurrentV1 } from '../src/lightscaper/preview/photo-culling-preview-plan-current-v1.ts';
import { preparePhotoCullingPreviewCurrentV1 } from '../src/lightscaper/preview/photo-culling-preview-preparation-current-v1.ts';
import { PhotoCullingPreviewCacheCurrentV1 } from '../src/lightscaper/preview/photo-culling-preview-cache-current-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const original = Uint8Array.from({ length: 123 }, (_, index) => index);
const sha256 = createHash('sha256').update(original).digest('hex');
const binding = { catalogId: 'camera-catalog', photoId: 'camera-photo', originalId: 'camera-original', storageKey: 'retained-camera',
	contentSha256: sha256, byteLength: original.byteLength, width: 4, height: 4 };
const descriptor = { schemaVersion: 1 as const, width: 4, height: 4, sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const };
const pixels = Uint8Array.from({ length: 64 }, (_, index) => index % 4 === 3 ? 255 : index);
const plan = () => planPhotoCullingPreviewCurrentV1({ binding, tier: 'thumbnail', source: 'camera-embedded' });
const prepared = () => preparePhotoCullingPreviewCurrentV1({ plan: plan(), binding, frame: { descriptor, pixels } });

async function fixture(maximumBytes: number = PHOTO_PREVIEW_CACHE_PROFILE_V1.maximumBytes) {
	const indexedDB = createInstrumentedIndexedDB(), name = `camera-culling-cache-${crypto.randomUUID()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, name), identities: BinaryDerivativeCacheIdentityV1[] = [];
	const retained = { sourceId: binding.storageKey, size: original.byteLength, blob: new Blob([original]), ...freshVerifiedMediaContentDigest(sha256) };
	indexedDB.seedRecord(name, 'mediaAssets', retained);
	const repository = new BinaryDerivativeCacheRepositoryV1({ memory: getMemoryDatabase(name), database: async () => database }, {
		async planBinaryWriter() { return null; },
		async loadBinaryRecord(row) { if (!(row.blob instanceof Blob)) throw new Error('Cache body missing.'); return row.blob; },
		async deletePath() {},
	}, new MediaAssetLifecycleCoordinator(), { ...PHOTO_PREVIEW_CACHE_PROFILE_V1, maximumBytes });
	let calls = 0;
	const core: BinaryDerivativeCachePortV1 = {
		load(...args) { calls++; return repository.load(...args); },
		store(value, ...args) { calls++; identities.push(normalizeBinaryDerivativeCacheIdentityV1(value, PHOTO_PREVIEW_CACHE_PROFILE_V1)); return repository.store(value, ...args); },
		trim(...args) { calls++; return repository.trim(...args); },
	};
	return { cache: new PhotoCullingPreviewCacheCurrentV1(core), core, database, indexedDB, name, retained, identities, calls: () => calls };
}

test('Light Current camera culling cache uses actual paired storage and preserves complete Original fencing', async t => {
	const f = await fixture(); t.after(() => f.database.close()); const value = await prepared();
	assert.deepEqual(await f.cache.store(value), { outcome: 'stored' });
	assert.equal(f.indexedDB.recordCount(f.name, 'videoDerivatives'), 1);
	assert.equal(f.indexedDB.recordCount(f.name, 'videoDerivativeCacheEntries'), 1);
	assert.equal(f.indexedDB.recordCount(f.name, 'mediaAssets'), 1);
	const identity = f.identities[0]!; assert.equal(identity.kind, PHOTO_PREVIEW_CACHE_PROFILE_V1.kind);
	assert.ok(identity.key.startsWith(PHOTO_PREVIEW_CACHE_PROFILE_V1.keyPrefix));
	assert.equal(identity.originalSha256, sha256); assert.equal(identity.originalByteLength, original.byteLength);
	assert.equal(identity.sourceId, binding.storageKey); assert.deepEqual(JSON.parse(identity.metadata), plan());
	assert.ok(new TextEncoder().encode(JSON.stringify(identity)).length < 4096);
	assert.equal(Object.hasOwn(identity, 'originalMediaContentToken'), false);
	const loaded = await new PhotoCullingPreviewCacheCurrentV1(f.core).load(plan()); assert.ok(loaded);
	const { body: loadedBody, ...loadedScalars } = loaded, { body: preparedBody, ...preparedScalars } = value;
	assert.deepEqual(loadedScalars, preparedScalars);
	assert.deepEqual(new Uint8Array(await loadedBody.arrayBuffer()), pixels);
	assert.deepEqual(new Uint8Array(await loadedBody.arrayBuffer()), new Uint8Array(await preparedBody.arrayBuffer()));
	assert.equal(loaded.outputSha256, createHash('sha256').update(new Uint8Array(await loadedBody.arrayBuffer())).digest('hex'));
	f.indexedDB.seedRecord(f.name, 'mediaAssets', { ...f.retained, ...freshVerifiedMediaContentDigest(sha256) });
	assert.equal(await f.cache.load(plan()), null, 'a private Original token replacement must invalidate the disposable body');
	assert.deepEqual(new Uint8Array(await f.retained.blob.arrayBuffer()), original);
	assert.equal(f.indexedDB.stats.getAllRequests.length, 0);
});

test('Light camera and permanent Original preview share one bounded capacity with distinct keys', async t => {
	const f = await fixture(64); t.after(() => f.database.close());
	const legacy = new PhotoPreviewCacheV1(f.core), legacyPlan = planPhotoPreviewV1({ binding, source: descriptor, tier: 'thumbnail' });
	const legacyBody = await preparePhotoPreviewV1({ plan: legacyPlan, binding, frame: { descriptor, pixels } });
	await legacy.store(legacyBody); assert.ok(await legacy.load(legacyPlan));
	const camera = await prepared(); assert.notEqual(camera.key, legacyBody.key); await f.cache.store(camera);
	assert.equal(await legacy.load(legacyPlan), null); assert.ok(await f.cache.load(plan()));
	assert.equal(f.indexedDB.recordCount(f.name, 'videoDerivativeCacheEntries'), 1);
	await assert.rejects(legacy.store(camera)); await assert.rejects(f.cache.store(legacyBody));
	await assert.rejects(legacy.load(plan())); await assert.rejects(f.cache.load(legacyPlan));
	assert.equal(f.indexedDB.recordCount(f.name, 'mediaAssets'), 1);
});

test('Light Current culling cache refuses changed policy and prepared geometry before shared storage', async t => {
	const f = await fixture(); t.after(() => f.database.close()); const value = await prepared(); let getters = 0;
	for (const changed of [{ ...value, key: 'photo-preview-sha256:' + '0'.repeat(64) }, { ...value, byteLength: 63 },
		{ ...value, descriptor: { ...descriptor, width: 2 } }, { ...value, binding: { ...binding, photoId: 'other' } },
		{ ...value, recipe: { ...value.recipe, cameraFit: 'stretch' } }, { ...value, body: new Blob(['short']) },
		{ ...value, original: new Blob([original]) }, Object.defineProperty({ ...value }, 'body', { enumerable: true, get() { getters++; throw new Error('body getter'); } })]) {
		await assert.rejects(f.cache.store(changed));
	}
	assert.equal(f.calls(), 0); assert.equal(getters, 0);
	await assert.rejects(f.cache.store({ ...value, outputSha256: 'b'.repeat(64) }), /digest/iu);
	assert.equal(f.indexedDB.recordCount(f.name, 'videoDerivativeCacheEntries'), 0);
	assert.equal(f.indexedDB.recordCount(f.name, 'videoDerivatives'), 0);
});

test('Light Current culling paired publication rolls back a real inventory write failure', async t => {
	const f = await fixture(); t.after(() => f.database.close()); const value = await prepared();
	f.indexedDB.failNextPutForStore('videoDerivativeCacheEntries', new Error('culling pair failure'));
	await assert.rejects(f.cache.store(value), /culling pair failure/iu);
	assert.equal(f.indexedDB.recordCount(f.name, 'videoDerivativeCacheEntries'), 0);
	assert.equal(f.indexedDB.recordCount(f.name, 'videoDerivatives'), 0);
	assert.equal(await f.cache.load(plan()), null); assert.equal(f.indexedDB.recordCount(f.name, 'mediaAssets'), 1);
});

test('Light Current culling cache pins methods and receiver and retains acknowledged commit diagnostics', async t => {
	const f = await fixture(); t.after(() => f.database.close()); const value = await prepared();
	const controller = new AbortController(), reason = new Error('after real cache ACK'), issue = new Error('acknowledged cleanup');
	const ports: BinaryDerivativeCachePortV1 = { ...f.core, async store(...args) {
		assert.equal(this, ports); const result = await f.core.store(...args); controller.abort(reason);
		return { ...result, cleanupErrors: [issue] };
	} };
	const cache = new PhotoCullingPreviewCacheCurrentV1(ports);
	ports.store = async () => { throw new Error('replaced cache port'); };
	const receipt = await cache.store(value, controller.signal); assert.equal(receipt.outcome, 'stored'); assert.deepEqual(receipt.cleanupErrors, [issue]);
	assert.ok(Object.isFrozen(receipt)); assert.ok(Object.isFrozen(receipt.cleanupErrors)); assert.ok(await f.cache.load(plan()));
	const count = f.calls();
	for (const operation of [() => f.cache.load(plan(), controller.signal), () => f.cache.store(value, controller.signal), () => f.cache.trim(controller.signal)]) {
		await assert.rejects(operation(), error => error === reason);
	}
	assert.equal(f.calls(), count);
});
