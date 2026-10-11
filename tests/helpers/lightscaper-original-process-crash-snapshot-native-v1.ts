/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { mediaAssetMetadata, type StorageRecord } from '../../src/common/editor/storage/media-records.ts';
import { normalizeCatalogOriginalRoot } from '../../src/common/editor/storage/media-catalog-original-schema.ts';
import { normalizePhotoDocumentV1OrV2 } from '../../src/lightscaper/catalog/photo-document-v2.ts';
import { readStoredPhotoV1OrV2 } from '../../src/lightscaper/catalog/photo-catalog-records-v2.ts';
import { PHOTO_CATALOG_STORES } from '../../src/lightscaper/catalog/repository-types.ts';
import { photoMemberships, photoSummary } from '../../src/lightscaper/catalog/repository-records.ts';
import { projectPhotoQueryRowV1 } from '../../src/lightscaper/catalog/photo-query-index-v1.ts';
import { projectPhotoQueryRowV2 } from '../../src/lightscaper/catalog/photo-query-index-v2.ts';
import { normalizePhotoImportIntentV1, photoImportIntentKeyV1 } from '../../src/lightscaper/import/import-intent-v1.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from '../../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { readPhotoLibraryLocationPointerV2, PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2 as CATALOG } from '../../src/lightscaper/storage/photo-library-location-v2.ts';
import { PHOTO_MEDIA_NAMESPACES_V1 as MEDIA } from '../../src/lightscaper/storage/photo-media-store.ts';
import { nativeCheckV1 as check, nativeDigestV1 as digest, nativeBytesEqualV1 as bytesEqual,
	nativeSameV1 as same, DEFAULT_IMPORT_PRIOR_PNG_V1, DEFAULT_IMPORT_CURRENT_PNG_V1,
	DEFAULT_IMPORT_CURRENT_SHA256_V1 } from './lightscaper-default-import-snapshot-native-v1.ts';

export const ORIGINAL_PROCESS_CRASH_CURRENT_SHA256_V1 = DEFAULT_IMPORT_CURRENT_SHA256_V1;
export const ORIGINAL_PROCESS_CRASH_UNROOTED_BYTES_V1 = Uint8Array.of(5, 13, 89, 197, 251, 7, 31);
export function originalProcessCrashLiteralV1(kind: 'donor' | 'current' | 'unrooted'): Uint8Array<ArrayBuffer> {
	if (kind === 'unrooted') return new Uint8Array(ORIGINAL_PROCESS_CRASH_UNROOTED_BYTES_V1);
	return Uint8Array.from(atob(kind === 'donor' ? DEFAULT_IMPORT_PRIOR_PNG_V1 : DEFAULT_IMPORT_CURRENT_PNG_V1), value => value.charCodeAt(0));
}

export interface OriginalProcessCrashIdentityV1 {
	readonly catalogId: string; readonly donorPhotoId: string; readonly unrootedSourceId: string;
	readonly currentSourceId: string; readonly currentPath: string | null;
}
export interface OriginalProcessCrashFileV1 { readonly present: boolean; readonly sha256: string | null; readonly byteLength: number | null }
export interface OriginalProcessCrashOriginalV1 {
	readonly sourceId: string; readonly path: string; readonly contentToken: string;
	readonly recordJson: string; readonly metadataJson: string; readonly custodyJson: string;
	readonly file: OriginalProcessCrashFileV1;
}
export interface OriginalProcessCrashSnapshotV1 {
	readonly stateJson: string; readonly catalogJson: string; readonly pointerJson: string;
	readonly donorPhotoJson: string; readonly donor: OriginalProcessCrashOriginalV1; readonly unrooted: OriginalProcessCrashOriginalV1;
	readonly paths: readonly string[]; readonly stagingJson: string; readonly bindingJson: string | null; readonly intentJson: string | null;
	readonly current: { readonly filePresent: boolean; readonly sha256: string | null; readonly byteLength: number | null;
		readonly leaseCount: number; readonly bindingCount: number; readonly bindingSameDirectory: boolean | null;
		readonly metadataCount: number; readonly photoCount: number; readonly rootCount: number; readonly intentPresent: boolean };
}

