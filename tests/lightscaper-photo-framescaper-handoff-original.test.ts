/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { deflateSync, crc32 } from 'node:zlib';
import { createFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { createImageDevelopHandoffProvenanceV1 } from '../src/common/editor/image-develop-handoff-provenance-v1.ts';
import { normalizeFramescaperImageSourceV2 } from '../src/common/editor/timeline-image-model-v2.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { preparePhotoFramescaperHandoffOriginalV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-original-v1.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../src/common/editor/timeline-image-native-decode-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { iptcText, jpegFixture, jpegSegment, joinBytes, numberEntry, photoshopIptc, tiffFixture } from './helpers/image-metadata-fixtures.ts';

const WHITE = Uint8Array.of(255, 255, 255, 255), BLACK = Uint8Array.of(0, 0, 0, 255);
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function chunk(type: string, body: Uint8Array): Buffer {
	const value = Buffer.alloc(body.length + 12); value.writeUInt32BE(body.length); value.write(type, 4, 'ascii'); value.set(body, 8);
	value.writeUInt32BE(crc32(value.subarray(4, value.length - 4)), value.length - 4); return value;
}
function png(pixels = WHITE, width = 1, height = 1, exif?: Uint8Array): Uint8Array<ArrayBuffer> {
	const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header.set([8, 6, 0, 0, 0], 8);
	const rows = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y++) rows.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
	return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...(exif ? [chunk('eXIf', exif)] : []), chunk('IDAT', deflateSync(rows)), chunk('IEND', new Uint8Array())]));
}
function fixture(processVersion: 1 | 2 = 1, plane = WHITE) {
	const original = png(), pack = createFramescaperImageFramePackV1({ original, receipt: { schemaVersion: 1, decoder: 'controlled-native' },
		width: 1, height: 1, timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 5_000_000n, rgba: plane }] });
	const develop = { ...defaultPhotoDevelopV1(), processVersion };
	const provenance = createImageDevelopHandoffProvenanceV1({ origin: { schemaFamily: 'lightscaper', schemaVersion: processVersion,
		catalogId: 'origin-catalog', photoId: 'origin-photo', revision: 3, versionId: 'origin-version', versionKind: 'master', versionName: 'Original', versionCreatedAt: '2026-10-10T00:00:00.000Z' },
		original: { exactName: 'e\u0301.png', sha256: digest(original), byteLength: original.length }, develop });
	const source = normalizeFramescaperImageSourceV2({ schemaVersion: 2, kind: 'image', id: 'source', name: 'Image', storageKey: 'source',
		mimeType: 'application/vnd.framescaper.image-asset', contentSha256: pack.contentSha256, assetByteLength: pack.assetByteLength,
		original: { fileName: 'é.png', mimeType: 'image/png', recognizedFormat: 'png', sha256: pack.originalSha256, byteLength: pack.originalByteLength },
		canonical: { width: 1, height: 1, hasAlpha: pack.hasAlpha, frameCount: 1, durationTicks: pack.durationTicks, timingMode: 'fallback' },
		conversionReceiptSha256: pack.conversionReceiptSha256, develop, developed: { width: 1, height: 1 }, provenance });
	return { source, originalBlob: new Blob([original], { type: 'image/png' }), canonicalFrameSha256: digest(plane) };
}
function native(pixels = WHITE): OpenFramescaperBrowserNativeImageV1 {
	return async request => {
		assert.deepEqual(request.bytes, png());
		return { metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'controlled-native' },
			decodeFrame: async () => ({ rgba: pixels, durationMicroseconds: null }), close() {} };
	};
}
function mutableSource(source: ReturnType<typeof fixture>['source']) {
	return { ...source, original: { ...source.original }, canonical: { ...source.canonical }, developed: { ...source.developed },
		provenance: { ...source.provenance, original: { ...source.provenance.original } } };
}
for (const processVersion of [1, 2] as const) test(`Light return original verifies process${processVersion} white pixels without changing retained identity`, async () => {
	const f = fixture(processVersion), before = WHITE.slice();
	const result = await preparePhotoFramescaperHandoffOriginalV1(f, { openImage: native() });
	assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.originalBlob));
	assert.deepEqual(new Uint8Array(await result.originalBlob.arrayBuffer()), png()); assert.deepEqual(WHITE, before);
	assert.equal(result.metadata.fileName, 'e\u0301.png'); assert.equal(result.metadata.modifiedTime, null);
	assert.equal(result.extractedMetadata.container, 'png'); assert.deepEqual(result.keywordNames, []);
});
test('Light return original rejects genuine white encoded PNG bound to a valid black canonical pack', async () => {
	const f = fixture(2, BLACK);
	await assert.rejects(preparePhotoFramescaperHandoffOriginalV1(f, { openImage: native() }), /canonical.*digest|pixels.*differ/iu);
});

