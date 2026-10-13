/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainArray } from '../../../src/common/editor/closed-domain-value.ts';
import { request, transact } from '../../../src/common/editor/storage/indexeddb-backend.ts';
import { canonicalMediaContentBlob, digestMediaContent } from '../../../src/common/editor/storage/media-content-digest.ts';
import { openFramescaperImageFramePackV1 } from '../../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { normalizeFramescaperImageSourceCurrentV1 } from '../../../src/common/editor/timeline-image-model-current-v1.ts';
import { collectFramescaperImageProjectResourcesCurrentV1 } from '../../../src/common/editor/video-cube-lut-project-references-current-v1.ts';
import { editorProjectStorageProfileNames } from '../../../src/common/editor/storage/project-storage-profile.ts';
import { createFramescaperProjectStore } from '../../../src/framescaper/editor-project-store.ts';
import { cloneFramescaperProject } from '../../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../../src/framescaper/editor-project-runtime-profile.ts';
import { FRAMESCAPER_PROJECT_STORAGE_PROFILE } from '../../../src/framescaper/editor-project-storage-profile.ts';
import { openFramescaperCurrentImageFrameSource } from '../../../src/framescaper/timeline-image-current-frame-source.ts';
import { createFramescaperCubeLutSourceFinishing } from '../../../src/framescaper/cube-lut-source-finishing.ts';
import { createFramescaperMaskRasterSourceTimelineImageV1 } from '../../../src/framescaper/timeline-image-mask-raster-source-v1.ts';
import { PhotoMediaStoreV1 } from '../../../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2 } from '../../../src/lightscaper/storage/photo-library-location-v2.ts';
import { readValidatedPhotoCatalogRootV1 } from '../../../src/lightscaper/catalog/documents.ts';
import { readIndexState } from '../../../src/lightscaper/catalog/repository-records.ts';
import { normalizeOpfsWorkerPath } from '../../../src/common/editor/storage/opfs-sync-worker-protocol.ts';
import { readPhotoSmartCollectionRecordV1 } from '../../../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { readRepairFramePhotoCustodyNativeV1 } from './lightscaper-repair-frame-current-reference.ts';

const READ = Blob.prototype.arrayBuffer, SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const TYPE = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')!.get!, FILL = Uint8Array.prototype.fill;
const BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'buffer')!.get!;
const MAXIMUM_BODY = 4096, MAXIMUM_PACK = 65536;

/** Existing selected native rows and complete Current custody only. No chosen
 * library, Photo, definition, body or capability is created or published. */
export async function readRepairSequenceSenderNativeV1(ids: readonly string[], beforeClose?: () => Promise<void>) {
	const photoIds = readClosedDomainArray(ids, 'Sequence sender Photos', 1, 3).map(identity);
	check(new Set(photoIds).size === photoIds.length, 'Sequence sender IDs must be distinct.');
	const existing = await openExisting(PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2); existing.close();
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, preferOpfs: false, syncWorkerClient: null });
	return joined(async () => {
		const locate = () => withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw Error('Sequence observer cannot initialize a selected library.'); } }));
		const selected = await locate(), initial = await catalogFacts(selected.location.catalogDatabaseName, selected.location.catalogId);
		const custody = await readRepairFramePhotoCustodyNativeV1(photoIds, beforeClose);
		check(custody.namespace === selected.location.namespaceToken && custody.photos.every(value => value.photo.catalogId === selected.location.catalogId), 'Sequence sender namespace changed.');
		check(JSON.stringify(await catalogFacts(selected.location.catalogDatabaseName, selected.location.catalogId)) === JSON.stringify(initial), 'Sequence native catalog/definitions changed during observation.');
		check(JSON.stringify((await locate()).pointer) === JSON.stringify(selected.pointer), 'Sequence selected pointer changed.');
		return { ...custody, ...initial };
	}, [() => anchor.close()]);
}

/** Scalar committed-ACK polling cannot acquire an Original or media snapshot. */
export async function readRepairSequenceFrameScalarNativeV1(projectId: string) {
	identity(projectId); const databaseName = editorProjectStorageProfileNames(FRAMESCAPER_PROJECT_STORAGE_PROFILE).databaseName;
	const database = await openExisting(databaseName);
	try { const project = await transact(database, 'projects', 'readonly', async stores => {
		check(stores.projects !== undefined, 'Native Frame project store is missing.'); return cloneFramescaperProject(PROFILE, await request(stores.projects.get(projectId)));
	}); check(project.id === projectId, 'Sequence native project ID changed.');
		return { databaseName, project, sources: imageSources(project), revision: project.revision };
	} finally { database.close(); }
}

