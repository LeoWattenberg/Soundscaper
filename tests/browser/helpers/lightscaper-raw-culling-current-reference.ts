/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from '../../../src/common/editor/storage/indexeddb-backend.ts';
import { digestMediaContent } from '../../../src/common/editor/storage/media-content-digest.ts';
import { readBinaryDerivativeCacheRecordV1 } from '../../../src/common/editor/storage/binary-derivative-cache-records.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoMediaStoreV1, PHOTO_MEDIA_NAMESPACES_V1 } from '../../../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { PHOTO_PREVIEW_CACHE_PROFILE_V1 } from '../../../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { validatePhotoDevelopProxyCustodyV1 } from '../../helpers/lightscaper-develop-proxy-native-observer.ts';

const CAMERA = 'lightscaper.raw-culling.camera-embedded.rgba8-contain-nearest';
const NEUTRAL = 'lightscaper.original-preview.rgba8-nearest';
interface CameraImage { readonly displayWidth: number; readonly displayHeight: number; close(): void; }
interface CameraDecoder {
	readonly tracks: { readonly ready: PromiseLike<void> };
	decode(options: { frameIndex: number; completeFramesOnly: boolean }): PromiseLike<{ image: CameraImage }>;
	close(): void;
}
interface CameraDecoderConstructor {
	new(options: { data: Uint8Array<ArrayBuffer>; type: string; preferAnimation: boolean; colorSpaceConversion: 'default' }): CameraDecoder;
	isTypeSupported?(type: string): PromiseLike<boolean>;
}

/** One real D60 Photo/Original and at most four paired previews. No initializer,
 * renderer, producer, writer or app Worker replacement runs in this observer.
 * Original and preview bytes stream into hashes; only scalar facts leave it. */