for (const mimeType of ['image/jpeg', 'application/octet-stream', null]) {
	test(`Light return original refuses declared MIME ${String(mimeType)} differing from actual PNG before native acquisition`, async () => {
		const f = fixture(), source = mutableSource(f.source); source.original.mimeType = mimeType; let opened = 0;
		const openImage: OpenFramescaperBrowserNativeImageV1 = async request => { opened++; return native()(request); };
		await assert.rejects(preparePhotoFramescaperHandoffOriginalV1({ ...f, source }, { openImage }), /MIME/iu);
		assert.equal(opened, 0);
	});
}
test('Light return original treats differing Blob MIME as a hint while retaining verified Source2 MIME', async () => {
	const f = fixture(), originalBlob = new Blob([png()], { type: 'image/jpeg' });
	const result = await preparePhotoFramescaperHandoffOriginalV1({ ...f, originalBlob }, { openImage: native() });
	assert.equal(result.originalBlob.type, 'image/jpeg'); assert.deepEqual(new Uint8Array(await result.originalBlob.arrayBuffer()), png());
});

test('Light return original pins request, native receiver and genuine immutable Blob before yielding', async () => {
	const f = fixture(), mutable = mutableSource(f.source), input = { ...f, source: mutable }, originalOpen = native(); let calls = 0, getters = 0;
	const dependencies: { openImage: OpenFramescaperBrowserNativeImageV1 } = { openImage: async function(this: unknown, request) {
		assert.equal(this, dependencies); calls++; return originalOpen(request);
	} };
	const work = preparePhotoFramescaperHandoffOriginalV1(input, dependencies);
	mutable.canonical.width = 2; dependencies.openImage = async () => { throw Symbol('late method'); };
	for (const key of ['size', 'slice', 'arrayBuffer']) Object.defineProperty(f.originalBlob, key, { get() { getters++; throw Symbol('shadow'); } });
	const result = await work; assert.equal(calls, 1); assert.equal(getters, 0);
	assert.deepEqual(new Uint8Array(await result.originalBlob.arrayBuffer()), png());
});

for (const kind of ['request-getter', 'dependency-getter', 'inherited-request', 'extra-request', 'foreign-signal', 'signal-getter', 'digest'] as const) {
	test(`Light return original refuses ${kind} before native acquisition without accessor calls`, async () => {
		const f = fixture(), stop = new AbortController(); let opened = 0, getters = 0;
		let input: unknown = f, dependencies: unknown = { openImage: async () => { opened++; throw Symbol('unexpected native'); } };
		if (kind === 'request-getter') input = Object.defineProperty({ ...f }, 'source', { get() { getters++; return f.source; } });
		if (kind === 'dependency-getter') dependencies = Object.defineProperty({}, 'openImage', { get() { getters++; return native(); } });
		if (kind === 'inherited-request') input = Object.create(f) as unknown;
		if (kind === 'extra-request') input = { ...f, sourceId: 'extra' };
		if (kind === 'foreign-signal') input = { ...f, signal: {} };
		if (kind === 'signal-getter') { Object.defineProperty(stop.signal, 'throwIfAborted', { get() { getters++; throw Symbol('signal getter'); } }); input = { ...f, signal: stop.signal }; }
		if (kind === 'digest') input = { ...f, canonicalFrameSha256: 'a'.repeat(63) };
		await assert.rejects(preparePhotoFramescaperHandoffOriginalV1(input as Parameters<typeof preparePhotoFramescaperHandoffOriginalV1>[0], dependencies as Parameters<typeof preparePhotoFramescaperHandoffOriginalV1>[1]));
		assert.equal(opened, 0); assert.equal(getters, 0);
	});
}