const MEDIA_STORES = ['settings', 'mediaAssets', 'catalogOriginalRoots', 'mediaAssetStaging',
	'sources', 'sourceChunks', 'mediaAssetChunks', 'videoDerivatives', 'videoDerivativeCacheEntries'] as const;
const bindingPrefix = 'audio-editor-opfs-directory-binding-v1:';
const exceptionName = Object.getOwnPropertyDescriptor(DOMException.prototype, 'name')!.get!;

/** Only existing native connections and readonly transactions; no Session/media readiness or upgrade. */
export async function readOriginalProcessCrashSnapshotNativeV1(identity: OriginalProcessCrashIdentityV1): Promise<Readonly<OriginalProcessCrashSnapshotV1>> {
	const inventory = await indexedDB.databases();
	check(inventory.length === 2 && inventory.some(row => row.name === CATALOG && row.version === 5)
		&& inventory.some(row => row.name === MEDIA.databaseName && row.version === 2), 'Crash fixture requires exactly its two existing default databases.');
	const catalog = await readRows(CATALOG, 5, PHOTO_CATALOG_STORES);
	const raw = await readRows(MEDIA.databaseName, 2, MEDIA_STORES);
	const documents = catalog.photos!; check(documents.length === 1, 'Crash fixture must retain exactly its acknowledged donor Photo.');
	const donor = normalizePhotoDocumentV1OrV2(readStoredPhotoV1OrV2(documents[0]));
	check(donor.id === identity.donorPhotoId && donor.catalogId === identity.catalogId && donor.schemaVersion === 1
		&& donor.versions[0]?.develop.processVersion === 1, 'Actual full donor identity/recipe changed.');
	check(same(catalog.summaries, [photoSummary(donor)]) && same(catalog.photoQueryRows, [projectPhotoQueryRowV1(donor)])
		&& same(catalog.photoQueryRowsV2, [projectPhotoQueryRowV2(donor)])
		&& exactRows(catalog.memberships!, photoMemberships(donor)), 'Native complete donor projections differ from its full Photo.');
	const assets = raw.mediaAssets! as StorageRecord[];
	check(assets.length === 2, 'Only acknowledged donor and completed unrooted original metadata may exist.');
	const roots = raw.catalogOriginalRoots!.map(normalizeCatalogOriginalRoot);
	check(roots.length === 1 && roots[0]?.photoId === donor.id && roots[0].importId === null
		&& roots[0].assetId === donor.original.storageKey && roots[0].sourceId === donor.original.id
		&& roots[0].sha256 === donor.original.contentSha256 && roots[0].size === donor.original.byteLength,
		'Donor must retain its actual complete permanent original root.');
	for (const record of assets) check((record.catalogRootCount ?? 0) === roots.filter(root => root.assetId === record.sourceId).length,
		'Native original root count differs from actual custody.');
	for (const name of ['sources', 'sourceChunks', 'mediaAssetChunks', 'videoDerivatives', 'videoDerivativeCacheEntries'])
		check(raw[name]!.length === 0, 'Crash fixture has unexpected binary source/cache rows.');
	const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(MEDIA.opfsDirectoryName);
	const retainedDonor = await original(donor.original.storageKey, 'donor');
	check(retainedDonor.file.sha256 === donor.original.contentSha256, 'Donor Photo digest differs from literal native file.');
	const unrooted = await original(identity.unrootedSourceId, 'unrooted');
	check(unrooted.custodyJson === '[]', 'The separately completed original must remain unrooted.');
	const currentFile = await file(identity.currentPath, 'current');
	const leases = raw.mediaAssetStaging!.filter(row => field(row, 'kind') === 'lease');
	check(leases.length <= 1 && raw.mediaAssetStaging!.length === leases.length + 1, 'Crash prefix exceeds its exact state/lease inventory.');
	const state = raw.mediaAssetStaging!.find(row => field(row, 'kind') === 'state');
	check(same(state, { key: 'state', kind: 'state', generation: 'initial' }), 'Crash staging generation changed unexpectedly.');
	const settings = raw.settings! as Record<string, unknown>[];
	const pointerRow = settings.find(row => row.key === PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1); check(pointerRow !== undefined, 'Actual default pointer is missing.');
	const pointer = readPhotoLibraryLocationPointerV2(pointerRow.value);
	check(pointer.schemaVersion === 1 && pointer.catalogId === identity.catalogId, 'Crash profile must retain its actual default pointer.');
	const intentRow = settings.find(row => row.key === photoImportIntentKeyV1(identity.catalogId));
	const intent = intentRow ? normalizePhotoImportIntentV1(intentRow.value, identity.catalogId) : null;
	const bindings = settings.filter(row => typeof row.key === 'string' && row.key.startsWith(bindingPrefix));
	check(bindings.length === leases.length, 'The durable directory witness and exact lease inventories disagree.');
	let bindingJson: string | null = null, bindingSameDirectory: boolean | null = null;
	if (leases.length) {
		const lease = leases[0]!; check(field(lease, 'sourceId') === identity.currentSourceId && field(lease, 'path') === identity.currentPath,
			'Actual orphan lease differs from the captured current writer.');
		const binding = bindings[0]!; check(binding.key === bindingPrefix + String(field(lease, 'leaseId')), 'Witness key differs from its actual lease.');
		const value = binding.value; check(value !== null && typeof value === 'object', 'Directory witness value is missing.');
		check(exactKeys(value, ['schemaVersion', 'kind', 'leaseId', 'sourceId', 'path', 'directoryHandle'])
			&& field(value, 'schemaVersion') === 1 && field(value, 'kind') === 'media-asset-opfs-directory-binding'
			&& field(value, 'leaseId') === field(lease, 'leaseId') && field(value, 'sourceId') === identity.currentSourceId
			&& field(value, 'path') === identity.currentPath, 'Persisted native witness does not bind this exact whole-Blob lease.');
		const sameEntry: unknown = Object.getOwnPropertyDescriptor(FileSystemHandle.prototype, 'isSameEntry')?.value;
		check(typeof sameEntry === 'function', 'Native persisted directory comparison is unavailable.');
		bindingSameDirectory = await Reflect.apply(sameEntry, directory, [field(value, 'directoryHandle')]) === true;
		check(bindingSameDirectory, 'Recovered native handle differs from the actual current original directory.');
		const { directoryHandle: _handle, ...scalar } = value as Record<string, unknown>;
		bindingJson = JSON.stringify({ key: binding.key, value: scalar });
		check(intent !== null && currentFile.present, 'An intact orphan prefix must retain its file and import intent.');
	}
	const paths: string[] = [];
	for await (const path of (directory as FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> }).keys()) {
		paths.push(path); check(paths.length <= 3, 'Crash fixture has unexpected physical files.');
	}
	paths.sort(); check(same(paths, [retainedDonor.path, unrooted.path, ...(currentFile.present ? [identity.currentPath!] : [])].sort()),
		'Complete physical directory differs from the acknowledged originals and actual orphan.');
	const stableSettings = settings.filter(row => typeof row.key === 'string'
		&& !row.key.startsWith('audio-editor-retention-session-v1:') && !row.key.startsWith(bindingPrefix));
	const catalogJson = JSON.stringify(catalog), stagingJson = JSON.stringify(raw.mediaAssetStaging);
	const stateJson = JSON.stringify({ catalog, media: { ...raw, settings: stableSettings }, bindingJson, paths,
		donor: retainedDonor, unrooted, currentFile });
	check(new TextEncoder().encode(stateJson).byteLength <= 262_144, 'Crash scalar snapshot exceeds its fixed bound.');
	return Object.freeze({ stateJson, catalogJson, pointerJson: JSON.stringify(pointerRow), donorPhotoJson: JSON.stringify(donor),
		donor: retainedDonor, unrooted, paths: Object.freeze(paths), stagingJson, bindingJson, intentJson: intent === null ? null : JSON.stringify(intent),
		current: Object.freeze({ filePresent: currentFile.present, sha256: currentFile.sha256, byteLength: currentFile.byteLength,
			leaseCount: leases.length, bindingCount: bindings.length, bindingSameDirectory,
			metadataCount: assets.filter(row => row.sourceId === identity.currentSourceId).length,
			photoCount: documents.map(row => readStoredPhotoV1OrV2(row)).filter(photo => photo.original.storageKey === identity.currentSourceId).length,
			rootCount: roots.filter(row => row.assetId === identity.currentSourceId).length, intentPresent: intent !== null }) });

	async function original(sourceId: string, kind: 'donor' | 'unrooted'): Promise<Readonly<OriginalProcessCrashOriginalV1>> {
		const record = assets.find(value => value.sourceId === sourceId);
		check(record !== undefined && record.storage === 'opfs' && typeof record.path === 'string' && record.blob === undefined
			&& typeof record.mediaContentToken === 'string' && record.mediaContentToken.length > 0, 'Acknowledged native original/token is missing.');
		const facts = await file(record.path, kind); check(facts.present && facts.sha256 === record.sha256 && facts.byteLength === record.size,
			'Acknowledged immutable metadata differs from its actual literal file.');
		return Object.freeze({ sourceId, path: record.path, contentToken: record.mediaContentToken, recordJson: JSON.stringify(record),
			metadataJson: JSON.stringify(mediaAssetMetadata(record)), custodyJson: JSON.stringify(roots.filter(root => root.assetId === sourceId)), file: facts });
	}
	async function file(path: string | null, kind: 'donor' | 'current' | 'unrooted'): Promise<Readonly<OriginalProcessCrashFileV1>> {
		if (path === null) return Object.freeze({ present: false, sha256: null, byteLength: null });
		let body: File;
		try { body = await (await directory.getFileHandle(path)).getFile(); }
		catch (error) { if (nativeNotFound(error)) return Object.freeze({ present: false, sha256: null, byteLength: null }); throw error; }
		const literal = originalProcessCrashLiteralV1(kind); let bytes: Uint8Array<ArrayBuffer> | undefined;
		try { check(body.size === literal.length, 'Native original file exceeds its exact independent literal size.');
			bytes = new Uint8Array(await body.arrayBuffer());
			check(bytesEqual(bytes, literal), 'Native original file differs from independent literal bytes.');
			return Object.freeze({ present: true, sha256: await digest(bytes), byteLength: bytes.length }); }
		finally { literal.fill(0); bytes?.fill(0); }
	}
}

