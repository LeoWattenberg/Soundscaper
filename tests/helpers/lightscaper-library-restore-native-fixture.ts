/* SPDX-License-Identifier: AGPL-3.0-only */

import { BlobReader, BlobWriter, ZipReader, ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js/index-native.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { digestScapeBytes } from '../../src/common/editor/scape-byte-stream.ts';
import type { ScapeManifest } from '../../src/common/editor/scape-archive-envelope.ts';
import { readCursorPage, request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { trustedMediaContentSha256 } from '../../src/common/editor/storage/media-content-provenance.ts';
import { mediaAssetChunkKey } from '../../src/common/editor/storage/media-asset-chunk-records.ts';
import { catalogOriginalKey, normalizeCatalogOriginalRoot } from '../../src/common/editor/storage/media-catalog-original-schema.ts';
import type { StorageRecord } from '../../src/common/editor/storage/media-records.ts';
import { exportPhotoCatalogArchiveV3 } from '../../src/lightscaper/archive/catalog-archive-export-v3.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoStackV1 } from '../../src/lightscaper/catalog/photo-stack-v1.ts';
import { normalizePhotoSmartCollectionV1 } from '../../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { normalizePhotoSmartCollectionsStateV1 } from '../../src/lightscaper/catalog/photo-smart-collection-state-v1.ts';
import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { PHOTO_CATALOG_STORES } from '../../src/lightscaper/catalog/repository-types.ts';
import { createPhotoLibrarySessionV2 } from '../../src/lightscaper/photo-library-session-runtime-v2.ts';
import { createPhotoLibraryRestoreRuntimeV1 } from '../../src/lightscaper/photo-library-restore-runtime-v1.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { recoverPhotoLibraryRestoreV1 } from '../../src/lightscaper/storage/photo-library-restore-recovery-v1.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from '../../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2, readPhotoLibraryLocationPointerV2 } from '../../src/lightscaper/storage/photo-library-location-v2.ts';
import { normalizePhotoLibraryRestoreCommitV1, photoLibraryRestoreCommitKeyV1, PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1,
	resolveCommittedPhotoLibraryLocationV2 } from '../../src/lightscaper/storage/photo-library-restore-journal-v1.ts';
import { assertPhotoLibraryRestoreOwnerMarkerV1, PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1, PHOTO_CATALOG_RESTORE_OWNER_STORE_V1 } from '../../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './lightscaper-catalog-query-fixture.ts';

const SPAN = 4 * 1024 * 1024, NAME = 'Native restored library 界';
const nativeAdd = EventTarget.prototype.addEventListener;
type Archive = Awaited<ReturnType<typeof archive>>;
type Authority = Awaited<ReturnType<typeof authority>>;

/** Actual ZIP codecs, native IDB, production restore and selected Session. No restored rows are seeded. */
export async function qualifyNativeLibraryRestoreV1(mode: 'preservation' | 'corruption' | 'cancellation') {
	if (!navigator.locks) throw new Error('Native library restore qualification requires actual browser locks.');
	const source = await archive(), baselineSession = await createPhotoLibrarySessionV2({ name: 'Previous default library', indexedDB, locks: navigator.locks });
	try { await baselineSession.readPage(); } finally { await baselineSession.close(); }
	const originalPointer = await pointer();
	const first = await install(source.blob), selected = await authority(), before = await inspect(source, selected);
	check(first.catalogId === source.root.id && first.photoCount === 2 && first.stackCount === 1 && first.savedCollectionCount === 1
		&& first.originalCount === 2 && first.originalByteLength === source.bytes.reduce((sum, bytes) => sum + bytes.length, 0), 'Restore receipt differs from the actual archive.');
	check(equal(selected.commit.previousPointer, originalPointer), 'Permanent commit lost the previous pointer.');
	const physicalBefore = await physicalNames(), historyBefore = await history();
	if (mode === 'preservation') return { ...before, receipt: first, previousPointerPreserved: true,
		selectedNamespaces: physicalBefore.filter(name => name.includes('-restore-')).length };
	if (mode === 'corruption') {
		const bad = await corruptOriginal(source.blob); let failure: unknown;
		try { await install(bad); } catch (error) { failure = error; }
		check(originalDigestFailure(failure), 'Authenticated corrupt original did not refuse its inner digest.');
		const after = await authority(), retained = await inspect(source, after);
		check(equal(selected, after) && equal(before, retained), 'Failed restore changed the selected library or permanent history.');
		check(equal(physicalBefore, await physicalNames()), 'Failed restore retained or deleted an unrelated physical namespace.');
		check(equal(historyBefore, await history()), 'Failed restore changed permanent commit inventory.');
		check(await activeJournal() === undefined, 'Failed restore left an active journal.');
		return { corruptOriginalRefused: true, previousPointerUnchanged: true, permanentHistoryUnchanged: true,
			oldLibraryExact: true, reopenedOldLibrary: true, candidateNamespacesCleaned: true };
	}
	const early = new AbortController(), reason = Object.freeze({ native: 'original-delivery' }); let deliveries = 0, failure: unknown;
	const put = IDBObjectStore.prototype.put;
	IDBObjectStore.prototype.put = function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
		const writing = Reflect.apply(put, this, key === undefined ? [value] : [value, key]) as IDBRequest<IDBValidKey>;
		if (this.name === 'mediaAssetChunks' && this.transaction.db.name.includes('-restore-')) {
			Reflect.apply(nativeAdd, writing, ['success', () => { deliveries++; if (deliveries === 1) early.abort(reason); }, { once: true }]);
		}
		return writing;
	};
	try { await install(source.blob, early.signal); } catch (error) { failure = error; }
	finally { IDBObjectStore.prototype.put = put; }
	check(deliveries > 0 && contains(failure, reason), 'Native original delivery did not preserve its cancellation.');
	check(equal(selected, await authority()) && equal(before, await inspect(source, selected)), 'Cancelled restore changed the old library.');
	check(await activeJournal() !== undefined, 'Cancelled restore lost its recoverable journal.');
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, preferOpfs: false });
	try {
		await anchor.ready(); const recovery = await recoverPhotoLibraryRestoreV1({ settings: anchor.settingsRepository, indexedDB, locks: navigator.locks });
		check(recovery.outcome === 'discarded' && recovery.errors.length === 0, 'Actual native recovery did not discard the cancelled candidate.');
	} finally { await anchor.close(); }
	check(await activeJournal() === undefined && equal(physicalBefore, await physicalNames()), 'Native recovery did not join candidate deletion.');
	check(equal(historyBefore, await history()) && equal(before, await inspect(source, await authority())), 'Recovery changed previous permanent history or selected data.');
	const late = new AbortController(); let complete = 0;
	IDBObjectStore.prototype.put = function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
		const writing = Reflect.apply(put, this, key === undefined ? [value] : [value, key]) as IDBRequest<IDBValidKey>;
		const row = value as { key?: unknown; value?: { schemaVersion?: unknown } };
		if (this.name === 'settings' && this.transaction.db.name === PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2
			&& row.key === PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 && row.value?.schemaVersion === 2) {
			Reflect.apply(nativeAdd, this.transaction, ['complete', () => { complete++; late.abort(reason); }, { once: true }]);
		}
		return writing;
	};
	let ack: Awaited<ReturnType<typeof install>>;
	try { ack = await install(source.blob, late.signal); } finally { IDBObjectStore.prototype.put = put; }
	check(complete === 1 && late.signal.aborted && ack.photoCount === 2, 'Completed native publication lost its ACK.');
	const current = await authority(); check(current.pointer.namespaceToken !== selected.pointer.namespaceToken, 'A second restore adopted the previous namespace.');
	await inspect(source, current);
	check(equal(await commitAt(selected.pointer.namespaceToken), selected.commit), 'Later publication rewrote previous permanent history.');
	check(await activeJournal() === undefined, 'Completed publication did not retire its journal.');
	return { nativeOriginalDeliveries: deliveries, exactCancellation: true, oldLibraryUnchanged: true, cancelledCandidateDeleted: true,
		lateAborted: true, publicationAcknowledged: true, distinctReplacementNamespace: true, previousCommitPreserved: true };
}

