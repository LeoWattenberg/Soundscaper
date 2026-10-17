/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoOriginalFrameV1 } from '../src/lightscaper/preview/photo-original-frame-v1.ts';
import { withPhotoOriginalFrameCurrentV1, type PhotoOriginalFramePortsCurrentV1 } from '../src/lightscaper/preview/photo-original-frame-current-v1.ts';
import { admitPhotoOriginalHdrBindingCurrentV1, withPhotoOriginalHdrFrameCurrentV1 } from '../src/lightscaper/preview/photo-original-hdr-frame-current-v1.ts';
import { normalizePhotoOriginalBindingCurrentV1 } from '../src/lightscaper/preview/photo-original-binding-current-v1.ts';
import { withDecodedImageHdrOriginalV1 } from '../src/common/editor/imaging/image-hdr-original-v1.ts';
import { normalizePhotoPreviewOriginalBindingV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { currentAppLocks } from './helpers/lightscaper-current-app-fixture.tsx';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const MIME = 'image/x-lightscaper-hdr';
const RGB = Float32Array.from([3, .5, -.25, 1e-30, -0, 1 / 65535]);
const RGBA = Float32Array.from([3, .5, -.25, 1, 1e-30, -0, 1 / 65535, 1]);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Independent wire fixture: no production HDR parser, encoder or merge engine
 * constructs this retained body or supplies the expected native samples. */
function hdrBody(): Uint8Array<ArrayBuffer> {
	const inputs = [1, 4].map((exposureMultiplier, index) => ({ product: 'lightscaper', ownerId: 'source-catalog', sourceId: `source-${index}`,
		revision: 0, original: { fileName: `Bracket-${index}.dng`, mimeType: 'image/x-adobe-dng', sha256: (index ? 'b' : 'a').repeat(64),
			byteLength: 1024, width: 2, height: 1 }, profile: 'linear-srgb16', exposureMultiplier,
		offset: { x: 0, y: 0 }, alignmentError: 0, alignmentSupport: 2 }));
	const provenance = { schemaVersion: 1, operation: 'hdr-merge-v1', referenceIndex: 0, alignment: 'none',
		deghost: { mode: 'off', threshold: 0 }, inputs, output: { x: 0, y: 0, width: 2, height: 1 } };
	const canonical = (value: unknown): string => {
		if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
		if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`).join(',')}}`;
		const text = JSON.stringify(value); if (text === undefined) throw new TypeError('Fixture JSON requires a value.'); return text;
	};
	const metadata = new TextEncoder().encode(canonical(provenance)), payloadOffset = (64 + metadata.length + 3) & ~3;
	const bytes = new Uint8Array(payloadOffset + RGB.byteLength), view = new DataView(bytes.buffer);
	bytes.set(new TextEncoder().encode('LSCHDRF1'));
	for (const [offset, value] of [[8, 64], [12, 1], [16, 2], [20, 1], [24, metadata.length], [28, RGB.byteLength]]) view.setUint32(offset!, value!, true);
	bytes.set(createHash('sha256').update(metadata).digest(), 32); bytes.set(metadata, 64);
	for (let index = 0; index < RGB.length; index++) view.setFloat32(payloadOffset + index * 4, RGB[index]!, true);
	return bytes;
}

async function retainedHdrSession() {
	const keyRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
	Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
	const native = mediaRestoreFixture(), locks = currentAppLocks(), options = { name: 'HDR retained Original', indexedDB: native.factory, locks };
	let session: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>> | undefined;
	let media: PhotoMediaStoreV1 | undefined, catalog: PhotoCatalogRepositoryCurrentV1 | undefined;
	const restore = () => { if (keyRange) Object.defineProperty(globalThis, 'IDBKeyRange', keyRange); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); };
	try {
		const initial = await createPhotoLibrarySessionV3(options);
		try { await initial.readPage(); } finally { await initial.close(); }
		const anchor = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, preferOpfs: false });
		const selected = await (async () => {
			try { await anchor.ready(); return await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
				initializeDefault: async () => { throw new Error('Fixture cannot initialize an alternate namespace.'); } }); }
			finally { await anchor.close(); }
		})();
		const storage = { indexedDB: native.factory, locks, databaseName: selected.location.mediaDatabaseName, preferOpfs: false };
		media = new PhotoMediaStoreV1(storage); await media.ready();
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, databaseName: selected.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
		const bytes = hdrBody(), seed = queryPhotoV1(), photo = normalizePhotoDocumentCurrentV1({ ...seed, schemaVersion: 3,
			catalogId: selected.location.catalogId, folderId: null, collectionIds: [], keywordIds: [], extractedMetadata: null,
			original: { ...seed.original, name: 'Merged.lshdr', mimeType: MIME, width: 2, height: 1, byteLength: bytes.length, contentSha256: digest(bytes) } });
		const asset = await media.mediaRepository.writeAsset(photo.original.storageKey, new Blob([bytes], { type: MIME }));
		await media.mediaRepository.catalogOriginals.stage(photo.catalogId, 'hdr-seed', [{ photoId: photo.id, sourceId: photo.original.id,
			assetId: asset.sourceId, sha256: asset.sha256, size: asset.size }]);
		const root = await catalog.loadCatalog(photo.catalogId); assert.ok(root); await catalog.publishPhotos(root.id, root.revision, [photo]);
		await media.mediaRepository.catalogOriginals.promote(root.id, 'hdr-seed', [photo.id]);
		await Promise.all([catalog.close(), media.close()]); catalog = undefined; media = undefined;
		// The default Current Session reopens the real native catalog and body.
		// No decoder, source frame, repository method or Session is substituted.
		session = await createPhotoLibrarySessionCurrentV1(options);
		const original = session.develop.original; assert.ok(original);
		const inspect = async () => {
			const owner = new PhotoMediaStoreV1(storage), repository = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory,
				databaseName: selected.location.catalogDatabaseName, verifyOriginal: owner.verifyOriginal });
			try {
				await owner.ready(); const row = await repository.loadPhoto(photo.catalogId, photo.id); assert.ok(row);
				const body = await owner.mediaRepository.loadAsset(row.original.storageKey); assert.ok(body instanceof Blob);
				await owner.verifyOriginal(row.original);
				return { row, bytes: new Uint8Array(await body.arrayBuffer()), metadata: await owner.mediaRepository.getAssetMetadata(row.original.storageKey),
					roots: await owner.mediaRepository.catalogOriginals.readPage({ catalogId: photo.catalogId }) };
			} finally { await Promise.all([repository.close(), owner.close()]); }
		};
		return { photo, bytes, original, inspect, request: { schemaVersion: 1 as const, photoId: photo.id, expectedRevision: photo.revision },
			close: async () => { try { await session?.close(); } finally { restore(); } } };
	} catch (error) { await Promise.allSettled([session?.close(), catalog?.close(), media?.close()]); restore(); throw error; }
}