async function readRows(name: string, version: number, names: readonly string[]): Promise<Record<string, unknown[]>> {
	const database = await existingDatabase(name, version);
	try {
		return await transact(database, names, 'readonly', async stores => {
			const rows = await Promise.all(names.map(async key => {
				const current = stores[key]; check(current !== undefined, 'Readonly crash store is missing.');
				const values: unknown[] = await request(current.getAll(undefined, 17));
				check(values.length <= 16, 'Readonly crash inventory exceeds its complete tiny fixture.');
				return [key, values] as const;
			}));
			return Object.fromEntries(rows);
		});
	} finally { database.close(); }
}
async function existingDatabase(name: string, version: number): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const opening = indexedDB.open(name); let refused = false;
		opening.onupgradeneeded = () => { refused = true; opening.transaction?.abort(); };
		opening.onerror = () => { reject(opening.error ?? new Error('Existing crash database could not be opened.')); };
		opening.onblocked = () => { refused = true; reject(new Error('Readonly crash database opening blocked.')); };
		opening.onsuccess = () => { const database = opening.result;
			if (refused || database.version !== version) { database.close(); reject(new Error('Readonly crash database profile changed.')); return; }
			resolve(database);
		};
	});
}
function field(value: unknown, key: string): unknown {
	check(value !== null && typeof value === 'object', 'Native scalar row is missing.');
	const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && 'value' in descriptor ? descriptor.value as unknown : undefined;
}
function exactKeys(value: object, keys: readonly string[]): boolean { return same(Object.keys(value).sort(), [...keys].sort()); }
function exactRows(actual: readonly unknown[], expected: readonly unknown[]): boolean {
	const sort = (rows: readonly unknown[]) => [...rows].sort((a, b) => String(field(a, 'key')).localeCompare(String(field(b, 'key'))));
	return same(sort(actual), sort(expected));
}
function nativeNotFound(value: unknown): boolean { try { return Reflect.apply(exceptionName, value, []) === 'NotFoundError'; } catch { return false; } }
