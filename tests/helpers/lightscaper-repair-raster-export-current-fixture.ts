/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { createPhotoLibrarySessionV3 } from '../../src/lightscaper/photo-library-session-runtime-v3.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { applyPhotoCommandCurrentV1 } from '../../src/lightscaper/controller/photo-commands-current-v1.ts';
import { verifyPhotoResourcesCurrentV1 } from '../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../../src/lightscaper/photo-develop-render-runtime-v3.ts';
import { defaultImageDevelopStateV2 } from '../../src/common/editor/imaging/image-develop-state-v2.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { withPreparedBrushMaskResourceV1 } from '../../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { encodePixelFramePngV1 } from '../../src/common/editor/imaging/pixel-frame-png-v1.ts';
import { encodePixelFrameJpegV1 } from '../../src/common/editor/imaging/pixel-frame-jpeg-v1.ts';
import type { PhotoRasterExportRequest } from '../../src/lightscaper/controller/photo-raster-export.ts';
import type { ExecutePhotoDevelopCurrentV1 } from '../../src/common/editor/controller/shared/photo-library-develop-workflow-current-v1.ts';
import type { PhotoLibraryExportJournalPort, ReadPhotoExportSidecar } from '../../src/common/editor/photo-library-session-port-v2.ts';
import type { PixelFrameV1 } from '../../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import type { PhotoLibraryDevelopOriginalPortV1, PhotoLibraryDevelopOriginalReadV1, PhotoLibraryDevelopOriginalFrameV1 } from '../../src/common/editor/photo-library-develop-original-port-v1.ts';
import type { PhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';
import { mediaRestoreFixture } from './lightscaper-media-restore-fixture.ts';
import { currentAppLocks } from './lightscaper-current-app-fixture.tsx';
import { InstrumentedKeyRange } from './instrumented-indexeddb-keys.ts';
import { pngChunk } from './image-metadata-fixtures.ts';
import { deferred } from './async-test-control.ts';

export interface RepairRasterRequest extends Omit<PhotoRasterExportRequest, 'execute' | 'loadRenderer'> {
	readonly execute: ExecutePhotoDevelopCurrentV1;
	readonly loadRenderer: () => Promise<ReturnType<typeof createPhotoDevelopRenderRuntimeV3>>;
}
export const ORIGINAL = [255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255];
export function repairRecipe(width = 3) {
	return replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV2(), { schemaVersion: 1, spots: [{ id: 'clone', mode: 'clone', enabled: true,
		target: { x: 1.5 / width, y: 0.5 }, source: { x: 0.5 / width, y: 0.5 }, radius: 0.1, feather: 0, opacity: 1 }] });
}
export function pngBytes(pixels: readonly number[], height = 1): Uint8Array<ArrayBuffer> {
	const width = pixels.length / (height * 4), header = new Uint8Array(13), view = new DataView(header.buffer);
	assert.ok(Number.isSafeInteger(width)); view.setUint32(0, width); view.setUint32(4, height); header.set([8, 6], 8);
	const rows = new Uint8Array(pixels.length + height);
	for (let y = 0; y < height; y++) rows.set(pixels.slice(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
	return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header),
		pngChunk('IDAT', new Uint8Array(deflateSync(rows))), pngChunk('IEND', new Uint8Array())]));
}
export function decodePng(bytes: Uint8Array) {
	assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), width = data.getUint32(16), height = data.getUint32(20), chunks: Uint8Array[] = [];
	assert.ok(width > 0 && height > 0 && width * height <= 4096); assert.equal(bytes[24], 8); assert.equal(bytes[25], 6);
	for (let offset = 8; offset < bytes.length;) {
		const length = data.getUint32(offset); assert.ok(offset + length + 12 <= bytes.length);
		if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
		offset += length + 12;
	}
	const rows = inflateSync(Buffer.concat(chunks)), pixels = new Uint8Array(width * height * 4);
	assert.equal(rows.length, (width * 4 + 1) * height);
	for (let y = 0; y < height; y++) { const offset = y * (width * 4 + 1); assert.equal(rows[offset], 0); pixels.set(rows.subarray(offset + 1, offset + 1 + width * 4), y * width * 4); }
	return { width, height, pixels };
}

/** Controlled browser codec edge only. The real Session Original owner still
 * verifies encoded SHA/length/orientation before and after actual PNG parsing.
 * JPEG bytes are a structural native-output stand-in, never a codec golden. */
