/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import rawFixtures from '../config/lightscaper-raw-fixtures.json' with { type: 'json' };
import { compilePinnedLibRawModuleV1 } from '../src/common/editor/raw/libraw-runtime-asset-v1.ts';
import { withDecodedRawOriginalV1 } from '../src/common/editor/raw/libraw-runtime-v1.ts';
import { probeRawSourceV1, rawFlipExifOrientationV1, RAW_SOURCE_FILE_ACCEPT_V1 } from '../src/common/editor/raw/raw-source-v1.ts';
import type { PhotoLibraryImportItemV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { preparePhotoImportGestureCurrentV1, type PhotoImportOutcomeCurrentV1 } from '../src/lightscaper/import/photo-import-preparation-current-v1.ts';
import { preparePhotoImportGestureV1 } from '../src/lightscaper/import/photo-import-preparation-v1.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { repairSettingsFixture } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { rawDngFixtureV1 } from './helpers/lightscaper-raw-dng-current-fixture.ts';
import { rawWorkerFixtureV1 } from './helpers/lightscaper-raw-worker-current-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';

type Fixture = Awaited<ReturnType<typeof repairSettingsFixture>>;
type Workers = Awaited<ReturnType<typeof rawWorkerFixtureV1>>;
const OPTIONS = { concurrency: false, timeout: 20_000 };
const CATALOG = { schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'raw-catalog', name: 'RAW Library', revision: 0, photoCount: 0,
	folders: [], collections: [], keywords: [] };
let compiled: Promise<WebAssembly.Module> | undefined;
const wasmBytes = async () => new Uint8Array(await readFile(new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url)));
function moduleBytes() { compiled ??= wasmBytes().then(compilePinnedLibRawModuleV1); return compiled; }
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function selected(bytes: Uint8Array<ArrayBuffer>, name = 'Native sensor.DNG') { return new File([bytes], name, { type: 'image/png', lastModified: 0 }); }
function request(files: File[]) { return { files, catalog: CATALOG, createdAt: '2026-10-16T00:00:00.000Z',
	ownership: files.map((_, index) => ({ photoId: `raw-photo-${index}`, originalId: `raw-original-${index}`, originalStorageKey: `raw-storage-${index}`, masterVersionId: `raw-master-${index}` })) }; }
async function collect(values: AsyncIterable<PhotoImportOutcomeCurrentV1>) { const result: PhotoImportOutcomeCurrentV1[] = []; for await (const value of values) result.push(value); return result; }
function observed<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
function nativeReader(workers: Workers): typeof withDecodedRawOriginalV1 {
	return (value, consume) => withDecodedRawOriginalV1(value, consume, { loadModule: moduleBytes, createWorker: workers.createWorker });
}

async function withNativeImport<Result>(run: (f: Fixture, workers: Workers) => Promise<Result>): Promise<Result> {
	const f = await repairSettingsFixture(1), workers = await rawWorkerFixtureV1();
	const previousWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker'), previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
	try {
		const wasm = await wasmBytes();
		Object.defineProperty(globalThis, 'Worker', { configurable: true, value: function () { return workers.createWorker(); } });
		Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (value: RequestInfo | URL) => {
			assert.equal(String(value), 'https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm'); return new Response(wasm, { status: 200 });
		} });
		return await run(f, workers);
	} finally {
		try { await f.close(); } finally { try { await workers.close(); } finally {
			for (const [key, descriptor] of [['Worker', previousWorker], ['fetch', previousFetch]] as const) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
			}
		} }
	}
}

async function inspectImported(f: Fixture, photoId: string) {
	const anchor = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, preferOpfs: false });
	let selection: Awaited<ReturnType<typeof readPhotoLibrarySessionLocationV2>>;
	try { await anchor.ready(); selection = await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
		initializeDefault: async () => { throw new Error('RAW import fixture cannot allocate another namespace.'); } }); } finally { await anchor.close(); }
	const media = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, databaseName: selection.location.mediaDatabaseName, preferOpfs: false });
	const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.native.factory, databaseName: selection.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
	try {
		const photo = await catalog.loadPhoto(selection.location.catalogId, photoId); assert.ok(photo);
		const body = await media.mediaRepository.loadAsset(photo.original.storageKey); assert.ok(body instanceof Blob);
		const raw = f.native.raw(selection.location.mediaDatabaseName);
		const roots = (raw.records(selection.location.mediaDatabaseName, 'catalogOriginalRoots') as Record<string, unknown>[]).filter(row => row.photoId === photoId);
		const assets = (raw.records(selection.location.mediaDatabaseName, 'mediaAssets') as Record<string, unknown>[]).filter(row => row.sourceId === photo.original.storageKey);
		return { photo, bytes: new Uint8Array(await body.arrayBuffer()), roots, assets };
	} finally { await Promise.all([catalog.close(), media.close()]); }
}

test('Current File import accepts genuine DNG bytes through the real native decoder and selected catalog writer', OPTIONS, async () => {
	await withNativeImport(async (f, workers) => {
		const bytes = rawDngFixtureV1().bytes, before = await f.inspect(), acknowledged: PhotoLibraryImportItemV1[] = [];
		const receipt = await f.session.importFiles([selected(bytes)], { onAcknowledged: item => { acknowledged.push(item); } });
		assert.equal(receipt.length, 1); assert.equal(receipt[0]?.status, 'imported'); assert.ok(receipt[0]?.photoId);
		assert.deepEqual(acknowledged, receipt); assert.equal((await f.session.readPage()).totalCount, 2);
		const retained = await inspectImported(f, receipt[0].photoId);
		assert.deepEqual(retained.bytes, bytes); assert.equal(retained.photo.original.contentSha256, digest(bytes));
		assert.equal(retained.photo.original.mimeType, 'image/x-adobe-dng'); assert.equal(retained.photo.original.name, 'Native sensor.DNG');
		assert.deepEqual([retained.photo.original.width, retained.photo.original.height, retained.photo.original.hasAlpha], [32, 32, false]);
		assert.equal(retained.roots.length, 1); assert.equal(retained.roots[0]?.importId, null); assert.equal(retained.assets.length, 1);
		assert.equal(typeof retained.assets[0]?.mediaContentToken, 'string'); assert.deepEqual(await f.inspect(), before);
		assert.equal(workers.statistics.joined, 1); assert.equal(workers.active(), 0);
		await f.session.close(); const reopened = await createPhotoLibrarySessionCurrentV1(f.options);
		try { assert.equal((await reopened.readPage()).totalCount, 2); assert.deepEqual(await inspectImported(f, receipt[0].photoId), retained); }
		finally { await reopened.close(); }
	});
});

test('Current File import retains the pinned Canon CRW Original after actual proprietary RAW decoding', OPTIONS, async () => {
	const pin = rawFixtures.fixtures[0]; assert.ok(pin); assert.equal(pin.fileName, 'D60.CRW'); assert.equal(pin.license, 'CC0-1.0');
	const bytes = new Uint8Array(await readFile(new URL('../vendor/lightscaper-raw-fixtures/D60.CRW', import.meta.url)));
	assert.equal(bytes.byteLength, pin.byteLength); assert.equal(digest(bytes), pin.sha256);
	await withNativeImport(async (f, workers) => {
		const before = await f.inspect(), items = await f.session.importFiles([selected(bytes, 'Lens cap.CRW')]);
		assert.equal(items.length, 1); assert.equal(items[0]?.status, 'imported'); assert.ok(items[0]?.photoId);
		const retained = await inspectImported(f, items[0].photoId);
		assert.equal(retained.photo.original.mimeType, 'image/x-canon-crw'); assert.equal(retained.photo.original.name, 'Lens cap.CRW');
		assert.deepEqual([retained.photo.original.width, retained.photo.original.height, retained.photo.original.hasAlpha], [3088, 2056, false]);
		assert.equal(retained.photo.original.contentSha256, pin.sha256); assert.equal(retained.photo.original.byteLength, pin.byteLength);
		assert.equal(retained.photo.original.retention, 'managed'); assert.equal(retained.photo.extractedMetadata?.container, 'unsupported');
		assert.equal(retained.photo.extractedMetadata?.exif, null); assert.equal(retained.photo.extractedMetadata?.iptc, null);
		assert.deepEqual(retained.bytes, bytes); assert.equal(retained.roots.length, 1); assert.equal(retained.assets.length, 1);
		assert.equal(retained.roots[0]?.importId, null); assert.equal(retained.roots[0]?.sha256, pin.sha256);
		assert.equal(retained.roots[0]?.size, pin.byteLength); assert.equal(retained.roots[0]?.assetId, retained.photo.original.storageKey);
		const nativeBody = retained.assets[0]?.blob; assert.ok(nativeBody instanceof Blob);
		assert.equal(nativeBody.type, 'image/x-canon-crw'); assert.equal(nativeBody.size, pin.byteLength);
		assert.deepEqual(new Uint8Array(await nativeBody.arrayBuffer()), bytes);
		assert.deepEqual(await f.inspect(), before); assert.equal(workers.statistics.joined, 1); assert.equal(workers.active(), 0);
		// This licensed lens-cap capture proves the actual import/storage route;
		// it provides no scene-color accuracy or camera-breadth claim.
	});
});

test('RAW source probe qualifies DNG declarations and CIFF signatures without filename or MIME authority', () => {
	const bytes = rawDngFixtureV1().bytes, view = new DataView(bytes.buffer), directory = view.getUint32(4, true);
	assert.deepEqual(probeRawSourceV1(bytes), { format: 'dng', mimeType: 'image/x-adobe-dng' });
	const count = view.getUint16(directory, true), entries = Array.from({ length: count }, (_, index) => directory + 2 + index * 12);
	const tag = entries.find(at => view.getUint16(at, true) === 50706); assert.ok(tag);
	const plain = bytes.slice(); new DataView(plain.buffer).setUint16(tag, 50705, true); assert.equal(probeRawSourceV1(plain), null);
	const malformed = bytes.slice(); new DataView(malformed.buffer).setUint32(tag + 4, 5, true); assert.throws(() => probeRawSourceV1(malformed), RangeError);
	const duplicate = bytes.slice(), duplicateView = new DataView(duplicate.buffer), other = entries.find(at => at !== tag)!;
	duplicateView.setUint16(other, 50706, true); duplicateView.setUint16(other + 2, 1, true); duplicateView.setUint32(other + 4, 4, true); duplicate[other + 8] = 1;
	assert.throws(() => probeRawSourceV1(duplicate), RangeError);
	for (const little of [true, false]) {
		const ciff = new Uint8Array(32), ciffView = new DataView(ciff.buffer); ciff.set(little ? [73, 73] : [77, 77]);
		ciffView.setUint32(2, 26, little); ciff.set(new TextEncoder().encode('HEAPCCDR'), 6);
		assert.deepEqual(probeRawSourceV1(ciff), { format: 'crw', mimeType: 'image/x-canon-crw' });
		ciffView.setUint32(2, 33, little); assert.throws(() => probeRawSourceV1(ciff), RangeError);
	}
	assert.equal(probeRawSourceV1(new TextEncoder().encode('a filename.dng is not a signature')), null);
	assert.deepEqual(Array.from({ length: 8 }, (_, flip) => rawFlipExifOrientationV1(flip)), [1, 2, 4, 3, 5, 8, 6, 7]);
	assert.throws(() => rawFlipExifOrientationV1(8)); assert.match(RAW_SOURCE_FILE_ACCEPT_V1, /\.dng,.crw/);
	const shadowed = bytes.slice(); Object.defineProperty(shadowed, 'byteLength', { value: 8 }); assert.throws(() => probeRawSourceV1(shadowed), TypeError);
});