/** Failure-only physical observation bypasses worker snapshots. It neither
 * opens a media owner nor creates a directory/file or authorizes publication. */
export async function readRepairSequenceFrameFilesNativeV1(projectId: string) {
	const names = editorProjectStorageProfileNames(FRAMESCAPER_PROJECT_STORAGE_PROFILE), getRoot = navigator.storage.getDirectory.bind(navigator.storage);
	const scalar = await readRepairSequenceFrameScalarNativeV1(projectId), refs = collectFramescaperImageProjectResourcesCurrentV1(scalar.project);
	const keys = [...new Set([...scalar.sources.map(source => source.storageKey), ...refs.luts.map(ref => ref.storageKey), ...refs.brushes.map(ref => ref.storageKey)])];
	check(keys.length <= 8, 'Sequence physical diagnostic inventory is bounded.');
	const rows = await nativeRecords(names.databaseName, keys), root = await getRoot(), getDirectory = root.getDirectoryHandle.bind(root);
	const directory = await getDirectory(names.opfsDirectoryName, { create: false }), getHandle = directory.getFileHandle.bind(directory), files = [];
	for (const [key, row] of rows) {
		if (row.storage !== 'opfs') { files.push({ key, storage: row.storage, physical: false }); continue; }
		const path = normalizeOpfsWorkerPath(row.path);
		try {
			const handle = await getHandle(path, { create: false }), getFile = handle.getFile.bind(handle), file = await getFile();
			const size = Number(Reflect.apply(SIZE, file, [])); check(size <= MAXIMUM_PACK, 'Sequence physical diagnostic body exceeds its bound.');
			const backing = await Reflect.apply(READ, file, []) as ArrayBuffer;
			try { files.push({ key, path, size, sha256: hash(new Uint8Array(backing)), expectedSize: row.size, expectedSha256: row.sha256 }); }
			finally { wipe(backing); }
		} catch (error) { files.push({ key, path, failure: diagnosticError(error) }); }
	}
	const finalRows = await nativeRecords(names.databaseName, keys), finalScalar = await readRepairSequenceFrameScalarNativeV1(projectId);
	return { directory: names.opfsDirectoryName, revision: scalar.revision, finalRevision: finalScalar.revision,
		rows: [...rows], finalRows: [...finalRows], files, projectUnchanged: JSON.stringify(finalScalar.project) === JSON.stringify(scalar.project) };
}

/** Read the actual separate-origin Frame application's complete stored project
 * and up to four editable image sources. All declared bodies are authenticated
 * before natural rendering; native metadata tokens and the entire project are
 * re-read before joined Close. There is no importer or publication callback. */
