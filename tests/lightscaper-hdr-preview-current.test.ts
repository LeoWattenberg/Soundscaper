/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { encodeImageHdrOriginalV1 } from '../src/common/editor/imaging/image-hdr-original-v1.ts';
import { readBinaryDerivativeCacheRecordV1 } from '../src/common/editor/storage/binary-derivative-cache-records.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { PHOTO_PREVIEW_CACHE_PROFILE_V1 } from '../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { normalizePhotoPreviewPlanV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { normalizePhotoHdrPreviewPlanCurrentV1, planPhotoHdrPreviewCurrentV1 } from '../src/lightscaper/preview/photo-hdr-preview-plan-current-v1.ts';
import { preparePhotoHdrPreviewCurrentV1 } from '../src/lightscaper/preview/photo-hdr-preview-preparation-current-v1.ts';
import { RepairPixelFrameLifetimeV1 } from '../src/common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { repairSettingsFixture } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';

const WIDTH = 2050, HEIGHT = 5, RECIPE = 'lightscaper.hdr-original-preview.linear-f32-srgb.rgba8-nearest';
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sourceSamples = () => {
	const samples = new Float32Array(WIDTH * HEIGHT * 4);
	for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
		const at = (y * WIDTH + x) * 4; samples[at] = (x % 31) / 16; samples[at + 1] = (y - .5) / 8; samples[at + 2] = (x % 5) / 65535; samples[at + 3] = 1;
	}
	return samples;
};
function expectedPreview(width: number, height: number): Uint8Array {
	const source = sourceSamples(), output = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const from = (Math.floor(y * HEIGHT / height) * WIDTH + Math.floor(x * WIDTH / width)) * 4, to = (y * width + x) * 4;
		for (let channel = 0; channel < 3; channel++) {
			const linear = Math.max(0, Math.min(1, source[from + channel]!));
			output[to + channel] = Math.round(255 * (linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055));
		}
		output[to + 3] = 255;
	}
	return output;
}

async function previewFixture() {
	const f = await repairSettingsFixture(1);
	const anchor = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, preferOpfs: false });
	let media: PhotoMediaStoreV1 | undefined, catalog: PhotoCatalogRepositoryCurrentV1 | undefined;
	let current: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>> | undefined;
	try {
		const selected = await (async () => { try { await anchor.ready(); return await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw new Error('Preview fixture must retain the selected namespace.'); } }); } finally { await anchor.close(); } })();
		const storage = { indexedDB: f.native.factory, locks: f.options.locks, databaseName: selected.location.mediaDatabaseName, preferOpfs: false };
		media = new PhotoMediaStoreV1(storage); await media.ready();
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.native.factory, databaseName: selected.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
		const provenance = { schemaVersion: 1, operation: 'hdr-merge-v1', referenceIndex: 0, alignment: 'none', deghost: { mode: 'off', threshold: 0 },
			inputs: [1, 4].map((exposureMultiplier, index) => ({ product: 'lightscaper', ownerId: 'bracket-catalog', sourceId: `bracket-${index}`, revision: 0,
				original: { fileName: `Bracket-${index}.dng`, mimeType: 'image/x-adobe-dng', sha256: (index ? 'b' : 'a').repeat(64), byteLength: 2048, width: WIDTH, height: HEIGHT },
				profile: 'linear-srgb16', exposureMultiplier, offset: { x: 0, y: 0 }, alignmentError: 0, alignmentSupport: WIDTH * HEIGHT })),
			output: { x: 0, y: 0, width: WIDTH, height: HEIGHT } };
		const source = sourceSamples(), bytes = await encodeImageHdrOriginalV1({ descriptor: { schemaVersion: 1, width: WIDTH, height: HEIGHT,
			sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, pixels: source }, provenance);
		const seed = queryPhotoV1(90), photo = normalizePhotoDocumentCurrentV1({ ...seed, schemaVersion: 3, catalogId: selected.location.catalogId,
			folderId: null, keywordIds: [], collectionIds: [], extractedMetadata: null, original: { ...seed.original, name: 'Merged.lshdr', mimeType: 'image/x-lightscaper-hdr',
				width: WIDTH, height: HEIGHT, byteLength: bytes.length, contentSha256: digest(bytes) } });
		const asset = await media.mediaRepository.writeAsset(photo.original.storageKey, new Blob([bytes], { type: photo.original.mimeType }));
		await media.mediaRepository.catalogOriginals.stage(photo.catalogId, 'hdr-preview-seed', [{ photoId: photo.id, sourceId: photo.original.id,
			assetId: asset.sourceId, sha256: asset.sha256, size: asset.size }]);
		const root = await catalog.loadCatalog(photo.catalogId); assert.ok(root); await catalog.publishPhotos(root.id, root.revision, [photo]);
		await media.mediaRepository.catalogOriginals.promote(root.id, 'hdr-preview-seed', [photo.id]);
		await Promise.all([catalog.close(), media.close(), f.session.close()]); catalog = undefined; media = undefined;
		current = await createPhotoLibrarySessionCurrentV1(f.options);
		const inspect = async () => {
			const owner = new PhotoMediaStoreV1(storage), repository = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.native.factory,
				databaseName: selected.location.catalogDatabaseName, verifyOriginal: owner.verifyOriginal });
			try {
				await owner.ready(); const row = await repository.loadPhoto(photo.catalogId, photo.id); assert.ok(row);
				const body = await owner.mediaRepository.loadAsset(row.original.storageKey); assert.ok(body instanceof Blob);
				const native = f.native.raw(selected.location.mediaDatabaseName);
				const rows = (name: string) => (native.records(selected.location.mediaDatabaseName, name) as Record<string, unknown>[])
					.filter(value => value.sourceId === photo.original.storageKey || value.photoId === photo.id);
				return { row, bytes: new Uint8Array(await body.arrayBuffer()), metadata: await owner.mediaRepository.getAssetMetadata(row.original.storageKey),
					assets: rows('mediaAssets'), roots: rows('catalogOriginalRoots'), inventory: rows('videoDerivativeCacheEntries'), payload: rows('videoDerivatives') };
			} finally { await Promise.all([repository.close(), owner.close()]); }
		};
		return { photo, bytes, source, inspect, session: () => { assert.ok(current); return current; },
			async reopen() { await current?.close(); current = await createPhotoLibrarySessionCurrentV1(f.options); },
			async close() { try { await current?.close(); } finally { await f.close(); } } };
	} catch (error) { await Promise.allSettled([current?.close(), catalog?.close(), media?.close(), anchor.close()]); await f.close(); throw error; }
}

