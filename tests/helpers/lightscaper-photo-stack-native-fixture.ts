/* SPDX-License-Identifier: AGPL-3.0-only */

import { openDatabase, request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import type { StorageRecord } from '../../src/common/editor/storage/media-records.ts';
import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { openPhotoCatalogDatabaseV1 } from '../../src/lightscaper/catalog/catalog-database.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { photoStackRecordV1 } from '../../src/lightscaper/catalog/photo-stack-record-v1.ts';
import type { PhotoCatalogQueryV1 } from '../../src/lightscaper/catalog/photo-query-types-v1.ts';
import type { PhotoStackQueryPageV1 } from '../../src/lightscaper/catalog/photo-stack-query-types-v1.ts';
import { preparePhotoImportGestureV1 } from '../../src/lightscaper/import/photo-import-preparation-v1.ts';
import { importManagedPhotosV1 } from '../../src/lightscaper/import/managed-import-v1.ts';
import { PhotoMediaStoreV1, PHOTO_MEDIA_NAMESPACES_V1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { openDefaultPhotoCatalogV1 } from '../../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { PHOTO_LARGE_LIBRARY_PNG_BASE64_V1, PHOTO_LARGE_LIBRARY_SPECIFICATION_V1 } from '../../src/lightscaper/quality/large-library-workload-v1.ts';
import { observeCompareLibraryV1 } from './lightscaper-compare-native-fixture.tsx';

export { bundledLightscaperEditorCopyForLocale as stackCopyForLocaleV1 } from '../../src/common/i18n/lightscaper-editor-copy.ts';

/** Four UI-imported originals/custody plus at most two tiny stacks; no fixture mutation authors the UI result. */
export async function observePhotoStackLibraryNativeV1(photoIds: readonly string[]) {
	const observed = await observeCompareLibraryV1(photoIds);
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB, verifyOriginal: async () => undefined });
	try {
		const state = await catalog.readStackState(observed.catalogId), page = await catalog.readStackPage(observed.catalogId);
		if (state.stackCount > 2 || page.items.length > 2 || page.continuation) throw new RangeError('Four-photo observation exceeds two stacks.');
		const stacks = [];
		for (const summary of page.items) {
			const stack = await catalog.loadStack(observed.catalogId, summary.id);
			if (!stack || stack.photoIds.length > 4 || stack.photoIds.some(id => !photoIds.includes(id))) throw new Error('Observed stack differs from four explicit photos.');
			stacks.push(stack);
		}
		const output = { ...observed, stackState: state, stacks };
		if (new TextEncoder().encode(JSON.stringify(output)).byteLength > 80 * 1024) throw new RangeError('Stack observation exceeds80KiB.');
		return output;
	} finally { await catalog.close(); }
}

const COUNT = 130, DISTANT = 'Distant native stack token';
const photoId = (index: number) => `native-stack-photo-${String(index).padStart(3, '0')}`;
const ordinary: PhotoCatalogQueryV1 = { text: '', filter: null, sort: { field: 'file-name', direction: 'ascending' } };

