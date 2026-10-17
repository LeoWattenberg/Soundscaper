/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import { PhotoLibraryRepairSpotsAuthoringV1 } from '../src/common/editor/controller/shared/photo-library-repair-spots-authoring-v1.ts';
import { createPhotoLibraryDevelopOriginalSessionCurrentV1 } from '../src/lightscaper/controller/photo-library-develop-original-session-current-v1.ts';
import { PhotoLibrarySessionLifetime } from '../src/lightscaper/controller/photo-library-session-lifetime.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { withPhotoOriginalFrameV1 } from '../src/lightscaper/preview/photo-original-frame-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { withImageDevelopFrameV3 } from '../src/common/editor/imaging/image-develop-frame-v3.ts';
import type { ImageDevelopRepairSpotV1 } from '../src/common/editor/imaging/image-develop-repair-spots-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../src/common/editor/photo-library-develop-original-port-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { pngChunk } from './helpers/image-metadata-fixtures.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const LIMITS = { maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 67_108_864 };
function encodedOriginal(pixels: readonly number[], width: number, height: number): Uint8Array<ArrayBuffer> {
	const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0, width); view.setUint32(4, height); header.set([8, 6], 8);
	const rows = new Uint8Array(pixels.length + height);
	for (let y = 0; y < height; y++) rows.set(pixels.slice(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
	return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header),
		pngChunk('IDAT', new Uint8Array(deflateSync(rows))), pngChunk('IEND', new Uint8Array())]));
}
function decodeFixture(bytes: Uint8Array, width: number, height: number): Uint8Array<ArrayBuffer> {
	const chunks: Uint8Array[] = [];
	for (let offset = 8; offset < bytes.length;) {
		const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
		if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
		offset += length + 12;
	}
	const decoded = inflateSync(Buffer.concat(chunks)), result = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) { const offset = y * (width * 4 + 1); assert.equal(decoded[offset], 0); result.set(decoded.subarray(offset + 1, offset + 1 + width * 4), y * width * 4); }
	return result;
}
function donorPixels(): number[] {
	const pixels = Array<number>(11 * 3 * 4).fill(0);
	for (let y = 0; y < 3; y++) for (let x = 0; x < 11; x++) {
		const value = x < 3 ? 32 : x >= 4 && x < 7 ? 64 : x >= 8 ? 128 : 0, offset = (y * 11 + x) * 4;
		pixels.splice(offset, 4, value, value, value, 255);
	}
	for (const [x, value] of [[1, 64], [5, 192], [9, 0]] as const) pixels.splice((11 + x) * 4, 3, value, value, value);
	return pixels;
}
function spot(id = 'spot', mode: 'clone' | 'heal' = 'clone'): ImageDevelopRepairSpotV1 {
	return { id, mode, enabled: true, target: { x: 9.5 / 11, y: 0.5 }, source: { x: 1.5 / 11, y: 0.5 }, radius: 0.2, feather: 0, opacity: 1 };
}
async function fixture(pixels: readonly number[] = donorPixels(), width = 11, height = 3) {
	const raw = createInstrumentedIndexedDB(), repository = new PhotoCatalogRepositoryCurrentV1({ indexedDB: raw as unknown as IDBFactory,
		databaseName: `lightscaper-repair-authoring-${crypto.randomUUID()}`, verifyOriginal: async () => undefined });
	const bytes = encodedOriginal(pixels, width, height), seed = photoArchiveFixture(1, bytes);
	const photo = normalizePhotoDocumentCurrentV1({ ...seed.photo, original: { ...seed.photo.original, width, height, hasAlpha: false } });
	await repository.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1', name: 'Repair authoring',
		revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] }); await repository.publishPhotos('catalog-1', 0, [photo]);
	const lifetime = new PhotoLibrarySessionLifetime(), borrowed: PixelFrameV1['pixels'][] = [], decoderBuffers: Uint8Array[] = [];
	const calls = { bodies: 0, opens: 0, cleanup: 0 }, hooks = { current: true, body: seed.original, ready: async () => 'catalog-1' };
	const actual = createPhotoLibraryDevelopOriginalSessionCurrentV1({ repository, ready: () => hooks.ready(),
		operation: (run, signal) => lifetime.operation(run, signal), loadOriginal: async original => {
			assert.deepEqual(original, photo.original); calls.bodies++; return hooks.body;
		}, withFrame: (value, consume) => withPhotoOriginalFrameV1(value, async frame => {
			borrowed.push(frame.pixels); return consume(frame, { orientation: 1, runtimeVersion: 'authoring-fixture' });
		}, { openImage: async request => {
			calls.opens++; decoderBuffers.push(request.bytes); return { metadata: { width, height, frameCount: 1, topology: 'single', runtimeVersion: 'authoring-fixture' },
				decodeFrame: async () => ({ rgba: decodeFixture(request.bytes, width, height), durationMicroseconds: null }), close() { /* Controlled decoder owns no retained resource. */ } };
		} }) });
	const original: PhotoLibraryDevelopOriginalPortV1 = { withFrame(request, consume, options) { assert.equal(this, original); return actual.withFrame(request, consume, options); } };
	const options = { original, photoId: 'photo-1', expectedRevision: 0, develop: defaultImageDevelopStateV2(), isCurrent: () => hooks.current };
	return { repository, photo, seed, bytes, calls, hooks, options, original, borrowed, decoderBuffers, lifetime,
		close: () => lifetime.close(async () => { calls.cleanup++; await repository.close(); }) };
}
async function enteredBeforeSettlement(work: Promise<unknown>, entered: Promise<void>): Promise<void> {
	await Promise.race([entered, work.then(() => assert.fail('The held Original operation settled before entering.'), (error: unknown) => { throw error; })]);
}

