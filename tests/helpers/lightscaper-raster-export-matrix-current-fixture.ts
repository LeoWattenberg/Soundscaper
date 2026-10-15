/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createPhotoLibrarySessionV3 } from '../../src/lightscaper/photo-library-session-runtime-v3.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { applyPhotoCommandCurrentV1 } from '../../src/lightscaper/controller/photo-commands-current-v1.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../../src/lightscaper/photo-develop-render-runtime-v3.ts';
import { createVideoEffect } from '../../src/common/editor/video-effects.js';
import { encodePixelFramePngV1 } from '../../src/common/editor/imaging/pixel-frame-png-v1.ts';
import { encodePixelFrameJpegV1 } from '../../src/common/editor/imaging/pixel-frame-jpeg-v1.ts';
import { readImageMetadataV1 } from '../../src/common/editor/imaging/image-metadata-reader-v1.ts';
import type { PhotoRasterExportRequestCurrentV1 } from '../../src/lightscaper/controller/photo-raster-export-current-v1.ts';
import type { PixelFrameV1 } from '../../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import type { PhotoLibraryDevelopOriginalPortV1, PhotoLibraryDevelopOriginalReadV1, PhotoLibraryDevelopOriginalFrameV1 } from '../../src/common/editor/photo-library-develop-original-port-v1.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';
import { mediaRestoreFixture } from './lightscaper-media-restore-fixture.ts';
import { currentAppLocks } from './lightscaper-current-app-fixture.tsx';
import { InstrumentedKeyRange } from './instrumented-indexeddb-keys.ts';
import { numberEntry, pngChunk, rationalEntry, textEntry, tiffFixture } from './image-metadata-fixtures.ts';
import { decodePng, pngBytes, repairRecipe } from './lightscaper-repair-raster-export-current-fixture.ts';

export const MATRIX_ORIGINAL_RGBA = [255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255,
	0, 255, 0, 255, 255, 255, 255, 255, 255, 255, 0, 255];
export type MatrixFormat = 'png' | 'jpeg';

function originalPng(): Uint8Array<ArrayBuffer> {
	const png = pngBytes(MATRIX_ORIGINAL_RGBA, 2), tiff = tiffFixture([
		numberEntry(0x0112, 1), textEntry(0x010f, 'Matrix camera'), textEntry(0x0110, 'Native facts'),
		textEntry(0x013b, 'Private original artist'), textEntry(0x010e, 'Private original description'),
	], [rationalEntry(0x829a, 1, 125), rationalEntry(0x829d, 4, 1), numberEntry(0x8827, 200),
		rationalEntry(0x920a, 35, 1), textEntry(0xa434, 'Matrix lens')]);
	const exif = pngChunk('eXIf', tiff), output = new Uint8Array(png.length + exif.length);
	output.set(png.subarray(0, 33)); output.set(exif, 33); output.set(png.subarray(33), 33 + exif.length);
	return output;
}

/** Only native browser interfaces are modeled: IDB/locks use the existing
 * instrumented fixtures, PNG decoding is an independent zlib parser, and the
 * JPEG canvas emits structural bytes, not decodable entropy. The real JPEG
 * wrapper must receive the independently expected pixels and dimensions. PNG
 * encoding, metadata, rendering, Session and all storage owners are production. */
