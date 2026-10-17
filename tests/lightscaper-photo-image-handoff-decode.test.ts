/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { decodePhotoImageHandoffSourceV1 } from '../src/lightscaper/controller/photo-image-handoff-decode-v1.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../src/common/editor/timeline-image-native-decode-v1.ts';
import { IMAGE_IMPORT_LIMITS } from '../src/common/editor/image-import-admission.ts';
import { openFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { readImageMetadataV1 } from '../src/common/editor/imaging/image-metadata-reader-v1.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { jpegFixture, jpegSegment, jpegExif, tiffFixture, numberEntry } from './helpers/image-metadata-fixtures.ts';

const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const TIME = '2026-10-10T00:00:00.000Z';
function fixture(bytes = PNG, processVersion: 1 | 2 = 2, width = 1, height = 1) {
	const base = photoArchiveFixture(1, bytes).photo;
	const photo = normalizePhotoDocumentV1OrV2({ ...base, schemaVersion: processVersion, original: { ...base.original, name: 'e\u0301.png', width, height,
		mimeType: bytes === PNG ? 'image/png' : 'image/jpeg' }, versions: [{ ...base.versions[0]!, createdAt: TIME,
		develop: processVersion === 2 ? currentRecipe() : base.versions[0]!.develop }], extractedMetadata: readImageMetadataV1(bytes) });
	const signal = new AbortController();
	const capture = { signal: signal.signal, originalBlob: new Blob([bytes], { type: photo.original.mimeType }),
		factsJson: serializePhotoExportSidecarV1(createPhotoExportSidecarV1(photo,
			{ catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision })),
		original: { exactName: photo.original.name, contentSha256: photo.original.contentSha256, byteLength: photo.original.byteLength,
			mimeType: photo.original.mimeType, width, height, hasAlpha: false } };
	const events: string[] = [], rgba = Uint8Array.from(Array.from({ length: width * height }, () => [23, 71, 149, 255]).flat());
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => {
		events.push('open'); assert.equal(request.format, bytes === PNG ? 'png' : 'jpeg');
		assert.equal(createHash('sha256').update(request.bytes).digest('hex'), photo.original.contentSha256);
		return { metadata: { width, height, frameCount: 1, topology: 'single', runtimeVersion: 'native-injection-fixture' },
			decodeFrame: async () => { events.push('decode'); return { rgba, durationMicroseconds: null }; }, close: () => { events.push('close'); } };
	};
	return { photo, capture, signal, events, rgba, openImage, bytes };
}
async function unpack(result: Awaited<ReturnType<typeof decodePhotoImageHandoffSourceV1>>) {
	const { develop: _develop, developed: _developed, provenance: _provenance, ...base } = result.source;
	const bytes = new Uint8Array(await result.body.arrayBuffer());
	return openFramescaperImageFramePackV1({ source: { ...base, schemaVersion: 1 }, read: (offset, length) => bytes.slice(offset, offset + length) });
}

for (const processVersion of [1, 2] as const) test(`Light selected Photo${processVersion} decodes one original into an editable pre-Develop pack`, async () => {
	const f = fixture(PNG, processVersion), original = f.bytes.slice(), pixels = f.rgba.slice();
	const result = await decodePhotoImageHandoffSourceV1(f.capture, 'new-source', { openImage: f.openImage });
	assert.equal(result.source.develop.processVersion, processVersion);
	assert.deepEqual(result.source.develop, f.photo.versions[0]!.develop); assert.deepEqual(result.source.developed, { width: 1, height: 1 });
	assert.equal(result.source.provenance.original.exactName, 'e\u0301.png');
	const reader = await unpack(result); assert.deepEqual(await reader.readOriginal(), original); assert.deepEqual(await reader.readFrame(0), pixels);
	assert.deepEqual(f.events, ['open', 'decode', 'close']); assert.deepEqual(f.bytes, original); assert.deepEqual(f.rgba, pixels);
});

test('Light source decodes EXIF-oriented original geometry once and retains original EXIF bytes', async () => {
	const bytes = jpegFixture(jpegExif(tiffFixture([numberEntry(0x112, 6)], [])), jpegSegment(0xc0, Uint8Array.of(8, 0, 1, 0, 2, 1, 1, 0x11, 0)),
		jpegSegment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0)), Uint8Array.of(0));
	const f = fixture(new Uint8Array(bytes), 2, 1, 2), result = await decodePhotoImageHandoffSourceV1(f.capture, 'oriented', { openImage: f.openImage });
	assert.deepEqual(result.source.canonical, { width: 1, height: 2, hasAlpha: false, frameCount: 1, durationTicks: '5000000', timingMode: 'fallback' });
	assert.deepEqual(await (await unpack(result)).readOriginal(), bytes); assert.deepEqual(f.events, ['open', 'decode', 'close']);
});

test('Light decoder rejects saved original identity drift before opening native decoder', async () => {
	const f = fixture();
	await assert.rejects(decodePhotoImageHandoffSourceV1({ ...f.capture, original: { ...f.capture.original, exactName: 'different.png' } }, 'new-source',
		{ openImage: f.openImage }), /original.*binding|original.*identity/iu);
	assert.deepEqual(f.events, []);
});

test('Light decoder authenticates the retained Blob before the native decode', async () => {
	const f = fixture(), wrong = PNG.slice(); wrong[wrong.length - 1] = wrong[wrong.length - 1]! ^ 1;
	await assert.rejects(decodePhotoImageHandoffSourceV1({ ...f.capture, originalBlob: new Blob([wrong]) }, 'new-source', { openImage: f.openImage }), /digest|SHA/iu);
	assert.deepEqual(f.events, []);
});

