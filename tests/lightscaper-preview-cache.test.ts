/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { BinaryDerivativeCacheIdentityV1, BinaryDerivativeCachePortV1 } from '../src/common/editor/storage/binary-derivative-cache-repository.ts';
import { normalizeBinaryDerivativeCacheIdentityV1 } from '../src/common/editor/storage/binary-derivative-cache-records.ts';
import { PhotoPreviewCacheV1, PHOTO_PREVIEW_CACHE_PROFILE_V1 } from '../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { planPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { preparePhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';

const binding = (photoId = 'photo') => ({ catalogId: 'catalog', photoId, originalId: `original-${photoId}`,
	storageKey: 'shared-original', contentSha256: 'a'.repeat(64), byteLength: 123, width: 2, height: 1 });
const descriptor = { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' };
const plan = (photoId = 'photo') => planPhotoPreviewV1({ binding: binding(photoId), source: descriptor, tier: 'thumbnail' });
const prepared = async (photoId = 'photo') => preparePhotoPreviewV1({ plan: plan(photoId), binding: binding(photoId),
	frame: { descriptor, pixels: Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255]) } });

function fixture() {
	const rows = new Map<string, { identity: BinaryDerivativeCacheIdentityV1; body: Blob; outputSha256: string }>();
	const stored: BinaryDerivativeCacheIdentityV1[] = [];
	let calls = 0;
	const core: BinaryDerivativeCachePortV1 = {
		async load(value) { calls += 1; const identity = normalizeBinaryDerivativeCacheIdentityV1(value, PHOTO_PREVIEW_CACHE_PROFILE_V1); return rows.get(identity.key) ?? null; },
		async store(value, body, outputSha256) {
			const identity = normalizeBinaryDerivativeCacheIdentityV1(value, PHOTO_PREVIEW_CACHE_PROFILE_V1);
			calls += 1; stored.push(identity);
			assert.ok(body instanceof Blob);
			rows.set(identity.key, { identity, body, outputSha256 });
			return Object.freeze({ outcome: 'stored' as const });
		},
		async trim() { calls += 1; const removedEntries = rows.size; rows.clear(); return { removedEntries, removedBytes: removedEntries * 8, more: false }; },
	};
	return { cache: new PhotoPreviewCacheV1(core), core, rows, stored, calls: () => calls };
}

test('photo cache binds complete normalized plans while retaining shared physical original identity', async () => {
	const current = fixture(), first = await prepared(), second = await prepared('second');
	await current.cache.store(first); await current.cache.store(second);
	assert.equal(current.rows.size, 2);
	assert.notEqual(current.stored[0].key, current.stored[1].key);
	for (const identity of current.stored) {
		assert.equal(identity.kind, 'photo-preview-cache'); assert.equal(identity.sourceId, 'shared-original');
		assert.equal(identity.originalByteLength, 123); assert.equal(identity.originalSha256, 'a'.repeat(64));
		assert.equal(Object.hasOwn(identity, 'timestamp'), false);
		assert.equal(Object.hasOwn(identity, 'originalMediaContentToken'), false);
		assert.ok(Object.isFrozen(identity)); assert.ok(new TextEncoder().encode(JSON.stringify(identity)).length <= 4_096);
	}
	assert.deepEqual(JSON.parse(current.stored[0].metadata), plan());
	const loaded = await current.cache.load(plan()); assert.ok(loaded);
	assert.deepEqual(loaded.binding, first.binding); assert.deepEqual(loaded.descriptor, first.descriptor);
	assert.equal(loaded.outputSha256, first.outputSha256);
	assert.deepEqual(new Uint8Array(await loaded.body.arrayBuffer()), new Uint8Array(await first.body.arrayBuffer()));
	assert.ok(Object.isFrozen(loaded));
	assert.equal(await current.cache.load(plan('missing')), null);
	await current.cache.trim(); assert.equal(await current.cache.load(plan()), null);
	assert.deepEqual(PHOTO_PREVIEW_CACHE_PROFILE_V1, { kind: 'photo-preview-cache', keyPrefix: 'photo-preview-sha256:',
		maximumBytes: 134_217_728, maximumEntries: 1_024, maximumManifestBytes: 4_096, maximumEvictions: 16 });
});

test('prepared cache admission rejects altered version, recipe, geometry, length and unknown fields before storage', async () => {
	const current = fixture(), value = await prepared();
	for (const changed of [{ ...value, schemaVersion: 2 }, { ...value, kind: 'photo' }, { ...value, key: 'photo-preview-sha256:' + 'b'.repeat(64) },
		{ ...value, recipe: { ...value.recipe, version: 2 } }, { ...value, descriptor: { ...value.descriptor, width: 1 } },
		{ ...value, byteLength: 9 }, { ...value, body: new Blob(['short']) }, { ...value, outputSha256: 'invalid' },
		{ ...value, binding: { ...value.binding, storageKey: 'other' } }, { ...value, original: new Blob(['private']) }]) {
		await assert.rejects(current.cache.store(changed));
	}
	assert.equal(current.calls(), 0);
});

test('closed cache values reject getters without invoking them and use genuine Blob intrinsics', async () => {
	const current = fixture(), value = await prepared(); let invoked = 0;
	const hostile = Object.defineProperty({ ...value }, 'body', { enumerable: true, get() { invoked += 1; throw new Error('body getter'); } });
	await assert.rejects(current.cache.store(hostile), TypeError);
	const badPlan = Object.defineProperty({ ...plan() }, 'source', { enumerable: true, get() { invoked += 1; throw new Error('source getter'); } });
	await assert.rejects(current.cache.load(badPlan), TypeError); assert.equal(current.calls(), 0);
	for (const key of ['size', 'type', 'slice', 'arrayBuffer']) Object.defineProperty(value.body, key, { get() { invoked += 1; throw new Error('Blob getter'); } });
	await current.cache.store(value); assert.equal(invoked, 0); assert.equal(current.rows.size, 1);
});

test('a returned cache record must retain the exact requested plan and output binding', async () => {
	const current = fixture(), value = await prepared(); await current.cache.store(value);
	const row = current.rows.get(value.key)!;
	for (const changed of [{ ...row, identity: { ...row.identity, metadata: JSON.stringify(plan('other')) } },
		{ ...row, identity: { ...row.identity, sourceId: 'other' } }, { ...row, outputSha256: 'future' },
		{ ...row, body: new Blob(['short']) }]) {
		current.rows.set(value.key, changed); await assert.rejects(current.cache.load(plan()));
	}
});

test('pressure and postcommit diagnostics remain distinct from cancellation before storage', async () => {
	const value = await prepared(), controller = new AbortController(), error = new Error('cancel cached preview');
	controller.abort(error); const current = fixture();
	await assert.rejects(current.cache.store(value, controller.signal), candidate => candidate === error);
	await assert.rejects(current.cache.load(plan(), controller.signal), candidate => candidate === error);
	await assert.rejects(current.cache.trim(controller.signal), candidate => candidate === error);
	assert.equal(current.calls(), 0);
	const pressure = new PhotoPreviewCacheV1({ ...current.core, async store() { return { outcome: 'pressure' }; } });
	assert.deepEqual(await pressure.store(value), { outcome: 'pressure' });
	const issue = new Error('committed cleanup failed');
	const acknowledged = new PhotoPreviewCacheV1({ ...current.core, async store() { return { outcome: 'stored', cleanupErrors: [issue] }; } });
	const receipt = await acknowledged.store(value); assert.equal(receipt.outcome, 'stored');
	assert.deepEqual(receipt.cleanupErrors, [issue]); assert.ok(Object.isFrozen(receipt));
});

test('cache port admission snapshots its validated functions', async () => {
	const current = fixture(), cache = new PhotoPreviewCacheV1(current.core), value = await prepared();
	current.core.store = async () => { throw new Error('replaced validated cache function'); };
	await cache.store(value); assert.equal(current.rows.size, 1);
});