function rawBytes(frame: Readonly<PixelFrameV1>): Uint8Array { return new Uint8Array(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.byteLength); }
function observed<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
function directHdr() {
	const bytes = hdrBody(), binding = { sourceKind: 'hdr-original' as const, catalogId: 'catalog', photoId: 'hdr', originalId: 'hdr-source', storageKey: 'hdr-body',
		contentSha256: digest(bytes), byteLength: bytes.length, width: 2, height: 1 };
	return { bytes, binding, value: { binding, body: new Blob([bytes], { type: MIME }) } };
}

test('Current reopened retained HDR Original lends exact signed HDR and tiny Float32 samples without byte quantization', async () => {
	const f = await retainedHdrSession(); let backing: Uint8Array | undefined;
	try {
		const before = await f.inspect();
		const result = await f.original.withFrame(f.request, view => {
			assert.equal(view.photoId, f.photo.id); assert.equal(view.revision, f.photo.revision);
			assert.deepEqual(view.frame.descriptor, { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' });
			assert.ok(view.frame.pixels instanceof Float32Array); backing = rawBytes(view.frame);
			assert.deepEqual([...view.frame.pixels], [...RGBA]); assert.ok(Object.is(view.frame.pixels[5], -0)); return 'native HDR Original';
		});
		assert.equal(result, 'native HDR Original'); assert.ok(backing?.every(value => value === 0));
		const after = await f.inspect(); assert.deepEqual(after.row, before.row); assert.deepEqual(after.bytes, f.bytes);
		assert.deepEqual(after.metadata, before.metadata); assert.deepEqual(after.roots, before.roots); assert.equal(digest(after.bytes), f.photo.original.contentSha256);
	} finally { await f.close(); }
});

test('Current retained HDR Original enters the real native Develop pipeline before exposure minus two', async () => {
	const f = await retainedHdrSession(), renderer = createPhotoDevelopRenderRuntimeCurrentV1(); let source: Uint8Array | undefined, output: Uint8Array | undefined;
	const develop = normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(),
		effects: [createVideoEffectV2('tone-ladder-v1', { id: 'hdr-exposure', params: { exposure: -2 } })] });
	try {
		const result = await f.original.withFrame(f.request, view => {
			source = rawBytes(view.frame);
			return renderer.withFullResolution({ frame: view.frame, develop, signal: new AbortController().signal }, rendered => {
				assert.ok(rendered.frame.pixels instanceof Float32Array); output = rawBytes(rendered.frame);
				return [...rendered.frame.pixels];
			});
		});
		// The active tone stage's neutral additive terms normalize signed zero;
		// the exact Original bit-pattern witness above remains independent.
		assert.deepEqual(result, [...RGBA].map((value, index) => index % 4 === 3 ? value : value === 0 ? 0 : Math.fround(value * .25)));
		assert.ok(source?.every(value => value === 0)); assert.ok(output?.every(value => value === 0));
		assert.deepEqual((await f.inspect()).bytes, f.bytes);
	} finally { await f.close(); }
});

