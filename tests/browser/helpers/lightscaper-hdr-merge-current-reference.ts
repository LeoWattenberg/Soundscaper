/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { request, transact } from '../../../src/common/editor/storage/indexeddb-backend.ts';
import { canonicalMediaContentBlob, digestMediaContent } from '../../../src/common/editor/storage/media-content-digest.ts';
import { PhotoMediaStoreV1 } from '../../../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { verifyPhotoResourcesCurrentV1 } from '../../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { createFramescaperProjectStore } from '../../../src/framescaper/editor-project-store.ts';
import { cloneFramescaperProject } from '../../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../../src/framescaper/editor-project-runtime-profile.ts';
import { FRAMESCAPER_PROJECT_STORAGE_PROFILE } from '../../../src/framescaper/editor-project-storage-profile.ts';
import { editorProjectStorageProfileNames } from '../../../src/common/editor/storage/project-storage-profile.ts';
import { framescaperImagePackSourceCurrentV1 } from '../../../src/common/editor/timeline-image-pack-source-current-v1.ts';
import { openFramescaperImageFramePackV1 } from '../../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { normalizeFramescaperImageSourceCurrentV1 } from '../../../src/common/editor/timeline-image-model-current-v1.ts';

const FRAME_DATABASE = editorProjectStorageProfileNames(FRAMESCAPER_PROJECT_STORAGE_PROFILE).databaseName;
const READ = Blob.prototype.arrayBuffer, SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;

/** Read only the selected native Photo namespace, complete bounded Originals
 * and immutable content tokens. This observer cannot publish or render. */
export async function readHdrMergePhotosCurrentV1(ids: readonly string[]) {
	check(ids.length >= 2 && ids.length <= 3 && new Set(ids).size === ids.length, 'HDR Photo witness requires its two inputs and optional result.');
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, syncWorkerClient: null });
	let media: PhotoMediaStoreV1 | undefined, catalog: PhotoCatalogRepositoryCurrentV1 | undefined;
	const owned: Uint8Array[] = [];
	const read = async () => {
		await anchor.ready(); const selected = await withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw new Error('HDR browser observation cannot create a library.'); } }));
		media = selected.location.mediaDatabaseName === 'lightscaper-photo-media-v2' ? anchor : new PhotoMediaStoreV1({
			indexedDB, locks: navigator.locks, databaseName: selected.location.mediaDatabaseName, syncWorkerClient: null });
		await media.ready(); const currentMedia = media;
		const verifyResources = (photo: unknown, signal?: AbortSignal) => verifyPhotoResourcesCurrentV1(photo, {
			cubeLutResources: () => currentMedia.getCubeLutResources(), maskRasterResources: () => currentMedia.getMaskRasterResources(),
		}, signal);
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB, databaseName: selected.location.catalogDatabaseName,
			verifyOriginal: currentMedia.verifyOriginal, verifyResources });
		const root = await catalog.loadCatalog(selected.location.catalogId); check(root, 'Selected HDR catalog is missing.');
		const photos = [];
		for (const id of ids) {
			const photo = await catalog.loadPhoto(root.id, id); check(photo, 'HDR browser Photo is missing.');
			check(photo.original.width === 32 && photo.original.height === 32 && photo.original.byteLength <= 65_536, 'HDR observer source exceeds its fixed 32×32 corpus.');
			await currentMedia.verifyOriginal(photo.original); await verifyResources(photo);
			const row = await nativeRow(selected.location.mediaDatabaseName, photo.original.storageKey), metadata = await media.mediaRepository.getAssetMetadata(photo.original.storageKey);
			const body = canonicalMediaContentBlob(await media.mediaRepository.loadAsset(photo.original.storageKey));
			check(Number(Reflect.apply(SIZE, body, [])) === photo.original.byteLength && await digestMediaContent(body) === photo.original.contentSha256, 'HDR Photo Original body differs.');
			const bytes = new Uint8Array(await Reflect.apply(READ, body, []) as ArrayBuffer); owned.push(bytes);
			check(typeof row.mediaContentToken === 'string' && row.sha256 === photo.original.contentSha256 && row.size === bytes.byteLength, 'HDR Photo immutable content authority differs.');
			const original = { sha256: hash(bytes), byteLength: bytes.byteLength, bytes: Array.from(bytes), row, metadata };
			const native = photo.original.mimeType === 'image/x-lightscaper-hdr' ? inspectHdr(bytes) : null;
			check(JSON.stringify(await nativeRow(selected.location.mediaDatabaseName, photo.original.storageKey)) === JSON.stringify(row)
				&& JSON.stringify(await media.mediaRepository.getAssetMetadata(photo.original.storageKey)) === JSON.stringify(metadata)
				&& JSON.stringify(await catalog.loadPhoto(root.id, id)) === JSON.stringify(photo), 'HDR Photo changed during observation.');
			photos.push({ photo, original, native });
		}
		check(JSON.stringify(await catalog.loadCatalog(root.id)) === JSON.stringify(root), 'HDR catalog changed during observation.');
		return { root, namespace: selected.location.namespaceToken, photos };
	};
	const outcome = await read().then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	const errors: unknown[] = outcome.ok ? [] : [outcome.error];
	try { for (const bytes of owned) bytes.fill(0); } catch (error) { errors.push(error); }
	const retired = await Promise.allSettled([...new Set([catalog, media, anchor])].filter(owner => owner !== undefined).map(owner => owner.close()));
	for (const result of retired) if (result.status === 'rejected') errors.push(result.reason as unknown);
	if (errors.length === 1) throw errors[0]; if (errors.length > 1) throw new AggregateError(errors, 'HDR Photo observation retirement failed.', { cause: errors[0] });
	if (outcome.ok) return outcome.value; throw new Error('HDR Photo observation has no outcome.');
}

/** Actual persisted project/pack custody only. Byte presentation is observed
 * separately from authenticated native HDR payload; neither one renders here. */
export async function readHdrMergeFrameCurrentV1(projectId: string) {
	const project = await frameProject(projectId), sources = project.sources.filter(source => source.kind === 'image').map(normalizeFramescaperImageSourceCurrentV1);
	check(sources.length >= 2 && sources.length <= 3 && sources.every(source => source.schemaVersion === 4 || source.schemaVersion === 5), 'HDR Frame witness requires only the two RAW brackets and optional native result.');
	const store = createFramescaperProjectStore(PROFILE, { indexedDB, locks: navigator.locks, syncWorkerClient: null }), owned: Uint8Array[] = [];
	const read = async () => {
		const images = [];
		for (const source of sources) {
			check(source.schemaVersion === 4 || source.schemaVersion === 5, 'HDR Frame source must retain its native RAW/HDR authority.');
			check(source.canonical.width === 32 && source.canonical.height === 32 && source.assetByteLength <= 131_072, 'HDR Frame observation exceeds its fixed 32×32 corpus.');
			const row = await nativeRow(FRAME_DATABASE, source.storageKey), metadata = await store.getMediaAssetMetadata(source.storageKey);
			const blob = canonicalMediaContentBlob(await store.loadMediaAsset(source.storageKey));
			check(await digestMediaContent(blob) === source.contentSha256 && Number(Reflect.apply(SIZE, blob, [])) === source.assetByteLength
				&& row.sha256 === source.contentSha256 && row.size === source.assetByteLength && typeof row.mediaContentToken === 'string', 'HDR Frame immutable pack authority differs.');
			const packed = new Uint8Array(await Reflect.apply(READ, blob, []) as ArrayBuffer); owned.push(packed);
			const reader = await openFramescaperImageFramePackV1({ source: framescaperImagePackSourceCurrentV1(source), read: (offset, length) => packed.slice(offset, offset + length) });
			const original = await reader.readOriginal(), cache = await reader.readFrame(0); owned.push(original, cache);
			check(hash(original) === source.original.sha256 && original.byteLength === source.original.byteLength && cache.byteLength === 4096, 'HDR Frame Original or presentation extent differs.');
			const native = source.schemaVersion === 5 ? inspectHdr(original) : null;
			if (source.schemaVersion === 5) {
				check(native && native.pixelsSha256 === source.hdr.pixelsSha256 && native.metadataSha256 === source.hdr.metadataSha256, 'HDR Source5 native receipt differs.');
				check(JSON.stringify(reader.receipt) === canonical({ schemaVersion: 1, kind: 'hdr-original', hdr: source.hdr }), 'HDR Source5 packed receipt differs.');
			}
			check(JSON.stringify(await nativeRow(FRAME_DATABASE, source.storageKey)) === JSON.stringify(row)
				&& JSON.stringify(await store.getMediaAssetMetadata(source.storageKey)) === JSON.stringify(metadata), 'HDR Frame content token changed during observation.');
			images.push({ source, row, metadata, original: { sha256: hash(original), byteLength: original.byteLength, bytes: Array.from(original) }, cache: Array.from(cache), native });
		}
		check(JSON.stringify(await frameProject(projectId)) === JSON.stringify(project), 'HDR Frame project changed during observation.');
		return { project, images };
	};
	const outcome = await read().then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	const errors: unknown[] = outcome.ok ? [] : [outcome.error];
	for (const retire of [() => { for (const bytes of owned) bytes.fill(0); }, () => store.close()]) { try { await retire(); } catch (error) { errors.push(error); } }
	if (errors.length === 1) throw errors[0]; if (errors.length > 1) throw new AggregateError(errors, 'HDR Frame observation retirement failed.', { cause: errors[0] });
	if (outcome.ok) return outcome.value; throw new Error('HDR Frame observation has no outcome.');
}

