/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { decodePhotoImageHandoffSourceCurrentV1 } from '../src/lightscaper/controller/photo-image-handoff-decode-current-v1.ts';
import { decodePhotoImageHandoffSourceV1 } from '../src/lightscaper/controller/photo-image-handoff-decode-v1.ts';
import { createPhotoImageHandoffSourceCurrentV1 } from '../src/lightscaper/controller/photo-image-handoff-source-current-v1.ts';
import { createPhotoImageHandoffSourceV1 } from '../src/lightscaper/controller/photo-image-handoff-source-v1.ts';
import { createPhotoExportSidecarCurrentV1, serializePhotoExportSidecarCurrentV1 } from '../src/lightscaper/catalog/photo-export-sidecar-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { openFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { normalizeFramescaperImageSourceV1 } from '../src/common/editor/timeline-image-model.ts';
import { createRawFrameFixtureCurrentV1 } from './helpers/lightscaper-raw-frame-current-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { decodePhotoRawImageHandoffPackCurrentV1 } from '../src/lightscaper/controller/internal/photo-image-handoff-raw-current-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import type { withDecodedRawOriginalV1 } from '../src/common/editor/raw/libraw-runtime-v1.ts';

function capture(original: Uint8Array<ArrayBuffer>, processVersion: 1 | 2 | 3, photoSchemaVersion: 1 | 2 | 3 = 3) {
	const base = photoArchiveFixture(1, original).photo, develop = processVersion === 1 ? defaultPhotoDevelopV1()
		: processVersion === 2 ? defaultImageDevelopStateV2() : { ...defaultImageDevelopStateV2(), processVersion: 3, repairs: { schemaVersion: 1, spots: [] } };
	const photo = normalizePhotoDocumentCurrentV1({ ...base, schemaVersion: photoSchemaVersion,
		original: { ...base.original, name: 'Native precision.dng', mimeType: 'image/x-adobe-dng', width: 32, height: 32 },
		versions: [{ ...base.versions[0]!, develop }] });
	return { signal: new AbortController().signal, originalBlob: new Blob([original], { type: photo.original.mimeType }),
		factsJson: serializePhotoExportSidecarCurrentV1(createPhotoExportSidecarCurrentV1(photo,
			{ catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision })),
		original: { exactName: photo.original.name, contentSha256: photo.original.contentSha256, byteLength: original.byteLength,
			mimeType: photo.original.mimeType, width: 32, height: 32, hasAlpha: false }, develop };
}

for (const [photoSchemaVersion, processVersion] of [[1, 1], [2, 2], [3, 1], [3, 2], [3, 3]] as const) test(`Light RAW Photo${photoSchemaVersion} process${processVersion} exports actual native Original and unchanged recipe to editable Source4`, async () => {
	const f = await createRawFrameFixtureCurrentV1({ orientation: 6 });
	try {
		const { develop, ...view } = capture(f.original, processVersion, photoSchemaVersion), before = f.original.slice();
		const result = await f.withDefaultTransport(() => decodePhotoImageHandoffSourceCurrentV1(view, 'raw-forward',
			{ openImage: async () => assert.fail('RAW must use the pinned native decoder.') }));
		assert.equal(result.source.schemaVersion, 4); if (result.source.schemaVersion !== 4) assert.fail('Expected Source4.');
		assert.deepEqual(result.source.develop, develop); assert.deepEqual(result.source.raw, f.raw);
		assert.equal(result.source.provenance.origin.schemaFamily, 'lightscaper');
		if (result.source.provenance.origin.schemaFamily === 'lightscaper') assert.equal(result.source.provenance.origin.schemaVersion, photoSchemaVersion);
		const source = result.source, packSource = normalizeFramescaperImageSourceV1({ schemaVersion: 1, kind: source.kind, id: source.id, name: source.name,
			mimeType: source.mimeType, storageKey: source.storageKey, contentSha256: source.contentSha256, assetByteLength: source.assetByteLength,
			original: source.original, canonical: source.canonical, conversionReceiptSha256: source.conversionReceiptSha256 });
		const bytes = new Uint8Array(await result.body.arrayBuffer()), reader = await openFramescaperImageFramePackV1({ source: packSource,
			read: (offset, length) => bytes.slice(offset, offset + length) });
		assert.deepEqual(reader.receipt, { schemaVersion: 1, kind: 'raw-original', raw: f.raw });
		assert.deepEqual(await reader.readOriginal(), before); assert.deepEqual(await reader.readFrame(0), f.cache);
		assert.deepEqual(f.original, before); assert.equal(f.workers.active(), 0);
	} finally { await f.close(); }
});