test('actual Current HDR preview warms native thumbnail and fitted caches, reopens exact hits, and preserves Float32 Original custody', async () => {
	const f = await previewFixture();
	try {
		const before = await f.inspect(); assert.deepEqual(before.inventory, []);
		for (const [tier, width, height] of [['thumbnail', 512, 1], ['fit-screen', 2048, 5]] as const) {
			const ready = await f.session().readPreview(f.photo.id, tier); assert.ok(ready.outcome === 'ready'); assert.equal(ready.cache, 'stored');
			assert.deepEqual(ready.preview.descriptor, { schemaVersion: 1, width, height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' });
			assert.deepEqual(new Uint8Array(await ready.preview.body.arrayBuffer()), expectedPreview(width, height));
			const hit = await f.session().readPreview(f.photo.id, tier, { rawPreviewSource: 'camera-embedded' });
			assert.ok(hit.outcome === 'ready'); assert.equal(hit.cache, 'hit'); assert.equal(hit.preview.outputSha256, ready.preview.outputSha256);
		}
		const warmed = await f.inspect(); assert.equal(warmed.inventory.length, 2); assert.equal(warmed.payload.length, 2);
		for (const row of warmed.inventory) {
			assert.ok(typeof row.key === 'string'); const record = readBinaryDerivativeCacheRecordV1(row, row.key, PHOTO_PREVIEW_CACHE_PROFILE_V1);
			assert.equal(record.recipeId, RECIPE); assert.equal(record.originalSha256, f.photo.original.contentSha256); assert.equal(record.originalByteLength, f.bytes.length);
			assert.equal(record.originalMediaContentToken, warmed.assets[0]?.mediaContentToken);
			const payload = warmed.payload.find(value => value.key === row.key); assert.ok(payload);
			assert.deepEqual(readBinaryDerivativeCacheRecordV1(payload, row.key, PHOTO_PREVIEW_CACHE_PROFILE_V1, true), record);
			assert.ok(payload.blob instanceof Blob); assert.equal(digest(new Uint8Array(await payload.blob.arrayBuffer())), record.outputSha256);
		}
		await f.reopen();
		for (const tier of ['thumbnail', 'fit-screen'] as const) { const hit = await f.session().readPreview(f.photo.id, tier); assert.ok(hit.outcome === 'ready'); assert.equal(hit.cache, 'hit'); }
		const original = f.session().develop.original; assert.ok(original); let exposed: Float32Array | undefined;
		await original.withFrame({ schemaVersion: 1, photoId: f.photo.id, expectedRevision: f.photo.revision }, view => {
			assert.ok(view.frame.pixels instanceof Float32Array); exposed = view.frame.pixels; assert.deepEqual([...exposed], [...f.source]);
		});
		assert.ok(exposed?.every(value => value === 0)); const after = await f.inspect();
		assert.deepEqual(after.row, before.row); assert.deepEqual(after.bytes, before.bytes); assert.deepEqual(after.metadata, before.metadata);
		assert.deepEqual(after.assets, before.assets); assert.deepEqual(after.roots, before.roots); assert.deepEqual(after.inventory, warmed.inventory);
	} finally { await f.close(); }
});

function preparationFixture(width = 512, height = 40) {
	const binding = { sourceKind: 'hdr-original' as const, catalogId: 'hdr-catalog', photoId: 'hdr-photo', originalId: 'hdr-original', storageKey: 'hdr-body',
		contentSha256: 'a'.repeat(64), byteLength: width * height * 12 + 2048, width, height };
	const plan = planPhotoHdrPreviewCurrentV1({ binding, tier: 'thumbnail' });
	const pixels = new Float32Array(width * height * 4);
	for (let at = 0; at < pixels.length; at += 4) pixels.set([3, .5, -.25, 1], at);
	return { binding, plan, frame: { descriptor: plan.source, pixels } };
}
function capturePreparationPlanes() {
	const descriptor = Object.getOwnPropertyDescriptor(RepairPixelFrameLifetimeV1.prototype, 'bytes')!, bytes = RepairPixelFrameLifetimeV1.prototype.bytes;
	const owned: Uint8Array<ArrayBuffer>[] = [];
	Object.defineProperty(RepairPixelFrameLifetimeV1.prototype, 'bytes', { configurable: true, value: function (this: RepairPixelFrameLifetimeV1, length: number) {
		const plane = Reflect.apply(bytes, this, [length]) as Uint8Array<ArrayBuffer>; owned.push(plane); return plane;
	} });
	return { owned, restore: () => { Object.defineProperty(RepairPixelFrameLifetimeV1.prototype, 'bytes', descriptor); } };
}

test('HDR preview policy has its own reproducible recipe, rounded fit and closed native source admission', () => {
	const f = preparationFixture(WIDTH, HEIGHT), plan = planPhotoHdrPreviewCurrentV1({ binding: f.binding, tier: 'fit-screen' });
	assert.deepEqual(plan.output, { schemaVersion: 1, width: 2048, height: 5, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' });
	assert.equal(plan.recipe.id, RECIPE); assert.deepEqual(normalizePhotoHdrPreviewPlanCurrentV1(JSON.parse(JSON.stringify(plan))), plan);
	assert.throws(() => normalizePhotoPreviewPlanV1(plan));
	for (const patch of [{ key: 'photo-preview-sha256:' + 'b'.repeat(64) }, { source: { ...plan.source, sampleFormat: 'unorm16' } },
		{ output: { ...plan.output, width: 2047 } }, { recipe: { ...plan.recipe, version: 2 } }, { extra: true }]) {
		assert.throws(() => normalizePhotoHdrPreviewPlanCurrentV1({ ...plan, ...patch }));
	}
});

test('HDR preparation snapshots selected native samples synchronously and retires all owned planes before returning its independent Blob', async () => {
	const f = preparationFixture(), capture = capturePreparationPlanes();
	try {
		const work = preparePhotoHdrPreviewCurrentV1(f); f.frame.pixels.fill(0);
		const prepared = await work, actual = new Uint8Array(await prepared.body.arrayBuffer());
		for (let at = 0; at < actual.length; at += 4) assert.deepEqual([...actual.subarray(at, at + 4)], [255, 188, 0, 255]);
		assert.equal(capture.owned.length, 2); assert.ok(capture.owned.every(plane => plane.every(value => value === 0)));
		assert.equal(prepared.outputSha256, digest(actual)); assert.equal(Object.hasOwn(prepared, 'original'), false);
	} finally { capture.restore(); }
});

test('HDR preparation cancellation preserves its opaque native reason and physically wipes fitted snapshot and output', async () => {
	const f = preparationFixture(), capture = capturePreparationPlanes(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	const before = f.frame.pixels.slice();
	try {
		const work = preparePhotoHdrPreviewCurrentV1({ ...f, signal: stop.signal });
		const observed = work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); stop.abort(opaque.proxy);
		const outcome = await observed; assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, opaque.proxy));
		assert.equal(capture.owned.length, 2); assert.ok(capture.owned.every(plane => plane.every(value => value === 0))); assert.deepEqual(f.frame.pixels, before);
	} finally { capture.restore(); }
});

test('HDR preview metadata and fixed native planes refuse before getters or owned allocation', async () => {
	const f = preparationFixture(), capture = capturePreparationPlanes(); let reads = 0;
	try {
		const pixels = { enumerable: true, get() { reads++; throw new Error('Rejected metadata consulted source pixels.'); } };
		for (const descriptor of [{ ...f.frame.descriptor, width: 8193 }, { ...f.frame.descriptor, sampleFormat: 'unorm8' },
			{ ...f.frame.descriptor, primaries: 'display-p3' }, { ...f.frame.descriptor, transfer: 'srgb' }]) {
			await assert.rejects(preparePhotoHdrPreviewCurrentV1({ ...f, frame: Object.defineProperty({ descriptor }, 'pixels', pixels) }), RangeError);
		}
		const resizable = Reflect.construct(ArrayBuffer, [f.frame.pixels.byteLength, { maxByteLength: f.frame.pixels.byteLength * 2 }]) as ArrayBuffer;
		await assert.rejects(preparePhotoHdrPreviewCurrentV1({ ...f, frame: { ...f.frame, pixels: new Float32Array(resizable) } }), TypeError);
		await assert.rejects(preparePhotoHdrPreviewCurrentV1({ ...f, frame: { ...f.frame, pixels: new Float32Array(new SharedArrayBuffer(f.frame.pixels.byteLength)) } }), TypeError);
		assert.equal(reads, 0); assert.equal(capture.owned.length, 0);
	} finally { capture.restore(); }
});
