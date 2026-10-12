/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainArray } from '../../../src/common/editor/closed-domain-value.ts';
import { request, transact } from '../../../src/common/editor/storage/indexeddb-backend.ts';
import { canonicalMediaContentBlob, digestMediaContent } from '../../../src/common/editor/storage/media-content-digest.ts';
import { normalizeCatalogOriginalRoot } from '../../../src/common/editor/storage/media-catalog-original-schema.ts';
import { openFramescaperImageFramePackV1 } from '../../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { normalizeFramescaperImageSourceCurrentV1, framescaperImageSourceResourceReferencesCurrentV1 } from '../../../src/common/editor/timeline-image-model-current-v1.ts';
import { createFramescaperProjectStore } from '../../../src/framescaper/editor-project-store.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../../src/framescaper/editor-project-runtime-profile.ts';
import { FRAMESCAPER_PROJECT_STORAGE_PROFILE } from '../../../src/framescaper/editor-project-storage-profile.ts';
import { editorProjectStorageProfileNames } from '../../../src/common/editor/storage/project-storage-profile.ts';
import { collectFramescaperImageProjectResourcesCurrentV1 } from '../../../src/common/editor/video-cube-lut-project-references-current-v1.ts';
import { cloneFramescaperProject } from '../../../src/framescaper/editor-project.ts';
import { openFramescaperCurrentImageFrameSource } from '../../../src/framescaper/timeline-image-current-frame-source.ts';
import { createFramescaperCubeLutSourceFinishing } from '../../../src/framescaper/cube-lut-source-finishing.ts';
import { createFramescaperMaskRasterSourceTimelineImageV1 } from '../../../src/framescaper/timeline-image-mask-raster-source-v1.ts';
import { PhotoMediaStoreV1 } from '../../../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2 } from '../../../src/lightscaper/storage/photo-library-location-v2.ts';
import { photoStorageKey } from '../../../src/lightscaper/catalog/repository-records.ts';
import { readStoredPhotoCurrentV1 } from '../../../src/lightscaper/catalog/photo-catalog-records-current-v1.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../../../src/lightscaper/catalog/photo-resource-reachability-current-v1.ts';
import { normalizeBrushMaskResourceReferenceV1 } from '../../../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { verifyPhotoResourceReferencesCurrentV1 } from '../../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { validatePhotoDevelopProxyCustodyV1 } from '../../helpers/lightscaper-develop-proxy-native-observer.ts';

const READ = Blob.prototype.arrayBuffer, SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const TYPE = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')!.get!, FILL = Uint8Array.prototype.fill;
const BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'buffer')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'byteLength')!.get!;
const BACKING_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const MAXIMUM_OBSERVED_BYTES = 4096;

/** Poll the actual committed project row while native Save/preview owns its
 * bodies. No media owner, Original snapshot, renderer or publisher is opened. */
export async function readRepairFrameProjectScalarNativeV1(projectId: string) {
	identity(projectId);
	const databaseName = editorProjectStorageProfileNames(FRAMESCAPER_PROJECT_STORAGE_PROFILE).databaseName;
	const database = await openExisting(databaseName);
	try {
		const project = await transact(database, ['projects'], 'readonly', async stores => {
			const store = stores.projects; check(store !== undefined, 'Actual Frame project store is missing.');
			const value: unknown = await request(store.get(projectId));
			return cloneFramescaperProject(PROFILE, value);
		});
		check(project.id === projectId, 'Frame scalar observer project identity changed.');
		const images = project.sources.filter(source => source.kind === 'image');
		check(images.length === 1, 'Frame scalar fixture needs exactly one image source.');
		const source = normalizeFramescaperImageSourceCurrentV1(images[0]);
		check(source.schemaVersion === 3, 'Frame scalar fixture must retain Source3.');
		return { databaseName, project, source, revision: project.revision };
	} finally { database.close(); }
}

/** Observe the actual separate-origin Frame application's existing database.
 * No importer, command, publisher, chosen-library initializer or body writer
 * participates. Complete Source3 metadata precedes every declared body read. */