for (const kind of ['sha', 'length', 'format', 'geometry', 'alpha', 'native-geometry', 'native-topology'] as const) {
	test(`Light return original refuses ${kind} disagreement with authenticated canonical facts`, async () => {
		const f = fixture(), source = mutableSource(f.source); let opened = 0, closed = 0;
		if (kind === 'sha') source.original.sha256 = source.provenance.original.sha256 = 'b'.repeat(64);
		if (kind === 'length') source.original.byteLength = source.provenance.original.byteLength = png().length + 1;
		if (kind === 'format') source.original.recognizedFormat = 'jpeg';
		if (kind === 'geometry') source.canonical.width = 2;
		if (kind === 'alpha') source.canonical.hasAlpha = true;
		const openImage: OpenFramescaperBrowserNativeImageV1 = async request => {
			opened++; const session = await native()(request);
			return { ...session, metadata: { ...session.metadata, ...(kind === 'native-geometry' ? { width: 2 } : {}), ...(kind === 'native-topology' ? { topology: 'animated', frameCount: 2 } : {}) }, close() { closed++; } };
		};
		await assert.rejects(preparePhotoFramescaperHandoffOriginalV1({ ...f, source }, { openImage }));
		const acquires = ['alpha', 'native-geometry', 'native-topology'].includes(kind) ? 1 : 0;
		assert.equal(opened, acquires); assert.equal(closed, acquires);
	});
}

test('Light return original admits actual EXIF oriented geometry and refuses unswapped canonical dimensions', async () => {
	const encoded = png(new Uint8Array([...WHITE, ...BLACK]), 2, 1, tiffFixture([numberEntry(0x0112, 6)])), pixels = new Uint8Array([...WHITE, ...BLACK]);
	const f = fixture(), source = mutableSource(f.source); source.original.byteLength = source.provenance.original.byteLength = encoded.length;
	source.original.sha256 = source.provenance.original.sha256 = digest(encoded); source.canonical.height = 2; source.developed.height = 2;
	let closed = 0;
	const openImage: OpenFramescaperBrowserNativeImageV1 = async () => ({ metadata: { width: 1, height: 2, frameCount: 1, topology: 'single', runtimeVersion: 'orientation-controlled' },
		decodeFrame: async () => ({ rgba: pixels, durationMicroseconds: null }), close() { closed++; } });
	const input = { source, originalBlob: new Blob([encoded]), canonicalFrameSha256: digest(pixels) };
	const result = await preparePhotoFramescaperHandoffOriginalV1(input, { openImage });
	assert.equal(result.metadata.orientation, 6); assert.equal(closed, 1); assert.deepEqual(pixels, new Uint8Array([...WHITE, ...BLACK]));
	source.canonical.width = 2; source.canonical.height = 1;
	await assert.rejects(preparePhotoFramescaperHandoffOriginalV1(input, { openImage }), /oriented dimensions/iu); assert.equal(closed, 1);
});

for (const exactName of ['x'.repeat(257) + '.png', 'e\u200b.png', ' '.repeat(257), '😀'.repeat(128) + '.png']) {
	test(`Light return original retains exact ${exactName.length}-unit name while reporting bounded display alias`, async () => {
		const f = fixture(), source = mutableSource(f.source); source.provenance.original.exactName = exactName; source.original.fileName = exactName.normalize('NFC');
		const result = await preparePhotoFramescaperHandoffOriginalV1({ ...f, source }, { openImage: native() });
		assert.ok(result.metadata.fileName.length <= 256); assert.ok(result.metadata.fileName.trim()); assert.doesNotMatch(result.metadata.fileName, /[\p{Cc}\p{Cf}]/u);
		assert.equal(source.provenance.original.exactName, exactName); assert.deepEqual(result.notices, [{ field: 'fileName', reason: 'display-bound' }]);
		assert.equal(result.metadata.modifiedTime, null);
	});
}

test('Light return original preserves opaque native failure and distinct cleanup without reflection', async () => {
	const f = fixture(), cleanup = Symbol('native close'); let reflections = 0, closed = 0, retained: Uint8Array | undefined;
	const primary = new Proxy({}, { getPrototypeOf() { reflections++; throw Symbol('unsafe reflection'); } });
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => {
		retained = request.bytes;
		return { metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'controlled' },
			decodeFrame: async () => { Object.setPrototypeOf(request.bytes, null); throw primary; }, close() { closed++; throw cleanup; } };
	};
	await assert.rejects(preparePhotoFramescaperHandoffOriginalV1(f, { openImage }), error => error instanceof AggregateError && error.cause === primary && error.errors[0] === primary && error.errors[1] === cleanup);
	assert.equal(reflections, 0); assert.equal(closed, 1); assert.ok(retained); assert.ok(Uint8Array.prototype.every.call(retained, (value: number) => value === 0));
});

