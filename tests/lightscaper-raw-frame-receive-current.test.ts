/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { preparePhotoFramescaperHandoffOriginalCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-original-current-v1.ts';
import { preparePhotoFramescaperHandoffOriginalV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-original-v1.ts';
import { createPhotoFramescaperHandoffPhotoCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-photo-current-v1.ts';
import { createRawFrameFixtureCurrentV1, rawFixtureSha256CurrentV1 } from './helpers/lightscaper-raw-frame-current-fixture.ts';
import { queryCatalogRootV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { withFramescaperRawImageOriginalCurrentV1 } from '../src/common/editor/timeline-image-raw-pack-current-v1.ts';
import { createFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import type { withDecodedRawOriginalV1 } from '../src/common/editor/raw/libraw-runtime-v1.ts';

for (const processVersion of [1, 2] as const) test(`Light RAW return authenticates actual Original words and retains Photo3 with unchanged process${processVersion}`, async t => {
	const f = await createRawFrameFixtureCurrentV1({ develop: processVersion === 1 ? defaultImageDevelopStateV1() : defaultImageDevelopStateV2() }); t.after(() => f.close());
	await f.withDefaultTransport(async () => {
		const result = await preparePhotoFramescaperHandoffOriginalCurrentV1({ source: f.source, originalBlob: f.originalBlob,
			canonicalFrameSha256: rawFixtureSha256CurrentV1(f.cache) } as unknown as Parameters<typeof preparePhotoFramescaperHandoffOriginalCurrentV1>[0]);
		assert.deepEqual(new Uint8Array(await result.originalBlob.arrayBuffer()), f.original);
		assert.equal(result.metadata.orientation, 1); assert.equal(result.extractedMetadata.container, 'tiff');
		const photo = createPhotoFramescaperHandoffPhotoCurrentV1({ source: f.source, catalog: queryCatalogRootV1(), createdAt: '2026-10-15T00:00:00.000Z',
			ownership: { photoId: 'received-raw-photo', originalId: 'received-raw-original', storageKey: 'received-raw-body', masterVersionId: 'received-raw-master' },
			metadata: result.metadata, extractedMetadata: result.extractedMetadata });
		assert.equal(photo.schemaVersion, 3); assert.equal(photo.versions[0]!.develop.processVersion, processVersion);
		assert.deepEqual(photo.versions[0]!.develop, f.source.develop); assert.equal(photo.original.mimeType, 'image/x-adobe-dng');
		assert.equal(photo.original.contentSha256, f.source.original.sha256); assert.equal(photo.original.byteLength, f.original.byteLength);
		assert.equal(f.workers.active(), 0); assert.ok(f.workers.statistics.joined >= 2);
	});
});

test('Light RAW scoped pack proof captures native receivers before yield and physically retires Original/native allocations', async t => {
	const f = await createRawFrameFixtureCurrentV1(); t.after(() => f.close()); let original: Uint8Array<ArrayBuffer> | undefined, words: Uint16Array<ArrayBuffer> | undefined;
	const request = { source: f.source, read(offset: number, length: number) { assert.equal(this, request); return f.read(offset, length); } };
	const ports = { withRawOriginal: function (this: unknown, ...args: Parameters<typeof withDecodedRawOriginalV1>) { assert.equal(this, ports); return f.withRawOriginal(...args); } as typeof withDecodedRawOriginalV1 };
	const work = withFramescaperRawImageOriginalCurrentV1(request, view => { original = view.originalBytes; words = view.frame.pixels;
		assert.deepEqual(Array.from(words), f.native.words); assert.deepEqual(original, f.original); assert.equal(view.rawFlip, f.native.rawFlip); return 'native'; }, ports);
	request.read = () => { throw new Error('Replacement range port consulted.'); }; ports.withRawOriginal = () => { throw new Error('Replacement decoder consulted.'); };
	assert.equal(await work, 'native'); assert.ok(original && words); assert.ok(original.every(value => value === 0)); assert.ok(words.every(value => value === 0));
	assert.equal(f.workers.active(), 0); assert.equal(f.workers.statistics.joined, 2); assert.deepEqual(new Uint8Array(await f.originalBlob.arrayBuffer()), f.original);
});

test('Light RAW poisoned but honestly authenticated presentation cache cannot change native Original authority', async t => {
	const f = await createRawFrameFixtureCurrentV1(); t.after(() => f.close());
	const cache = new Uint8Array(4096); for (let index = 3; index < cache.length; index += 4) cache[index] = 255;
	const poisoned = repack(f, f.raw, cache);
	assert.notEqual(poisoned.source.contentSha256, f.source.contentSha256);
	const result = await withFramescaperRawImageOriginalCurrentV1({ source: poisoned.source,
		read: (offset, length) => new Uint8Array(poisoned.pack.bytes.slice(offset, offset + length)) }, view => Array.from(view.frame.pixels), { withRawOriginal: f.withRawOriginal });
	assert.deepEqual(result, f.native.words);
	const original = await preparePhotoFramescaperHandoffOriginalCurrentV1({ source: poisoned.source, originalBlob: f.originalBlob,
		canonicalFrameSha256: rawFixtureSha256CurrentV1(cache) } as unknown as Parameters<typeof preparePhotoFramescaperHandoffOriginalCurrentV1>[0], { withRawOriginal: f.withRawOriginal });
	assert.deepEqual(new Uint8Array(await original.originalBlob.arrayBuffer()), f.original); assert.equal(original.metadata.orientation, 1);
});

for (const disagreement of ['native-words', 'native-flip'] as const) test(`Light RAW proof rejects honestly repacked ${disagreement} receipt against actual native decoder`, async t => {
	const f = await createRawFrameFixtureCurrentV1(); t.after(() => f.close());
	const raw = { ...f.raw, ...(disagreement === 'native-words' ? { pixelsSha256: 'a'.repeat(64) } : { rawFlip: 3 }) }, changed = repack(f, raw);
	await assert.rejects(withFramescaperRawImageOriginalCurrentV1({ source: changed.source,
		read: (offset, length) => new Uint8Array(changed.pack.bytes.slice(offset, offset + length)) }, () => assert.fail('False native authority delivered.'), { withRawOriginal: f.withRawOriginal }), /native words|orientation|receipt/iu);
	assert.equal(f.workers.statistics.joined, 2); assert.equal(f.workers.active(), 0);
});

test('Light RAW exact receipt metadata and whole pack SHA refuse before native worker acquisition', async t => {
	const f = await createRawFrameFixtureCurrentV1(); t.after(() => f.close()); let reads = 0;
	await assert.rejects(withFramescaperRawImageOriginalCurrentV1({ source: { ...f.source, conversionReceiptSha256: 'a'.repeat(64) },
		read: () => { reads++; throw new Error('IO before exact metadata admission.'); } }, () => undefined, { withRawOriginal: f.withRawOriginal }), /receipt/iu);
	assert.equal(reads, 0); const corrupt = new Uint8Array(f.pack.bytes); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
	await assert.rejects(withFramescaperRawImageOriginalCurrentV1({ source: f.source, read: (offset, length) => corrupt.subarray(offset, offset + length) }, () => undefined,
		{ withRawOriginal: f.withRawOriginal }), /digest|body/iu);
	assert.equal(f.workers.statistics.created, 1); assert.equal(f.workers.active(), 0);
});

test('Light RAW held native consumer cancellation joins before opaque reason and physical Original retirement', async t => {
	const f = await createRawFrameFixtureCurrentV1(); t.after(() => f.close()); const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const reason = Proxy.revocable({}, {}); reason.revoke(); let original: Uint8Array<ArrayBuffer> | undefined, words: Uint16Array<ArrayBuffer> | undefined;
	const work = withFramescaperRawImageOriginalCurrentV1({ source: f.source, read: f.read, signal: stop.signal }, async view => {
		original = view.originalBytes; words = view.frame.pixels; entered.resolve(); await release.promise; return 'held';
	}, { withRawOriginal: f.withRawOriginal });
	const observed = work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	try { await entered.promise; stop.abort(reason.proxy); assert.equal(await remainsPending(work), true); assert.ok(original?.some(value => value !== 0)); }
	finally { release.resolve(); }
	const outcome = await observed; if (outcome.ok) assert.fail('Cancelled native borrower completed.'); assert.equal(Object.is(outcome.error, reason.proxy), true);
	assert.ok(original && words); assert.ok(original.every(value => value === 0)); assert.ok(words.every(value => value === 0)); assert.equal(f.workers.active(), 0);
});

test('Light RAW physical Original transfer refuses while still joining and wiping native words', async t => {
	const f = await createRawFrameFixtureCurrentV1(); t.after(() => f.close()); let words: Uint16Array<ArrayBuffer> | undefined;
	await assert.rejects(withFramescaperRawImageOriginalCurrentV1({ source: f.source, read: f.read }, view => {
		words = view.frame.pixels; structuredClone(view.originalBytes.buffer, { transfer: [view.originalBytes.buffer] });
	}, { withRawOriginal: f.withRawOriginal }), /detach|backing|retirement/iu);
	assert.ok(words); assert.ok(words.every(value => value === 0)); assert.equal(f.workers.active(), 0);
});

function repack(f: Awaited<ReturnType<typeof createRawFrameFixtureCurrentV1>>, raw = f.raw, cache = f.cache) {
	const pack = createFramescaperImageFramePackV1({ original: f.original, receipt: { schemaVersion: 1, kind: 'raw-original', raw }, width: 32, height: 32,
		timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 5_000_000n, rgba: cache }] });
	return { pack, source: { ...f.source, raw, contentSha256: pack.contentSha256, assetByteLength: pack.assetByteLength, conversionReceiptSha256: pack.conversionReceiptSha256 } };
}

test('Light RAW return permanent legacy facade refuses Source4 without creating a native worker', async t => {
	const f = await createRawFrameFixtureCurrentV1(); t.after(() => f.close()); const before = f.workers.statistics.created;
	await assert.rejects(preparePhotoFramescaperHandoffOriginalV1({ source: f.source, originalBlob: f.originalBlob,
		canonicalFrameSha256: rawFixtureSha256CurrentV1(f.cache) } as unknown as Parameters<typeof preparePhotoFramescaperHandoffOriginalV1>[0]), /version|Source|source/iu);
	assert.equal(f.workers.statistics.created, before); assert.deepEqual(new Uint8Array(await f.originalBlob.arrayBuffer()), f.original);
});