async function install(blob: Blob, signal?: AbortSignal) {
	const runtime = createPhotoLibraryRestoreRuntimeV1({ name: NAME, indexedDB, locks: navigator.locks });
	try { return await runtime.restoreArchive(blob, { signal }); } finally { await runtime.close(); }
}

async function archive() {
	const small = await png(), bytes = [withTextChunk(small, SPAN), small], root = normalizePhotoCatalogRootV1({
		...queryCatalogRootV1(), name: NAME, revision: 37, photoCount: 2 });
	const photos = await Promise.all(bytes.map(async (body, index) => {
		const base = queryPhotoV1(index + 1), digest = bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', body.buffer as ArrayBuffer)));
		return normalizePhotoDocumentV1({ ...base, revision: index ? 19 : 11,
			original: { ...base.original, id: `archived-original-${index + 1}`, storageKey: `archived-key-${index + 1}`,
				name: `Native-${index + 1}.png`, mimeType: 'image/png', byteLength: body.length, contentSha256: digest, width: 2, height: 2, hasAlpha: true },
			keywordIds: ['keyword'], metadata: { ...base.metadata, fileName: `Native-${index + 1}.png`, title: 'Landscape', cameraMake: 'Native Camera',
				cameraModel: `Camera ${index + 1}`, lens: 'Native Lens', iso: index ? 800 : 200,
				captureTime: { local: `2026-10-0${index + 1}T12:34:00.000`, offsetMinutes: 0 } } });
	}));
	const stack = normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: root.id, id: 'archived-stack', revision: 23,
		photoIds: [photos[1]!.id, photos[0]!.id], coverPhotoId: photos[1]!.id });
	const saved = normalizePhotoSmartCollectionV1({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: root.id, id: 'archived-saved', revision: 29,
		name: 'Camera selection 界', query: { schemaVersion: 2, kind: 'photo-catalog-query', text: 'Landscape', filter: { kind: 'collection', id: 'manual' },
			sort: { field: 'capture-time', direction: 'descending' }, predicate: { kind: 'all', terms: [
				{ kind: 'text', column: 'camera-make', operator: 'contains', value: 'Native' },
				{ kind: 'number', column: 'iso', minimum: 200, maximum: 800 },
				{ kind: 'any', terms: [{ kind: 'folder', id: 'folder' }, { kind: 'keyword', id: 'keyword' }] },
			] } } });
	const state = normalizePhotoSmartCollectionsStateV1({ schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: root.id, revision: 41, collectionCount: 1 });
	const result = await exportPhotoCatalogArchiveV3(root, photos.map((photo, index) => ({ photo, original: new Blob([bytes[index]!.buffer as ArrayBuffer], { type: 'image/png' }) })), [stack], state, [saved]);
	check(result.blob instanceof Blob && result.byteLength < 8 * 1024 * 1024, 'Native fixture exceeds its archive bound.');
	return { blob: result.blob, root, photos, bytes, stack, saved, state };
}

