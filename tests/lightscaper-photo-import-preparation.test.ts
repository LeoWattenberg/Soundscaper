/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { preparePhotoImportGestureV1, type PhotoImportOutcomeV1 } from '../src/lightscaper/import/photo-import-preparation-v1.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../src/common/editor/timeline-image-native-decode-v1.ts';
import { openFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../src/common/editor/timeline-image-model.ts';
import { serializeLightscaperDocumentV1, parseLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { jpegFixture, jpegSegment, jpegExif, tiffFixture, textEntry, numberEntry, joinBytes, photoshopIptc, iptcText, pngChunk } from './helpers/image-metadata-fixtures.ts';

const CREATED = '2026-10-07T10:00:00.000Z';
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const CATALOG = { schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog', name: 'Library', revision: 0, photoCount: 0, folders: [{ id: 'folder', name: 'Folder', parentId: null }], collections: [], keywords: [] };

function request(files: readonly File[]) {
	return { files, catalog: CATALOG, folderId: 'folder', createdAt: CREATED,
		ownership: files.map((_, index) => ({ photoId: `photo-${index}`, originalId: `original-${index}`, originalStorageKey: `storage-${index}`, masterVersionId: `master-${index}` })) };
}
function file(bytes: Uint8Array = PNG, name = 'photo.png') { return new File([bytes.slice()], name, { type: 'text/plain', lastModified: 0 }); }
async function collect(iterable: AsyncIterable<PhotoImportOutcomeV1>) { const outcomes: PhotoImportOutcomeV1[] = []; for await (const value of iterable) outcomes.push(value); return outcomes; }
function decoder(events: string[] = [], width = 1, height = 1): OpenFramescaperBrowserNativeImageV1 {
	return async ({ format, mimeType }) => {
		events.push(`open:${format}:${mimeType}`);
		return { metadata: { width, height, frameCount: 1, topology: 'single', runtimeVersion: 'fixture-1' },
			decodeFrame: async () => { events.push('decode'); const rgba = new Uint8Array(width * height * 4); rgba.fill(255); return { rgba, durationMicroseconds: null }; },
			close: () => { events.push('close'); } };
	};
}
function jpeg(...metadata: readonly Uint8Array[]) {
	return jpegFixture(...metadata, jpegSegment(0xc0, Uint8Array.of(8, 0, 1, 0, 2, 1, 1, 0x11, 0)), jpegSegment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0)), Uint8Array.of(0));
}

test('prepares a validated immutable photo and exact original separately from shared decode artifact', async () => {
	const events: string[] = [];
	const result = (await collect(preparePhotoImportGestureV1(request([file()]), { openImage: decoder(events) })))[0];
	assert.equal(result?.outcome, 'prepared'); if (result?.outcome !== 'prepared') return;
	assert.equal(result.photo.original.contentSha256, bytesToHex(sha256(PNG)));
	assert.equal(result.photo.original.byteLength, PNG.length);
	assert.equal(result.original.size, PNG.length);
	assert.equal(result.original.type, 'image/png');
	assert.deepEqual(new Uint8Array(await result.original.arrayBuffer()), PNG);
	assert.deepEqual(result.photo.versions[0]?.develop, defaultPhotoDevelopV1());
	assert.equal(result.photo.versions[0]?.createdAt, CREATED);
	assert.equal(result.photo.metadata.modifiedTime, '1970-01-01T00:00:00.000Z');
	assert.equal(result.photo.folderId, 'folder');
	assert.ok(Object.isFrozen(result.photo) && Object.isFrozen(result.photo.original));
	assert.deepEqual(parseLightscaperDocumentV1(serializeLightscaperDocumentV1(result.photo)), result.photo);
	assert.deepEqual(events, ['open:png:image/png', 'decode', 'close']);
	const artifact = result.decodeArtifact;
	assert.equal(artifact.originalSha256, result.photo.original.contentSha256);
	assert.notEqual(artifact.contentSha256, artifact.originalSha256);
	const source = { schemaVersion: 1 as const, kind: 'image' as const, id: 'artifact', name: result.fileName,
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, storageKey: 'artifact', contentSha256: artifact.contentSha256,
		assetByteLength: artifact.assetByteLength, original: { fileName: result.fileName, mimeType: 'image/png', recognizedFormat: 'png', byteLength: artifact.originalByteLength, sha256: artifact.originalSha256 },
		canonical: { width: artifact.width, height: artifact.height, frameCount: 1, hasAlpha: artifact.hasAlpha, durationTicks: artifact.durationTicks, timingMode: artifact.timingMode }, conversionReceiptSha256: artifact.conversionReceiptSha256 };
	const reader = await openFramescaperImageFramePackV1({ source, read: async (offset, length) => new Uint8Array(await artifact.body.slice(offset, offset + length).arrayBuffer()) });
	assert.deepEqual(await reader.readOriginal(), PNG);
	assert.deepEqual(await reader.readFrame(0), Uint8Array.of(255, 255, 255, 255));
});

test('decomposed Unicode filenames keep their exact original and receipt identity through shared native decode', async () => {
	const originalName = '原本 e\u0301 ÉTÉ.PNG', selected = file(PNG, originalName), events: string[] = [];
	assert.notEqual(originalName, originalName.normalize('NFC'));
	const result = (await collect(preparePhotoImportGestureV1(request([selected]), { openImage: decoder(events) })))[0];
	assert.equal(result?.outcome, 'prepared'); if (result?.outcome !== 'prepared') return;
	assert.equal(selected.name, originalName); assert.equal(result.fileName, originalName);
	assert.equal(result.photo.original.name, originalName); assert.equal(result.photo.metadata.fileName, originalName);
	assert.equal(result.photo.original.contentSha256, bytesToHex(sha256(PNG)));
	assert.equal(result.decodeArtifact.originalSha256, result.photo.original.contentSha256);
	assert.deepEqual(new Uint8Array(await result.original.arrayBuffer()), PNG);
	assert.deepEqual(result.photo.versions[0]?.develop, defaultPhotoDevelopV1());
	assert.deepEqual(events, ['open:png:image/png', 'decode', 'close']);
});

test('maximal valid selected names whose NFC projection expands beyond 512 retain exact identity and bytes', async () => {
	const originalName = '\ufb2c'.repeat(256), selected = file(PNG, originalName), events: string[] = [];
	assert.equal(originalName.length, 256); assert.equal(originalName.normalize('NFC').length, 768);
	const result = (await collect(preparePhotoImportGestureV1(request([selected]), { openImage: decoder(events) })))[0];
	assert.equal(result?.outcome, 'prepared'); if (result?.outcome !== 'prepared') return;
	assert.equal(selected.name, originalName); assert.equal(result.fileName, originalName);
	assert.equal(result.photo.original.name, originalName); assert.equal(result.photo.metadata.fileName, originalName);
	assert.equal(result.photo.original.contentSha256, bytesToHex(sha256(PNG)));
	assert.equal(result.decodeArtifact.originalSha256, result.photo.original.contentSha256);
	assert.deepEqual(new Uint8Array(await result.original.arrayBuffer()), PNG);
	assert.deepEqual(parseLightscaperDocumentV1(serializeLightscaperDocumentV1(result.photo)), result.photo);
	assert.deepEqual(events, ['open:png:image/png', 'decode', 'close']);
});

test('new File selections still refuse 257-unit names before reading bytes or opening the decoder', () => {
	let reads = 0; const events: string[] = [], original = Blob.prototype.arrayBuffer;
	const mocked = test.mock.method(Blob.prototype, 'arrayBuffer', function (this: Blob) { reads++; return original.call(this); });
	try {
		assert.throws(() => preparePhotoImportGestureV1(request([file(PNG, 'x'.repeat(257))]), { openImage: decoder(events) }), TypeError);
		assert.equal(reads, 0); assert.deepEqual(events, []);
	} finally { mocked.mock.restore(); }
});

test('retains raw capture time, repeated creators/keywords and one native orientation pass', async () => {
	const bytes = jpeg(jpegExif(tiffFixture([numberEntry(0x112, 6)], [textEntry(0x9003, '2025:07:08 09:10:11'), textEntry(0x9291, '123456')])),
		photoshopIptc(joinBytes(iptcText(80, 'Alice'), iptcText(80, 'Bob'), iptcText(25, 'travel'), iptcText(25, 'travel'))));
	const outcome = (await collect(preparePhotoImportGestureV1(request([file(bytes, 'camera.jpg')]), { openImage: decoder([], 1, 2) })))[0];
	assert.equal(outcome?.outcome, 'prepared'); if (outcome?.outcome !== 'prepared') return;
	assert.equal(outcome.photo.metadata.orientation, 6);
	assert.deepEqual([outcome.photo.original.width, outcome.photo.original.height], [1, 2]);
	assert.equal(outcome.photo.metadata.captureTime, null);
	assert.equal(outcome.photo.extractedMetadata?.exif?.captureTime?.offsetMinutes, null);
	assert.equal(outcome.photo.extractedMetadata?.exif?.captureTimeRaw?.subsecondOriginal, '123456');
	assert.deepEqual(outcome.photo.extractedMetadata?.iptc?.creators, ['Alice', 'Bob']);
	assert.deepEqual(outcome.keywordNames, ['travel', 'travel']);
	assert.deepEqual(outcome.photo.keywordIds, []);
	assert.ok(outcome.notices.some(({ reason }) => reason === 'precision'));
	assert.deepEqual(new Uint8Array(await outcome.original.arrayBuffer()), bytes);
});

test('whole gesture and ownership/catalog definitions are admitted before original reads', () => {
	let reads = 0;
	const original = Blob.prototype.arrayBuffer;
	const context = test.mock.method(Blob.prototype, 'arrayBuffer', function (this: Blob) { reads++; return original.call(this); });
	try {
		assert.throws(() => preparePhotoImportGestureV1(request(Array.from({ length: 65 }, () => file()))));
		const invalid = request([file()]);
		assert.throws(() => preparePhotoImportGestureV1({ ...invalid, createdAt: 'invented' }));
		assert.throws(() => preparePhotoImportGestureV1({ ...invalid, folderId: 'missing' }));
		assert.throws(() => preparePhotoImportGestureV1({ ...invalid, catalog: { ...CATALOG, schemaVersion: 2 } }));
		assert.throws(() => preparePhotoImportGestureV1({ ...invalid, ownership: [{ ...invalid.ownership[0], originalStorageKey: '../escape' }] }));
		assert.equal(reads, 0);
	} finally { context.mock.restore(); }
});

test('rejects forged File objects and bypasses genuine subclass overrides and filename/size getters', async () => {
	let calls = 0;
	class HostileFile extends File {
		override get name(): string { calls++; throw new Error('name override'); }
		override get size(): number { calls++; throw new Error('size override'); }
		override arrayBuffer(): Promise<ArrayBuffer> { calls++; throw new Error('read override'); }
	}
	const input = new HostileFile([PNG.slice()], 'actual.png', { lastModified: 0 });
	const result = (await collect(preparePhotoImportGestureV1(request([input]), { openImage: decoder() })))[0];
	assert.equal(result?.outcome, 'prepared'); assert.equal(result?.fileName, 'actual.png');
	assert.equal(calls, 0);
	assert.throws(() => preparePhotoImportGestureV1(request([Object.create(File.prototype) as File])));
	assert.throws(() => preparePhotoImportGestureV1(request([new Blob([PNG.slice()]) as File])));
});

test('yields one closed artifact at a time, continues per-file decode failures and unsupported formats', async () => {
	const events: string[] = [];
	const open = decoder(events);
	let active = 0, maximum = 0, opens = 0;
	const stream = preparePhotoImportGestureV1(request([file(), file(Uint8Array.of(73, 73, 42, 0), 'raw.dng'), file(), file()]), {
		openImage: async request => { active++; maximum = Math.max(maximum, active); const session = await open(request);
			return { ...session, decodeFrame: ++opens === 2
				? async () => { throw new Error('corrupt frame'); } : session.decodeFrame,
			close() { active--; session.close(); } }; },
	});
	const first = await stream.next(); assert.equal(first.value?.outcome, 'prepared');
	assert.equal(events.length, 3); assert.equal(active, 0);
	const rest = await collect(stream);
	assert.deepEqual(rest.map(({ outcome }) => outcome), ['failed', 'failed', 'prepared']);
	assert.deepEqual(rest.map(({ index, fileName }) => [index, fileName]), [[1, 'raw.dng'], [2, 'photo.png'], [3, 'photo.png']]);
	assert.equal(maximum, 1); assert.equal(active, 0);
});

test('animation/high-precision/profile declarations refuse before a single-frame fallback opens', async () => {
	const highDepth = PNG.slice(); highDepth[24] = 16;
	const extendedPng = (chunk: Uint8Array) => joinBytes(PNG.subarray(0, 33), chunk, PNG.subarray(33));
	const inputs = [extendedPng(pngChunk('acTL', Uint8Array.of(0, 0, 0, 2, 0, 0, 0, 0))), extendedPng(pngChunk('iCCP', Uint8Array.of(0))), highDepth,
		extendedPng(pngChunk('cICP', Uint8Array.of(9, 16, 0, 1))), new TextEncoder().encode('<svg/>')];
	let opened = 0;
	const outcomes = await collect(preparePhotoImportGestureV1(request(inputs.map((bytes, index) => file(bytes, `unsupported-${index}.png`))), {
		openImage: async () => { opened++; throw new Error('must not open'); },
	}));
	assert.ok(outcomes.every(({ outcome }) => outcome === 'failed'));
	assert.equal(opened, 0);
});

test('oversized and animated decoder metadata fail before frame extraction and close sessions', async () => {
	for (const metadata of [{ width: 8193, height: 1, frameCount: 1, topology: 'single' as const }, { width: 1, height: 1, frameCount: 2, topology: 'animated' as const }]) {
		let decoded = 0, closed = 0;
		const outcomes = await collect(preparePhotoImportGestureV1(request([file()]), {
			openImage: async () => ({ metadata: { ...metadata, runtimeVersion: 'fixture' }, decodeFrame: async () => { decoded++; return { rgba: Uint8Array.of(0, 0, 0, 255), durationMicroseconds: null }; }, close() { closed++; } }),
		}));
		assert.equal(outcomes[0]?.outcome, 'failed'); assert.equal(decoded, 0); assert.equal(closed, 1);
	}
});

test('a decoder cannot replace exact original bytes or short-read pixels', async () => {
	for (const mutate of [true, false]) {
		let closed = 0;
		const outcomes = await collect(preparePhotoImportGestureV1(request([file()]), {
			openImage: async ({ bytes }) => { if (mutate) bytes[bytes.length - 1] ^= 1; return {
				metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'fixture' },
				decodeFrame: async () => ({ rgba: mutate ? Uint8Array.of(0, 0, 0, 255) : Uint8Array.of(1), durationMicroseconds: null }), close() { closed++; },
			}; },
		}));
		assert.equal(outcomes[0]?.outcome, 'failed'); assert.equal(closed, 1);
	}
});

