/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createPhotoLibraryDevelopOriginalSessionV1, type PhotoLibraryDevelopOriginalSessionHostV1 } from '../src/lightscaper/controller/photo-library-develop-original-session-v1.ts';
import { withPhotoOriginalFrameV1 } from '../src/lightscaper/preview/photo-original-frame-v1.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { PhotoCatalogRevisionConflictError } from '../src/lightscaper/catalog/repository-types.ts';
import type { PhotoLibraryDevelopOriginalReadV1 } from '../src/common/editor/photo-library-develop-original-port-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { developBatchFixture } from './helpers/lightscaper-develop-batch-fixture.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';

const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const body = new Blob([PNG]);
const original = { ...queryPhotoV1().original, mimeType: 'image/png', width: 1, height: 1,
	byteLength: PNG.length, contentSha256: createHash('sha256').update(PNG).digest('hex') };
const document = () => normalizePhotoDocumentV1({ ...queryPhotoV1(), original });
const request = (): PhotoLibraryDevelopOriginalReadV1 => ({ schemaVersion: 1, photoId: document().id, expectedRevision: 0 });

function fixture() {
	const lifetime = new AbortController();
	const calls = { initialize: 0, documents: 0, bodies: 0, opens: 0, closes: 0 };
	let current = document();
	const host: { -readonly [Key in keyof PhotoLibraryDevelopOriginalSessionHostV1]: PhotoLibraryDevelopOriginalSessionHostV1[Key] } = {
		repository: { loadPhoto: async (catalogId, photoId) => {
			calls.documents++; assert.equal(catalogId, 'catalog'); assert.equal(photoId, document().id); return current;
		} },
		ready: async () => { calls.initialize++; return 'catalog'; },
		operation: async (run, signal) => {
			const admitted = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
			admitted.throwIfAborted(); const result = await run(admitted); admitted.throwIfAborted(); return result;
		},
		loadOriginal: async (binding, signal) => { signal.throwIfAborted(); calls.bodies++; assert.deepEqual(binding, original); return body; },
		withFrame: (value, consume) => withPhotoOriginalFrameV1(value, consume, { openImage: async () => {
			calls.opens++;
			return { metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'original-reader-test-1' },
				decodeFrame: async () => ({ rgba: Uint8Array.of(7, 19, 233, 255), durationMicroseconds: null }),
				close() { calls.closes++; } };
		} }),
	};
	return { host, calls, lifetime, replace: (value: typeof current) => { current = value; }, port: createPhotoLibraryDevelopOriginalSessionV1(host) };
}

test('full-resolution original reader authenticates retained bytes and lends only a scoped, oriented frame', async () => {
	const f = fixture(); let observed: PixelFrameV1 | null = null;
	const result = await f.port.withFrame(request(), async view => {
		assert.deepEqual(Object.keys(view).sort(), ['frame', 'photoId', 'revision']);
		assert.equal(view.photoId, document().id); assert.equal(view.revision, 0);
		assert.deepEqual(Array.from(view.frame.pixels), [7, 19, 233, 255]);
		assert.deepEqual(view.frame.descriptor, { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' });
		assert.ok(Object.isFrozen(view)); observed = view.frame; assert.equal(f.calls.closes, 1); return 'consumed';
	});
	assert.equal(result, 'consumed'); assert.deepEqual(f.calls, { initialize: 1, documents: 4, bodies: 1, opens: 1, closes: 1 });
	assert.ok(observed); assert.deepEqual(Array.from((observed as PixelFrameV1).pixels), [0, 0, 0, 0]);
	assert.deepEqual(new Uint8Array(await body.arrayBuffer()), PNG); assert.deepEqual(document().original, original);
});

test('a stale revision or another catalog/photo refuses before reading any original body', async () => {
	for (const changed of [{ ...document(), revision: 1 }, { ...document(), catalogId: 'other' }, { ...document(), id: 'other' }]) {
		const f = fixture(); f.replace(normalizePhotoDocumentV1(changed));
		await assert.rejects(f.port.withFrame(request(), async () => undefined));
		assert.equal(f.calls.bodies, 0); assert.equal(f.calls.opens, 0);
	}
	const f = fixture(); f.replace(normalizePhotoDocumentV1({ ...document(), revision: 1 }));
	await assert.rejects(f.port.withFrame(request(), async () => undefined), PhotoCatalogRevisionConflictError);
});

test('late body completion with changed revision refuses before native decode or callback delivery', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>();
	const load = f.host.loadOriginal;
	f.host.loadOriginal = async (...args) => { entered.resolve(); await release.promise; return load(...args); };
	// Recreate after the owner captures trusted ports.
	const port = createPhotoLibraryDevelopOriginalSessionV1(f.host); let consumed = 0;
	const work = port.withFrame(request(), async () => { consumed++; }); await entered.promise;
	f.replace(normalizePhotoDocumentV1({ ...document(), revision: 1 })); release.resolve();
	await assert.rejects(work, PhotoCatalogRevisionConflictError);
	assert.equal(consumed, 0); assert.equal(f.calls.opens, 0); assert.equal(f.calls.closes, 0);
});

test('a revision changed during the scoped consumer refuses its result and wipes original-derived pixels', async () => {
	const f = fixture(); let observed: PixelFrameV1 | null = null;
	await assert.rejects(f.port.withFrame(request(), async view => {
		observed = view.frame; f.replace(normalizePhotoDocumentV1({ ...document(), revision: 1 })); return 'stale';
	}), PhotoCatalogRevisionConflictError);
	assert.ok(observed); assert.equal((observed as PixelFrameV1).pixels.every(value => value === 0), true);
});

test('closed request/options and non-consumers reject before initialization without invoking accessors', async () => {
	const f = fixture(); let invoked = 0;
	const accessor = Object.defineProperty(request(), 'photoId', { enumerable: true, get() { invoked++; throw Error('read accessor'); } });
	for (const value of [accessor, { ...request(), schemaVersion: 2 }, { ...request(), expectedRevision: -1 }, { ...request(), width: 8192 }, { ...request(), originalId: 'injected' }]) {
		await assert.rejects(f.port.withFrame(value as PhotoLibraryDevelopOriginalReadV1, async () => undefined));
	}
	await assert.rejects(f.port.withFrame(request(), null as unknown as Parameters<typeof f.port.withFrame>[1]));
	const options = Object.defineProperty({}, 'signal', { enumerable: true, get() { invoked++; throw Error('signal accessor'); } });
	await assert.rejects(f.port.withFrame(request(), async () => undefined, options));
	assert.equal(invoked, 0); assert.equal(f.calls.initialize, 0);
});

test('request identity is detached before initialization can yield', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), value = { ...request() };
	f.host.ready = async () => { entered.resolve(); await release.promise; return 'catalog'; };
	const port = createPhotoLibraryDevelopOriginalSessionV1(f.host), work = port.withFrame(value, async view => view.photoId);
	await entered.promise; value.photoId = 'replacement'; value.expectedRevision = 1; release.resolve();
	assert.equal(await work, document().id);
});

