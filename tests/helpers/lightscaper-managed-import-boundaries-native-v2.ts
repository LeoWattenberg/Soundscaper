/* SPDX-License-Identifier: AGPL-3.0-only */

import { defaultImageDevelopStateV2 } from '../../src/common/editor/imaging/image-develop-state-v2.ts';
import type { VideoCubeLutReferenceV1 } from '../../src/common/editor/video-color-cube-lut-v27.ts';
import type { StorageRecord } from '../../src/common/editor/storage/media-records.ts';
import { defaultPhotoDevelopV1 } from '../../src/lightscaper/catalog/develop-state.ts';
import { emptyPhotoMetadataV1 } from '../../src/lightscaper/catalog/photo-metadata.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoDocumentV2 } from '../../src/lightscaper/catalog/photo-document-v2.ts';
import { PhotoCatalogRepositoryV2 } from '../../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { importManagedPhotosV2, recoverManagedPhotoImportV2 } from '../../src/lightscaper/import/managed-import-v2.ts';
import { photoImportIntentKeyV1 } from '../../src/lightscaper/import/import-intent-v1.ts';
import type { PhotoManagedImportPortsV2, PhotoManagedImportReceiptV1 } from '../../src/lightscaper/import/managed-import-ports-v2.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';

export type ManagedPhotoImportNativePhaseV2 = 'intent' | 'original' | 'stage' | 'publish' | 'promote' | 'retire';
export type ManagedPhotoImportNativeTimingV2 = 'before' | 'after';
type Owners = Awaited<ReturnType<typeof openOwners>>;
type Names = Readonly<{ media: string; catalog: string; directory: string; worker: string }>;

// Already-admitted originals: independently encoded valid RGBA PNGs, not a
// selected-file ingest/decode witness. Native storage receives complete files.
const PRIOR_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQlNf/DwACAwFflwzAewAAAABJRU5ErkJggg==';
const CURRENT_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAHElEQVR4nGP4z8DwHwyB9P/qV7pAuuF//X+gCACcuAyINRgO7QAAAABJRU5ErkJggg==';
const CUBE = new TextEncoder().encode('LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n');
const IMPORT_ID = 'boundary-import';

/** Actual IDB/OPFS owners only. Wrappers hold one real port invocation before
 * or after its settlement; they never substitute its result or native storage. */