export async function readRawCullingCustodyCurrentV1(photoId: string) {
	check(typeof photoId === 'string' && photoId.length > 0 && photoId.length <= 128, 'Culling observer requires an exact Photo ID.');
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, preferOpfs: false, syncWorkerClient: null });
	let media: PhotoMediaStoreV1 | undefined, catalog: PhotoCatalogRepositoryCurrentV1 | undefined;
	const run = async () => {
		const selected = await withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({
			settings: anchor.settingsRepository, initializeDefault: async () => { throw new Error('Observation cannot initialize a library.'); },
		}));
		check(selected.location.mediaDatabaseName === PHOTO_MEDIA_NAMESPACES_V1.databaseName, 'Culling fixture must use its actual default native namespace.');
		const existing = await database(selected.location.mediaDatabaseName); existing.close();
		media = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, syncWorkerClient: null });
		const owner = media;
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB, databaseName: selected.location.catalogDatabaseName, verifyOriginal: owner.verifyOriginal });
		const photo = await catalog.loadPhoto(selected.location.catalogId, photoId); check(photo, 'Actual culling Photo is missing.');
		check(photo.original.mimeType === 'image/x-canon-crw' && photo.original.width === 3088 && photo.original.height === 2056
			&& photo.original.byteLength === 4363206, 'Observer requires the exact pinned D60 Original workload.');
		const body = await owner.mediaRepository.loadAsset(photo.original.storageKey), metadata = await owner.mediaRepository.getAssetMetadata(photo.original.storageKey);
		check(body instanceof Blob && metadata && metadata.storage === 'opfs', 'Actual D60 Original must have native OPFS custody.');
		const sha256 = await digestMediaContent(body, { chunkBytes: 65536 }), native = await rows(selected.location.mediaDatabaseName, photo.original.storageKey);
		const publicRoots = await owner.mediaRepository.catalogOriginals.readPage({ catalogId: photo.catalogId });
		const original = validatePhotoDevelopProxyCustodyV1(photo, metadata, native.original, native.roots, publicRoots, sha256, body.size);
		const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(PHOTO_MEDIA_NAMESPACES_V1.opfsDirectoryName, { create: false });
		const previews = [];
		for (const raw of native.inventory) {
			check(raw && typeof raw === 'object' && typeof Reflect.get(raw, 'key') === 'string', 'Native preview inventory is malformed.');
			const key = Reflect.get(raw, 'key') as string, scalar = readBinaryDerivativeCacheRecordV1(raw, key, PHOTO_PREVIEW_CACHE_PROFILE_V1);
			const rawPayload = native.payloads.find(value => value && typeof value === 'object' && Reflect.get(value, 'key') === key);
			const payload = readBinaryDerivativeCacheRecordV1(rawPayload, key, PHOTO_PREVIEW_CACHE_PROFILE_V1, true);
			check(JSON.stringify(payload) === JSON.stringify(scalar), 'Actual preview payload/inventory pairing differs.');
			check(scalar.sourceId === photo.original.storageKey && scalar.originalSha256 === sha256 && scalar.originalByteLength === body.size
				&& scalar.originalMediaContentToken === original.mediaContentToken && (scalar.recipeId === CAMERA || scalar.recipeId === NEUTRAL), 'Preview Original custody or recipe differs.');
			const identity = JSON.parse(scalar.binaryDerivativeManifest) as { metadata: string }, plan = JSON.parse(identity.metadata) as {
				kind: string; tier: string; output: { width: number; height: number }; recipe: { decoder?: { sha256: string } } };
			check(plan.tier === 'thumbnail' || plan.tier === 'fit-screen', 'Culling tier differs.');
			const width = plan.tier === 'thumbnail' ? 512 : 2048, height = Math.round(2056 * width / 3088);
			check(plan.output.width === width && plan.output.height === height && scalar.size === width * height * 4, 'Culling output exceeds its exact fixed tier.');
			const bytes = scalar.storage === 'opfs'
				? await (await directory.getFileHandle(scalar.path!, { create: false })).getFile()
				: Reflect.get(rawPayload as object, 'blob') as unknown;
			check(bytes instanceof Blob && bytes.size === scalar.size && await digestMediaContent(bytes) === scalar.outputSha256, 'Actual culling body hash differs.');
			previews.push({ key, recipeId: scalar.recipeId, tier: plan.tier, width, height, sha256: scalar.outputSha256,
				cacheToken: scalar.cacheToken, originalMediaContentToken: scalar.originalMediaContentToken, decoderSha256: plan.recipe.decoder?.sha256 ?? null });
		}
		check(JSON.stringify(await rows(selected.location.mediaDatabaseName, photo.original.storageKey)) === JSON.stringify(native), 'Native custody or preview rows changed during observation.');
		check(JSON.stringify(await catalog.loadPhoto(photo.catalogId, photo.id)) === JSON.stringify(photo), 'Photo changed during culling observation.');
		return { photo, original, namespace: selected.location.namespaceToken, previews: previews.sort((a, b) => a.key.localeCompare(b.key)) };
	};
	const result = await run().then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	const closed = await Promise.allSettled([catalog?.close(), media?.close(), anchor.close()]);
	const errors = closed.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
	if (!result.ok) { if (errors.length) throw new AggregateError([result.error, ...errors], 'Culling observation and retirement failed.', { cause: result.error }); throw result.error; }
	if (errors.length) throw new AggregateError(errors, 'Culling observation retirement failed.'); return result.value;
}

/** Independent platform JPEG decoding plus literal containment/nearest math.
 * No application image reader, orientation helper or resize owner is called.
 * This pinned D60 has native flip0, so no guessed orientation is applied. */
export async function rawCameraPreviewOracleCurrentV1(bytes: readonly number[], rawFlip: number) {
	check(rawFlip === 0 && bytes.length > 0 && bytes.length <= 16 * 1024 * 1024, 'Camera oracle requires the bounded flip0 D60 JPEG.');
	const encoded = Uint8Array.from(bytes);
	let pixels: Uint8ClampedArray<ArrayBuffer> | undefined;
	try {
		// ImageDecoder and ImageBitmap can round a JPEG differently. Qualify the
		// actual platform route independently, without importing its app adapter.
		pixels = await cameraPixels(encoded);
		const sourceWidth = 2048, sourceHeight = 1360;
		const outputs = [];
		for (const maximum of [512, 2048]) {
			const width = maximum, height = Math.round(2056 * maximum / 3088), scale = Math.min(width / sourceWidth, height / sourceHeight);
			const innerWidth = Math.round(sourceWidth * scale), innerHeight = Math.round(sourceHeight * scale), left = Math.floor((width - innerWidth) / 2), top = Math.floor((height - innerHeight) / 2);
			const output = new Uint8Array(width * height * 4);
			try {
				for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
					const to = (y * width + x) * 4; output[to + 3] = 255;
					if (x < left || y < top || x >= left + innerWidth || y >= top + innerHeight) continue;
					const from = (Math.floor((y - top) * sourceHeight / innerHeight) * sourceWidth + Math.floor((x - left) * sourceWidth / innerWidth)) * 4;
					for (let channel = 0; channel < 4; channel++) output[to + channel] = pixels[from + channel]!;
				}
				outputs.push({ width, height, sha256: await hash(output) });
			} finally { output.fill(0); }
		}
		return outputs;
	} finally { encoded.fill(0); pixels?.fill(0); }
}

