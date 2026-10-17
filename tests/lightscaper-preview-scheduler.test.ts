/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoPreviewSchedulerV1 } from '../src/lightscaper/preview/photo-preview-scheduler-v1.ts';
import type { PhotoPreviewCachePortV1 } from '../src/lightscaper/preview/photo-preview-cache-v1.ts';
import type { withPhotoOriginalFrameV1 } from '../src/lightscaper/preview/photo-original-frame-v1.ts';
import type { PreparedPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import { planPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { preparePhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

function gate() { let open!: () => void; const promise = new Promise<void>(resolve => { open = resolve; }); return { promise, open }; }
const frame = { descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
	pixels: Uint8Array.from([12, 34, 56, 255]) } as const;

function fixture() {
	const photos = new Map(Array.from({ length: 70 }, (_, index) => { const value = photoArchiveFixture(index + 1); return [value.photo.id, value]; }));
	const saved: PreparedPhotoPreviewV1[] = [];
	let reads = 0, decoded = 0, loads = 0, stores = 0, trims = 0;
	const cache: PhotoPreviewCachePortV1 = {
		async load() { loads += 1; return null; },
		async store(value) { stores += 1; saved.push(value as PreparedPhotoPreviewV1); return { outcome: 'stored' }; },
		async trim() { trims += 1; return { removedEntries: 0, removedBytes: 0, more: false }; },
	};
	const regenerate: typeof withPhotoOriginalFrameV1 = async (value, consume) => { void value; decoded += 1;
		return consume(frame, { orientation: 1, runtimeVersion: 'test-frame-v1' }); };
	const options = { catalogId: 'catalog-1', cache,
		async loadPhoto(photoId: string) { return photos.get(photoId)?.photo ?? null; },
		async loadOriginal(storageKey: string) { reads += 1; return [...photos.values()].find(value => value.photo.original.storageKey === storageKey)!.original; },
		regenerate };
	return { photos, saved, cache, options, stats: () => ({ reads, decoded, loads, stores, trims }) };
}

test('coalesced requests perform one bounded job and return an independent kernel body', async () => {
	const current = fixture(), entered = gate(), release = gate();
	const scheduler = new PhotoPreviewSchedulerV1({ ...current.options,
		async loadPhoto(id) { entered.open(); await release.promise; return current.options.loadPhoto(id); } });
	const first = scheduler.request({ photoId: 'photo-1', tier: 'thumbnail' });
	const repeated = scheduler.request({ photoId: 'photo-1', tier: 'thumbnail' });
	const queued = scheduler.request({ photoId: 'photo-2', tier: 'fit-screen' });
	await entered.promise;
	assert.deepEqual(scheduler.status(), { closed: false, active: true, queued: 1, pendingRequests: 3 });
	release.open(); const [one, same, second] = await Promise.all([first, repeated, queued]);
	assert.equal(one, same); assert.equal(one.outcome, 'ready'); assert.equal(second.outcome, 'ready');
	if (one.outcome === 'ready') {
		assert.equal(one.cache, 'stored'); assert.deepEqual(new Uint8Array(await one.preview.body.arrayBuffer()), frame.pixels);
		assert.equal(Object.hasOwn(one.preview, 'original'), false);
	}
	assert.deepEqual(current.stats(), { reads: 2, decoded: 2, loads: 2, stores: 2, trims: 0 });
	await scheduler.close(); assert.deepEqual(scheduler.status(), { closed: true, active: false, queued: 0, pendingRequests: 0 });
});

test('the queue and coalesced subscriber set refuse growth beyond their declared scalar limits', async () => {
	const current = fixture(), entered = gate(), release = gate();
	const scheduler = new PhotoPreviewSchedulerV1({ ...current.options,
		async loadPhoto(id) { entered.open(); await release.promise; return current.options.loadPhoto(id); } });
	const controller = new AbortController();
	const active = scheduler.request({ photoId: 'photo-1', tier: 'thumbnail', signal: controller.signal });
	const activeRejected = assert.rejects(active, /stop bounded queue/u);
	await entered.promise;
	const requests = Array.from({ length: 64 }, (_, index) => scheduler.request({ photoId: `photo-${index + 2}`, tier: 'thumbnail', signal: controller.signal }));
	const rejected = Promise.all(requests.map(request => assert.rejects(request, /stop bounded queue/u)));
	await assert.rejects(scheduler.request({ photoId: 'photo-66', tier: 'thumbnail' }), /queue|request budget/u);
	await assert.rejects(scheduler.request({ photoId: 'photo-1', tier: 'thumbnail' }), /request budget/u);
	assert.deepEqual(scheduler.status(), { closed: false, active: true, queued: 64, pendingRequests: 65 });
	controller.abort(new Error('stop bounded queue')); release.open(); await Promise.all([activeRejected, rejected]);
	await scheduler.close(); assert.equal(current.stats().reads, 0); assert.equal(current.stats().decoded, 0);
});

test('cancelling one coalesced observer and a queued job preserves another observer and the active job', async () => {
	const current = fixture(), entered = gate(), release = gate();
	const scheduler = new PhotoPreviewSchedulerV1({ ...current.options,
		async loadPhoto(id) { entered.open(); await release.promise; return current.options.loadPhoto(id); } });
	const firstSignal = new AbortController(), queuedSignal = new AbortController();
	const first = scheduler.request({ photoId: 'photo-1', tier: 'thumbnail', signal: firstSignal.signal });
	const kept = scheduler.request({ photoId: 'photo-1', tier: 'thumbnail' });
	const queued = scheduler.request({ photoId: 'photo-2', tier: 'thumbnail', signal: queuedSignal.signal });
	const firstRejected = assert.rejects(first, /observer stopped/u), queuedRejected = assert.rejects(queued, /queued stopped/u);
	await entered.promise; firstSignal.abort(new Error('observer stopped')); queuedSignal.abort(new Error('queued stopped'));
	assert.equal(scheduler.status().queued, 0); assert.equal(scheduler.status().pendingRequests, 1);
	release.open(); assert.equal((await kept).outcome, 'ready'); await Promise.all([firstRejected, queuedRejected]);
	assert.equal(current.stats().decoded, 1); await scheduler.close();
});

test('close is terminal and joins an admitted late read before disposing its owned work', async () => {
	const current = fixture(), entered = gate(), release = gate();
	const scheduler = new PhotoPreviewSchedulerV1({ ...current.options,
		async loadPhoto(id) { entered.open(); await release.promise; return current.options.loadPhoto(id); } });
	const active = scheduler.request({ photoId: 'photo-1', tier: 'thumbnail' });
	const rejected = assert.rejects(active, /closed/u); await entered.promise;
	let closed = false; const closing = scheduler.close(); void closing.then(() => { closed = true; });
	assert.equal(closing, scheduler.close()); assert.equal(closed, false);
	await assert.rejects(scheduler.request({ photoId: 'photo-2', tier: 'thumbnail' }), /closed/u);
	release.open(); await Promise.all([closing, rejected]); assert.equal(closed, true);
	assert.equal(current.stats().reads, 0); assert.equal(current.stats().stores, 0);
});

test('a cached body avoids original reads and is checked against current photo association before delivery', async () => {
	const current = fixture(), photo = current.photos.get('photo-1')!.photo;
	const binding = { catalogId: photo.catalogId, photoId: photo.id, originalId: photo.original.id, storageKey: photo.original.storageKey,
		contentSha256: photo.original.contentSha256, byteLength: photo.original.byteLength, width: 1, height: 1 };
	const plan = planPhotoPreviewV1({ binding, source: frame.descriptor, tier: 'thumbnail' });
	const value = await preparePhotoPreviewV1({ plan, binding, frame });
	const scheduler = new PhotoPreviewSchedulerV1({ ...current.options, cache: { ...current.cache, async load() { return value; } } });
	const receipt = await scheduler.request({ photoId: 'photo-1', tier: 'thumbnail' });
	assert.equal(receipt.outcome, 'ready'); if (receipt.outcome === 'ready') assert.equal(receipt.cache, 'hit');
	assert.equal(current.stats().reads, 0); await scheduler.close();
	let reads = 0;
	const changed = new PhotoPreviewSchedulerV1({ ...current.options,
		async loadPhoto() { reads += 1; return reads === 1 ? photo : { ...photo, original: { ...photo.original, storageKey: 'replacement' } }; },
		cache: { ...current.cache, async load() { return value; } } });
	assert.equal((await changed.request({ photoId: 'photo-1', tier: 'thumbnail' })).outcome, 'superseded');
	assert.equal(current.stats().reads, 0); await changed.close();
});

test('a storage failure retains a transient body and pressure performs exactly one bounded retry', async () => {
	const current = fixture(), error = new Error('Error preparing Blob/File data');
	const failed = new PhotoPreviewSchedulerV1({ ...current.options, cache: { ...current.cache, async store() { throw error; } } });
	const transient = await failed.request({ photoId: 'photo-1', tier: 'thumbnail' });
	assert.equal(transient.outcome, 'ready'); if (transient.outcome === 'ready') {
		assert.equal(transient.cache, 'transient'); assert.equal(transient.persistenceError, error);
		assert.deepEqual(new Uint8Array(await transient.preview.body.arrayBuffer()), frame.pixels);
	}
	await failed.close(); let attempts = 0;
	const pressure = new PhotoPreviewSchedulerV1({ ...current.options, cache: { ...current.cache,
		async store() { attempts += 1; return { outcome: 'pressure' }; } } });
	const receipt = await pressure.request({ photoId: 'photo-1', tier: 'thumbnail' });
	assert.equal(receipt.outcome, 'ready'); if (receipt.outcome === 'ready') assert.equal(receipt.cache, 'transient');
	assert.equal(attempts, 2); assert.equal(current.stats().trims, 1); await pressure.close();
});

test('authored changes retain original previews while original replacement or removal suppresses publication', async () => {
	for (const replacement of ['rating', 'original', 'missing'] as const) {
		const current = fixture(), original = current.photos.get('photo-1')!;
		const regenerate: typeof withPhotoOriginalFrameV1 = async (value, consume) => {
			void value; const result = await consume(frame, { orientation: 1, runtimeVersion: 'test' });
			if (replacement === 'missing') current.photos.delete('photo-1');
			else current.photos.set('photo-1', { ...original, photo: replacement === 'rating' ? { ...original.photo, rating: 5, revision: 1 }
				: { ...original.photo, original: { ...original.photo.original, storageKey: 'replacement' } } });
			return result;
		};
		const scheduler = new PhotoPreviewSchedulerV1({ ...current.options, regenerate });
		const receipt = await scheduler.request({ photoId: 'photo-1', tier: 'thumbnail' });
		assert.equal(receipt.outcome, replacement === 'rating' ? 'ready' : 'superseded');
		assert.equal(current.stats().stores, replacement === 'rating' ? 1 : 0); await scheduler.close();
	}
});

test('invalid requests and foreign photo documents are refused before cache or original ports', async () => {
	const current = fixture(), scheduler = new PhotoPreviewSchedulerV1(current.options); let invoked = 0;
	const getter = Object.defineProperty({ tier: 'thumbnail' }, 'photoId', { enumerable: true, get() { invoked += 1; return 'photo-1'; } });
	for (const request of [getter, { photoId: 'photo-1', tier: 'poster' }, { photoId: '../disk', tier: 'thumbnail' },
		{ photoId: 'photo-1', tier: 'thumbnail', priority: 5 }]) await assert.rejects(scheduler.request(request));
	assert.equal(invoked, 0); assert.equal(current.stats().reads, 0); assert.equal(current.stats().loads, 0); await scheduler.close();
	const foreign = new PhotoPreviewSchedulerV1({ ...current.options, async loadPhoto() { return { schemaFamily: 'framescaper', schemaVersion: 1 }; } });
	await assert.rejects(foreign.request({ photoId: 'photo-1', tier: 'thumbnail' }));
	assert.equal(current.stats().loads, 0); await foreign.close();
});

test('admitted ports remain stable and genuine cancellation uses signal intrinsics', async () => {
	const current = fixture(), controller = new AbortController(), scheduler = new PhotoPreviewSchedulerV1(current.options);
	let invoked = 0;
	for (const key of ['throwIfAborted', 'reason']) Object.defineProperty(controller.signal, key, {
		get() { invoked += 1; throw new Error('hostile cancellation property'); },
	});
	current.cache.load = async () => { throw new Error('replaced cache function'); };
	const result = await scheduler.request({ photoId: 'photo-1', tier: 'thumbnail', signal: controller.signal });
	assert.equal(result.outcome, 'ready'); assert.equal(invoked, 0); await scheduler.close();
});

test('close preserves cleanup failures from cancelled and acknowledged cache publications', async () => {
	for (const acknowledged of [false, true]) {
		const current = fixture(), entered = gate(), release = gate(), cleanup = new Error('cache cleanup failed');
		let committed = false;
		const scheduler = new PhotoPreviewSchedulerV1({ ...current.options, cache: { ...current.cache,
			async store(_value, signal) {
				entered.open(); await release.promise;
				if (!acknowledged) throw new AggregateError([signal?.reason, cleanup], 'cancelled write and cleanup failed');
				committed = true; return { outcome: 'stored', cleanupErrors: [cleanup] };
			} } });
		const request = scheduler.request({ photoId: 'photo-1', tier: 'thumbnail' }), rejected = assert.rejects(request, /closed/u);
		await entered.promise;
		const closing = scheduler.close(), failure = assert.rejects(closing, error => error instanceof AggregateError && error.errors.includes(cleanup));
		release.open(); await Promise.all([failure, rejected]); assert.equal(committed, acknowledged);
	}
});

test('pressure retry preserves diagnostics from the first publication, trim and successful retry', async () => {
	const current = fixture(), issues = [new Error('pressure cleanup'), new Error('trim cleanup'), new Error('retry cleanup')];
	let attempts = 0;
	const scheduler = new PhotoPreviewSchedulerV1({ ...current.options, cache: { ...current.cache,
		async store() { attempts++; return attempts === 1 ? { outcome: 'pressure', cleanupErrors: [issues[0]] }
			: { outcome: 'stored', cleanupErrors: [issues[2]] }; },
		async trim() { return { removedEntries: 1, removedBytes: 4, more: false, cleanupErrors: [issues[1]] }; },
	} });
	const result = await scheduler.request({ photoId: 'photo-1', tier: 'thumbnail' });
	assert.equal(result.outcome, 'ready'); if (result.outcome === 'ready') {
		assert.equal(result.cache, 'stored'); assert.deepEqual(result.cleanupErrors, issues); assert.ok(Object.isFrozen(result.cleanupErrors));
	}
	await scheduler.close();
});

test('close during final photo revalidation retains acknowledged publication cleanup failures', async () => {
	const current = fixture(), entered = gate(), release = gate(), cleanup = new Error('acknowledged cleanup failed');
	let reads = 0;
	const scheduler = new PhotoPreviewSchedulerV1({ ...current.options,
		async loadPhoto(id) { reads++; if (reads === 3) { entered.open(); await release.promise; } return current.options.loadPhoto(id); },
		cache: { ...current.cache, async store() { return { outcome: 'stored', cleanupErrors: [cleanup] }; } },
	});
	const request = scheduler.request({ photoId: 'photo-1', tier: 'thumbnail' }), rejected = assert.rejects(request, /closed/u);
	await entered.promise;
	const closing = scheduler.close(), failure = assert.rejects(closing, error => error instanceof AggregateError && error.errors.includes(cleanup));
	release.open(); await Promise.all([failure, rejected]); assert.equal(reads, 3);
});

test('a superseded delivery preserves already acknowledged cleanup failures', async () => {
	const current = fixture(), original = current.photos.get('photo-1')!.photo, cleanup = new Error('superseded cleanup failed');
	let reads = 0;
	const scheduler = new PhotoPreviewSchedulerV1({ ...current.options,
		async loadPhoto() { reads++; return reads < 3 ? original : { ...original, original: { ...original.original, storageKey: 'replacement' } }; },
		cache: { ...current.cache, async store() { return { outcome: 'stored', cleanupErrors: [cleanup] }; } },
	});
	await assert.rejects(scheduler.request({ photoId: 'photo-1', tier: 'thumbnail' }),
		error => error instanceof AggregateError && error.errors.includes(cleanup));
	await scheduler.close();
});