export async function readRepairSequenceFrameNativeV1(projectId: string) {
	identity(projectId); const databaseName = editorProjectStorageProfileNames(FRAMESCAPER_PROJECT_STORAGE_PROFILE).databaseName;
	const existing = await openExisting(databaseName); existing.close();
	const store = createFramescaperProjectStore(PROFILE, { indexedDB, locks: navigator.locks, syncWorkerClient: null });
	const loadProject = store.loadProject.bind(store), loadMediaAsset = store.loadMediaAsset.bind(store), metadata = store.getMediaAssetMetadata.bind(store);
	const lut = createFramescaperCubeLutSourceFinishing({ loadMediaAsset }), mask = createFramescaperMaskRasterSourceTimelineImageV1({ loadMediaAsset });
	const readers: Awaited<ReturnType<typeof openFramescaperCurrentImageFrameSource>>[] = [];
	return joined(async () => {
		const project = cloneFramescaperProject(PROFILE, await loadProject(projectId)); check(project.id === projectId, 'Sequence Frame project identity changed.');
		const sources = imageSources(project), resources = collectFramescaperImageProjectResourcesCurrentV1(project);
		check(resources.luts.length + resources.brushes.length <= 4 && [...resources.luts, ...resources.brushes].every(ref => ref.byteLength <= MAXIMUM_BODY), 'Sequence resources exceed observation bounds.');
		const references = [...sources.map(source => ({ storageKey: source.storageKey, sha256: source.contentSha256, byteLength: source.assetByteLength })), ...resources.luts, ...resources.brushes];
		const keys = [...new Set(references.map(ref => ref.storageKey))]; check(keys.length <= 8, 'Sequence native token inventory exceeds its observation bound.');
		const records = await nativeRecords(databaseName, keys), tokens = await Promise.all(keys.map(async key => ({ key, record: records.get(key)!, metadata: await metadata(key) })));
		for (const ref of references) { const row = records.get(ref.storageKey)!;
			check(row.sourceId === ref.storageKey && row.sha256 === ref.sha256 && row.size === ref.byteLength, 'Sequence actual native resource identity differs.'); }
		const luts = [], bodies = [];
		for (const reference of resources.luts) luts.push(await lut.withBytes(reference, bytes => ({ reference, bytes: Array.from(bytes) })));
		for (const reference of resources.brushes) bodies.push(await mask.withBytes(reference, bytes => ({ reference, bytes: Array.from(bytes) })));
		const images = [];
		for (const source of sources) {
			const blob = canonicalMediaContentBlob(await loadMediaAsset(source.storageKey));
			check(Number(Reflect.apply(SIZE, blob, [])) === source.assetByteLength && await digestMediaContent(blob) === source.contentSha256, 'Sequence native immutable pack differs.');
			const backing = await Reflect.apply(READ, blob, []) as ArrayBuffer, bytes = new Uint8Array(backing);
			let original: { sha256: string; byteLength: number; bytes: number[] };
			try {
				// The pack-only view retains the actual immutable wire facts. The
				// complete Source2/3 and Current recipe remain unchanged above.
				const { develop: _develop, developed: _developed, provenance: _provenance, ...fields } = source;
				const pack = await openFramescaperImageFramePackV1({ source: { ...fields, schemaVersion: 1 }, read: (offset, length) => bytes.slice(offset, offset + length) });
				const encoded = await pack.readOriginal(), encodedBacking = nativeBacking(encoded);
				try { check(encoded.byteLength === source.original.byteLength && hash(encoded) === source.original.sha256, 'Sequence retained encoded Original differs.');
					original = { sha256: hash(encoded), byteLength: encoded.byteLength, bytes: Array.from(encoded) }; }
				finally { wipe(encodedBacking); }
			} finally { wipe(backing); }
			const reader = await openFramescaperCurrentImageFrameSource({ loadMediaAsset }, source); readers.push(reader);
			const frame = await reader.readFrame(0), frameBacking = nativeBacking(frame);
			let pixels: number[];
			try { check(frame.byteLength === source.developed.width * source.developed.height * 4 && frame.byteLength <= MAXIMUM_BODY, 'Sequence natural pixels exceed their exact observation bound.'); pixels = Array.from(frame); }
			finally { wipe(frameBacking); }
			await reader.closeAndJoin();
			images.push({ source, original, width: source.developed.width, height: source.developed.height, pixels });
		}
		check(JSON.stringify(cloneFramescaperProject(PROFILE, await loadProject(projectId))) === JSON.stringify(project), 'Sequence full project changed during observation.');
		check(JSON.stringify([...await nativeRecords(databaseName, keys)]) === JSON.stringify([...records]), 'Sequence native body tokens changed.');
		for (const token of tokens) check(JSON.stringify(await metadata(token.key)) === JSON.stringify(token.metadata), 'Sequence public native metadata changed.');
		return { databaseName, project, images, resources, luts, bodies, tokens };
	}, [async () => { const failures: unknown[] = []; for (const reader of readers) try { await reader.closeAndJoin(); } catch (error) { failures.push(error); }
		if (failures.length === 1) throw failures[0]; if (failures.length) throw new AggregateError(failures, 'Sequence readers failed to close.'); }, () => lut.close(), () => mask.close(), () => store.close()]);
}