async function cameraPixels(encoded: Uint8Array<ArrayBuffer>): Promise<Uint8ClampedArray<ArrayBuffer>> {
	const Decoder = (globalThis as typeof globalThis & { ImageDecoder?: CameraDecoderConstructor }).ImageDecoder;
	const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(2048, 1360) : document.createElement('canvas');
	canvas.width = 2048; canvas.height = 1360;
	let decoder: CameraDecoder | undefined, image: CameraImage | undefined, bitmap: ImageBitmap | undefined;
	let decoderInput: Uint8Array<ArrayBuffer> | undefined;
	try {
		const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true, colorSpace: 'srgb' }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
		check(context, 'Camera oracle canvas is unavailable.');
		if (Decoder && (!Decoder.isTypeSupported || await Decoder.isTypeSupported('image/jpeg'))) {
			decoderInput = encoded.slice(); decoder = new Decoder({ data: decoderInput, type: 'image/jpeg', preferAnimation: true, colorSpaceConversion: 'default' });
			await decoder.tracks.ready; image = (await decoder.decode({ frameIndex: 0, completeFramesOnly: true })).image;
			check(image.displayWidth === 2048 && image.displayHeight === 1360, 'Native D60 JPEG decoder extent differs.');
			context.drawImage(image as unknown as CanvasImageSource, 0, 0, 2048, 1360);
		} else {
			bitmap = await createImageBitmap(new Blob([encoded], { type: 'image/jpeg' }), { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
			check(bitmap.width === 2048 && bitmap.height === 1360, 'Actual D60 embedded JPEG extent differs.');
			context.drawImage(bitmap, 0, 0, 2048, 1360);
		}
		return context.getImageData(0, 0, 2048, 1360, { colorSpace: 'srgb' }).data;
	} finally {
		try { image?.close(); } finally { try { decoder?.close(); } finally {
			try { bitmap?.close(); } finally { canvas.width = 0; canvas.height = 0; decoderInput?.fill(0); }
		} }
	}
}

async function rows(name: string, originalId: string) {
	const opened = await database(name);
	try { return await transact(opened, ['mediaAssets', 'catalogOriginalRoots', 'videoDerivatives', 'videoDerivativeCacheEntries'], 'readonly', async stores => {
		const asset = stores.mediaAssets, roots = stores.catalogOriginalRoots, payload = stores.videoDerivatives, inventory = stores.videoDerivativeCacheEntries;
		check(asset && roots && payload && inventory, 'Actual culling native stores are missing.');
		const original: unknown = await request(asset.get(originalId)), rootRows: unknown[] = await request(roots.getAll(undefined, 2));
		const payloads: unknown[] = await request(payload.getAll(undefined, 5)), entries: unknown[] = await request(inventory.getAll(undefined, 5));
		check(rootRows.length === 1 && payloads.length === entries.length && entries.length <= 4, 'Culling fixture inventory is incomplete or exceeds its fixed workload.');
		return { original, roots: rootRows, payloads, inventory: entries };
	}); } finally { opened.close(); }
}
function database(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => { const opening = indexedDB.open(name);
		opening.addEventListener('upgradeneeded', () => opening.transaction?.abort(), { once: true }); opening.addEventListener('error', () => reject(opening.error), { once: true });
		opening.addEventListener('success', () => resolve(opening.result), { once: true }); });
}
async function hash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