test('whole-gesture cancellation closes an active session and does not continue with another file', async () => {
	const controller = new AbortController(); let opened = 0, closed = 0;
	await assert.rejects(collect(preparePhotoImportGestureV1({ ...request([file(), file()]), signal: controller.signal }, {
		openImage: async () => { opened++; return { metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'fixture' },
			decodeFrame: async () => { controller.abort(new Error('cancel gesture')); return { rgba: Uint8Array.of(0, 0, 0, 255), durationMicroseconds: null }; }, close() { closed++; } }; },
	})), /cancel gesture/u);
	assert.equal(opened, 1); assert.equal(closed, 1);
});

test('per-file and total byte ceilings cannot trigger even the first original read', () => {
	const body = new Blob([new Uint8Array(64 * 1024 * 1024)]);
	let reads = 0; const native = Blob.prototype.arrayBuffer;
	const mocked = test.mock.method(Blob.prototype, 'arrayBuffer', function (this: Blob) { reads++; return native.call(this); });
	try {
		assert.throws(() => preparePhotoImportGestureV1(request([new File([body, Uint8Array.of(0)], 'too-large.png')])));
		assert.throws(() => preparePhotoImportGestureV1(request(Array.from({ length: 9 }, (_, index) => new File([body], `large-${index}.png`)))));
		assert.equal(reads, 0);
	} finally { mocked.mock.restore(); }
});