export async function qualifyManagedPhotoImportNativeBoundaryV2(phase: ManagedPhotoImportNativePhaseV2, when: ManagedPhotoImportNativeTimingV2) {
	if (!['intent', 'original', 'stage', 'publish', 'promote', 'retire'].includes(phase) || !['before', 'after'].includes(when)) {
		throw new TypeError('Unknown current native import boundary.');
	}
	if (!isSecureContext || !crossOriginIsolated || !navigator.locks || !navigator.storage.getDirectory) {
		throw new Error('Native import boundaries require the preview security policy and real browser storage.');
	}
	const nonce = crypto.randomUUID(), catalogId = `catalog-${nonce}`;
	const names = { media: `lightscaper-current-import-media-${nonce}`, catalog: `lightscaper-current-import-catalog-${nonce}`,
		directory: `lightscaper-current-import-originals-${nonce}`, worker: `lightscaper-current-import-worker-${nonce}` };
	const priorBytes = decode(PRIOR_PNG), currentBytes = decode(CURRENT_PNG), lutSha256 = await digest(CUBE);
	const reference: Readonly<VideoCubeLutReferenceV1> = { storageKey: `lut-sha256:${lutSha256}`, sha256: lutSha256, byteLength: CUBE.length,
		size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
	const prior = normalizePhotoDocumentV1(await photoInput(catalogId, 'prior', priorBytes, 1, 1));
	const current = normalizePhotoDocumentV2({ ...await photoInput(catalogId, 'current', currentBytes, 2, 3), schemaVersion: 2,
		versions: [{ id: 'current-version', kind: 'master', name: 'Original', createdAt: '2026-10-10T00:00:00.000Z',
			develop: { ...defaultImageDevelopStateV2(), effects: [{ id: 'retained-profile', type: 'cube-lut-profile-v1', enabled: false, params: { lut: reference } }] } }] });
	let owner: Owners | null = null;
	const run = async () => {
		owner = await openOwners(names);
		await owner.catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: catalogId,
			name: 'Native current import boundaries', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
		await owner.resources.put(reference, CUBE);
		const seeded = await importManagedPhotosV2(catalogId, [{ photo: prior, original: new Blob([priorBytes], { type: 'image/png' }) }], ports(owner, 'prior-import'));
		const before = await snapshot(owner, names, catalogId, reference);
		const entered = deferred(), release = deferred(), stop = new AbortController();
		let enteredCount = 0, reasonReflections = 0, completed = false;
		const publications: PhotoManagedImportReceiptV1[] = [];
		const reason = new Proxy({}, { get() { reasonReflections++; throw new Error('Opaque abort reason read.'); },
			getPrototypeOf() { reasonReflections++; throw new Error('Opaque abort reason reflected.'); } });
		const intercept = async <Result,>(at: ManagedPhotoImportNativePhaseV2, operation: () => Promise<Result>): Promise<Result> => {
			if (at !== phase) return operation();
			if (++enteredCount !== 1) throw new Error('Native boundary invoked more than once.');
			if (when === 'before') { entered.resolve(); await release.promise; stop.signal.throwIfAborted(); }
			const result = await operation();
			if (when === 'after') { entered.resolve(); await release.promise; }
			return result;
		};
		const base = ports(owner, IMPORT_ID);
		const interrupted: PhotoManagedImportPortsV2 = { ...base,
			journal: { get: key => base.journal.get(key), putIfAbsent: (...args) => intercept('intent', () => base.journal.putIfAbsent(...args)),
				deleteIfCurrent: (...args) => intercept('retire', () => base.journal.deleteIfCurrent(...args)) },
			media: { writeAsset: (...args) => intercept('original', () => base.media.writeAsset(...args)), custody: {
				findDigestPage: (...args) => base.media.custody.findDigestPage(...args), readPage: (...args) => base.media.custody.readPage(...args),
				releaseStaged: (...args) => base.media.custody.releaseStaged(...args),
				stage: (...args) => intercept('stage', () => base.media.custody.stage(...args)),
				promote: (...args) => intercept('promote', () => base.media.custody.promote(...args)) } },
			catalog: { loadCatalog: key => base.catalog.loadCatalog(key), loadPhoto: (...args) => base.catalog.loadPhoto(...args),
				publishPhotos: (...args) => intercept('publish', () => base.catalog.publishPhotos(...args)) } };
		const work = importManagedPhotosV2(catalogId, [{ photo: current, original: new Blob([currentBytes], { type: 'image/png' }) }], interrupted,
			{ signal: stop.signal, onPublished: receipt => { publications.push(receipt); } });
		const outcome = work.then(receipts => { completed = true; return { status: 'fulfilled' as const, receipts, sameReason: false }; },
			(error: unknown) => { completed = true; return { status: 'rejected' as const, receipts: [], sameReason: Object.is(error, reason) }; });
		try {
			await Promise.race([entered.promise, work.then(() => { throw new Error('Native import settled before its declared boundary.'); },
				(error: unknown) => { throw error; })]);
			stop.abort(reason);
			await new Promise<void>(resolve => { setTimeout(resolve, 0); });
			const joinedWhileHeld = !completed, publicationsWhileHeld = [...publications];
			const held = await snapshot(owner, names, catalogId, reference);
			release.resolve(); const result = await outcome;
			const released = await snapshot(owner, names, catalogId, reference);
			await owner.close(); owner = await openOwners(names);
			const reopened = await snapshot(owner, names, catalogId, reference);
			await recoverManagedPhotoImportV2(catalogId, ports(owner, IMPORT_ID));
			const recovered = await snapshot(owner, names, catalogId, reference);
			await owner.close(); owner = await openOwners(names);
			await recoverManagedPhotoImportV2(catalogId, ports(owner, IMPORT_ID));
			const recoveredAgain = await snapshot(owner, names, catalogId, reference);
			return { phase, when, catalogId, importId: IMPORT_ID, inputs: { prior, current }, seeded, before,
				joinedWhileHeld, enteredCount, publicationsWhileHeld, publications: [...publications], outcome: result,
				reasonReflections, held, released, reopened, recovered, recoveredAgain };
		} finally { release.resolve(); await outcome; }
	};
	const closeOwner = async () => { await owner?.close(); };
	let result: Awaited<ReturnType<typeof run>> | undefined, primary: unknown;
	try { result = await run(); } catch (error) { primary = error; }
	const errors: unknown[] = [];
	try { await closeOwner(); } catch (error) { errors.push(error); }
	for (const name of [names.catalog, names.media]) {
		try { await deleteDatabase(name); } catch (error) { errors.push(error); }
	}
	try { await (await navigator.storage.getDirectory()).removeEntry(names.directory, { recursive: true }); }
	catch (error) { if (!(error instanceof DOMException) || error.name !== 'NotFoundError') errors.push(error); }
	if (errors.length) throw new AggregateError(result === undefined ? [primary, ...errors] : errors,
		'Native boundary owner cleanup failed.', { cause: result === undefined ? primary : errors[0] });
	if (result === undefined) throw primary;
	return result;
}

async function openOwners(names: Names) {
	const media = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, databaseName: names.media,
		opfsDirectoryName: names.directory, opfsWorkerName: names.worker });
	try {
		await media.ready();
		const resources = await media.getCubeLutResources();
		const catalog = new PhotoCatalogRepositoryV2({ indexedDB, databaseName: names.catalog, verifyOriginal: media.verifyOriginal,
			verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal) });
		return { media, catalog, resources, async close() { try { await catalog.close(); } finally { await media.close(); } } };
	} catch (error) {
		const failures: unknown[] = [];
		try { await media.close(); }
		catch (cleanup) { failures.push(cleanup); }
		if (failures.length) throw new AggregateError([error, ...failures], 'Native boundary opening and cleanup failed.', { cause: error });
		throw error;
	}
}