function inspectHdr(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	check(new TextDecoder().decode(bytes.subarray(0, 8)) === 'LSCHDRF1' && view.getUint32(8, true) === 64 && view.getUint32(12, true) === 1,
		'HDR result has an invalid fixed header.');
	const width = view.getUint32(16, true), height = view.getUint32(20, true), metadataBytes = view.getUint32(24, true), payloadBytes = view.getUint32(28, true);
	check(width === 32 && height === 32 && metadataBytes <= 16384 && payloadBytes === width * height * 12, 'HDR result extent exceeds the independent bounded parser.');
	const payloadOffset = Math.ceil((64 + metadataBytes) / 4) * 4; check(payloadOffset + payloadBytes === bytes.byteLength, 'HDR result body length differs.');
	const metadata = bytes.subarray(64, 64 + metadataBytes), metadataSha256 = hash(metadata), text = new TextDecoder().decode(metadata);
	check(bytesToHex(bytes.subarray(32, 64)) === metadataSha256, 'HDR result metadata hash differs.');
	const provenance: unknown = JSON.parse(text); check(canonical(provenance) === text, 'HDR result provenance must be exact canonical JSON.');
	for (let at = 64 + metadataBytes; at < payloadOffset; at++) check(bytes[at] === 0, 'HDR result alignment padding differs.');
	const values: number[] = [], bits: number[] = []; let maximum = 0;
	for (let index = 0; index < width * height * 3; index++) {
		const n = view.getFloat32(payloadOffset + index * 4, true); check(Number.isFinite(n), 'HDR result must retain finite native samples.');
		values.push(n); bits.push(view.getUint32(payloadOffset + index * 4, true)); maximum = Math.max(maximum, n);
	}
	return { width, height, provenance, values, bits, maximum, pixelsSha256: hash(bytes.subarray(payloadOffset)), metadataSha256 };
}
async function frameProject(projectId: string) {
	const database = await existing(FRAME_DATABASE);
	try { return await transact(database, ['projects'], 'readonly', async stores => {
		check(stores.projects, 'HDR native project store is missing.'); const project = cloneFramescaperProject(PROFILE, await request(stores.projects.get(projectId)));
		check(project.id === projectId, 'HDR native project identity differs.'); return project;
	}); } finally { database.close(); }
}
async function nativeRow(databaseName: string, sourceId: string): Promise<Readonly<Record<string, unknown>>> {
	const database = await existing(databaseName);
	try { return await transact(database, ['mediaAssets'], 'readonly', async stores => {
		check(stores.mediaAssets, 'HDR native media store is missing.'); const row: unknown = await request(stores.mediaAssets.get(sourceId));
		check(row && typeof row === 'object' && !Array.isArray(row), 'HDR native immutable row is missing.');
		const { blob: ignored, ...scalar } = row as Record<string, unknown>; void ignored; return scalar;
	}); } finally { database.close(); }
}
function existing(name: string): Promise<IDBDatabase> { return new Promise((resolve, reject) => {
	const opening = indexedDB.open(name); opening.addEventListener('upgradeneeded', () => opening.transaction?.abort(), { once: true });
	opening.addEventListener('error', () => reject(opening.error), { once: true }); opening.addEventListener('success', () => resolve(opening.result), { once: true });
}); }
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`).join(',')}}`;
	const result = JSON.stringify(value); if (result === undefined) throw new TypeError('HDR provenance is not closed JSON.'); return result;
}
function hash(bytes: Uint8Array): string { return bytesToHex(sha256(bytes)); }
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