/** Actual native storage setup, separate from menu reachability: one decoded163-byte original, batches≤16. */
export async function qualifyPhotoStackStorageNativeV1() {
	const media = new PhotoMediaStoreV1(), catalog = new PhotoCatalogRepositoryV1({ indexedDB, verifyOriginal: media.verifyOriginal });
	let database: IDBDatabase | null = null;
	try {
		await media.ready();
		let root = await openDefaultPhotoCatalogV1({ catalog, settings: media.settingsRepository }, { name: 'Native stack qualification' });
		if (root.photoCount !== 0) throw new RangeError('Native stack qualification requires an isolated empty catalog.');
		const bytes = Uint8Array.from(atob(PHOTO_LARGE_LIBRARY_PNG_BASE64_V1), character => character.charCodeAt(0));
		const source = new File([bytes], 'Native-stack-source.png', { type: 'image/png' });
		const prepared = preparePhotoImportGestureV1({ files: [source], catalog: root, createdAt: '2026-10-08T12:00:00.000Z',
			ownership: [{ photoId: photoId(0), originalId: 'native-stack-source', originalStorageKey: 'native-stack-storage', masterVersionId: 'native-stack-master-000' }] });
		let maximumPublishedBatch = 0;
		for await (const outcome of prepared) {
			if (outcome.outcome !== 'prepared') throw outcome.error;
			const first = member(outcome.photo, 0);
			const receipts = await importManagedPhotosV1(root.id, [{ photo: first, original: outcome.original }], {
				catalog, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals }, journal: media.settingsRepository });
			if (receipts.length !== 1 || receipts[0]?.status !== 'imported') throw new Error('Native stack original publication failed.');
			root = (await catalog.loadCatalog(root.id))!;
			for (let offset = 1; offset < COUNT; offset += 16) {
				const batch = Array.from({ length: Math.min(16, COUNT - offset) }, (_, n) => member(outcome.photo, offset + n));
				maximumPublishedBatch = Math.max(maximumPublishedBatch, batch.length);
				await media.mediaRepository.catalogOriginals.retain(root.id, batch.map(photo => ({ photoId: photo.id,
					assetId: photo.original.storageKey, sourceId: photo.original.id, sha256: photo.original.contentSha256, size: photo.original.byteLength })));
				root = await catalog.publishPhotos(root.id, root.revision, batch);
			}
		}
		if (root.photoCount !== COUNT) throw new Error('Native stack publication did not reach130 photos.');
		const selected = Array.from({ length: COUNT }, (_, index) => photoId(index));
		const stackAudit = await qualifyStackAudit(catalog, root.id);
		root = (await catalog.loadCatalog(root.id))!;
		let stack = await catalog.saveStack({ schemaVersion: 1, kind: 'photo-stack', catalogId: root.id, id: 'native-stack', revision: 0,
			photoIds: selected, coverPhotoId: photoId(0) }, null, { expectedCatalogRevision: root.revision,
			expectedStateRevision: (await catalog.readStackState(root.id)).revision });
		const eligible = await collect(catalog, root.id, ordinary);
		if (eligible.ids.length !== 1 || eligible.ids[0] !== photoId(0) || eligible.emptyPendingSteps < 2) throw new Error('Eligible native cover was not fully authenticated.');
		const sparse = await collect(catalog, root.id, { ...ordinary, text: DISTANT });
		if (sparse.ids.length !== 1 || sparse.ids[0] !== photoId(129) || sparse.emptyPendingSteps < 2) throw new Error('Sparse native stack did not resume correctly.');
		root = (await catalog.loadCatalog(root.id))!;
		stack = await catalog.saveStack({ ...stack, coverPhotoId: photoId(129) }, stack.revision, { expectedCatalogRevision: root.revision,
			expectedStateRevision: (await catalog.readStackState(root.id)).revision });
		const crossPage = await collect(catalog, root.id, ordinary);
		if (crossPage.ids.length !== 1 || crossPage.ids[0] !== photoId(129)) throw new Error('Native distant cover was duplicated or lost.');
		root = (await catalog.loadCatalog(root.id))!;
		stack = await catalog.saveStack({ ...stack, coverPhotoId: photoId(0) }, stack.revision, { expectedCatalogRevision: root.revision,
			expectedStateRevision: (await catalog.readStackState(root.id)).revision });
		database = await openPhotoCatalogDatabaseV1(indexedDB, 'lightscaper-photo-catalog-v1', () => undefined);
		const index = database.transaction('photoStacks').objectStore('photoStacks').index('memberKey');
		const indexOptions = { keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
		if (index.keyPath !== 'memberKeys' || !index.unique || !index.multiEntry) throw new Error('Native forward index options differ from the contract.');
		await refuses(transact(database, 'photoStacks', 'readwrite', async stores => {
			await request(stores.photoStacks.put(photoStackRecordV1({ ...stack, id: 'duplicate', revision: 0, photoIds: selected.slice(0, 2), coverPhotoId: photoId(0) })));
		}), /ConstraintError/u, true);
		if ((await catalog.readStackState(root.id)).stackCount !== 1 || (await catalog.readStackPage(root.id)).items.length !== 1) throw new Error('Duplicate refusal changed grouping.');
		const first = await catalog.readStackQueryPage(root.id, { query: ordinary });
		if (first.items.length || !first.continuation?.pending) throw new Error('Distant native cover was published before complete authentication.');
		const otherConnection = new PhotoCatalogRepositoryV1({ indexedDB, verifyOriginal: media.verifyOriginal });
		try { await refuses(otherConnection.readStackQueryPage(root.id, { query: ordinary, continuation: first.continuation }), /signature|progress|connection|issuer|continuation/iu); }
		finally { await otherConnection.close(); }
		const reverseKey = `${root.id}|${photoId(100)}`;
		const reverse: unknown = await transact(database, 'photoStackMemberships', 'readwrite', async stores => {
			const captured: unknown = await request(stores.photoStackMemberships.get(reverseKey));
			if (captured === undefined) throw new Error('Expected native reverse row is missing before fault.');
			await request(stores.photoStackMemberships.delete(reverseKey)); return captured;
		});
		await refuses(catalog.readStackQueryPage(root.id, { query: ordinary, continuation: first.continuation }), /membership|reverse|missing/iu);
		await transact(database, 'photoStackMemberships', 'readwrite', async stores => { await request(stores.photoStackMemberships.put(reverse)); });
		await transact(database, ['photoStacks', 'photoStackMemberships'], 'readwrite', async stores => {
			await request(stores.photoStacks.delete(`${root.id}|${stack.id}`));
			for (const id of selected) await request(stores.photoStackMemberships.delete(`${root.id}|${id}`));
		});
		await refuses(catalog.readStackQueryPage(root.id, { query: ordinary }), /state|count|stack/iu);
		const body = await media.mediaRepository.loadAsset('native-stack-storage');
		const mediaDatabase = await openDatabase(indexedDB, PHOTO_MEDIA_NAMESPACES_V1.databaseName);
		let originalRootCount: unknown;
		try { originalRootCount = await transact(mediaDatabase, 'mediaAssets', 'readonly', async stores =>
			(await request<StorageRecord | undefined>(stores.mediaAssets.get('native-stack-storage')))?.catalogRootCount); }
		finally { mediaDatabase.close(); }
		if (!(body instanceof Blob) || body.size !== 163 || originalRootCount !== COUNT) throw new Error('Grouping faults changed original custody.');
		const actualSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await body.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
		if (actualSha256 !== PHOTO_LARGE_LIBRARY_SPECIFICATION_V1.sourceSha256) throw new Error('Native original bytes changed.');
		return { photoCount: root.photoCount, maximumPublishedBatch, stackAudit, eligible, sparse, crossPage, indexOptions,
			duplicateRefused: true, missingReverseRefused: true, missingStackRefused: true, crossConnectionRefused: true,
			sourceByteLength: body.size, actualSha256, originalRootCount };
	} finally { database?.close(); await Promise.all([catalog.close(), media.close()]); }
}