async function inspect(source: Archive, selected: Authority) {
	const session = await createPhotoLibrarySessionV2({ name: NAME, indexedDB, locks: navigator.locks });
	try {
		const page = await session.readPage(), stack = await session.readStackSnapshot(source.photos[0]!.id), saved = await session.savedCollections.readSnapshot({ collectionId: source.saved.id });
		check(page.totalCount === 2 && page.catalogName === source.root.name && equal(page.rows.map(row => row.id).sort(), source.photos.map(photo => photo.id).sort()), 'Selected Session browses another library.');
		check(equal(stack.stack, { id: source.stack.id, revision: source.stack.revision, photoIds: source.stack.photoIds, coverPhotoId: source.stack.coverPhotoId }), 'Selected Session lost archived grouping.');
		check(saved.definition?.revision === source.saved.revision && equal(JSON.parse(saved.definition.queryJson), source.saved.query), 'Selected Session lost the complete saved recipe.');
		for (const mode of ['ordinary', 'collapsed'] as const) {
			const ids: string[] = []; let cursor: string | null = null, steps = 0;
			do { const step = await session.savedCollections.readQueryStep({ collectionId: source.saved.id, mode, cursor });
				check(step.scanned <= 64 && step.rows.length <= 64 && ++steps <= 8, 'Selected saved query exceeded its step bound.');
				ids.push(...step.rows.map(row => row.id)); cursor = step.cursor;
			} while (cursor !== null);
			check(equal(ids, mode === 'ordinary' ? source.stack.photoIds : [source.stack.coverPhotoId]), 'Saved query or collapsed representative differs.');
		}
	} finally { await session.close(); }
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB, databaseName: selected.location.catalogDatabaseName,
		verifyOriginal: async () => { throw new Error('Read-only fixture must never verify through a fake writer.'); } });
	try {
		check(equal(await catalog.loadCatalog(source.root.id), source.root), 'Archived root bytes/revision differ.');
		for (const photo of source.photos) check(equal(await catalog.loadPhoto(source.root.id, photo.id), photo), 'Archived photo values/revision differ.');
		check(equal(await catalog.loadStack(source.root.id, source.stack.id), source.stack), 'Archived stack differs.');
		check(equal(await catalog.loadSmartCollection(source.root.id, source.saved.id), source.saved), 'Archived saved definition differs.');
		check(equal(await catalog.readSmartCollectionState(source.root.id), source.state), 'Physical saved state differs.');
	} finally { await catalog.close(); }
	const catalogDatabase = await request(indexedDB.open(selected.location.catalogDatabaseName)), media = await request(indexedDB.open(selected.location.mediaDatabaseName));
	try {
		const catalogOwner = await transact(catalogDatabase, PHOTO_CATALOG_RESTORE_OWNER_STORE_V1, 'readonly', stores => request(stores[PHOTO_CATALOG_RESTORE_OWNER_STORE_V1]!.get(PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1)));
		const mediaOwner = await transact(media, 'settings', 'readonly', stores => request(stores.settings!.get(PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1))) as { value: unknown };
		assertPhotoLibraryRestoreOwnerMarkerV1(catalogOwner, selected.commit.allocation, 'catalog'); assertPhotoLibraryRestoreOwnerMarkerV1(mediaOwner.value, selected.commit.allocation, 'media');
		const tokens: string[] = [], chunks: number[] = [];
		for (const [index, photo] of source.photos.entries()) {
			await transact(media, ['mediaAssets', 'mediaAssetChunks', 'catalogOriginalRoots'], 'readonly', async stores => {
				const row = await request(stores.mediaAssets!.get(photo.original.storageKey)) as StorageRecord;
				check(row.sourceId === photo.original.storageKey && trustedMediaContentSha256(row) === photo.original.contentSha256
					&& row.size === source.bytes[index]!.length && row.storage === 'indexeddb-media-chunks-v1' && row.catalogRootCount === 1, 'Native immutable asset identity differs.');
				tokens.push(row.mediaContentToken!); chunks.push(Number(row.mediaChunkCount)); const hash = sha256.create();
				for (let chunkIndex = 0; chunkIndex < Number(row.mediaChunkCount); chunkIndex++) {
					const key = mediaAssetChunkKey(row.mediaChunkToken as string, chunkIndex), value = await request(stores.mediaAssetChunks!.get(key)) as Record<string, unknown>;
					check(value.key === key && value.sourceId === row.sourceId && value.mediaChunkToken === row.mediaChunkToken && value.index === chunkIndex
						&& value.payloadEncoding === 'array-buffer-v1' && value.payloadBytes instanceof ArrayBuffer && !Object.hasOwn(value, 'payload'), 'Native chunk geometry differs.');
					const bytes = new Uint8Array(value.payloadBytes as ArrayBuffer), expected = source.bytes[index]!.subarray(chunkIndex * SPAN, (chunkIndex + 1) * SPAN);
					check(bytes.length <= SPAN && bytes.length === expected.length && bytes.every((byte, offset) => byte === expected[offset]), 'Native original bytes differ.'); hash.update(bytes);
				}
				check(bytesToHex(hash.digest()) === photo.original.contentSha256, 'Native original SHA differs.');
				const root = normalizeCatalogOriginalRoot(await request(stores.catalogOriginalRoots!.get(catalogOriginalKey(source.root.id, null, photo.id))));
				check(root.importId === null && root.sourceId === photo.original.id && root.assetId === photo.original.storageKey
					&& root.sha256 === photo.original.contentSha256 && root.size === photo.original.byteLength && root.mediaContentToken === row.mediaContentToken, 'Committed original custody differs.');
			});
		}
		check(tokens[0] !== tokens[1] && equal(chunks, [2, 1]), 'Restored physical body identities or tail chunks differ.');
		// Independent oracle for this two-photo fixture; do not borrow the production membership projector.
		const expectedMemberships = source.photos.flatMap((photo, index) => [
			`${source.root.id}|rating|${index + 1}`, `${source.root.id}|flag|unflagged`, `${source.root.id}|label|none`,
			`${source.root.id}|keyword|keyword`, `${source.root.id}|collection|manual`, `${source.root.id}|folder|folder`,
		].map(scope => ({ key: `${scope}|${photo.id}`, scope, photoKey: `${source.root.id}|${photo.id}` })))
			.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
		const memberships = await transact(catalogDatabase, 'memberships', 'readonly', stores => readCursorPage(stores.memberships!, {
			limit: 64, project: (value: unknown, key) => ({ key, value }),
		}));
		check(expectedMemberships.length === 12 && equal(memberships, expectedMemberships.map(value => ({ key: value.key, value }))),
			'Native membership physical keys, scopes or photo bindings differ.');
		const inventory: Record<string, number> = {};
		for (const store of [...PHOTO_CATALOG_STORES, PHOTO_CATALOG_RESTORE_OWNER_STORE_V1]) inventory[store] = (await keys(catalogDatabase, store)).length;
		for (const [store, expected] of [['mediaAssets', 2], ['mediaAssetChunks', 3], ['catalogOriginalRoots', 2]] as const) check((await keys(media, store)).length === expected, 'Media inventory has missing/extra rows.');
		return { archivedDocumentsExact: true, originalBytesExact: true, originalShaExact: true, ownerMarkersExact: true, membershipRowsExact: true,
			selectedSessionReopened: true, savedOrdinaryAndCollapsedExact: true, stackOrder: source.stack.photoIds,
			photoRevisions: source.photos.map(photo => photo.revision), rootRevision: source.root.revision, stackRevision: source.stack.revision,
			savedRevision: source.saved.revision, savedStateRevision: source.state.revision, chunks, tokens, inventory,
			catalogFingerprint: await fingerprint(catalogDatabase), mediaOriginalByteLength: source.bytes.reduce((sum, bytes) => sum + bytes.length, 0) };
	} finally { catalogDatabase.close(); media.close(); }
}

async function authority() {
	const current = readPhotoLibraryLocationPointerV2(await pointer()); check(current.schemaVersion === 2, 'Restore did not install a V2 pointer.');
	const commit = normalizePhotoLibraryRestoreCommitV1(await commitAt(current.namespaceToken));
	return { pointer: current, commit, location: resolveCommittedPhotoLibraryLocationV2(current, commit) };
}
async function anchor(key: string): Promise<unknown> {
	const database = await request(indexedDB.open(PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2));
	try { const row = await transact(database, 'settings', 'readonly', stores => request(stores.settings!.get(key))) as { value: unknown } | undefined; return row?.value; }
	finally { database.close(); }
}
const pointer = () => anchor(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1);
const activeJournal = () => anchor(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1);
const commitAt = (token: string) => anchor(photoLibraryRestoreCommitKeyV1(token));
async function history() {
	const database = await request(indexedDB.open(PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2));
	try { const rows = await transact(database, 'settings', 'readonly', stores => readCursorPage(stores.settings!, {
		limit: 8, query: IDBKeyRange.bound('photo-library:restore-commit-v1:', 'photo-library:restore-commit-v1;'),
		project: (value: unknown, key) => ({ key, value }) }));
		check(rows.length < 8, 'Fixture permanent history exceeded its bounded inventory.'); return rows; }
	finally { database.close(); }
}
async function physicalNames() { return (await indexedDB.databases()).map(row => row.name!).filter(name => name.startsWith('lightscaper-')).sort(); }
async function keys(database: IDBDatabase, store: string) {
	return transact(database, store, 'readonly', stores => readCursorPage(stores[store]!, { limit: 64, project: (_value: unknown, key) => key }));
}
async function fingerprint(database: IDBDatabase) {
	const hash = sha256.create();
	for (const store of [...database.objectStoreNames].sort()) {
		const values = await transact(database, store, 'readonly', stores => readCursorPage(stores[store]!, { limit: 64, project: (value: unknown, key) => ({ key, value }) }));
		check(values.length < 64, 'Fixture inventory escaped its bounded two-photo profile.'); hash.update(new TextEncoder().encode(JSON.stringify([store, values])));
	}
	return bytesToHex(hash.digest());
}
async function corruptOriginal(blob: Blob) {
	const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false }), entries = new Map<string, Uint8Array<ArrayBuffer>>();
	try { for (const entry of await reader.getEntries()) if (!entry.directory) entries.set(entry.filename, await entry.getData(new Uint8ArrayWriter())); }
	finally { await reader.close(); }
	const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as ScapeManifest;
	const asset = manifest.assets.find(value => value.kind === 'photo-catalog-pack'); check(asset, 'Archive has no photo pack.');
	const bytes = entries.get(asset.entry)!; bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1; asset.sha256 = digestScapeBytes(bytes);
	check(asset.size === bytes.length && asset.sha256 === bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer))), 'Corrupt fixture outer digest/size is not authenticated.');
	entries.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
	const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false, level: 0 });
	try { for (const [name, value] of entries) await writer.add(name, new Uint8ArrayReader(value), { level: 0 }); return await writer.close(); }
	catch (error) { await writer.close(); throw error; }
}
async function png() {
	const canvas = new OffscreenCanvas(2, 2), context = canvas.getContext('2d'); check(context, 'Native PNG fixture requires canvas.');
	context.fillStyle = '#805040'; context.fillRect(0, 0, 2, 2);
	return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}