function ports(owner: Owners, importId: string): PhotoManagedImportPortsV2 {
	return { catalog: owner.catalog, journal: owner.media.settingsRepository,
		media: { writeAsset: owner.media.mediaRepository.writeAsset, custody: owner.media.mediaRepository.catalogOriginals },
		verifyResources: (photo, signal) => owner.resources.verifyPhoto(photo, signal), createImportId: () => importId };
}

async function photoInput(catalogId: string, prefix: string, bytes: Uint8Array<ArrayBuffer>, width: number, height: number) {
	const name = `${prefix}.png`;
	return { schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo', id: `${prefix}-photo`, catalogId, revision: 0,
		original: { schemaVersion: 1, kind: 'still', id: `${prefix}-source`, storageKey: `${prefix}-original`, name, mimeType: 'image/png',
			contentSha256: await digest(bytes), byteLength: bytes.length, width, height, hasAlpha: true, retention: 'managed' },
		metadata: { ...emptyPhotoMetadataV1(name), caption: `${prefix} authored caption` }, folderId: null, collectionIds: [], keywordIds: [],
		rating: prefix === 'prior' ? 4 : 1, flag: 'unflagged', colorLabel: 'none', activeVersionId: `${prefix}-version`,
		versions: [{ id: `${prefix}-version`, kind: 'master', name: 'Original', createdAt: '2026-10-10T00:00:00.000Z', develop: defaultPhotoDevelopV1() }] };
}

async function snapshot(owner: Owners, names: Names, catalogId: string, reference: Readonly<VideoCubeLutReferenceV1>) {
	const photos = await Promise.all(['prior-photo', 'current-photo'].map(id => owner.catalog.loadPhoto(catalogId, id)));
	const originals = [];
	for (const key of ['prior-original', 'current-original']) {
		const body = await owner.media.mediaRepository.loadAsset(key);
		const row = await nativeAsset(names.media, key);
		const bytes = body === null ? null : new Uint8Array(await body.arrayBuffer());
		originals.push({ key, bytes: bytes === null ? null : [...bytes], actualSha256: bytes === null ? null : await digest(bytes), row });
	}
	const retained = await owner.media.mediaRepository.catalogOriginals.readPage({ catalogId });
	const staged = await owner.media.mediaRepository.catalogOriginals.readPage({ catalogId, importId: IMPORT_ID });
	if (retained.afterKey !== null || staged.afterKey !== null || retained.roots.length > 2 || staged.roots.length > 1) {
		throw new Error('Tiny native boundary fixture escaped its custody bounds.');
	}
	const lut = await owner.resources.source.withBytes(reference, async bytes => ({ bytes: [...bytes], actualSha256: await digest(bytes) }));
	return { root: await owner.catalog.loadCatalog(catalogId), photos, originals, retained: retained.roots, staged: staged.roots,
		intent: await owner.media.settingsRepository.get(photoImportIntentKeyV1(catalogId)) ?? null, lut,
		catalogCounts: await counts(names.catalog, ['photos', 'summaries', 'photoQueryRowsV2']),
		mediaCounts: await counts(names.media, ['mediaAssets', 'mediaAssetStaging']), mediaStagingRows: await nativeStagingRows(names.media) };
}

async function nativeStagingRows(name: string): Promise<readonly unknown[]> {
	const database = await openDatabase(name);
	try { return await request<unknown[]>(database.transaction('mediaAssetStaging', 'readonly').objectStore('mediaAssetStaging').getAll()); }
	finally { database.close(); }
}

async function nativeAsset(name: string, key: string) {
	const database = await openDatabase(name);
	try {
		const row = await request<StorageRecord | undefined>(database.transaction('mediaAssets', 'readonly').objectStore('mediaAssets').get(key));
		return row === undefined ? null : { sourceId: row.sourceId, storage: row.storage, path: row.path,
			sha256: row.sha256, size: row.size, mediaContentDigestVersion: row.mediaContentDigestVersion,
			mediaContentToken: row.mediaContentToken, catalogRootCount: row.catalogRootCount ?? 0 };
	} finally { database.close(); }
}

async function counts(name: string, stores: readonly string[]): Promise<Readonly<Record<string, number>>> {
	const database = await openDatabase(name);
	try {
		const transaction = database.transaction([...stores], 'readonly');
		const entries = await Promise.all(stores.map(async store => [store, await request(transaction.objectStore(store).count())] as const));
		return Object.fromEntries(entries);
	} finally { database.close(); }
}

function openDatabase(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => { const opening = indexedDB.open(name);
		opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); };
		opening.onupgradeneeded = () => { opening.transaction?.abort(); reject(new Error('Native observer cannot initialize missing databases.')); };
	});
}
function deleteDatabase(name: string): Promise<void> {
	return new Promise((resolve, reject) => { const deleting = indexedDB.deleteDatabase(name);
		deleting.onsuccess = () => { resolve(); }; deleting.onerror = () => { reject(deleting.error); };
		deleting.onblocked = () => { reject(new Error('Native boundary database cleanup was blocked.')); };
	});
}
function request<Result>(value: IDBRequest<Result>): Promise<Result> {
	return new Promise((resolve, reject) => { value.onsuccess = () => { resolve(value.result); }; value.onerror = () => { reject(value.error); }; });
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; }
function decode(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
async function digest(bytes: Uint8Array): Promise<string> {
	return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(value => value.toString(16).padStart(2, '0')).join('');
}