test('Current RAW preparation retains exact Original facts and native orientation while retiring real deep pixels and its one input read', OPTIONS, async context => {
	const workers = await rawWorkerFixtureV1(), raw = nativeReader(workers), bytes = rawDngFixtureV1(6).bytes;
	const name = '原本 e\u0301.DNG', file = selected(bytes, name), input = request([file]);
	let reads = 0, plane: ArrayBuffer | undefined, inputBacking: ArrayBuffer | undefined;
	const arrayBuffer = Blob.prototype.arrayBuffer, mocked = context.mock.method(Blob.prototype, 'arrayBuffer', function (this: Blob) {
		if (this === file) reads++; return arrayBuffer.call(this);
	});
	const withRawFrame: typeof withDecodedRawOriginalV1 = (value, consume) => {
		inputBacking = (Object.getOwnPropertyDescriptor(value, 'bytes')!.value as Uint8Array<ArrayBuffer>).buffer;
		return raw(value, view => { plane = view.frame.pixels.buffer; assert.equal(view.frame.descriptor.sampleFormat, 'unorm16');
			assert.equal(workers.active(), 0); assert.equal(view.rawFlip, 6);
			assert.ok(view.frame.pixels.some(sample => sample !== 0 && sample % 257 !== 0)); return consume(view); });
	};
	try {
		const stream = preparePhotoImportGestureCurrentV1(input, { withRawFrame });
		input.files[0] = selected(Uint8Array.of(1), 'replacement.png'); input.ownership[0]!.photoId = 'replaced';
		const values = await collect(stream), value = values[0]; assert.equal(value?.outcome, 'prepared'); assert.equal(values.length, 1);
		assert.ok(value?.outcome === 'prepared'); assert.equal(value.photo.id, 'raw-photo-0'); assert.equal(value.fileName, name);
		assert.equal(value.photo.original.name, name); assert.equal(value.photo.metadata.fileName, name); assert.equal(value.photo.metadata.orientation, 6);
		assert.equal(value.photo.original.contentSha256, digest(bytes)); assert.deepEqual(new Uint8Array(await value.original.arrayBuffer()), bytes);
		assert.equal(value.original.type, 'image/x-adobe-dng'); assert.equal(Object.hasOwn(value, 'decodeArtifact'), false);
		assert.equal(reads, 1); assert.ok(plane && inputBacking); assert.ok(new Uint8Array(plane).every(sample => sample === 0));
		assert.ok(new Uint8Array(inputBacking).every(sample => sample === 0)); assert.equal(workers.statistics.joined, 1);
	} finally { mocked.mock.restore(); await workers.close(); }
});

test('Current RAW preparation refuses invalid whole gestures before source reads and preserves legacy RAW refusal', OPTIONS, async context => {
	let reads = 0, opens = 0; const arrayBuffer = Blob.prototype.arrayBuffer;
	const mocked = context.mock.method(Blob.prototype, 'arrayBuffer', function (this: Blob) { reads++; return arrayBuffer.call(this); });
	try {
		const input = request([selected(rawDngFixtureV1().bytes)]);
		assert.throws(() => preparePhotoImportGestureCurrentV1({ ...input, ownership: [] }));
		assert.throws(() => preparePhotoImportGestureCurrentV1(request([Object.create(File.prototype) as File])));
		assert.equal(reads, 0);
		const values = await collect(preparePhotoImportGestureV1(input, { openImage: async () => { opens++; throw new Error('RAW must remain outside V1.'); } }));
		assert.equal(values[0]?.outcome, 'failed'); assert.equal(opens, 0);
	} finally { mocked.mock.restore(); }
});

test('RAW preparation joins held native setup before propagating exact cancellation and never opens the next selected source', OPTIONS, async () => {
	const workers = await rawWorkerFixtureV1(), entered = deferred<void>(), release = deferred<WebAssembly.Module>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); let calls = 0;
	const withRawFrame: typeof withDecodedRawOriginalV1 = (value, consume) => {
		calls++; return withDecodedRawOriginalV1(value, consume, { loadModule: () => { entered.resolve(undefined); return release.promise; }, createWorker: workers.createWorker });
	};
	const stream = preparePhotoImportGestureCurrentV1({ ...request([selected(rawDngFixtureV1().bytes), selected(rawDngFixtureV1().bytes)]), signal: stop.signal }, { withRawFrame });
	const work = observed(stream.next());
	try {
		await entered.promise; stop.abort(opaque.proxy); release.resolve(await moduleBytes());
		const result = await work; assert.equal(result.ok, false); if (!result.ok) assert.ok(Object.is(result.error, opaque.proxy));
		assert.equal(calls, 1); assert.equal(workers.statistics.created, 0);
	} finally { release.resolve(await moduleBytes()); await work; await stream.return(undefined); await workers.close(); }
});

test('Current RAW import keeps source indexes and settings while deduplicating exact Original bytes', OPTIONS, async () => {
	await withNativeImport(async (f, workers) => {
		const bytes = rawDngFixtureV1().bytes, files = [selected(bytes, 'same.DNG'), selected(Uint8Array.of(1, 2, 3), 'invalid.DNG'), selected(bytes, 'same.DNG')];
		const items = await f.session.importFiles(files, { settings: { rename: { template: 'RAW-{sequence}.{extension}', sequenceStart: 7, sequencePadding: 2 },
			metadata: { creator: 'Photographer' }, keywordIds: [] } });
		assert.deepEqual(items.map(item => [item.index, item.status]), [[0, 'imported'], [1, 'failed'], [2, 'imported']]);
		assert.ok(items[0]?.photoId && items[2]?.photoId);
		const first = await inspectImported(f, items[0].photoId), last = await inspectImported(f, items[2].photoId);
		assert.equal(first.photo.metadata.fileName, 'RAW-07.DNG'); assert.equal(last.photo.metadata.fileName, 'RAW-09.DNG');
		assert.equal(first.photo.metadata.creator, 'Photographer'); assert.equal(last.photo.metadata.creator, 'Photographer');
		assert.equal(first.photo.original.name, 'same.DNG'); assert.equal(last.photo.original.name, 'same.DNG');
		assert.equal(first.photo.original.storageKey, last.photo.original.storageKey); assert.equal(items[2].reusedOriginal, true);
		assert.deepEqual(first.bytes, bytes); assert.deepEqual(last.bytes, bytes); assert.equal(workers.statistics.joined, 2);
	});
});

test('Cancellation after genuine RAW catalog ACK retains the photo and immutable Original for fresh-session recovery', OPTIONS, async () => {
	await withNativeImport(async (f, workers) => {
		const bytes = rawDngFixtureV1().bytes, stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
		let acknowledged: PhotoLibraryImportItemV1 | undefined;
		const result = await observed(f.session.importFiles([selected(bytes)], { signal: stop.signal, onAcknowledged: item => { acknowledged = item; stop.abort(opaque.proxy); } }));
		assert.equal(result.ok, false); if (!result.ok) assert.ok(Object.is(result.error, opaque.proxy));
		assert.ok(acknowledged?.photoId); assert.equal(acknowledged.status, 'imported'); assert.equal(workers.statistics.joined, 1);
		await f.session.close(); const reopened = await createPhotoLibrarySessionCurrentV1(f.options);
		try {
			assert.equal((await reopened.readPage()).totalCount, 2); const retained = await inspectImported(f, acknowledged.photoId);
			assert.deepEqual(retained.bytes, bytes); assert.equal(retained.roots.length, 1); assert.equal(retained.roots[0]?.importId, null);
		} finally { await reopened.close(); }
	});
});