function member(template: unknown, index: number) {
	const photo = normalizePhotoDocumentV1(template), id = `native-stack-master-${String(index).padStart(3, '0')}`;
	return normalizePhotoDocumentV1({ ...photo, id: photoId(index), activeVersionId: id,
		versions: [{ ...photo.versions[0]!, id }], rating: index === 129 ? 5 : 4,
		metadata: { ...photo.metadata, fileName: `Stack-${String(index).padStart(3, '0')}.png`, title: index === 129 ? DISTANT : `Native member ${String(index)}` } });
}
async function qualifyStackAudit(catalog: PhotoCatalogRepositoryV1, catalogId: string) {
	const pairId = (index: number) => `native-pair-${String(index).padStart(3, '0')}`;
	for (let index = 0; index < 65; index++) {
		const root = await catalog.loadCatalog(catalogId), state = await catalog.readStackState(catalogId);
		if (!root) throw new Error('Native audit catalog disappeared.');
		await catalog.saveStack({ schemaVersion: 1, kind: 'photo-stack', catalogId, id: pairId(index), revision: 0,
			photoIds: [photoId(index * 2), photoId(index * 2 + 1)], coverPhotoId: photoId(index * 2) }, null,
		{ expectedCatalogRevision: root.revision, expectedStateRevision: state.revision });
	}
	const report = await collect(catalog, catalogId, ordinary, 65);
	if (report.firstStep.itemCount !== 0 || report.firstStep.scanned !== 64 || report.firstStep.auditCount !== 64
		|| report.emptyAuditSteps < 1 || report.ids.length !== 65 || report.ids.some((id, index) => id !== photoId(index * 2))) {
		throw new Error('Native65-stack count authentication did not resume before publishing photos.');
	}
	for (let index = 0; index < 65; index++) {
		const root = await catalog.loadCatalog(catalogId), state = await catalog.readStackState(catalogId);
		const stack = await catalog.loadStack(catalogId, pairId(index));
		if (!root || !stack) throw new Error('Native audit stack disappeared.');
		await catalog.dissolveStack(catalogId, stack.id, stack.revision,
			{ expectedCatalogRevision: root.revision, expectedStateRevision: state.revision });
	}
	if ((await catalog.readStackState(catalogId)).stackCount !== 0) throw new Error('Native audit stacks were not dissolved.');
	return report;
}
async function collect(catalog: PhotoCatalogRepositoryV1, catalogId: string, query: PhotoCatalogQueryV1, maximumIds = 1) {
	const ids: string[] = []; let continuation: PhotoStackQueryPageV1['continuation'] = null;
	let steps = 0, maximumScanned = 0, maximumNativeRowRequests = 0, maximumNativeAuditKeys = 0, maximumNativeReadRequests = 0;
	let emptyPendingSteps = 0, emptyAuditSteps = 0, firstStep = { itemCount: 0, scanned: 0, auditCount: 0 };
	do {
		const measured = await measure(() => catalog.readStackQueryPage(catalogId, { query, continuation })), page = measured.page;
		const reads = measured.rowRequests + measured.auditKeys;
		if (page.scanned > 64 || page.items.length > 64 || reads > 65) throw new RangeError('Native stack query exceeded its64-candidate/probe plus EOF bound.');
		if (new TextEncoder().encode(JSON.stringify(page.continuation)).byteLength > 4096) throw new RangeError('Native stack cursor exceeds4KiB.');
		maximumScanned = Math.max(maximumScanned, page.scanned); maximumNativeRowRequests = Math.max(maximumNativeRowRequests, measured.rowRequests);
		maximumNativeAuditKeys = Math.max(maximumNativeAuditKeys, measured.auditKeys); maximumNativeReadRequests = Math.max(maximumNativeReadRequests, reads);
		if (steps === 0) firstStep = { itemCount: page.items.length, scanned: page.scanned, auditCount: page.continuation?.stackAudit?.count ?? 0 };
		if (!page.items.length && page.continuation?.pending) emptyPendingSteps++;
		if (!page.items.length && page.continuation?.stackAudit) emptyAuditSteps++;
		ids.push(...page.items.map(row => row.photoId)); continuation = page.continuation;
		if (ids.length > maximumIds || ++steps > 20) throw new Error('Native stack query duplicated a representative or failed to progress.');
	} while (continuation !== null);
	return { ids, steps, maximumScanned, maximumNativeRowRequests, maximumNativeAuditKeys, maximumNativeReadRequests,
		emptyPendingSteps, emptyAuditSteps, firstStep };
}
async function measure(read: () => Promise<PhotoStackQueryPageV1>) {
	const get = IDBObjectStore.prototype.get, cursor = IDBIndex.prototype.openCursor, keys = IDBObjectStore.prototype.openKeyCursor;
	let rowRequests = 0, auditKeys = 0;
	IDBObjectStore.prototype.get = function (...args) { if (this.name === 'photoQueryRows') rowRequests++; return Reflect.apply(get, this, args); };
	IDBIndex.prototype.openCursor = function (...args) { if (this.objectStore.name === 'photoQueryRows') rowRequests++; return Reflect.apply(cursor, this, args); };
	IDBObjectStore.prototype.openKeyCursor = function (...args) {
		const pending = Reflect.apply(keys, this, args) as IDBRequest<IDBCursor | null>;
		if (this.name === 'photoStacks') pending.addEventListener('success', () => { if (pending.result !== null) auditKeys++; });
		return pending;
	};
	try { return { page: await read(), rowRequests, auditKeys }; }
	finally { IDBObjectStore.prototype.get = get; IDBIndex.prototype.openCursor = cursor; IDBObjectStore.prototype.openKeyCursor = keys; }
}
async function refuses(operation: Promise<unknown>, pattern: RegExp, name = false) {
	try { await operation; } catch (error) {
		if (error instanceof Error && pattern.test(name ? error.name : error.message)) return;
		throw error;
	}
	throw new Error('Expected native storage refusal did not occur.');
}

export type PhotoStackNativeObservationV1 = Awaited<ReturnType<typeof observePhotoStackLibraryNativeV1>>;