test('Light decoder rejects native original-byte mutation and closes exactly once', async () => {
	const f = fixture(), openImage: OpenFramescaperBrowserNativeImageV1 = async request => { const session = await f.openImage(request); request.bytes[0] = 0; return session; };
	await assert.rejects(decodePhotoImageHandoffSourceV1(f.capture, 'new-source', { openImage }), /original.*binding|original.*digest|replaced/iu);
	assert.equal(f.events.filter(event => event === 'close').length, 1); assert.deepEqual(new Uint8Array(await f.capture.originalBlob.arrayBuffer()), PNG);
});

test('Light decoder joins native cleanup and preserves distinct opaque decode and close failures', async () => {
	const f = fixture(), primary = Symbol('decode-refusal'), cleanup = Symbol('native-close-refusal');
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => {
		const session = await f.openImage(request);
		return { ...session, decodeFrame: async () => { throw primary; }, close() { session.close(); throw cleanup; } };
	};
	await assert.rejects(decodePhotoImageHandoffSourceV1(f.capture, 'new-source', { openImage }), cause =>
		cause instanceof AggregateError && cause.cause === primary && cause.errors.length === 2
		&& cause.errors[0] === primary && cause.errors[1] === cleanup);
	assert.deepEqual(f.events, ['open', 'close']);
});

test('Light decoder refuses a successful native pack when cleanup fails and wipes its owned original', async () => {
	const f = fixture(), cleanup = Symbol('native-close-refusal'); let retained: Uint8Array | undefined;
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => {
		retained = request.bytes; const session = await f.openImage(request);
		return { ...session, close() { session.close(); throw cleanup; } };
	};
	await assert.rejects(decodePhotoImageHandoffSourceV1(f.capture, 'new-source', { openImage }), cause => cause === cleanup);
	assert.deepEqual(f.events, ['open', 'decode', 'close']); assert.ok(retained); assert.ok(retained.every(byte => byte === 0));
	assert.deepEqual(new Uint8Array(await f.capture.originalBlob.arrayBuffer()), PNG);
});

test('Light decoder preserves opaque native rejection after its original backing is detached', async () => {
	const f = fixture(), primary = Symbol('detached-native-rejection');
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => {
		structuredClone(request.bytes.buffer, { transfer: [request.bytes.buffer] }); throw primary;
	};
	await assert.rejects(decodePhotoImageHandoffSourceV1(f.capture, 'new-source', { openImage }), cause => cause === primary);
	assert.deepEqual(new Uint8Array(await f.capture.originalBlob.arrayBuffer()), PNG);
});

test('Light cancellation joins a held native frame read and then closes before rejecting its opaque reason', async () => {
	const f = fixture(), entered = deferred<void>(), released = deferred<void>();
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => { const session = await f.openImage(request), decode = session.decodeFrame;
		return { ...session, decodeFrame: async (...args) => { entered.resolve(); await released.promise; return decode(...args); } }; };
	const work = decodePhotoImageHandoffSourceV1(f.capture, 'new-source', { openImage }), observed = work.catch((cause: unknown) => cause);
	await Promise.race([entered.promise, observed.then(cause => { throw cause; })]);
	const reason = Symbol('retire-selected-session'); f.signal.abort(reason);
	assert.equal(await remainsPending(work), true); assert.deepEqual(f.events, ['open']); released.resolve();
	assert.equal(await observed, reason); assert.deepEqual(f.events, ['open', 'decode', 'close']);
});

test('Light decoder deadline joins the held native read and reports TimeoutError after cleanup', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const f = fixture(), entered = deferred<void>(), released = deferred<void>();
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => { const session = await f.openImage(request), decode = session.decodeFrame;
		return { ...session, decodeFrame: async (...args) => { entered.resolve(); await released.promise; return decode(...args); } }; };
	const work = decodePhotoImageHandoffSourceV1(f.capture, 'new-source', { openImage }), observed = work.catch((cause: unknown) => cause);
	await Promise.race([entered.promise, observed.then(cause => { throw cause; })]);
	context.mock.timers.tick(IMAGE_IMPORT_LIMITS.maximumDecodeMillisecondsPerFile);
	assert.equal(await remainsPending(work), true); assert.deepEqual(f.events, ['open']); released.resolve();
	const cause: unknown = await observed;
	assert.ok(cause instanceof DOMException); assert.equal(cause.name, 'TimeoutError'); assert.deepEqual(f.events, ['open', 'decode', 'close']);
});

test('Light decoder pins actual native-port receiver before body IO can yield to replacement', async () => {
	const f = fixture(), dependencies = { openImage: async function (request: Parameters<OpenFramescaperBrowserNativeImageV1>[0]) {
		assert.equal(this, dependencies); return f.openImage(request);
	} };
	const work = decodePhotoImageHandoffSourceV1(f.capture, 'new-source', dependencies);
	dependencies.openImage = async () => assert.fail('Replacement must not be acquired');
	assert.equal((await work).source.id, 'new-source'); assert.deepEqual(f.events, ['open', 'decode', 'close']);
});

test('Light retained native Blob overrides do not supply alternate body bytes', async () => {
	const f = fixture(); let reads = 0;
	class HostileBlob extends Blob { override arrayBuffer(): Promise<ArrayBuffer> { reads++; throw Symbol('override'); } }
	const capture = { ...f.capture, originalBlob: new HostileBlob([PNG], { type: 'image/png' }) };
	assert.equal((await decodePhotoImageHandoffSourceV1(capture, 'new-source', { openImage: f.openImage })).source.id, 'new-source'); assert.equal(reads, 0);
});