function browserCodecBoundary() {
	const keys = ['IDBKeyRange', 'ImageDecoder', 'createImageBitmap', 'OffscreenCanvas', 'ImageData'] as const;
	const previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	const bitmaps = new WeakMap<object, Uint8Array>(), decoded: Uint8Array[] = [];
	const jpegInputs: { width: number; height: number; pixels: number[] }[] = [], calls = { opens: 0, closes: 0 };
	class Canvas {
		pixels = new Uint8Array(0);
		constructor(public width: number, public height: number) {}
		getContext() { return { clearRect: () => { this.pixels.fill(0); }, drawImage: (image: object) => {
			const pixels = bitmaps.get(image); assert.ok(pixels); this.pixels = pixels.slice();
		}, getImageData: () => ({ data: new Uint8ClampedArray(this.pixels) }), putImageData: (image: { data: Uint8ClampedArray }) => {
			this.pixels = new Uint8Array(image.data); jpegInputs.push({ width: this.width, height: this.height, pixels: [...image.data] });
		} }; }
		convertToBlob(options: { type: string; quality: number }) {
			assert.equal(options.type, 'image/jpeg'); assert.equal(options.quality, .9);
			return Promise.resolve(new Blob([Uint8Array.of(255, 216, 255, 192, 0, 17, 8,
				this.height >> 8, this.height & 255, this.width >> 8, this.width & 255,
				3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 218, 0, 12, 3, 1, 0, 2, 0, 3, 0, 0, 63, 0, 1, 255, 217)], { type: 'image/jpeg' }));
		}
	}
	class Image { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} }
	const bitmap = async (body: Blob) => {
		const value = decodePng(new Uint8Array(await Blob.prototype.arrayBuffer.call(body))), image = { width: value.width, height: value.height,
			close() { calls.closes++; value.pixels.fill(0); } };
		calls.opens++; decoded.push(value.pixels); bitmaps.set(image, value.pixels); return image;
	};
	for (const [index, value] of [InstrumentedKeyRange, undefined, bitmap, Canvas, Image].entries()) {
		Object.defineProperty(globalThis, keys[index]!, { configurable: true, value });
	}
	return { calls, decoded, jpegInputs, restore() { for (const [index, key] of keys.entries()) {
		const descriptor = previous[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
	} } };
}

export async function rasterExportMatrixFixture() {
	const codecs = browserCodecBoundary(), native = mediaRestoreFixture(), locks = currentAppLocks();
	const options = { name: 'Current raster matrix', indexedDB: native.factory, locks };
	let session: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>> | undefined;
	let media: PhotoMediaStoreV1 | undefined, catalog: PhotoCatalogRepositoryCurrentV1 | undefined;
	try {
		const initial = await createPhotoLibrarySessionV3(options);
		try { await initial.readPage(); } finally { await initial.close(); }
		const anchor = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, preferOpfs: false });
		let selected: Awaited<ReturnType<typeof readPhotoLibrarySessionLocationV2>>;
		try { await anchor.ready(); selected = await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw new Error('The selected native namespace must already exist.'); } }); } finally { await anchor.close(); }
		const storage = { indexedDB: native.factory, locks, databaseName: selected.location.mediaDatabaseName, preferOpfs: false };
		media = new PhotoMediaStoreV1(storage); await media.ready();
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, databaseName: selected.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
		const bytes = originalPng(), seed = photoArchiveFixture(1, bytes), base = normalizePhotoDocumentV1({ ...seed.photo,
			catalogId: selected.location.catalogId, original: { ...seed.photo.original, width: 3, height: 2 }, extractedMetadata: readImageMetadataV1(bytes),
			metadata: { ...seed.photo.metadata, title: 'Matrix title', caption: 'Sidecar description', creator: 'Sidecar creator', copyright: 'Sidecar rights', location: 'Private sidecar location' } });
		const repairs = repairRecipe(), photo = applyPhotoCommandCurrentV1(base, { type: 'set-develop', develop: {
			...repairs, effects: [createVideoEffect('develop-geometry-v1', { id: 'matrix-flip', params: { flipHorizontal: 1 } })],
			repairs: { schemaVersion: 1, spots: [{ ...repairs.repairs.spots[0]!, target: { x: .5, y: .25 }, source: { x: 1 / 6, y: .25 } }] },
		} });
		assert.equal(photo.schemaVersion, 3); assert.equal(photo.versions[0]!.develop.processVersion, 3);
		assert.equal(photo.extractedMetadata?.exif?.cameraMake, 'Matrix camera');
		const metadata = await media.mediaRepository.writeAsset(photo.original.storageKey, seed.original);
		await media.mediaRepository.catalogOriginals.stage(photo.catalogId, 'matrix-seed', [{ photoId: photo.id, sourceId: photo.original.id,
			assetId: metadata.sourceId, sha256: metadata.sha256, size: metadata.size }]);
		const root = await catalog.loadCatalog(photo.catalogId); assert.ok(root); await catalog.publishPhotos(root.id, root.revision, [photo]);
		await media.mediaRepository.catalogOriginals.promote(root.id, 'matrix-seed', [photo.id]);
		await Promise.all([catalog.close(), media.close()]); catalog = undefined; media = undefined;
		session = await createPhotoLibrarySessionCurrentV1(options);
		const actual = session, events: string[] = [], outputs: { name: string; mimeType: string; bytes: Uint8Array }[] = [];
		const encoded: Uint8Array[] = [], fresh: Uint8Array[] = [], borrowed: PixelFrameV1['pixels'][] = [];
		const renderer = createPhotoDevelopRenderRuntimeV3({ source: actual.cubeLuts.source, maskSource: actual.maskRasterSource });
		const read = actual.readMetadata, sidecar = actual.readExportSidecarCurrent; assert.ok(sidecar);
		const originalPort = actual.develop.original!;
		const withFrame = originalPort.withFrame;
		const withOriginalFrame: PhotoLibraryDevelopOriginalPortV1['withFrame'] = async <Result>(bound: Readonly<PhotoLibraryDevelopOriginalReadV1>,
			consume: (view: Readonly<PhotoLibraryDevelopOriginalFrameV1>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) => {
			events.push('original'); const result = await (Reflect.apply(withFrame, originalPort, [bound, async (view: Readonly<PhotoLibraryDevelopOriginalFrameV1>) => {
				borrowed.push(view.frame.pixels); return consume(view);
			}, options]) as Promise<Result>);
			events.push('original-settled'); return result;
		};
		const request = (format: MatrixFormat): PhotoRasterExportRequestCurrentV1 => ({
			photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision, fileName: 'Suggested', fileTypeDescription: format,
			execute: async (run, signal) => { assert.ok(signal); await run({ signal, acquire: async () => actual.develop,
				isCurrent: () => true, refresh: () => actual.readPage() }); return 'completed'; },
			withOriginalFrame,
			loadRenderer: async () => renderer,
			encode: async (frame, options) => { events.push('encode'); const bytes = format === 'png' ? await encodePixelFramePngV1(frame, options)
				: await encodePixelFrameJpegV1(frame, { ...options, quality: .9 }); encoded.push(bytes); fresh.push(bytes.slice()); return bytes; },
			readMetadata: async (id, expectedRevision, options) => {
				events.push('metadata'); const snapshot = await Reflect.apply(read, actual, [id, options]) as Awaited<ReturnType<typeof read>>;
				assert.equal(snapshot.revision, expectedRevision); return { catalogId: photo.catalogId, snapshot };
			},
			prepareSave: value => { events.push('picker'); assert.equal(value.mimeType, format === 'png' ? 'image/png' : 'image/jpeg');
				const fileName = `Picked matrix.${format === 'png' ? 'png' : 'jpg'}`;
				return { mode: 'blob', target: { browserDownload: true }, fileName }; },
			saveFile: async value => { assert.ok(value.blob); assert.equal(typeof value.suggestedName, 'string');
				events.push(value.mimeType === 'application/json' ? 'sidecar-download' : 'raster-download');
				outputs.push({ name: value.suggestedName as string, mimeType: value.blob.type, bytes: new Uint8Array(await value.blob.arrayBuffer()) });
				return { method: 'download', fileName: value.suggestedName as string, size: value.blob.size };
			},
		});
		const readSidecar: NonNullable<PhotoRasterExportRequestCurrentV1['sidecar']>['read'] = (bound, options) => {
			events.push('sidecar-read'); return Reflect.apply(sidecar, actual, [bound, options]) as ReturnType<typeof sidecar>;
		};
		const inspect = async () => {
			const owner = new PhotoMediaStoreV1(storage), repository = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory,
				databaseName: selected.location.catalogDatabaseName, verifyOriginal: owner.verifyOriginal });
			try {
				await owner.ready(); const row = await repository.loadPhoto(photo.catalogId, photo.id); assert.ok(row);
				await owner.verifyOriginal(row.original); const body = await owner.mediaRepository.loadAsset(row.original.storageKey); assert.ok(body instanceof Blob);
				const roots = await owner.mediaRepository.catalogOriginals.readPage({ catalogId: row.catalogId }); assert.equal(roots.afterKey, null);
				return { photo: row, root: await repository.loadCatalog(row.catalogId), bytes: new Uint8Array(await body.arrayBuffer()),
					metadata: await owner.mediaRepository.getAssetMetadata(row.original.storageKey), roots: roots.roots };
			} finally { await Promise.all([repository.close(), owner.close()]); }
		};
		return { photo, bytes, codecs, encoded, fresh, borrowed, outputs, events, request, readSidecar, inspect,
			async close() { try { await actual.close(); } finally { codecs.restore(); } } };
	} catch (error) { try { await Promise.all([session?.close(), catalog?.close(), media?.close()]); } finally { codecs.restore(); } throw error; }
}
