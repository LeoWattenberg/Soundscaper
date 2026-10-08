/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PixelPreviewPresentationV1 } from '../src/common/editor/controller/shared/pixel-preview-presentation-v1.ts';
import type { PhotoLibraryPreviewOutcomeV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

const descriptor = Object.freeze({ schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' } as const);
const ready = (photoId: string): PhotoLibraryPreviewOutcomeV1 => ({ outcome: 'ready', cache: 'hit', notices: [],
	preview: { photoId, tier: 'thumbnail', descriptor, byteLength: 4, outputSha256: 'a'.repeat(64), body: new Blob([new Uint8Array(4)]) } });
const canvas = () => ({ width: 0, height: 0 }) as HTMLCanvasElement;
async function rejectsIdentically(promise: Promise<void>, failure: unknown): Promise<void> {
	let rejected = false;
	try { await promise; } catch (error) { rejected = true; assert.equal(Object.is(error, failure), true); }
	assert.equal(rejected, true);
}

test('real held staging cleanup rejects pause only after joining, and remains a retirement barrier', async () => {
	const entered = deferred<void>(), release = deferred<void>(), cleanup = new Error('Native staged pixels were not released.');
	let failure: AggregateError | undefined, reads = 0, paints = 0;
	const owner = new PixelPreviewPresentationV1({ stage: async request => {
		entered.resolve(); await release.promise; failure = new AggregateError([request.signal!.reason, cleanup], 'Abort and cleanup failed.'); throw failure;
	}, paint: () => { paints++; return { width: 1, height: 1, byteLength: 4 }; }, clear: target => { target.width = 0; target.height = 0; } });
	owner.attach('old', 'thumbnail', canvas());
	owner.setView({ readPreview: id => { reads++; return Promise.resolve(ready(id)); }, photoIds: ['old'], thumbnailsVisible: true, fitScreenPhotoId: null });
	await entered.promise;
	const paused = owner.pause(), rejected = assert.rejects(paused, error => error === failure);
	try {
		assert.equal(await remainsPending(paused), true); release.resolve(); await rejected;
		assert.equal(paints, 0); assert.equal(owner.snapshot().active, false); assert.equal(owner.snapshot().thumbnailBytes, 0);
		await settle(); await assert.rejects(owner.pause(), error => error === failure); await assert.rejects(owner.drain(), error => error === failure);
		owner.attach('new', 'thumbnail', canvas());
		owner.setView({ readPreview: id => { reads++; return Promise.resolve(ready(id)); }, photoIds: ['new'], thumbnailsVisible: true, fitScreenPhotoId: null });
		await settle(); assert.equal(reads, 1); await assert.rejects(owner.close(), error => error === failure);
	} finally { release.resolve(); await paused.catch(() => undefined); await owner.close().catch(() => undefined); }
});

test('joined clean cancellation remains harmless for exact reason and genuine AbortError with a shadowed name', async () => {
	for (const nativeAbort of [false, true]) {
		const entered = deferred<void>(), release = deferred<void>(); let nameReads = 0;
		const owner = new PixelPreviewPresentationV1({ stage: async request => {
			entered.resolve(); await release.promise;
			if (!nativeAbort) throw request.signal!.reason;
			throw Object.defineProperty(new DOMException('Native cancellation.', 'AbortError'), 'name', { get() { nameReads++; throw new Error('Shadowed exception name.'); } });
		}, clear: target => { target.width = 0; target.height = 0; } });
		owner.attach('photo', 'thumbnail', canvas()); owner.setView({ readPreview: id => Promise.resolve(ready(id)), photoIds: ['photo'], thumbnailsVisible: true, fitScreenPhotoId: null });
		await entered.promise; const paused = owner.pause();
		try { assert.equal(await remainsPending(paused), true); release.resolve(); await paused; await owner.drain(); await owner.close();
			assert.equal(nameReads, 0); assert.deepEqual(owner.snapshot().cleanupErrors, []); }
		finally { release.resolve(); await paused.catch(() => undefined); await owner.close().catch(() => undefined); }
	}
});

test('late opaque cleanup preserves identity without inspecting proxy or scalar rejection reasons', async () => {
	let inspected = 0;
	const hostile = new Proxy({}, { get() { inspected++; throw new Error('Cleanup getter evaluated.'); },
		getPrototypeOf() { inspected++; throw new Error('Cleanup prototype evaluated.'); },
		getOwnPropertyDescriptor() { inspected++; throw new Error('Cleanup descriptor evaluated.'); } });
	for (const failure of [hostile, null, 17, 'opaque cleanup']) {
		const entered = deferred<void>(), release = deferred<void>();
		const owner = new PixelPreviewPresentationV1({ stage: async () => { entered.resolve(); await release.promise; throw failure; }, clear: target => { target.width = 0; target.height = 0; } });
		owner.attach('photo', 'thumbnail', canvas()); owner.setView({ readPreview: id => Promise.resolve(ready(id)), photoIds: ['photo'], thumbnailsVisible: true, fitScreenPhotoId: null });
		await entered.promise; const paused = owner.pause(), rejected = rejectsIdentically(paused, failure);
		try { release.resolve(); await rejected; await rejectsIdentically(owner.close(), failure); }
		finally { release.resolve(); await paused.catch(() => undefined); await owner.close().catch(() => undefined); }
	}
	assert.equal(inspected, 0);
});

test('ordinary photo staging failure reports failed status and continues the next scalar preview', async () => {
	let staged = 0, painted = 0;
	const owner = new PixelPreviewPresentationV1({ stage: async (_request, consume) => {
		if (++staged === 1) throw new Error('This photo cannot be decoded.'); consume({ descriptor, pixels: new Uint8Array([1, 2, 3, 255]) });
	}, paint: () => { painted++; return { width: 1, height: 1, byteLength: 4 }; }, clear: target => { target.width = 0; target.height = 0; } });
	owner.attach('broken', 'thumbnail', canvas()); owner.attach('valid', 'thumbnail', canvas());
	owner.setView({ readPreview: id => Promise.resolve(ready(id)), photoIds: ['broken', 'valid'], thumbnailsVisible: true, fitScreenPhotoId: null });
	try { await owner.drain(); assert.equal(painted, 1);
		assert.deepEqual(owner.snapshot().targets.map(row => row.status), ['failed', 'ready']); await owner.pause(); }
	finally { await owner.close(); }
});

test('synchronous backing cleanup failure stays sticky after the first failed pause', async () => {
	const cleanup = new Error('Canvas backing could not be cleared.'); let broken = false;
	const owner = new PixelPreviewPresentationV1({ clear: target => { if (broken) throw cleanup; target.width = 0; target.height = 0; } });
	owner.attach('photo', 'thumbnail', canvas()); broken = true;
	let first: unknown; try { await owner.pause(); } catch (error) { first = error; }
	assert.equal(first, cleanup);
	broken = false; await assert.rejects(owner.pause(), error => error === first); await assert.rejects(owner.close(), error => error === first);
});