test('Light RAW forward admission binds actual container, Original digest and exact MIME before raster or RAW decoding', async () => {
	const f = await createRawFrameFixtureCurrentV1();
	try {
		const { develop: _develop, ...view } = capture(f.original, 2), created = f.workers.statistics.created;
		await f.withDefaultTransport(async () => {
			await assert.rejects(decodePhotoImageHandoffSourceCurrentV1({ ...view, original: { ...view.original, mimeType: 'image/png' } }, 'wrong-mime'), /MIME/iu);
			const wrong = f.original.slice(); wrong[wrong.length - 1] = wrong[wrong.length - 1]! ^ 1;
			await assert.rejects(decodePhotoImageHandoffSourceCurrentV1({ ...view, originalBlob: new Blob([wrong]) }, 'wrong-digest'), /SHA/iu);
			const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
			const { develop: _pngDevelop, ...pngView } = capture(png, 1);
			await assert.rejects(decodePhotoImageHandoffSourceCurrentV1(pngView, 'fake-raw', { openImage: async () => assert.fail('MIME hint must not grant decode authority.') }), /MIME|geometry/iu);
		});
		assert.equal(f.workers.statistics.created, created);
	} finally { await f.close(); }
});

test('Light permanent raster decoder and source builder keep refusing RAW even when named Current supports it', async () => {
	const f = await createRawFrameFixtureCurrentV1();
	try {
		const { develop: _develop, ...view } = capture(f.original, 1, 1);
		await assert.rejects(decodePhotoImageHandoffSourceV1(view, 'legacy-raw', { openImage: async () => assert.fail('Legacy must refuse RAW.') }));
		const request = { sourceId: 'legacy-raw', factsJson: view.factsJson, original: { mimeType: 'image/x-adobe-dng', width: 32, height: 32, hasAlpha: false }, pack: f.pack, raw: f.raw };
		await assert.rejects(createPhotoImageHandoffSourceV1(request), /unsupported|field/iu);
		const output = await createPhotoImageHandoffSourceCurrentV1(request); assert.equal(output.source.schemaVersion, 4);
		await assert.rejects(createPhotoImageHandoffSourceCurrentV1({ ...request, raw: { ...f.raw, pixelsSha256: 'a'.repeat(64) } }), /receipt/iu);
	} finally { await f.close(); }
});

test('Light RAW source builder refuses oversized physical producer backing before snapshot allocation', async () => {
	const f = await createRawFrameFixtureCurrentV1();
	try {
		const { develop: _develop, ...view } = capture(f.original, 2), backing = new ArrayBuffer(1024 * 1024 * 1024);
		const bytes = new Uint8Array(backing, 8, f.pack.bytes.length); bytes.set(f.pack.bytes);
		try {
			await assert.rejects(createPhotoImageHandoffSourceCurrentV1({ sourceId: 'oversized-producer', factsJson: view.factsJson,
				original: { mimeType: 'image/x-adobe-dng', width: 32, height: 32, hasAlpha: false }, pack: { ...f.pack, bytes }, raw: f.raw }), /working byte bound/iu);
		} finally { structuredClone(backing, { transfer: [backing] }); }
	} finally { await f.close(); }
});

for (const shadow of ['view-buffer', 'backing-length'] as const) test(`Light RAW source quota ignores hostile ${shadow} metadata without invoking it`, async () => {
	const f = await createRawFrameFixtureCurrentV1();
	try {
		const { develop: _develop, ...view } = capture(f.original, 2), backing = new ArrayBuffer(1024 * 1024 * 1024);
		const bytes = new Uint8Array(backing, 8, f.pack.bytes.length); bytes.set(f.pack.bytes); let reads = 0;
		Object.defineProperty(shadow === 'view-buffer' ? bytes : backing, shadow === 'view-buffer' ? 'buffer' : 'byteLength',
			{ configurable: true, get() { reads++; return shadow === 'view-buffer' ? new ArrayBuffer(0) : 0; } });
		try {
			await assert.rejects(createPhotoImageHandoffSourceCurrentV1({ sourceId: 'shadowed-producer', factsJson: view.factsJson,
				original: { mimeType: 'image/x-adobe-dng', width: 32, height: 32, hasAlpha: false }, pack: { ...f.pack, bytes }, raw: f.raw }), /working byte bound/iu);
			assert.equal(reads, 0);
		} finally { structuredClone(backing, { transfer: [backing] }); }
	} finally { await f.close(); }
});

test('Light RAW producer retires its pack and joins native words after an opaque decoder failure following successful packing', async () => {
	const f = await createRawFrameFixtureCurrentV1(), reason = Symbol('late RAW producer failure'); let packed: Uint8Array | undefined;
	const withRawOriginal: typeof withDecodedRawOriginalV1 = (request, consume) => f.withRawOriginal(request, async view => {
		const result = await consume(view); assert.ok(result && typeof result === 'object' && 'publication' in result);
		const publication = result.publication; assert.ok(publication && typeof publication === 'object' && 'bytes' in publication && publication.bytes instanceof Uint8Array);
		packed = publication.bytes; assert.ok(packed.some(byte => byte !== 0)); throw reason;
	});
	try {
		await assert.rejects(decodePhotoRawImageHandoffPackCurrentV1(f.original,
			{ mimeType: 'image/x-adobe-dng', width: 32, height: 32, hasAlpha: false }, new AbortController().signal, { withRawOriginal }), cause => cause === reason);
		assert.ok(packed); assert.ok(packed.every(byte => byte === 0)); assert.equal(f.workers.active(), 0);
		assert.ok(f.original.some(byte => byte !== 0));
	} finally { await f.close(); }
});

test('Light RAW producer joins a cancelled native callback before retiring its produced pack and rejecting the exact reason', async () => {
	const f = await createRawFrameFixtureCurrentV1(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Symbol('cancel RAW handoff');
	let packed: Uint8Array | undefined;
	const withRawOriginal: typeof withDecodedRawOriginalV1 = (request, consume) => f.withRawOriginal(request, async view => {
		const result = await consume(view); assert.ok(result && typeof result === 'object' && 'publication' in result);
		const publication = result.publication; assert.ok(publication && typeof publication === 'object' && 'bytes' in publication && publication.bytes instanceof Uint8Array);
		packed = publication.bytes; entered.resolve(); await release.promise; return result;
	});
	try {
		const work = decodePhotoRawImageHandoffPackCurrentV1(f.original, { mimeType: 'image/x-adobe-dng', width: 32, height: 32, hasAlpha: false }, stop.signal, { withRawOriginal });
		const observed = work.catch((error: unknown) => error);
		await Promise.race([entered.promise, observed.then(error => { throw error; })]); stop.abort(reason);
		assert.equal(await remainsPending(work), true); assert.ok(packed); assert.ok(packed.some(byte => byte !== 0));
		release.resolve(); assert.equal(await observed, reason); assert.ok(packed.every(byte => byte === 0)); assert.equal(f.workers.active(), 0);
	} finally { release.resolve(); await f.close(); }
});