test('Repair authoring validates genuine Clone and screened Heal against authenticated Original, including moved source and independent output literals', async () => {
	const f = await fixture(), owner = new PhotoLibraryRepairSpotsAuthoringV1(f.options), outputs: PixelFrameV1['pixels'][] = [];
	try {
		await owner.open(); assert.equal(owner.snapshot().ready, true); assert.equal(owner.snapshot().width, 11); assert.equal(owner.snapshot().height, 3);
		owner.add(spot()); const clone = await owner.apply(); assert.equal(clone.processVersion, 3); assert.deepEqual(clone.repairs.spots, [spot()]);
		const target = async (develop: typeof clone) => owner.withOriginalFrame(view => withImageDevelopFrameV3({ frame: view.frame, develop }, result => {
			outputs.push(result.frame.pixels); return [...result.frame.pixels.slice((11 + 9) * 4, (11 + 10) * 4)];
		}, { source: LIMITS, render: LIMITS }));
		assert.deepEqual(await target(clone), [64, 64, 64, 255]);
		owner.update(spot('spot', 'heal')); const heal = await owner.apply(); assert.deepEqual(await target(heal), [138, 138, 138, 255]);
		owner.update({ ...spot('spot', 'heal'), source: { x: 5.5 / 11, y: 0.5 } });
		const moved = await owner.apply(); assert.deepEqual(await target(moved), [217, 217, 217, 255]);
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.revision, 0);
		assert.deepEqual(new Uint8Array(await f.seed.original.arrayBuffer()), f.bytes);
		assert.ok(outputs.every(bytes => bytes.every(value => value === 0))); assert.ok(f.borrowed.every(bytes => bytes.every(value => value === 0)));
		assert.ok(f.decoderBuffers.every(bytes => bytes.every(value => value === 0)));
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('Local numeric and pointer authoring retains stable order and cancels source moves without writing the Photo', async () => {
	const f = await fixture(), owner = new PhotoLibraryRepairSpotsAuthoringV1(f.options);
	try {
		await owner.open(); const mutable = structuredClone(spot('clone')); owner.add(mutable); Reflect.set(mutable.source, 'x', 1);
		owner.add({ ...spot('heal', 'heal'), enabled: false }); assert.deepEqual(owner.snapshot().repairs.spots.map(value => value.id), ['clone', 'heal']);
		owner.move('heal', 'up'); assert.deepEqual(owner.snapshot().repairs.spots.map(value => value.id), ['heal', 'clone']);
		owner.select('clone'); assert.equal(owner.snapshot().selectedId, 'clone');
		const before = owner.snapshot().repairs;
		owner.beginMove('clone', 'source'); owner.previewMove({ x: 5.5 / 11, y: 0.5 }); assert.equal(owner.snapshot().repairs.spots[1]?.source.x, 5.5 / 11);
		owner.cancelMove(); assert.deepEqual(owner.snapshot().repairs, before);
		owner.beginMove('clone', 'target'); owner.previewMove({ x: 8.5 / 11, y: 0.5 }); owner.commitMove();
		assert.equal(owner.snapshot().repairs.spots[1]?.target.x, 8.5 / 11); assert.ok(Object.isFrozen(owner.snapshot().repairs.spots[1]?.target));
		owner.remove('heal'); assert.deepEqual(owner.snapshot().repairs.spots.map(value => value.id), ['clone']);
		const result = await owner.apply(); assert.equal(result.processVersion, 3); assert.deepEqual(result.repairs, owner.snapshot().repairs);
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.revision, 0);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('Repair scalar admission includes inactive spots, rejects duplicates/hostile metadata atomically and keeps every body unread', async () => {
	const f = await fixture(), owner = new PhotoLibraryRepairSpotsAuthoringV1(f.options); let getters = 0;
	try {
		await owner.open(); const bodyCount = f.calls.bodies;
		for (let index = 0; index < 64; index++) owner.add({ ...spot(`spot-${index}`), enabled: false });
		const before = owner.snapshot().repairs;
		assert.throws(() => owner.add({ ...spot('overflow'), enabled: false })); assert.throws(() => owner.add(spot('spot-0')));
		assert.throws(() => owner.update({ ...spot('spot-0'), radius: 0 })); assert.throws(() => owner.update(spot('missing')));
		const hostile = Object.defineProperty(spot('spot-0'), 'source', { enumerable: true, get() { getters++; return { x: 0, y: 0 }; } });
		assert.throws(() => owner.update(hostile)); owner.beginMove('spot-0', 'target');
		assert.throws(() => owner.previewMove({ x: NaN, y: 0 })); owner.cancelMove();
		assert.deepEqual(owner.snapshot().repairs, before); assert.equal(getters, 0); assert.equal(f.calls.bodies, bodyCount);
		const result = await owner.apply(); assert.equal(result.repairs.spots.length, 64); assert.equal(result.processVersion, 3);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('Genuine Heal with no original boundary context refuses rather than becoming Clone or publishing a local result', async () => {
	const f = await fixture([64, 64, 64, 255], 1, 1), owner = new PhotoLibraryRepairSpotsAuthoringV1(f.options);
	try {
		await owner.open(); owner.add({ ...spot('heal', 'heal'), target: { x: 0.5, y: 0.5 }, source: { x: 0.5, y: 0.5 }, radius: 1 });
		const before = owner.snapshot().repairs; await assert.rejects(owner.apply(), /context|boundary/iu);
		assert.deepEqual(owner.snapshot().repairs, before); assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.revision, 0);
		assert.ok(f.borrowed.every(bytes => bytes.every(value => value === 0)));
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('Authoring pins the real Original method before held readiness and detaches selection metadata without callable property reads', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), holder: { work?: Promise<unknown> } = {}; let metadata = 0;
	f.hooks.ready = async () => { entered.resolve(); await release.promise; return 'catalog-1'; };
	Reflect.set(f.original, 'withFrame', new Proxy(f.original.withFrame, { get() { metadata++; throw Error('Original callable metadata reflected.'); } }));
	const owner = new PhotoLibraryRepairSpotsAuthoringV1(f.options);
	try {
		holder.work = owner.open(); await enteredBeforeSettlement(holder.work, entered.promise);
		Reflect.set(f.original, 'withFrame', () => assert.fail('Replacement Original reader')); f.options.photoId = 'other'; f.options.expectedRevision = 999;
		release.resolve(); await holder.work; assert.equal(owner.snapshot().width, 11); assert.equal(metadata, 0); assert.equal(f.calls.bodies, 1);
	} finally { release.resolve(); await Promise.allSettled(holder.work ? [holder.work] : []); await owner.cancelAndJoin(); await f.close(); }
});

test('One Original demand rejects concurrent and reentrant callbacks before reflection, then permits a sequential borrow', async () => {
	const f = await fixture(), owner = new PhotoLibraryRepairSpotsAuthoringV1(f.options), entered = deferred<void>(), release = deferred<void>();
	const holder: { work?: Promise<unknown> } = {}; let traps = 0;
	const hostile = new Proxy(() => undefined, { get() { traps++; throw Error('Concurrent callback reflected.'); }, apply() { traps++; throw Error('Concurrent callback called.'); } });
	try {
		await owner.open(); holder.work = owner.withOriginalFrame(async view => { entered.resolve(); await release.promise; assert.equal(view.frame.pixels[4], 32); });
		await enteredBeforeSettlement(holder.work, entered.promise); await assert.rejects(owner.withOriginalFrame(hostile)); await assert.rejects(owner.apply());
		assert.equal(traps, 0); assert.equal(f.calls.bodies, 2); release.resolve(); await holder.work;
		await owner.withOriginalFrame(async () => { await assert.rejects(owner.withOriginalFrame(hostile)); });
		assert.equal(await owner.withOriginalFrame(view => view.frame.descriptor.width), 11); assert.equal(traps, 0);
	} finally { release.resolve(); await Promise.allSettled(holder.work ? [holder.work] : []); await owner.cancelAndJoin(); await f.close(); }
});

test('Native abort and cached Close join a held real Original consumer before cleanup and preserve the sole opaque reason', async () => {
	const f = await fixture(), stop = new AbortController(), owner = new PhotoLibraryRepairSpotsAuthoringV1({ ...f.options, signal: stop.signal });
	const entered = deferred<void>(), release = deferred<void>(), holder: { work?: Promise<unknown> } = {}, reason = Proxy.revocable({}, {}); reason.revoke();
	try {
		await owner.open(); holder.work = owner.withOriginalFrame(async view => { entered.resolve(); await release.promise; assert.equal(view.frame.pixels[4], 32); });
		const outcome = holder.work.then(() => ({ error: undefined }), (error: unknown) => ({ error }));
		await enteredBeforeSettlement(holder.work, entered.promise); stop.abort(reason.proxy);
		const closing = owner.cancelAndJoin(); assert.equal(owner.cancelAndJoin(), closing); assert.equal(await remainsPending(closing), true);
		const resources = f.close(); assert.equal(await remainsPending(resources), true); assert.equal(f.calls.cleanup, 0);
		assert.ok(f.borrowed.at(-1)?.some(value => value !== 0)); release.resolve(); assert.equal((await outcome).error, reason.proxy);
		await closing; await resources; assert.equal(owner.snapshot().closed, true); assert.equal(f.calls.cleanup, 1);
		assert.ok(f.borrowed.every(bytes => bytes.every(value => value === 0))); assert.ok(f.decoderBuffers.every(bytes => bytes.every(value => value === 0)));
		await assert.rejects(owner.withOriginalFrame(() => assert.fail('Retired consumer')));
	} finally { release.resolve(); await Promise.allSettled(holder.work ? [holder.work] : []); await owner.cancelAndJoin(); await f.close(); }
});

test('Held Apply stale-currentness and actual original corruption cannot yield a repaired recipe or alter the Photo', async () => {
	const f = await fixture(), owner = new PhotoLibraryRepairSpotsAuthoringV1(f.options), entered = deferred<void>(), release = deferred<void>();
	const holder: { work?: Promise<unknown> } = {};
	try {
		await owner.open(); owner.add(spot()); const before = owner.snapshot().repairs;
		f.hooks.ready = async () => { entered.resolve(); await release.promise; return 'catalog-1'; };
		holder.work = owner.apply(); const outcome = holder.work.then(() => ({ error: undefined }), (error: unknown) => ({ error }));
		await enteredBeforeSettlement(holder.work, entered.promise); f.hooks.current = false; release.resolve(); assert.notEqual((await outcome).error, undefined);
		assert.deepEqual(owner.snapshot().repairs, before); assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.revision, 0);
		f.hooks.current = true; const corrupt = f.bytes.slice(); corrupt[corrupt.length - 1] ^= 1; f.hooks.body = new Blob([corrupt]);
		await assert.rejects(owner.apply(), /SHA|digest/iu); assert.deepEqual(owner.snapshot().repairs, before);
		assert.deepEqual(new Uint8Array(await f.seed.original.arrayBuffer()), f.bytes);
	} finally { release.resolve(); await Promise.allSettled(holder.work ? [holder.work] : []); await owner.cancelAndJoin(); await f.close(); }
});

test('The selected Original revision remains fenced during diagnostic borrowing and the owned physical pixels retire before rejection', async () => {
	const f = await fixture(), owner = new PhotoLibraryRepairSpotsAuthoringV1(f.options);
	try {
		await owner.open(); await assert.rejects(owner.withOriginalFrame(async () => {
			const photo = await f.repository.loadPhoto('catalog-1', 'photo-1'); assert.ok(photo);
			await f.repository.savePhoto({ ...photo, metadata: { ...photo.metadata, title: 'External revision' } }, photo.revision);
		}), { code: 'PHOTO_REVISION_CONFLICT' });
		assert.ok(f.borrowed.every(bytes => bytes.every(value => value === 0))); assert.deepEqual(new Uint8Array(await f.seed.original.arrayBuffer()), f.bytes);
		assert.equal(owner.snapshot().repairs.spots.length, 0);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('Native pre-abort wins other required-field accessor descriptors before any Original acquisition or getter invocation', async () => {
	const f = await fixture(), stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); stop.abort(reason.proxy);
	let getters = 0;
	try {
		for (const key of ['original', 'develop', 'isCurrent']) {
			const options = Object.defineProperty({ ...f.options, signal: stop.signal }, key, { enumerable: true,
				get() { getters++; throw new Error('A pre-aborted authoring capability was read.'); } });
			let failure: unknown;
			try { new PhotoLibraryRepairSpotsAuthoringV1(options); } catch (error) { failure = error; }
			assert.equal(failure === reason.proxy, true);
		}
		assert.equal(getters, 0); assert.equal(f.calls.bodies, 0); assert.equal(f.calls.opens, 0);
	} finally { await f.close(); }
});