/** Valid ancillary PNG text: real encoded pixels with a deterministic >4MiB original and tail. */
function withTextChunk(png: Uint8Array<ArrayBuffer>, count: number) {
	const data = new Uint8Array(14 + count); data.set(new TextEncoder().encode('Restore bytes\0')); data.fill(120, 14);
	const chunk = new Uint8Array(data.length + 12); new DataView(chunk.buffer).setUint32(0, data.length, false);
	chunk.set(new TextEncoder().encode('tEXt'), 4); chunk.set(data, 8); new DataView(chunk.buffer).setUint32(chunk.length - 4, crc(chunk.subarray(4, chunk.length - 4)), false);
	const result = new Uint8Array(png.length + chunk.length), end = png.length - 12;
	result.set(png.subarray(0, end)); result.set(chunk, end); result.set(png.subarray(end), end + chunk.length); return result;
}
function crc(bytes: Uint8Array) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1; } return (value ^ 0xffffffff) >>> 0; }
function equal(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }
function contains(error: unknown, target: unknown): boolean { return error === target || error instanceof AggregateError && (error.errors as unknown[]).some(value => contains(value, target)); }
function originalDigestFailure(error: unknown): boolean { return error instanceof Error && error.message === 'Photo pack original digest differs from its reference.'
	|| error instanceof AggregateError && (error.errors as unknown[]).some(originalDigestFailure); }
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