test('caller/lifetime cancellation joins a held original read and preserves opaque reason without callback publication', async () => {
	for (const lifetime of [false, true]) {
		const f = fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
		const reason = new Proxy({}, { get() { throw Error('reason observed'); }, getPrototypeOf() { throw Error('reason reflected'); } });
		f.host.loadOriginal = async () => { entered.resolve(); await release.promise; return body; };
		const port = createPhotoLibraryDevelopOriginalSessionV1(f.host); let consumed = 0;
		const work = port.withFrame(request(), async () => { consumed++; }, { signal: stop.signal }); await entered.promise;
		const outcome = work.then(() => ({ fulfilled: true, error: undefined as unknown }), (error: unknown) => ({ fulfilled: false, error }));
		(lifetime ? f.lifetime : stop).abort(reason);
		assert.equal(await remainsPending(work), true); release.resolve();
		const refused = await outcome; assert.equal(refused.fulfilled, false); assert.equal(refused.error, reason);
		assert.equal(consumed, 0); assert.equal(f.calls.opens, 0);
	}
});

test('consumer errors and cancellation after consumer completion wipe the scoped frame', async () => {
	for (const cancel of [false, true]) {
		const f = fixture(), stop = new AbortController(), reason = Object.freeze({ stop: true }); let observed: PixelFrameV1 | null = null;
		await assert.rejects(f.port.withFrame(request(), async view => {
			observed = view.frame; if (cancel) stop.abort(reason); else throw reason;
		}, { signal: stop.signal }), error => error === reason);
		assert.ok(observed); assert.equal((observed as PixelFrameV1).pixels.every(value => value === 0), true); assert.equal(f.calls.closes, 1);
	}
});

test('original loaders cannot replace intrinsic cancellation with a shadowed signal method', async () => {
	const f = fixture(), stop = new AbortController(); let traps = 0, consumed = 0;
	const reason = new Proxy({}, { get() { throw Error('reason observed'); }, getPrototypeOf() { throw Error('reason reflected'); } });
	f.host.loadOriginal = async (_original, signal) => {
		Object.defineProperty(signal, 'throwIfAborted', { get() { traps++; throw Error('shadowed signal method'); } });
		stop.abort(reason); return body;
	};
	const port = createPhotoLibraryDevelopOriginalSessionV1(f.host);
	const result = await port.withFrame(request(), async () => { consumed++; }, { signal: stop.signal })
		.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => ({ failed: true, error }));
	assert.equal(result.failed, true); assert.equal(result.error, reason);
	assert.equal(traps, 0); assert.equal(consumed, 0); assert.equal(f.calls.opens, 0);
});

test('the actual Photo Session exposes scoped original reading and Close joins its held body without publishing pixels or metadata', async () => {
	const f = await developBatchFixture(), entered = deferred<void>(), release = deferred<void>();
	let borrowed: AbortSignal | undefined, consumed = 0;
	f.ports.backup = { readSnapshot: f.repository.readSnapshot.bind(f.repository),
		captureSmartCollectionArchiveV1: f.repository.captureSmartCollectionArchiveV1.bind(f.repository),
		loadOriginal: async (_original, signal) => { borrowed = signal; entered.resolve(); await release.promise; return body; } };
	const session = new PhotoLibrarySessionV1(f.ports), before = await f.repository.loadPhoto('catalog', f.photos[0]!.id);
	try {
		assert.ok(session.develop.original);
		const work = session.develop.original.withFrame({ schemaVersion: 1, photoId: f.photos[0]!.id, expectedRevision: 0 }, async () => { consumed++; });
		const outcome = work.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => ({ failed: true, error }));
		await entered.promise; const closing = session.close(); assert.equal(await remainsPending(closing), true);
		assert.equal(f.calls.close, 0); assert.ok(borrowed?.aborted);
		release.resolve(); const rejected = await outcome; await closing;
		assert.equal(rejected.failed, true); assert.equal(rejected.error, borrowed.reason);
		assert.equal(consumed, 0); assert.equal(f.calls.close, 1);
		assert.deepEqual(await f.repository.loadPhoto('catalog', f.photos[0]!.id), before);
		await assert.rejects(session.develop.original.withFrame({ schemaVersion: 1, photoId: f.photos[0]!.id, expectedRevision: 0 }, async () => undefined), /closed/iu);
	} finally { release.resolve(); await session.close(); await f.close(); }
});