function codecBoundary() {
	const keys = ['IDBKeyRange', 'ImageDecoder', 'createImageBitmap', 'OffscreenCanvas', 'ImageData'] as const;
	const previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	const bitmaps = new WeakMap<object, Uint8Array>(), decoded: Uint8Array[] = [], encodedInputs: number[][] = [];
	const calls = { opens: 0, closes: 0 };
	class Canvas {
		pixels = new Uint8Array(0);
		constructor(public width: number, public height: number) {}
		getContext() { return { clearRect: () => { this.pixels.fill(0); }, drawImage: (image: object) => {
			const pixels = bitmaps.get(image); assert.ok(pixels); this.pixels = pixels.slice();
		}, getImageData: () => ({ data: new Uint8ClampedArray(this.pixels) }), putImageData: (image: { data: Uint8ClampedArray }) => {
			this.pixels = new Uint8Array(image.data); encodedInputs.push([...image.data]);
		} }; }
		convertToBlob(options: { type: string; quality: number }) {
			assert.equal(options.type, 'image/jpeg'); assert.equal(options.quality, 0.9);
			const bytes = Uint8Array.of(255, 216, 255, 192, 0, 17, 8, this.height >> 8, this.height & 255, this.width >> 8, this.width & 255,
				3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 218, 0, 12, 3, 1, 0, 2, 0, 3, 0, 0, 63, 0, 1, 255, 217);
			return Promise.resolve(new Blob([bytes], { type: 'image/jpeg' }));
		}
	}
	class Image { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} }
	const createImageBitmap = async (body: Blob) => {
		const value = decodePng(new Uint8Array(await Blob.prototype.arrayBuffer.call(body))), bitmap = { width: value.width, height: value.height,
			close() { calls.closes++; value.pixels.fill(0); } };
		calls.opens++; decoded.push(value.pixels); bitmaps.set(bitmap, value.pixels); return bitmap;
	};
	for (const [index, value] of [InstrumentedKeyRange, undefined, createImageBitmap, Canvas, Image].entries()) Object.defineProperty(globalThis, keys[index]!, { configurable: true, value });
	return { calls, decoded, encodedInputs, restore() { for (const [index, key] of keys.entries()) {
		const saved = previous[index]; if (saved) Object.defineProperty(globalThis, key, saved); else Reflect.deleteProperty(globalThis, key);
	} } };
}