export async function readRepairFrameProjectNativeV1(projectId: string) {
	identity(projectId);
	const databaseName = editorProjectStorageProfileNames(FRAMESCAPER_PROJECT_STORAGE_PROFILE).databaseName;
	const existing = await openExisting(databaseName); existing.close();
	const store = createFramescaperProjectStore(PROFILE, { indexedDB, locks: navigator.locks, syncWorkerClient: null });
	const loadProject = store.loadProject.bind(store), loadMediaAsset = store.loadMediaAsset.bind(store), metadata = store.getMediaAssetMetadata.bind(store);
	const lut = createFramescaperCubeLutSourceFinishing({ loadMediaAsset }), mask = createFramescaperMaskRasterSourceTimelineImageV1({ loadMediaAsset });
	let reader: Awaited<ReturnType<typeof openFramescaperCurrentImageFrameSource>> | undefined;
	return joined(async () => {
		const project = cloneFramescaperProject(PROFILE, await loadProject(projectId));
		check(project.id === projectId, 'Frame observer project identity changed.');
		const images = project.sources.filter(source => source.kind === 'image');
		check(images.length === 1, 'Frame fixture needs exactly one actual image source.');
		const source = normalizeFramescaperImageSourceCurrentV1(images[0]);
		check(source.schemaVersion === 3, 'Actual editable Frame fixture must retain Source3.');
		check(source.canonical.width === 10 && source.canonical.height === 5 && source.original.recognizedFormat === 'png', 'Frame fixture must retain the real 10 by 5 Original PNG.');
		check(source.developed.width === 2 && source.developed.height === 1, 'Frame fixture natural output must be two by one.');
		check(source.original.byteLength <= MAXIMUM_OBSERVED_BYTES && source.assetByteLength <= 65536, 'Frame fixture encoded bodies exceed observation bounds.');
		const resources = collectFramescaperImageProjectResourcesCurrentV1(project); boundResources(resources);
		const keys = [source.storageKey, ...resources.luts.map(ref => ref.storageKey), ...resources.brushes.map(ref => ref.storageKey)];
		const initial = await nativeRecords(databaseName, keys), tokens = await Promise.all(keys.map(async key => ({ key, metadata: await metadata(key), record: initial.get(key)! })));
		for (const reference of [{ storageKey: source.storageKey, sha256: source.contentSha256, byteLength: source.assetByteLength }, ...resources.luts, ...resources.brushes]) {
			const row = initial.get(reference.storageKey)!;
			check(row.sourceId === reference.storageKey && row.sha256 === reference.sha256 && row.size === reference.byteLength, 'Frame native asset row differs from its complete resource identity.');
		}
		const luts = [], bodies = [];
		for (const reference of resources.luts) luts.push(await lut.withBytes(reference, bytes => ({ reference, bytes: Array.from(bytes) })));
		for (const reference of resources.brushes) bodies.push(await mask.withBytes(reference, bytes => ({ reference, bytes: Array.from(bytes) })));
		const blob = canonicalMediaContentBlob(await loadMediaAsset(source.storageKey));
		check(Number(Reflect.apply(SIZE, blob, [])) === source.assetByteLength && await digestMediaContent(blob) === source.contentSha256, 'Frame immutable pack native body differs.');
		const backing = await Reflect.apply(READ, blob, []) as ArrayBuffer, bytes = new Uint8Array(backing);
		let original: { sha256: string; byteLength: number; bytes: number[] };
		try {
			const { develop: _develop, developed: _developed, provenance: _provenance, ...packFields } = source;
			const pack = await openFramescaperImageFramePackV1({ source: { ...packFields, schemaVersion: 1 }, read: (offset, length) => bytes.slice(offset, offset + length) });
			const encoded = await pack.readOriginal(), originalBacking = nativeBacking(encoded);
			try { check(encoded.byteLength === source.original.byteLength && hash(encoded) === source.original.sha256, 'Frame retained Original encoded bytes differ.');
				original = { sha256: hash(encoded), byteLength: encoded.byteLength, bytes: Array.from(encoded) }; }
			finally { wipe(originalBacking); }
		} finally { wipe(backing); }
		reader = await openFramescaperCurrentImageFrameSource({ loadMediaAsset }, source);
		const frame = await reader.readFrame(0), frameBacking = nativeBacking(frame);
		let pixels: number[];
		try { check(frame.byteLength === 8, 'Actual Current Frame renderer must produce eight natural RGBA bytes.'); pixels = Array.from(frame); }
		finally { wipe(frameBacking); }
		check(JSON.stringify(cloneFramescaperProject(PROFILE, await loadProject(projectId))) === JSON.stringify(project), 'Frame project/source changed during body observation.');
		check(equalRecords(await nativeRecords(databaseName, keys), initial), 'Frame native content tokens changed during observation.');
		for (const token of tokens) check(JSON.stringify(await metadata(token.key)) === JSON.stringify(token.metadata), 'Frame native public metadata changed during observation.');
		return { databaseName, project, source, original, pixels, resources, luts, bodies, tokens };
	}, [() => reader?.closeAndJoin(), () => lut.close(), () => mask.close(), () => store.close()]);
}