test('Light return original preserves opaque acquisition failure after native detaches owned input storage', async () => {
	const reason = Symbol('detached native failure'); let retained: Uint8Array | undefined;
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => { retained = request.bytes; structuredClone(request.bytes.buffer, { transfer: [request.bytes.buffer as ArrayBuffer] }); throw reason; };
	await assert.rejects(preparePhotoFramescaperHandoffOriginalV1(fixture(), { openImage }), error => error === reason);
	assert.ok(retained); assert.equal(retained.byteLength, 0);
});

test('Light return original joins late native acquisition and cleanup before preserving opaque cancellation', async () => {
	const entered = deferred<void>(), held = deferred<Awaited<ReturnType<OpenFramescaperBrowserNativeImageV1>>>(), stop = new AbortController(), reason = Symbol('cancel native acquisition'), cleanup = Symbol('late close');
	let closed = 0, retained: Uint8Array | undefined;
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => { retained = request.bytes; entered.resolve(); return held.promise; };
	const work = preparePhotoFramescaperHandoffOriginalV1({ ...fixture(), signal: stop.signal }, { openImage });
	const refusal = assert.rejects(work, error => error instanceof AggregateError && error.cause === reason && error.errors[0] === reason && error.errors[1] === cleanup);
	await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work), true); assert.ok(retained); assert.deepEqual(retained, png());
	held.resolve({ metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'held' }, decodeFrame: async () => { assert.fail('cancelled decode'); }, close() { closed++; throw cleanup; } });
	await refusal; assert.equal(closed, 1); assert.ok(retained.every(value => value === 0));
});

test('Light return original joins held supplier frame without wiping unpublished supplier pixels', async () => {
	const entered = deferred<void>(), held = deferred<{ rgba: Uint8Array; durationMicroseconds: null }>(), stop = new AbortController(), reason = Symbol('held native decode');
	const supplier = WHITE.slice(); let closed = 0, retained: Uint8Array | undefined;
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => { retained = request.bytes; return {
		metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'held' }, decodeFrame: async () => { entered.resolve(); return held.promise; }, close() { closed++; } }; };
	const work = preparePhotoFramescaperHandoffOriginalV1({ ...fixture(), signal: stop.signal }, { openImage }); const refusal = assert.rejects(work, error => error === reason);
	await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work), true); held.resolve({ rgba: supplier, durationMicroseconds: null });
	await refusal; assert.equal(closed, 1); assert.deepEqual(supplier, WHITE); assert.ok(retained); assert.ok(retained.every(value => value === 0));
});

test('Light return original wipes its published canonical snapshot after native close while leaving supplier pixels intact', async () => {
	const Native = globalThis.Uint8Array, owned: Uint8Array[] = [], supplier = WHITE.slice(); let closed = 0;
	globalThis.Uint8Array = new Proxy(Native, { construct(target, args: unknown[], newTarget) {
		const bytes = Reflect.construct(target, args, newTarget) as Uint8Array;
		if (args[0] instanceof Native && args[0].length === 4) owned.push(bytes); return bytes;
	} });
	try {
		const openImage: OpenFramescaperBrowserNativeImageV1 = async request => { const session = await native(supplier)(request); return { ...session, close() {
			closed++; assert.ok(owned.length > 0); assert.ok(owned.some(bytes => bytes.some(value => value !== 0)));
		} }; };
		await preparePhotoFramescaperHandoffOriginalV1(fixture(), { openImage });
		assert.equal(closed, 1); assert.ok(owned.every(bytes => bytes.every(value => value === 0))); assert.deepEqual(supplier, WHITE);
	} finally { globalThis.Uint8Array = Native; }
});

test('Light return original retains extracted IPTC facts and ordered repeated keywords with unknown modification time', async () => {
	const encoded = jpegFixture(photoshopIptc(joinBytes(iptcText(5, 'Captioned photo'), iptcText(25, 'first'), iptcText(25, 'second'), iptcText(25, 'first'))),
		jpegSegment(0xc0, Uint8Array.of(8, 0, 1, 0, 1, 1, 1, 0x11, 0)), jpegSegment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0)), Uint8Array.of(0xff, 0, 0xff, 0xd0));
	const f = fixture(), source = mutableSource(f.source);
	source.original.byteLength = source.provenance.original.byteLength = encoded.length; source.original.sha256 = source.provenance.original.sha256 = digest(encoded);
	source.original.recognizedFormat = 'jpeg'; source.original.mimeType = 'image/jpeg';
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => {
		assert.deepEqual(request.bytes, encoded); assert.equal(request.format, 'jpeg'); return {
			metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'metadata-controlled' },
			decodeFrame: async () => ({ rgba: WHITE, durationMicroseconds: null }), close() {} };
	};
	const result = await preparePhotoFramescaperHandoffOriginalV1({ ...f, source, originalBlob: new Blob([new Uint8Array(encoded)]) }, { openImage });
	assert.deepEqual(result.keywordNames, ['first', 'second', 'first']); assert.deepEqual(result.extractedMetadata.iptc?.keywords, result.keywordNames);
	assert.equal(result.metadata.title, 'Captioned photo'); assert.equal(result.metadata.modifiedTime, null);
	assert.ok(Object.isFrozen(result.metadata)); assert.ok(Object.isFrozen(result.keywordNames)); assert.ok(Object.isFrozen(result.notices));
});

test('Light return original refuses an oversized genuine Blob and opaque preabort before native acquisition', async () => {
	const f = fixture(), stop = new AbortController(), reason = Symbol('preabort'); let opened = 0;
	const openImage: OpenFramescaperBrowserNativeImageV1 = async () => { opened++; throw Symbol('unexpected open'); };
	let body = new Blob([Uint8Array.of(0)]); for (let index = 0; index < 26; index++) body = new Blob([body, body]); body = new Blob([body, Uint8Array.of(0)]);
	await assert.rejects(preparePhotoFramescaperHandoffOriginalV1({ ...f, originalBlob: body }, { openImage }), /bound byte length/iu);
	stop.abort(reason); await assert.rejects(preparePhotoFramescaperHandoffOriginalV1({ ...f, signal: stop.signal }, { openImage }), error => error === reason);
	assert.equal(opened, 0);
});

test('Light return original refuses native input mutation while joining cleanup and preserving immutable retained bytes', async () => {
	const f = fixture(); let retained: Uint8Array | undefined, closed = 0;
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => { retained = request.bytes; return {
		metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'mutating' },
		decodeFrame: async () => { request.bytes[0] = 0; return { rgba: WHITE, durationMicroseconds: null }; }, close() { closed++; } }; };
	await assert.rejects(preparePhotoFramescaperHandoffOriginalV1(f, { openImage }), /changed.*SHA/iu);
	assert.equal(closed, 1); assert.ok(retained); assert.ok(retained.every(value => value === 0)); assert.deepEqual(new Uint8Array(await f.originalBlob.arrayBuffer()), png());
});

test('Light return original owns a late canonical snapshot before opaque cancellation and native cleanup failure', async () => {
	const f = fixture(), Native = globalThis.Uint8Array, stop = new AbortController(), reason = Symbol('cancel published pixels'), cleanup = Symbol('close published pixels');
	let owned: Uint8Array | undefined, capturing = false, before: number[] | undefined, closed = 0;
	globalThis.Uint8Array = new Proxy(Native, { construct(target, args: unknown[], newTarget) {
		const bytes = Reflect.construct(target, args, newTarget) as Uint8Array;
		if (capturing && args[0] instanceof Native && args[0].length === 4) { owned = bytes; queueMicrotask(() => { before = Array.from(bytes); stop.abort(reason); }); }
		return bytes;
	} });
	try {
		const openImage: OpenFramescaperBrowserNativeImageV1 = async () => ({
			metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'late canonical' },
			decodeFrame: async () => { capturing = true; return { rgba: WHITE, durationMicroseconds: null }; }, close() { closed++; throw cleanup; } });
		await assert.rejects(preparePhotoFramescaperHandoffOriginalV1({ ...f, signal: stop.signal }, { openImage }), error => error instanceof AggregateError && error.cause === reason && error.errors[0] === reason && error.errors[1] === cleanup);
		assert.deepEqual(before, Array.from(WHITE)); assert.equal(closed, 1); assert.ok(owned); assert.ok(owned.every(value => value === 0)); assert.deepEqual(WHITE, Uint8Array.of(255, 255, 255, 255));
	} finally { globalThis.Uint8Array = Native; }
});

test('Light return original preserves cancellation during retirement with its distinct opaque native close failure', async () => {
	const stop = new AbortController(), reason = Symbol('retirement cancel'), cleanup = Symbol('retirement cleanup');
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => { const session = await native()(request); return { ...session, close() { stop.abort(reason); throw cleanup; } }; };
	await assert.rejects(preparePhotoFramescaperHandoffOriginalV1({ ...fixture(), signal: stop.signal }, { openImage }),
		error => error instanceof AggregateError && error.cause === reason && error.errors[0] === reason && error.errors[1] === cleanup);
});