function imageSources(project: ReturnType<typeof cloneFramescaperProject>) {
	const images = project.sources.filter(source => source.kind === 'image'); check(images.length >= 1 && images.length <= 4, 'Sequence observer requires one to four actual image sources.');
	return images.map(value => { const source = normalizeFramescaperImageSourceCurrentV1(value);
		check(source.schemaVersion !== 1, 'Sequence fixture requires editable Source2/3.');
		check(source.canonical.frameCount === 1 && source.canonical.width === 10 && source.canonical.height === 5 && source.original.recognizedFormat === 'png', 'Sequence fixture requires actual single-frame ten by five PNG Originals.');
		check(source.original.byteLength <= MAXIMUM_BODY && source.assetByteLength <= MAXIMUM_PACK
			&& source.developed.width * source.developed.height * 4 <= MAXIMUM_BODY, 'Sequence fixture exceeds body/pixel observation bounds.'); return source;
	});
}
async function catalogFacts(databaseName: string, catalogId: string) {
	const database = await openExisting(databaseName);
	try { return await transact(database, ['catalogs', 'catalogStates', 'photoSmartCollections'], 'readonly', async stores => {
		check(stores.catalogs !== undefined && stores.catalogStates !== undefined && stores.photoSmartCollections !== undefined, 'Sequence native catalog stores are missing.');
		const root = readValidatedPhotoCatalogRootV1(await request(stores.catalogs.get(catalogId))); check(root.id === catalogId, 'Sequence native catalog identity differs.');
		const index = readIndexState(await request(stores.catalogStates.get(catalogId)));
		check(index.id === catalogId && index.rootRevision === root.revision && index.photoCount === root.photoCount, 'Sequence actual root/index facts disagree.');
		const records: unknown[] = await request(stores.photoSmartCollections.getAll(undefined, 5)); check(records.length <= 4, 'Sequence saved-filter observer is bounded.');
		const saved = records.map(value => { check(value !== null && typeof value === 'object', 'Sequence native saved definition is missing.');
			return readPhotoSmartCollectionRecordV1(value, catalogId, (value as { key: string }).key); });
		return { root, index, saved };
	}); } finally { database.close(); }
}
async function nativeRecords(databaseName: string, keys: readonly string[]) {
	const database = await openExisting(databaseName);
	try { return await transact(database, 'mediaAssets', 'readonly', async stores => {
		check(stores.mediaAssets !== undefined, 'Sequence actual native media store is missing.'); const records = new Map<string, Record<string, unknown>>();
		for (const key of keys) { const value: unknown = await request(stores.mediaAssets.get(key)); check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Sequence native body row is missing.');
			const row = { ...value } as Record<string, unknown>; check(typeof row.mediaContentToken === 'string' && row.mediaContentDigestVersion === 1, 'Sequence native verified content token is missing.');
			if (Object.hasOwn(row, 'blob') && row.blob !== null && row.blob !== undefined) row.blob = { size: Number(Reflect.apply(SIZE, row.blob, [])), type: Reflect.apply(TYPE, row.blob, []) as string };
			records.set(key, row); } return records;
	}); } finally { database.close(); }
}
function openExisting(name: string): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const opening = indexedDB.open(name);
	opening.addEventListener('upgradeneeded', () => opening.transaction?.abort(), { once: true });
	opening.addEventListener('error', () => reject(opening.error), { once: true }); opening.addEventListener('success', () => resolve(opening.result), { once: true }); }); }
function identity(value: unknown): string { check(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value), 'Sequence observer requires a stable existing identity.'); return value; }
function nativeBacking(bytes: Uint8Array): ArrayBuffer { return Reflect.apply(BUFFER, bytes, []) as ArrayBuffer; }
function wipe(backing: ArrayBuffer): void { Reflect.apply(FILL, new Uint8Array(backing), [0]); }
function hash(bytes: Uint8Array): string { return bytesToHex(sha256(bytes)); }
function diagnosticError(error: unknown) { return error instanceof Error || error instanceof DOMException
	? { name: error.name.slice(0, 128), message: error.message.slice(0, 1024) } : { type: typeof error }; }
async function joined<Value>(run: () => Promise<Value>, closes: readonly (() => void | Promise<void>)[]): Promise<Value> {
	let result!: Value, failed = false, primary: unknown;
	try { result = await run(); } catch (error) { failed = true; primary = error; }
	const failures: unknown[] = failed ? [primary] : [];
	for (const close of closes) try { await close(); } catch (error) { if (!failures.some(value => Object.is(value, error))) failures.push(error); }
	if (failures.length === 1) throw failures[0]; if (failures.length) throw new AggregateError(failures, 'Sequence native observation and retirement failed.', { cause: failures[0] });
	return result;
}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }
