/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoPreviewSchedulerCurrentV1 } from '../src/lightscaper/preview/photo-preview-scheduler-current-v1.ts';
import { PhotoPreviewSchedulerV2 } from '../src/lightscaper/preview/photo-preview-scheduler-v2.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import type { PhotoPreviewCachePortV1 } from '../src/lightscaper/preview/photo-preview-cache-v1.ts';
import type { withPhotoOriginalFrameV1 } from '../src/lightscaper/preview/photo-original-frame-v1.ts';
import type { PhotoPreviewPlanV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import type { PreparedPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import type { PhotoCullingPreviewPlanCurrentV1 } from '../src/lightscaper/preview/photo-culling-preview-plan-current-v1.ts';
import type { PreparedPhotoCullingPreviewCurrentV1 } from '../src/lightscaper/preview/photo-culling-preview-preparation-current-v1.ts';
import type { PhotoCullingPreviewCachePortCurrentV1 } from '../src/lightscaper/preview/photo-culling-preview-cache-current-v1.ts';
import type { withPhotoCullingFrameCurrentV1 } from '../src/lightscaper/preview/photo-culling-frame-current-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const frame = { descriptor: { schemaVersion: 1 as const, width: 1, height: 1, sampleFormat: 'unorm8' as const,
	primaries: 'srgb' as const, transfer: 'srgb' as const }, pixels: Uint8Array.of(12, 34, 56, 255) };
function fixture() {
	const f = photoArchiveFixture(1), calls = { photos: 0, originals: 0, regenerations: 0 };
	const cache: PhotoPreviewCachePortV1 = { load: async () => null, store: async () => ({ outcome: 'stored' }),
		trim: async () => ({ removedEntries: 0, removedBytes: 0, more: false }) };
	const regenerate: typeof withPhotoOriginalFrameV1 = async (_request, consume) => {
		calls.regenerations++; return consume(frame, { orientation: 1, runtimeVersion: 'test-native-boundary' });
	};
	return { calls, options: { catalogId: f.photo.catalogId, loadPhoto: async () => { calls.photos++; return f.photo; },
		loadOriginal: async () => { calls.originals++; return f.original; }, cache, regenerate } };
}

test('Current culling admits an explicit neutral preference with the unchanged Original preview bytes', async () => {
	const f = fixture(), scheduler = new PhotoPreviewSchedulerCurrentV1(f.options);
	try {
		const value = await scheduler.request({ photoId: 'photo-1', tier: 'thumbnail', rawPreviewSource: 'neutral-original' });
		assert.equal(value.outcome, 'ready'); if (value.outcome !== 'ready') assert.fail('Expected neutral preview.');
		assert.deepEqual(new Uint8Array(await value.preview.body.arrayBuffer()), frame.pixels);
		assert.equal(value.preview.recipe.id, 'lightscaper.original-preview.rgba8-nearest');
		assert.equal(f.calls.regenerations, 1);
	} finally { await scheduler.close(); }
});

function queuedFixture(raw = true) {
	const f = photoArchiveFixture(1), neutral = new Map<string, PreparedPhotoPreviewV1>(), camera = new Map<string, PreparedPhotoCullingPreviewCurrentV1>();
	let photo = { ...f.photo, original: { ...f.photo.original, mimeType: raw ? 'image/x-adobe-dng' : f.photo.original.mimeType } };
	const events: string[] = [], stats = { active: 0, maximumActive: 0, neutral: 0, camera: 0, originals: 0, stores: 0, trims: 0 };
	const holds = { neutral: async (): Promise<void> => undefined, camera: async (): Promise<void> => undefined };
	let pressure = false;
	const cache: PhotoPreviewCachePortV1 = { load: async value => neutral.get((value as PhotoPreviewPlanV1).key) ?? null,
		store: async value => { const prepared = value as PreparedPhotoPreviewV1; neutral.set(prepared.key, prepared); stats.stores++; return { outcome: 'stored' }; },
		trim: async () => { assert.fail('Camera pressure cannot trim through the neutral route.'); } };
	const cullingCache: PhotoCullingPreviewCachePortCurrentV1 = { load: async value => camera.get((value as PhotoCullingPreviewPlanCurrentV1).key) ?? null,
		store: async value => { if (pressure) { pressure = false; return { outcome: 'pressure' }; }
			const prepared = value as PreparedPhotoCullingPreviewCurrentV1; camera.set(prepared.key, prepared); stats.stores++; return { outcome: 'stored' }; },
		trim: async () => { stats.trims++; return { removedEntries: 0, removedBytes: 0, more: false }; } };
	async function enter(kind: 'neutral' | 'camera') {
		stats[kind]++; stats.active++; stats.maximumActive = Math.max(stats.maximumActive, stats.active); events.push(kind);
		await holds[kind]();
	}
	const regenerate: typeof withPhotoOriginalFrameV1 = async (_request, consume) => {
		try { await enter('neutral'); return await consume(frame, { orientation: 1, runtimeVersion: 'modeled-neutral-native' }); }
		finally { stats.active--; }
	};
	const regenerateCulling: typeof withPhotoCullingFrameCurrentV1 = async (_request, consume) => {
		try { await enter('camera'); return await consume({ ...frame, pixels: Uint8Array.of(200, 100, 50, 255) },
			{ orientation: 1, runtimeVersion: 'modeled-camera-native', representation: 'camera-embedded' }); }
		finally { stats.active--; }
	};
	const scheduler = new PhotoPreviewSchedulerCurrentV1({ catalogId: photo.catalogId, loadPhoto: async () => photo,
		loadOriginal: async () => { stats.originals++; return f.original; }, cache, cullingCache, regenerate, regenerateCulling });
	const request = (source: 'neutral-original' | 'camera-embedded', signal?: AbortSignal) => scheduler.request({ photoId: photo.id, tier: 'thumbnail', rawPreviewSource: source, ...(signal ? { signal } : {}) });
	return { scheduler, request, holds, events, stats, neutral, camera,
		replaceOriginal() { photo = { ...photo, original: { ...photo.original, contentSha256: '1'.repeat(64) } }; }, pressure() { pressure = true; } };
}

test('Current source variants coalesce independently while sharing exactly one active native job and warm cache', async () => {
	const f = queuedFixture(), entered = deferred<void>(), release = deferred<void>();
	f.holds.neutral = async () => { entered.resolve(); await release.promise; };
	try {
		const first = f.request('neutral-original'); await entered.promise;
		const second = f.request('camera-embedded'), duplicate = f.request('camera-embedded');
		assert.deepEqual(f.scheduler.status(), { closed: false, active: true, queued: 1, pendingRequests: 3 });
		assert.deepEqual(f.events, ['neutral']); release.resolve();
		const [old, one, same] = await Promise.all([first, second, duplicate]);
		assert.equal(old.outcome, 'ready'); assert.equal(one.outcome, 'ready'); assert.equal(one, same);
		if (old.outcome !== 'ready' || one.outcome !== 'ready') assert.fail('Expected both source variants.');
		assert.notEqual(old.preview.key, one.preview.key); assert.notDeepEqual(await old.preview.body.arrayBuffer(), await one.preview.body.arrayBuffer());
		for (const source of ['neutral-original', 'camera-embedded'] as const) {
			const hit = await f.request(source); assert.equal(hit.outcome, 'ready'); if (hit.outcome === 'ready') assert.equal(hit.cache, 'hit');
		}
		assert.deepEqual(f.stats, { active: 0, maximumActive: 1, neutral: 1, camera: 1, originals: 2, stores: 2, trims: 0 });
	} finally { release.resolve(); await f.scheduler.close(); }
});

test('camera preference retains the exact legacy raster recipe and cache without entering RAW production', async () => {
	const f = queuedFixture(false);
	try {
		const original = await f.request('neutral-original'), preferred = await f.request('camera-embedded');
		assert.equal(original.outcome, 'ready'); assert.equal(preferred.outcome, 'ready');
		if (original.outcome !== 'ready' || preferred.outcome !== 'ready') assert.fail('Expected raster previews.');
		assert.equal(preferred.cache, 'hit'); assert.equal(preferred.preview.key, original.preview.key);
		assert.equal(preferred.preview.recipe.id, 'lightscaper.original-preview.rgba8-nearest');
		assert.equal(f.stats.camera, 0); assert.equal(f.stats.neutral, 1); assert.equal(f.camera.size, 0);
	} finally { await f.scheduler.close(); }
});

test('Current camera pressure retries through its own bounded cache route and superseded Originals never publish', async () => {
	const f = queuedFixture(); f.pressure();
	try { assert.equal((await f.request('camera-embedded')).outcome, 'ready'); assert.equal(f.stats.trims, 1); }
	finally { await f.scheduler.close(); }
	const stale = queuedFixture(), entered = deferred<void>(), release = deferred<void>();
	stale.holds.camera = async () => { entered.resolve(); await release.promise; };
	try {
		const pending = stale.request('camera-embedded'); await entered.promise; stale.replaceOriginal(); release.resolve();
		assert.deepEqual(await pending, { outcome: 'superseded' }); assert.equal(stale.stats.stores, 0);
	} finally { release.resolve(); await stale.scheduler.close(); }
});

test('Current queued source changes and Close retain physical native exclusion until held work settles', async () => {
	const f = queuedFixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Object.freeze({ cancelled: 'source-change' });
	f.holds.neutral = async () => { entered.resolve(); await release.promise; };
	const first = f.request('neutral-original', stop.signal), refused = assert.rejects(first, error => error === reason);
	await entered.promise; stop.abort(reason); await refused;
	const second = f.request('camera-embedded'), cancelled = assert.rejects(second);
	const closing = f.scheduler.close(); assert.equal(await remainsPending(closing), true); assert.deepEqual(f.events, ['neutral']);
	release.resolve(); await Promise.all([closing, cancelled]); assert.equal(f.stats.maximumActive, 1); assert.equal(f.stats.camera, 0);
});

test('unknown and accessor Current source preferences refuse before catalog, cache or body work', async () => {
	const f = fixture(), scheduler = new PhotoPreviewSchedulerCurrentV1(f.options); let getter = 0;
	try {
		await assert.rejects(scheduler.request({ photoId: 'photo-1', tier: 'thumbnail', rawPreviewSource: 'future-v9' }));
		const request = { photoId: 'photo-1', tier: 'thumbnail' }; Object.defineProperty(request, 'rawPreviewSource', { enumerable: true, get() { getter++; return 'camera-embedded'; } });
		await assert.rejects(scheduler.request(request)); assert.equal(getter, 0); assert.deepEqual(f.calls, { photos: 0, originals: 0, regenerations: 0 });
	} finally { await scheduler.close(); }
});

test('permanent legacy culling refuses RAW preference fields before selected Photo or Original acquisition', async () => {
	const f = fixture(), scheduler = new PhotoPreviewSchedulerV2(f.options);
	try {
		await assert.rejects(scheduler.request({ photoId: 'photo-1', tier: 'thumbnail', rawPreviewSource: 'camera-embedded' }));
		assert.deepEqual(f.calls, { photos: 0, originals: 0, regenerations: 0 });
	} finally { await scheduler.close(); }
});