export async function repairRasterFixture(recipe: unknown = repairRecipe(), pixels: readonly number[] = ORIGINAL, count = 1, height = 1) {
	const codecs = codecBoundary(), native = mediaRestoreFixture(), locks = currentAppLocks(), options = { name: 'Repair export', indexedDB: native.factory, locks };
	let session: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>> | undefined;
	const owners: { media?: PhotoMediaStoreV1; catalog?: PhotoCatalogRepositoryCurrentV1 } = {};
	try {
		const initial = await createPhotoLibrarySessionV3(options); try { await initial.readPage(); } finally { await initial.close(); }
		const anchor = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, preferOpfs: false });
		let selected: Awaited<ReturnType<typeof readPhotoLibrarySessionLocationV2>>;
		try { await anchor.ready(); selected = await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw new Error('The real selected namespace was not initialized.'); } }); } finally { await anchor.close(); }
		const media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, databaseName: selected.location.mediaDatabaseName, preferOpfs: false }); owners.media = media;
		const resources = { cubeLutResources: () => media.getCubeLutResources(), maskRasterResources: () => media.getMaskRasterResources() };
		const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, databaseName: selected.location.catalogDatabaseName,
			verifyOriginal: media.verifyOriginal, verifyResources: (photo, signal) => verifyPhotoResourcesCurrentV1(photo, resources, signal) }); owners.catalog = catalog;
		await media.ready();
		const bytes = pngBytes(pixels, height), photos: PhotoDocumentCurrentV1[] = [];
		for (let index = 1; index <= count; index++) {
			const seed = photoArchiveFixture(index, bytes), legacy = normalizePhotoDocumentV1({ ...seed.photo, catalogId: selected.location.catalogId,
				original: { ...seed.photo.original, width: pixels.length / (height * 4), height, hasAlpha: pixels.some((value, offset) => offset % 4 === 3 && value !== 255) } });
			const photo = applyPhotoCommandCurrentV1(legacy, { type: 'set-develop', develop: recipe });
			const metadata = await media.mediaRepository.writeAsset(photo.original.storageKey, seed.original);
			await media.mediaRepository.catalogOriginals.stage(photo.catalogId, 'export-seed', [{ photoId: photo.id, sourceId: photo.original.id,
				assetId: metadata.sourceId, sha256: metadata.sha256, size: metadata.size }]); photos.push(photo);
		}
		const root = await catalog.loadCatalog(selected.location.catalogId); assert.ok(root); await catalog.publishPhotos(root.id, root.revision, photos);
		await media.mediaRepository.catalogOriginals.promote(root.id, 'export-seed', photos.map(photo => photo.id));
		await Promise.all([catalog.close(), media.close()]); owners.catalog = undefined; owners.media = undefined;
		session = await createPhotoLibrarySessionCurrentV1(options);
		const actual = session, events: string[] = [], outputs: { name: string; mimeType: string; bytes: Uint8Array }[] = [], encoded: Uint8Array[] = [], borrowed: PixelFrameV1['pixels'][] = [];
		const execute: ExecutePhotoDevelopCurrentV1 = async (run, external) => { const signal = external ?? new AbortController().signal;
			await run({ signal, acquire: async () => actual.develop, isCurrent: () => true, refresh: () => actual.readPage() }); return 'completed'; };
		const runtime = createPhotoDevelopRenderRuntimeV3({ source: actual.cubeLuts.source, maskSource: actual.maskRasterSource });
		const current = actual as typeof actual & { readExportSidecarCurrent?: ReadPhotoExportSidecar; exportJournalCurrent?: Readonly<PhotoLibraryExportJournalPort> };
		const readSidecar: ReadPhotoExportSidecar = (request, options) => Reflect.apply(current.readExportSidecarCurrent ?? actual.readExportSidecar!, actual, [request, options]) as Promise<string>;
		const openJournal: PhotoLibraryExportJournalPort['open'] = options => {
			const port = current.exportJournalCurrent ?? actual.exportJournal!; return Reflect.apply(port.open, port, [options]) as ReturnType<PhotoLibraryExportJournalPort['open']>;
		};
		const withOriginalFrame: PhotoLibraryDevelopOriginalPortV1['withFrame'] = async <Result>(bound: Readonly<PhotoLibraryDevelopOriginalReadV1>,
			consume: (view: Readonly<PhotoLibraryDevelopOriginalFrameV1>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) => {
			events.push('original');
			const result = await (Reflect.apply(actual.develop.original!.withFrame, actual.develop.original,
				[bound, async (view: Readonly<PhotoLibraryDevelopOriginalFrameV1>) => { borrowed.push(view.frame.pixels); return consume(view); }, options]) as Promise<Result>);
			events.push('original-settled'); return result;
		};
		const request = (format: 'png' | 'jpeg' = 'png', index = 0): RepairRasterRequest => {
			const photo = photos[index]!;
			return { photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision, fileName: `Photo-${index + 1}`, fileTypeDescription: format,
				execute, withOriginalFrame,
				loadRenderer: async () => runtime, encode: async (frame, options) => { events.push('encode'); const bytes = format === 'png' ? await encodePixelFramePngV1(frame, options)
					: await encodePixelFrameJpegV1(frame, { ...options, quality: 0.9 }); encoded.push(bytes); return bytes; },
				prepareSave: value => { events.push('picker'); const name = value.suggestedName; assert.ok(typeof name === 'string'); return { mode: 'blob', target: { browserDownload: true, name }, fileName: name }; },
				saveFile: async value => { assert.ok(value.blob); const name = value.suggestedName ?? value.fileName; assert.equal(typeof name, 'string');
					events.push('download'); outputs.push({ name: name as string, mimeType: value.mimeType ?? value.blob.type, bytes: new Uint8Array(await value.blob.arrayBuffer()) });
					return { method: 'download', fileName: name as string, size: value.blob.size }; },
			};
		};
		const inspect = async () => { const media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, databaseName: selected.location.mediaDatabaseName, preferOpfs: false });
				const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, databaseName: selected.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
				try { return await Promise.all(photos.map(async photo => { const row = await catalog.loadPhoto(photo.catalogId, photo.id); assert.ok(row);
					const body = await media.mediaRepository.loadAsset(row.original.storageKey); assert.ok(body instanceof Blob); return { photo: row, bytes: new Uint8Array(await body.arrayBuffer()) }; })); }
				finally { await Promise.all([catalog.close(), media.close()]); } };
		return { session: actual, photos, bytes, codecs, events, outputs, encoded, borrowed, execute, runtime, request, readSidecar, openJournal, inspect,
			async installBrush(alpha: readonly number[] = [255, 0, 0]) { return withPreparedBrushMaskResourceV1({ width: alpha.length, height: 1, alpha: Uint8Array.from(alpha) },
				async body => actual.develop.maskRasters!.install(body.reference, body.bytes)); },
			async changeRecipe(develop: unknown, index = 0) {
				const photo = photos[index]!, snapshot = await actual.develop.read({ schemaVersion: 3, photoId: photo.id });
				const ack = await actual.develop.apply({ schemaVersion: 3, photoId: photo.id, expectedRevision: snapshot.revision,
					command: { type: 'record-develop', versionId: snapshot.versionId, develop: normalizeImageDevelopStateCurrentV1(develop), label: 'Export recipe', createdAt: '2026-10-12T00:00:00.000Z' } });
				const observed = await inspect(); photos[index] = observed[index]!.photo; return ack;
			},
			async close() { try { await actual.close(); } finally { codecs.restore(); } },
		};
	} catch (error) { try { await Promise.all([session?.close(), owners.catalog?.close(), owners.media?.close()]); } finally { codecs.restore(); } throw error; }
}

export function heldNativeWrite() {
	const entered = deferred<void>(), write = deferred<void>(), closed = deferred<void>(), closing = deferred<void>(), events: string[] = [];
	return { entered, write, closed, closing, events, target: { async createWritable() { return {
		async write(_bytes: unknown) { events.push('write'); entered.resolve(); await write.promise; },
		async close() { events.push('close'); closed.resolve(); await closing.promise; }, async abort(_reason?: unknown) { events.push('abort'); },
	}; } } };
}