test('original reads occur once each and stop at iterator backpressure', async () => {
	let reads = 0; const native = Blob.prototype.arrayBuffer;
	const mocked = test.mock.method(Blob.prototype, 'arrayBuffer', function (this: Blob) { if (this instanceof File) reads++; return native.call(this); });
	try {
		const stream = preparePhotoImportGestureV1(request([file(), file()]), { openImage: decoder() });
		assert.equal(reads, 0);
		await stream.next(); assert.equal(reads, 1);
		await stream.return(undefined); assert.equal(reads, 1);
	} finally { mocked.mock.restore(); }
});

test('decoder accessors and pixel subclasses are refused without consulting their getters', async () => {
	for (const hostileMetadata of [true, false]) {
		let getters = 0, closed = 0;
		class HostilePixels extends Uint8Array { override get byteLength(): number { getters++; throw new Error('pixel getter'); } }
		const metadata = { width: 1, height: 1, frameCount: 1, topology: 'single' as const, runtimeVersion: 'fixture' };
		if (hostileMetadata) Object.defineProperty(metadata, 'width', { enumerable: true, get() { getters++; throw new Error('metadata getter'); } });
		const outcomes = await collect(preparePhotoImportGestureV1(request([file()]), { openImage: async () => ({
			metadata, decodeFrame: async () => ({ rgba: new HostilePixels([0, 0, 0, 255]), durationMicroseconds: null }), close() { closed++; },
		}) }));
		assert.equal(outcomes[0]?.outcome, 'failed'); assert.equal(getters, 0); assert.equal(closed, 1);
	}
});