/** Native committed row polling has no Original snapshot or renderer demand. */
export async function readRepairFramePhotosNativeV1(ids: readonly string[]) {
	const photoIds = admittedIds(ids), anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, preferOpfs: false, syncWorkerClient: null });
	return joined(async () => {
		const selected = await selectedLocation(anchor), photos = await nativePhotos(selected.location.catalogDatabaseName, selected.location.catalogId, photoIds);
		check(JSON.stringify((await selectedLocation(anchor)).pointer) === JSON.stringify(selected.pointer), 'Frame Photo poll selected namespace changed.');
		return { namespace: selected.location.namespaceToken, photos: photos.map(photo => ({ photo })) };
	}, [() => anchor.close()]);
}

/** Three actual Photo roots may share two physical Originals. Authenticate
 * each complete retained recipe/root and real media row, never a guessed
 * unique-asset count or a reconstructed legacy Photo. */
export async function readRepairFramePhotoCustodyNativeV1(ids: readonly string[], beforeClose?: () => Promise<void>) {
	const photoIds = admittedIds(ids), anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, preferOpfs: false, syncWorkerClient: null });
	let media: PhotoMediaStoreV1 | undefined;
	return joined(async () => {
		const selected = await selectedLocation(anchor), { catalogId, catalogDatabaseName, mediaDatabaseName } = selected.location;
		const saved = await nativePhotos(catalogDatabaseName, catalogId, photoIds), collector = createPhotoResourceReachabilityCurrentV1();
		for (const photo of saved) { collector.addPhoto(photo);
			for (const version of photo.versions) for (const develop of [version.develop, ...(version.workspace?.entries.map(entry => entry.develop) ?? []), ...(version.workspace?.snapshots.map(snapshot => snapshot.develop) ?? [])]) {
				for (const graph of develop.masks) for (const input of graph.inputs) normalizeBrushMaskResourceReferenceV1(input.sourceRef);
			} }
		const references = collector.finish(); boundResources(references);
		for (const photo of saved) check(photo.original.byteLength <= MAXIMUM_OBSERVED_BYTES, 'Frame Photo Original exceeds observation bounds.');
		media = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, databaseName: mediaDatabaseName, syncWorkerClient: null });
		// Raw existing database admission precedes the read owner; ready's startup
		// reconciliation is intentionally not invoked by this observation.
		const existing = await openExisting(mediaDatabaseName); existing.close();
		const selectedMedia = media, getMetadata = selectedMedia.mediaRepository.getAssetMetadata.bind(selectedMedia.mediaRepository), load = selectedMedia.mediaRepository.loadAsset.bind(selectedMedia.mediaRepository);
		const initialCustody = await nativeCustody(mediaDatabaseName, photoIds.length), roots = initialCustody.roots;
		check(roots.length === photoIds.length && roots.every(root => root.catalogId === catalogId && root.importId === null && photoIds.includes(root.photoId)), 'Actual complete Frame Photo custody inventory differs.');
		const page = await selectedMedia.mediaRepository.catalogOriginals.readPage({ catalogId });
		const publicRoots = page.roots.map(normalizeCatalogOriginalRoot);
		check(page.afterKey === null && JSON.stringify(publicRoots) === JSON.stringify(roots), 'Frame native/public Original roots differ.');
		await verifyPhotoResourceReferencesCurrentV1(references, { cubeLutResources: () => selectedMedia.getCubeLutResources(), maskRasterResources: () => selectedMedia.getMaskRasterResources() });
		const keys = [...new Set(saved.map(photo => photo.original.storageKey))];
		const resourceKeys = [...references.luts, ...references.brushes].map(ref => ref.storageKey);
		const records = await nativeRecords(mediaDatabaseName, keys), resourceRecords = await nativeAnalysisRecords(mediaDatabaseName, resourceKeys), photos = [];
		for (const photo of saved) {
			await selectedMedia.verifyOriginal(photo.original);
			const metadata = await getMetadata(photo.original.storageKey); check(metadata !== null, 'Frame Photo Original native metadata is missing.');
			const body = canonicalMediaContentBlob(await load(photo.original.storageKey)), backing = await Reflect.apply(READ, body, []) as ArrayBuffer;
			try { const bytes = new Uint8Array(backing), original = validatePhotoDevelopProxyCustodyV1(photo, metadata, records.get(photo.original.storageKey),
				roots.filter(root => root.photoId === photo.id), { roots: publicRoots.filter(root => root.photoId === photo.id), afterKey: null }, hash(bytes), bytes.byteLength);
				photos.push({ photo, original, bytes: Array.from(bytes) }); }
			finally { wipe(backing); }
		}
		const cubes = await selectedMedia.getCubeLutResources(), masks = await selectedMedia.getMaskRasterResources(), luts = [], bodies = [];
		for (const reference of references.luts) luts.push(await cubes.source.withBytes(reference, bytes => ({ reference, bytes: Array.from(bytes) })));
		for (const reference of references.brushes) bodies.push(await masks.source.withBytes(reference, bytes => ({ reference, bytes: Array.from(bytes) })));
		await beforeClose?.();
		check(JSON.stringify(await nativePhotos(catalogDatabaseName, catalogId, photoIds)) === JSON.stringify(saved), 'Complete Current Photos changed during native observation.');
		check(JSON.stringify((await nativeCustody(mediaDatabaseName, photoIds.length)).roots) === JSON.stringify(roots), 'Native Original custody changed during observation.');
		check(equalRecords(await nativeRecords(mediaDatabaseName, keys), records), 'Native Photo/resource content tokens changed during observation.');
		check(equalRecords(await nativeAnalysisRecords(mediaDatabaseName, resourceKeys), resourceRecords), 'Native selected LUT/SCMASK rows changed during observation.');
		check(JSON.stringify((await selectedLocation(anchor)).pointer) === JSON.stringify(selected.pointer), 'Frame Photo observer selected namespace changed.');
		return { namespace: selected.location.namespaceToken, photos, bodies, luts, resources: references, resourceRecords: [...resourceRecords] };
	}, [() => media?.close(), () => anchor.close()]);
}