test('Current HDR Original cancellation joins the held consumer before wiping the native plane', async () => {
	const f = await retainedHdrSession(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); let pixels: Uint8Array | undefined;
	const work = f.original.withFrame(f.request, async view => { pixels = rawBytes(view.frame); entered.resolve(); await release.promise; return 'held'; }, { signal: stop.signal });
	const outcome = observed(work);
	try {
		await Promise.race([entered.promise, work.then(() => assert.fail('No held native HDR consumer.'), (error: unknown) => { throw error; })]);
		stop.abort(opaque.proxy); assert.equal(await remainsPending(work), true); assert.ok(pixels?.some(value => value !== 0));
		release.resolve(); const result = await outcome; assert.ok(!result.ok); assert.ok(Object.is(result.error, opaque.proxy));
		assert.ok(pixels?.every(value => value === 0)); assert.deepEqual((await f.inspect()).bytes, f.bytes);
	} finally { release.resolve(); await outcome; await f.close(); }
});

test('permanent raster Original reader and V1 64 MiB binding remain closed to the native HDR successor', async () => {
	const bytes = hdrBody(), binding = { catalogId: 'catalog', photoId: 'hdr', originalId: 'source', storageKey: 'hdr-original',
		contentSha256: digest(bytes), byteLength: bytes.length, width: 2, height: 1 };
	assert.throws(() => normalizePhotoPreviewOriginalBindingV1({ ...binding, byteLength: 64 * 1024 * 1024 + 1 }), RangeError);
	let opened = false, consumed = false;
	await assert.rejects(withPhotoOriginalFrameV1({ binding, body: new Blob([bytes], { type: MIME }) }, async () => { consumed = true; },
		{ openImage: async () => { opened = true; throw new Error('Private HDR bytes must not reach a raster decoder.'); } }));
	assert.equal(opened, false); assert.equal(consumed, false);
});

test('HDR Current binding admits its named encoded cap while permanent raster and RAW bindings stay at 64 MiB', async () => {
	const f = directHdr();
	assert.equal(normalizePhotoOriginalBindingCurrentV1({ ...f.binding, byteLength: 196 * 1024 * 1024 }).byteLength, 196 * 1024 * 1024);
	assert.throws(() => normalizePhotoOriginalBindingCurrentV1({ ...f.binding, byteLength: 196 * 1024 * 1024 + 1 }), RangeError);
	const { sourceKind: _sourceKind, ...fixed } = f.binding;
	assert.throws(() => normalizePhotoOriginalBindingCurrentV1({ ...fixed, byteLength: 64 * 1024 * 1024 + 1 }), RangeError);
	assert.throws(() => normalizePhotoPreviewOriginalBindingV1(f.binding), TypeError);
	assert.doesNotThrow(() => admitPhotoOriginalHdrBindingCurrentV1({ ...f.binding, width: 8192, height: 2048 }));
	assert.throws(() => admitPhotoOriginalHdrBindingCurrentV1({ ...f.binding, width: 8192, height: 2049 }), RangeError);
});

test('HDR scalar capacity and malformed capability admission precede intrinsic Blob IO', async () => {
	const f = directHdr(), saved = Object.getOwnPropertyDescriptor(Reflect, 'apply')!, apply = Reflect.apply, read = Blob.prototype.arrayBuffer;
	let reads = 0, calls = 0;
	Object.defineProperty(Reflect, 'apply', { configurable: true, value(target: (...args: never[]) => unknown, receiver: unknown, args: unknown[]): unknown {
		if (target === read) { reads++; throw new Error('Refused HDR metadata reached encoded allocation.'); }
		return apply(target, receiver, args);
	} });
	try {
		const ports: PhotoOriginalFramePortsCurrentV1 = { withHdrFrame() { calls++; throw new Error('Invalid admission reached native HDR decode.'); } };
		for (const binding of [{ ...f.binding, width: 8193 }, { ...f.binding, width: 8192, height: 4096 },
			{ ...f.binding, byteLength: 196 * 1024 * 1024 + 1 }, { ...f.binding, sourceKind: 'unknown' }]) {
			await assert.rejects(withPhotoOriginalFrameCurrentV1({ ...f.value, binding }, async () => undefined, ports));
		}
		await assert.rejects(withPhotoOriginalHdrFrameCurrentV1(f.value, async () => undefined,
			Object.defineProperty({}, 'withHdrFrame', { enumerable: true, get() { calls++; throw new Error('Decoder getter ran.'); } })), TypeError);
		assert.equal(reads, 0); assert.equal(calls, 0);
	} finally { Object.defineProperty(Reflect, 'apply', saved); }
});

test('HDR owner verifies whole encoded authority and header geometry before lending pixels', async () => {
	const f = directHdr(), changed = f.bytes.slice(); changed[changed.length - 1]! ^= 1;
	let calls = 0, deliveries = 0;
	const ports: PhotoOriginalFramePortsCurrentV1 = { withHdrFrame(request, consume) { calls++; return withDecodedImageHdrOriginalV1(request, consume); } };
	for (const body of [new Blob([changed]), new Blob([f.bytes.subarray(1)])]) {
		await assert.rejects(withPhotoOriginalFrameCurrentV1({ ...f.value, body }, async () => { deliveries++; }, ports), /SHA|length/u);
	}
	assert.equal(calls, 0);
	await assert.rejects(withPhotoOriginalFrameCurrentV1({ ...f.value, binding: { ...f.binding, width: 1 } }, async () => { deliveries++; }, ports), /geometry/u);
	const invalid = f.bytes.slice(); invalid[0] = 0;
	await assert.rejects(withPhotoOriginalFrameCurrentV1({ binding: { ...f.binding, contentSha256: digest(invalid) }, body: new Blob([invalid]) }, async () => { deliveries++; }, ports));
	assert.equal(deliveries, 0); assert.deepEqual(new Uint8Array(await f.value.body.arrayBuffer()), f.bytes);
});

test('HDR encoded snapshots retire before external Develop, with the selected decoder receiver pinned across IO', async () => {
	const f = directHdr(), entered = deferred<void>(), release = deferred<void>(); let encoded: Uint8Array | undefined, native: Uint8Array | undefined, calls = 0;
	const ports: PhotoOriginalFramePortsCurrentV1 = { withHdrFrame(request, consume) {
		assert.equal(this, ports); calls++; assert.ok(request && typeof request === 'object');
		const bytes: unknown = Object.getOwnPropertyDescriptor(request, 'bytes')?.value; assert.ok(bytes instanceof Uint8Array); encoded = bytes;
		return withDecodedImageHdrOriginalV1(request, view => {
			assert.ok(encoded!.some(value => value !== 0)); native = rawBytes(view.frame); return consume(view);
		});
	} };
	const work = withPhotoOriginalFrameCurrentV1(f.value, async frame => {
		assert.ok(encoded?.every(value => value === 0)); assert.deepEqual([...frame.pixels], [...RGBA]); entered.resolve(); await release.promise; return 'retired encoded';
	}, ports), result = observed(work);
	Object.defineProperty(ports, 'withHdrFrame', { configurable: true, value() { throw new Error('Late capability replacement was read.'); } });
	try {
		await Promise.race([entered.promise, work.then(() => assert.fail('No held native plane.'), (error: unknown) => { throw error; })]);
		assert.equal(await remainsPending(work), true); assert.ok(native?.some(value => value !== 0));
		release.resolve(); assert.equal(await work, 'retired encoded'); assert.equal(calls, 1); assert.ok(native?.every(value => value === 0));
		assert.deepEqual(f.bytes, new Uint8Array(await f.value.body.arrayBuffer()));
	} finally { release.resolve(); await result; }
});

test('HDR reader preserves opaque failure and its complete downstream cleanup aggregate', async () => {
	const f = directHdr(), opaque = Proxy.revocable({}, {}); opaque.revoke(); const cleanup = new Error('Downstream cleanup failed.');
	for (const primary of [opaque.proxy, new AggregateError([opaque.proxy, cleanup], 'Downstream operation and cleanup.')]) {
		let plane: Uint8Array | undefined;
		const outcome = await observed(withPhotoOriginalFrameCurrentV1(f.value, async frame => { plane = rawBytes(frame); throw primary; }));
		assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, primary)); assert.ok(plane?.every(value => value === 0));
	}
});

test('HDR pre-abort keeps an opaque native reason ahead of hostile request metadata', async () => {
	const f = directHdr(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); stop.abort(opaque.proxy); let inspected = 0;
	const request = new Proxy({ ...f.value, signal: stop.signal }, { ownKeys() { inspected++; throw new Error('Pre-aborted request was enumerated.'); } });
	const outcome = await observed(withPhotoOriginalHdrFrameCurrentV1(request, async () => undefined));
	assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, opaque.proxy)); assert.equal(inspected, 0);
});

test('HDR transferred native plane refuses delivery and preserves an opaque primary alongside retirement failure', async () => {
	const f = directHdr(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	for (const fail of [false, true]) {
		let transferred: ArrayBuffer | undefined;
		try {
			const outcome = await observed(withPhotoOriginalFrameCurrentV1(f.value, async frame => {
				const backing = frame.pixels.buffer; transferred = structuredClone(backing, { transfer: [backing] });
				if (fail) throw opaque.proxy; return 'unretired output';
			}));
			assert.ok(!outcome.ok);
			if (fail) { assert.ok(outcome.error instanceof AggregateError); assert.ok(Object.is(outcome.error.errors[0], opaque.proxy)); assert.ok(outcome.error.errors[1] instanceof TypeError); }
			else assert.ok(outcome.error instanceof TypeError);
			assert.ok(transferred); assert.ok(new Uint8Array(transferred).some(value => value !== 0));
		} finally { if (transferred) new Uint8Array(transferred).fill(0); }
	}
});