test('session metadata accessors are refused while their own data cleanup port still runs', async () => {
	let getters = 0, closed = 0;
	const session = { metadata: { width: 1, height: 1, frameCount: 1, topology: 'single' as const, runtimeVersion: 'fixture' },
		decodeFrame: async () => ({ rgba: Uint8Array.of(0, 0, 0, 255), durationMicroseconds: null }), close() { closed++; } };
	Object.defineProperty(session, 'metadata', { enumerable: true, get() { getters++; throw new Error('session getter'); } });
	const result = (await collect(preparePhotoImportGestureV1(request([file()]), { openImage: async () => session })))[0];
	assert.equal(result?.outcome, 'failed'); assert.equal(getters, 0); assert.equal(closed, 1);
});

test('decoded pixel method, species and iterator overrides cannot run through shared normalization', async () => {
	for (const key of ['slice', 'constructor', Symbol.iterator]) {
		let getters = 0, closed = 0;
		const rgba = Uint8Array.of(10, 20, 30, 255);
		Object.defineProperty(rgba, key, { get() { getters++; throw new Error('pixel behavior getter'); } });
		const result = (await collect(preparePhotoImportGestureV1(request([file()]), { openImage: async () => ({
			metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'fixture' },
			decodeFrame: async () => ({ rgba, durationMicroseconds: null }), close() { closed++; },
		}) })))[0];
		assert.equal(result?.outcome, 'prepared'); assert.equal(getters, 0); assert.equal(closed, 1);
	}
});

test('explicit Exif color refusal precedes the browser port even when descriptive extraction fails', async () => {
	const artist = textEntry(0x013b, 'artist'); artist.data[0] = 255;
	let opened = 0;
	const result = (await collect(preparePhotoImportGestureV1(request([file(jpeg(jpegExif(tiffFixture([artist], [numberEntry(0xa001, 65535)]))), 'capture.jpg')]), {
		openImage: async () => { opened++; throw new Error('color refusal must precede native open'); },
	})))[0];
	assert.equal(result?.outcome, 'failed'); assert.equal(opened, 0);
	if (result?.outcome === 'failed') assert.match(String(result.error), /Exif.*colour/iu);
});

test('a cooperative deadline closes one decoder before the next outcome is prepared', async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	let began: () => void = () => undefined; const entered = new Promise<void>(resolve => { began = resolve; });
	let opens = 0, closed = 0;
	const stream = preparePhotoImportGestureV1(request([file(), file()]), { openImage: async () => {
		const first = ++opens === 1;
		return { metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'fixture' },
			decodeFrame: async (_index, signal) => {
				if (!first) return { rgba: Uint8Array.of(0, 0, 0, 255), durationMicroseconds: null };
				assert.ok(signal); began();
				return new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => { reject(signal.reason); }, { once: true }));
			}, close() { closed++; } };
	} });
	const pending = stream.next(); await entered;
	context.mock.timers.tick(60_000);
	const first = await pending; assert.equal(first.value?.outcome, 'failed'); assert.equal(closed, 1);
	const second = await stream.next(); assert.equal(second.value?.outcome, 'prepared'); assert.equal(closed, 2);
	await stream.return(undefined);
});
