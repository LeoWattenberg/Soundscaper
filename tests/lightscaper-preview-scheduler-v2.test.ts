/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoPreviewSchedulerV2 } from '../src/lightscaper/preview/photo-preview-scheduler-v2.ts';
import { PhotoPreviewSchedulerV1 } from '../src/lightscaper/preview/photo-preview-scheduler-v1.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { PreparedPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import type { PhotoPreviewCachePortV1 } from '../src/lightscaper/preview/photo-preview-cache-v1.ts';
import type { withPhotoOriginalFrameV1 } from '../src/lightscaper/preview/photo-original-frame-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const frame = { descriptor: { schemaVersion: 1 as const, width: 1, height: 1, sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const },
	pixels: Uint8Array.of(12, 34, 56, 255) };
const SHA = 'b'.repeat(64), lut = { storageKey: `lut-sha256:${SHA}`, sha256: SHA, byteLength: 17, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
function fixture() {
	const legacy = photoArchiveFixture(1); let current: unknown = normalizePhotoDocumentV2({ ...legacy.photo, schemaVersion: 2,
		versions: legacy.photo.versions.map(version => ({ ...version, develop: { ...defaultImageDevelopStateV2(), effects: [
			{ id: 'profile', type: 'cube-lut-profile-v1', enabled: true, params: { lut } },
		] } })) });
	let cached: PreparedPhotoPreviewV1 | null = null;
	const stats = { reads: 0, decodes: 0, stores: 0 };
	const cache: PhotoPreviewCachePortV1 = { load: async () => cached, store: async () => { stats.stores++; return { outcome: 'stored' }; },
		trim: async () => ({ removedEntries: 0, removedBytes: 0, more: false }) };
	const regenerate: typeof withPhotoOriginalFrameV1 = async (_value, consume) => { stats.decodes++; return consume(frame, { orientation: 1, runtimeVersion: 'preview-test-2' }); };
	const options = { catalogId: 'catalog-1', cache, loadPhoto: async () => current,
		loadOriginal: async () => { stats.reads++; return legacy.original; }, regenerate };
	return { legacy, options, stats, replace(value: unknown) { current = value; }, current: () => current,
		useCached(value: PreparedPhotoPreviewV1) { cached = value; } };
}
const request = () => ({ photoId: 'photo-1', tier: 'thumbnail' as const });

test('Photo2 original previews retain the existing cache identity and exact pixels across mixed catalog reads', async () => {
	const f = fixture(), scheduler = new PhotoPreviewSchedulerV2(f.options);
	try {
		const ready = await scheduler.request(request()); assert.equal(ready.outcome, 'ready');
		if (ready.outcome !== 'ready') assert.fail('Missing current preview');
		assert.deepEqual(new Uint8Array(await ready.preview.body.arrayBuffer()), frame.pixels);
		f.useCached(ready.preview);
		f.replace({ ...f.legacy.photo, revision: 1, rating: 5 });
		const cached = await scheduler.request(request()); assert.equal(cached.outcome, 'ready');
		if (cached.outcome !== 'ready') assert.fail('Missing legacy cache hit');
		assert.equal(cached.cache, 'hit'); assert.equal(cached.preview, ready.preview);
		assert.deepEqual(f.stats, { reads: 1, decodes: 1, stores: 1 });
	} finally { await scheduler.close(); }
	const old = fixture(), strict = new PhotoPreviewSchedulerV1(old.options);
	try { await assert.rejects(strict.request(request())); assert.equal(old.stats.reads, 0); }
	finally { await strict.close(); }
});

test('current previews refuse future, malformed disabled recipes and another physical photo before body IO', async () => {
	for (const change of [{ ...photoArchiveFixture(1).photo, schemaVersion: 3 }, { ...photoArchiveFixture(1).photo, id: 'other' },
		{ ...photoArchiveFixture(1).photo, catalogId: 'other' }, { ...photoArchiveFixture(1).photo, schemaVersion: 2,
			versions: [{ ...photoArchiveFixture(1).photo.versions[0], develop: { ...defaultImageDevelopStateV2(), effects: [{ id: 'bad', type: 'future-v99', enabled: false, params: {} }] } }] }]) {
		const f = fixture(); f.replace(change); const scheduler = new PhotoPreviewSchedulerV2(f.options);
		try { await assert.rejects(scheduler.request(request())); assert.equal(f.stats.reads, 0); assert.equal(f.stats.stores, 0); }
		finally { await scheduler.close(); }
	}
});

test('current preview requests coalesce and Close joins held Photo2 reads before releasing the scalar queue', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>();
	const scheduler = new PhotoPreviewSchedulerV2({ ...f.options, loadPhoto: async () => { entered.resolve(); await release.promise; return f.current(); } });
	const first = scheduler.request(request()), second = scheduler.request(request());
	const refusals = [first, second].map(work => work.then(() => false, () => true));
	await entered.promise; assert.deepEqual(scheduler.status(), { closed: false, active: true, queued: 0, pendingRequests: 2 });
	const closing = scheduler.close(); assert.equal(closing, scheduler.close()); assert.equal(await remainsPending(closing), true);
	release.resolve(); await closing; assert.deepEqual(await Promise.all(refusals), [true, true]);
	assert.equal(f.stats.reads, 0); assert.deepEqual(scheduler.status(), { closed: true, active: false, queued: 0, pendingRequests: 0 });
});

test('current preview port methods are captured without function metadata reads and cannot be replaced by later work', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>();
	const reader = new Proxy(async () => { entered.resolve(); await release.promise; return f.current(); }, { get() { assert.fail('Function metadata inspected'); } });
	const options = { ...f.options, loadPhoto: reader }, scheduler = new PhotoPreviewSchedulerV2(options);
	const work = scheduler.request(request()); await entered.promise;
	Reflect.set(options, 'loadPhoto', async () => { assert.fail('Replaced reader invoked'); });
	release.resolve(); try { assert.equal((await work).outcome, 'ready'); } finally { await scheduler.close(); }
});

test('both fixed preview owners retain the legacy optional decoder default on an explicit undefined port', async () => {
	for (const Owner of [PhotoPreviewSchedulerV1, PhotoPreviewSchedulerV2]) {
		const f = fixture(), scheduler = new Owner({ ...f.options, regenerate: undefined });
		await scheduler.close(); assert.deepEqual(f.stats, { reads: 0, decodes: 0, stores: 0 });
	}
});

for (const Owner of [PhotoPreviewSchedulerV1, PhotoPreviewSchedulerV2]) {
	test(`${Owner.name} cannot enqueue a request whose reflection closes its scheduler`, async () => {
		const f = fixture(), scheduler = new Owner(f.options); let closing: Promise<void> | undefined;
		const value = new Proxy(request(), { ownKeys(target) { closing = scheduler.close(); return Reflect.ownKeys(target); } });
		const work = scheduler.request(value), outcome = work.then(() => true, () => false);
		assert.ok(closing); await closing;
		assert.deepEqual(scheduler.status(), { closed: true, active: false, queued: 0, pendingRequests: 0 });
		assert.equal(await outcome, false); assert.equal(f.stats.reads, 0);
	});

	test(`${Owner.name} registers its active join before invoking a synchronous loader that closes it`, async () => {
		const f = fixture(), entered = deferred<void>(), release = deferred<void>(), closings: Promise<void>[] = [];
		if (Owner === PhotoPreviewSchedulerV1) f.replace(f.legacy.photo);
		const scheduler: PhotoPreviewSchedulerV1 | PhotoPreviewSchedulerV2 = new Owner({ ...f.options, async loadPhoto() {
			closings.push(scheduler.close()); entered.resolve(); await release.promise; return f.current();
		} });
		const outcome = scheduler.request(request()).then(() => true, () => false);
		await entered.promise;
		try { assert.equal(await remainsPending(closings[0]!), true); }
		finally { release.resolve(); await closings[0]; await outcome; }
		assert.deepEqual(scheduler.status(), { closed: true, active: false, queued: 0, pendingRequests: 0 });
		assert.equal(f.stats.reads, 0); assert.equal(f.stats.stores, 0);
	});

	test(`${Owner.name} caches the identical Close promise before native abort listeners can reenter`, async () => {
		const f = fixture(), entered = deferred<void>(), release = deferred<void>(), nested: Promise<void>[] = [];
		if (Owner === PhotoPreviewSchedulerV1) f.replace(f.legacy.photo);
		const scheduler: PhotoPreviewSchedulerV1 | PhotoPreviewSchedulerV2 = new Owner({ ...f.options, async loadOriginal(_key, signal) {
			signal.addEventListener('abort', () => { nested.push(scheduler.close()); }, { once: true });
			entered.resolve(); await release.promise; return f.legacy.original;
		} });
		const outcome = scheduler.request(request()).then(() => true, () => false); await entered.promise;
		const closing = scheduler.close();
		try {
			assert.equal(nested.length, 1); assert.equal(nested[0] === closing, true);
			assert.equal(scheduler.close() === closing, true); assert.equal(await remainsPending(closing), true);
		} finally { release.resolve(); await Promise.all([closing, ...nested]); await outcome; }
		assert.equal(f.stats.decodes, 0); assert.equal(f.stats.stores, 0);
	});

	test(`${Owner.name} joins native cancellation despite a loader shadowing the private signal method`, async () => {
		const f = fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
		if (Owner === PhotoPreviewSchedulerV1) f.replace(f.legacy.photo);
		let traps = 0;
		const reason = new Proxy({}, { get() { assert.fail('Reason inspected'); }, getPrototypeOf() { assert.fail('Reason reflected'); } });
		const scheduler = new Owner({ ...f.options, async loadOriginal(_key, signal) {
			Object.defineProperty(signal, 'throwIfAborted', { get() { traps++; throw Error('Shadowed native cancellation'); } });
			Object.defineProperty(signal, 'reason', { get() { traps++; throw Error('Shadowed native reason'); } });
			entered.resolve(); await release.promise; return f.legacy.original;
		} });
		const work = scheduler.request({ ...request(), signal: stop.signal });
		const outcome = work.then(() => ({ ok: true, reason: undefined as unknown }), (value: unknown) => ({ ok: false, reason: value }));
		await entered.promise; stop.abort(reason); const closing = scheduler.close();
		const closed = closing.then(() => true, () => false);
		assert.equal(await remainsPending(closing), true); release.resolve();
		const result = await outcome; assert.equal(result.ok, false); assert.equal(result.reason === reason, true);
		assert.equal(await closed, true); assert.equal(traps, 0);
		assert.equal(f.stats.decodes, 0); assert.equal(f.stats.stores, 0);
	});
}

for (const [label, reason] of [['null', null], ['NaN', Number.NaN], ['negative zero', -0]] as const) {
	test(`current previews preserve native ${label} cancellation through subscriber refusal and Close`, async () => {
		const f = fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
		const scheduler = new PhotoPreviewSchedulerV2({ ...f.options, async loadOriginal() {
			entered.resolve(); await release.promise; return f.legacy.original;
		} });
		const work = scheduler.request({ ...request(), signal: stop.signal });
		const outcome = work.then(() => ({ ok: true, reason: undefined as unknown }), (value: unknown) => ({ ok: false, reason: value }));
		await entered.promise; stop.abort(reason); const closed = scheduler.close().then(() => true, () => false);
		release.resolve(); const result = await outcome;
		assert.equal(await closed, true); assert.equal(result.ok, false); assert.equal(Object.is(result.reason, reason), true);
		assert.equal(f.stats.decodes, 0); assert.equal(f.stats.stores, 0);
	});
}
