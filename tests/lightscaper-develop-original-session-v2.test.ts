/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createPhotoLibraryDevelopOriginalSessionV2, type PhotoLibraryDevelopOriginalSessionHostV2 } from '../src/lightscaper/controller/photo-library-develop-original-session-v2.ts';
import { createPhotoLibraryDevelopOriginalSessionV1 } from '../src/lightscaper/controller/photo-library-develop-original-session-v1.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoDocumentV2, type PhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { PhotoDocumentV1 } from '../src/lightscaper/catalog/types.ts';
import { withPhotoOriginalFrameV1 } from '../src/lightscaper/preview/photo-original-frame-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../src/lightscaper/catalog/repository-types.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const body = new Blob([PNG]), SHA = 'a'.repeat(64);
const lut = { storageKey: `lut-sha256:${SHA}`, sha256: SHA, byteLength: 17, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
function photo(schemaVersion: 1 | 2 = 2): PhotoDocumentV1 | PhotoDocumentV2 {
	const value = queryPhotoV1(), original = { ...value.original, mimeType: 'image/png', width: 1, height: 1,
		byteLength: PNG.length, contentSha256: createHash('sha256').update(PNG).digest('hex') };
	if (schemaVersion === 1) return normalizePhotoDocumentV1({ ...value, original });
	return normalizePhotoDocumentV2({ ...value, original, schemaVersion: 2, versions: value.versions.map(version => ({ ...version,
		develop: { ...defaultImageDevelopStateV2(), effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled: true, params: { lut } }] } })) });
}
const request = () => ({ schemaVersion: 1 as const, photoId: photo().id, expectedRevision: 0 });
function fixture(initial = photo()) {
	const lifetime = new AbortController(), calls = { reads: 0, bodies: 0, opens: 0, closes: 0 };
	let current = initial;
	const host: PhotoLibraryDevelopOriginalSessionHostV2 = {
		repository: { loadPhoto: async () => { calls.reads++; return current; } }, ready: async () => 'catalog',
		operation: async (run, signal) => {
			const admitted = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
			admitted.throwIfAborted(); return run(admitted);
		},
		loadOriginal: async original => { calls.bodies++; assert.deepEqual(original, current.original); return body; },
		withFrame: (value, consume) => withPhotoOriginalFrameV1(value, consume, { openImage: async () => {
			calls.opens++; return { metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'original-reader-test-2' },
				decodeFrame: async () => ({ rgba: Uint8Array.of(7, 19, 233, 255), durationMicroseconds: null }), close() { calls.closes++; } };
		} }),
	};
	return { host, calls, lifetime, replace(value: typeof current) { current = value; } };
}

test('current original reading admits real Photo1/2 without loading LUTs or changing retained original pixels', async () => {
	for (const schema of [1, 2] as const) {
		const f = fixture(photo(schema)), borrowed: PixelFrameV1[] = [], port = createPhotoLibraryDevelopOriginalSessionV2(f.host);
		const result = await port.withFrame(request(), view => {
			borrowed.push(view.frame); assert.deepEqual(Object.keys(view).sort(), ['frame', 'photoId', 'revision']);
			assert.equal(f.calls.closes, 1); return [...view.frame.pixels];
		});
		assert.deepEqual(result, [7, 19, 233, 255]); assert.equal(borrowed[0]!.pixels.every(byte => byte === 0), true);
		assert.deepEqual(f.calls, { reads: 5, bodies: 1, opens: 1, closes: 1 });
	}
	const current = fixture();
	const oldHost = { ...current.host, repository: { loadPhoto: async () => queryPhotoV1() } };
	Reflect.set(oldHost.repository, 'loadPhoto', current.host.repository.loadPhoto);
	await assert.rejects(createPhotoLibraryDevelopOriginalSessionV1(oldHost).withFrame(request(), () => undefined));
	assert.equal(current.calls.bodies, 0);
	assert.deepEqual(new Uint8Array(await body.arrayBuffer()), PNG);
});

test('complete mixed admission and requested identity refuse malformed recipes and stale photos before original IO', async () => {
	for (const replacement of [{ ...photo(), schemaVersion: 3 }, { ...photo(), id: 'other' }, { ...photo(), catalogId: 'other' },
		{ ...photo(), revision: 1 }, { ...photo(), versions: [{ ...photo().versions[0], develop: { ...defaultImageDevelopStateV2(), effects: [{ id: 'bad', type: 'unknown-v99', enabled: false, params: {} }] } }] }]) {
		const f = fixture(); Reflect.set(f.host.repository, 'loadPhoto', async () => replacement);
		await assert.rejects(createPhotoLibraryDevelopOriginalSessionV2(f.host).withFrame(request(), () => undefined));
		assert.equal(f.calls.bodies, 0); assert.equal(f.calls.opens, 0);
	}
});

test('current original reading detaches request identity and captured methods before initialization yields', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), value = { ...request() };
	Reflect.set(f.host, 'ready', async () => { entered.resolve(); await release.promise; return 'catalog'; });
	const originalLoad = f.host.repository.loadPhoto;
	Reflect.set(f.host.repository, 'loadPhoto', new Proxy(originalLoad, { get() { assert.fail('Method metadata inspected'); } }));
	const port = createPhotoLibraryDevelopOriginalSessionV2(f.host), work = port.withFrame(value, view => view.photoId);
	await entered.promise; value.photoId = 'other'; value.expectedRevision = 2;
	Reflect.set(f.host.repository, 'loadPhoto', async () => { assert.fail('Captured reader replaced'); });
	release.resolve(); assert.equal(await work, photo().id);
});

test('held original reads and consumers join intrinsic cancellation while scoped pixels are wiped', async () => {
	for (const holdConsumer of [false, true]) {
		const f = fixture(), entered = deferred<void>(), release = deferred<void>(), borrowed: PixelFrameV1[] = [];
		const reason = new Proxy({}, { get() { assert.fail('Abort reason inspected'); }, getPrototypeOf() { assert.fail('Abort reason reflected'); } });
		if (!holdConsumer) Reflect.set(f.host, 'loadOriginal', async () => { entered.resolve(); await release.promise; return body; });
		const work = createPhotoLibraryDevelopOriginalSessionV2(f.host).withFrame(request(), async view => {
			borrowed.push(view.frame); entered.resolve(); await release.promise; return 'obsolete';
		});
		const outcome = work.then(() => ({ ok: true, reason: undefined as unknown }), (value: unknown) => ({ ok: false, reason: value }));
		await entered.promise; f.lifetime.abort(reason); assert.equal(await remainsPending(work), true); release.resolve();
		const result = await outcome; assert.equal(result.ok, false); assert.equal(result.reason === reason, true);
		if (holdConsumer) assert.equal(borrowed[0]!.pixels.every(byte => byte === 0), true);
		else assert.equal(f.calls.opens, 0);
	}
});

test('a Photo2 revision change during borrowed consumer refuses publication and wipes pixels', async () => {
	const f = fixture(), borrowed: PixelFrameV1[] = [];
	await assert.rejects(createPhotoLibraryDevelopOriginalSessionV2(f.host).withFrame(request(), view => {
		borrowed.push(view.frame); f.replace(normalizePhotoDocumentV2({ ...photo(), revision: 1 })); return 'stale';
	}), PhotoCatalogRevisionConflictError);
	assert.equal(borrowed[0]!.pixels.every(byte => byte === 0), true);
});