async function selectedLocation(anchor: PhotoMediaStoreV1) {
	const existing = await openExisting(PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2); existing.close();
	return withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
		initializeDefault: async () => { throw Error('Frame observer cannot initialize a chosen library.'); } }));
}
async function nativePhotos(databaseName: string, catalogId: string, ids: readonly string[]) {
	const database = await openExisting(databaseName);
	try { return await transact(database, ['photos'], 'readonly', async stores => {
		const store = stores.photos; check(store !== undefined, 'Native Current Photo store is missing.');
		return await Promise.all(ids.map(async id => { const key = photoStorageKey(catalogId, id); return readStoredPhotoCurrentV1(await request(store.get(key)), key); }));
	}); } finally { database.close(); }
}
async function nativeCustody(databaseName: string, count: number) {
	const database = await openExisting(databaseName);
	try { return await transact(database, ['catalogOriginalRoots'], 'readonly', async stores => {
		const store = stores.catalogOriginalRoots; check(store !== undefined, 'Native Original root store is missing.');
		const rows: unknown[] = await request(store.getAll(undefined, count + 1)); return { roots: rows.map(normalizeCatalogOriginalRoot) };
	}); } finally { database.close(); }
}
async function nativeRecords(databaseName: string, keys: readonly string[]) {
	const database = await openExisting(databaseName);
	try { return await transact(database, ['mediaAssets'], 'readonly', async stores => {
		const store = stores.mediaAssets; check(store !== undefined, 'Native media asset store is missing.');
		const rows = new Map<string, Record<string, unknown>>();
		for (const key of keys) { const value: unknown = await request(store.get(key)); check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Native media asset row is missing.');
			const row = value as Record<string, unknown>; check(typeof row.mediaContentToken === 'string' && row.mediaContentDigestVersion === 1, 'Native verified media content token is missing.');
			const scalar = { ...row };
			if (Object.hasOwn(scalar, 'blob') && scalar.blob !== null && scalar.blob !== undefined) {
				scalar.blob = { size: Number(Reflect.apply(SIZE, scalar.blob, [])), type: Reflect.apply(TYPE, scalar.blob, []) as string };
			}
			rows.set(key, scalar); }
		return rows;
	}); } finally { database.close(); }
}
async function nativeAnalysisRecords(databaseName: string, keys: readonly string[]) {
	const database = await openExisting(databaseName);
	try { return await transact(database, ['analysis'], 'readonly', async stores => {
		const store = stores.analysis; check(store !== undefined, 'Native selected resource store is missing.');
		const rows = new Map<string, Record<string, unknown>>();
		for (const key of keys) {
			const raw: unknown = await request(store.get(key)); check(raw !== null && typeof raw === 'object', 'Native selected immutable resource row is missing.');
			const row = raw as Record<string, unknown>; check(row.key === key && row.value !== null && typeof row.value === 'object', 'Native selected resource wrapper differs from its key.');
			const value = row.value as Record<string, unknown>, bytes = value.bytes as Uint8Array;
			const length = Number(Reflect.apply(LENGTH, bytes, [])), backing = nativeBacking(bytes);
			try { check(length >= 1 && length <= MAXIMUM_OBSERVED_BYTES, 'Native selected resource row exceeds the observation bound.');
				const { bytes: _bytes, ...metadata } = value; rows.set(key, { key, value: metadata, byteLength: length, sha256: hash(bytes) }); }
			finally { wipe(backing); }
		}
		return rows;
	}); } finally { database.close(); }
}
function openExisting(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const opening = indexedDB.open(name);
		opening.addEventListener('upgradeneeded', () => opening.transaction?.abort(), { once: true });
		opening.addEventListener('error', () => reject(opening.error), { once: true });
		opening.addEventListener('success', () => resolve(opening.result), { once: true });
	});
}
function admittedIds(value: readonly string[]): readonly string[] {
	const ids = readClosedDomainArray(value, 'Frame native Photo observer identities', 1, 3).map(identity);
	check(new Set(ids).size === ids.length, 'Frame Photo observer IDs must be distinct.'); return Object.freeze(ids);
}
function identity(value: unknown): string { check(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value), 'Frame observer needs a bounded existing identity.'); return value; }
function boundResources(value: ReturnType<typeof framescaperImageSourceResourceReferencesCurrentV1>): void {
	check(value.luts.length + value.brushes.length <= 32 && [...value.luts, ...value.brushes].every(ref => ref.byteLength <= MAXIMUM_OBSERVED_BYTES), 'Frame fixture resources exceed small native observation bounds.');
}
function hash(bytes: Uint8Array): string { return bytesToHex(sha256(bytes)); }
function nativeBacking(bytes: Uint8Array): ArrayBuffer { return Reflect.apply(BUFFER, bytes, []) as ArrayBuffer; }
function wipe(backing: ArrayBuffer): void { if (Number(Reflect.apply(BACKING_SIZE, backing, [])) !== 0) Reflect.apply(FILL, new Uint8Array(backing), [0]); }
function equalRecords(left: ReadonlyMap<string, Record<string, unknown>>, right: ReadonlyMap<string, Record<string, unknown>>): boolean {
	return left.size === right.size && [...left].every(([key, value]) => JSON.stringify(value) === JSON.stringify(right.get(key)));
}
async function joined<Result>(run: () => Promise<Result>, cleanup: readonly (() => void | Promise<void>)[]): Promise<Result> {
	let result: Result | undefined, failed = false, primary: unknown;
	try { result = await run(); } catch (error) { failed = true; primary = error; }
	const failures: unknown[] = failed ? [primary] : [];
	for (const close of cleanup) try { await close(); } catch (error) { if (!failures.some(value => Object.is(value, error))) failures.push(error); }
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Native Frame observation and joined retirement failed.', { cause: failures[0] });
	check(result !== undefined, 'Native Frame observation did not produce scalar facts.'); return result;
}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }
