/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readCursorPage, request } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { catalogTransaction } from '../../src/lightscaper/catalog/catalog-transaction.ts';
import { createPhotoCatalogRestoreStageV1, type PhotoCatalogRestoreStageV1 } from '../../src/lightscaper/catalog/photo-catalog-restore-stage-v1.ts';
import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { PHOTO_CATALOG_STORES } from '../../src/lightscaper/catalog/repository-types.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoSmartCollectionV1 } from '../../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { photoCatalogRestorePhotoRecordsV1 } from '../../src/lightscaper/catalog/photo-catalog-restore-records-v1.ts';
import { photoSmartCollectionRecordV1 } from '../../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './lightscaper-catalog-query-fixture.ts';
import { observeNativeCatalogRestoreV1 } from './lightscaper-catalog-restore-native-observer.ts';

const MAXIMUM = Number.MAX_SAFE_INTEGER;
const PREFIX = 'lightscaper-native-restore-';
const encoder = new TextEncoder();

/** This qualifies the native catalog candidate; it does not publish a library or stage original media. */
export async function qualifyNativeCatalogRestoreV1(mode: string) {
	const observer = observeNativeCatalogRestoreV1(PREFIX), names = new Set<string>(), stages = new Set<PhotoCatalogRestoreStageV1>();
	const connections = new Set<IDBDatabase>(), owners = new Set<PhotoCatalogRepositoryV1>();
	try {
		const result = mode === 'preservation' ? await preservation() : mode === 'collision' ? await collision()
			: mode === 'corruption' ? await corruption() : mode === 'cancellation' ? await cancellation()
				: (() => { throw new RangeError('Unknown native restore qualification.'); })();
		await observer.settle();
		return { result, activeTransactions: observer.activeTransactions, forbiddenRequests: observer.forbiddenRequests,
			maximumKeyDeliveries: observer.maximumKeyDeliveries, maximumCountRequests: observer.maximumCountRequests };
	} finally {
		for (const owner of owners) await owner.close();
		for (const stage of stages) await stage.close();
		for (const database of connections) database.close();
		await observer.settle(); observer.restore();
		for (const name of names) await request(indexedDB.deleteDatabase(name));
	}
	function scratch() { const name = `${PREFIX}${crypto.randomUUID()}`; names.add(name); return name; }
	function root(photoCount = 66) { return { ...queryCatalogRootV1(), revision: MAXIMUM, photoCount }; }
	function photo(index = 0) { return normalizePhotoDocumentV1({ ...queryPhotoV1(index), revision: MAXIMUM - index }); }
	function definition() {
		return normalizePhotoSmartCollectionV1({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: 'catalog',
			id: 'saved', revision: MAXIMUM, name: 'Archived full query', query: { schemaVersion: 2, kind: 'photo-catalog-query',
				text: 'Sparse', filter: { kind: 'collection', id: 'manual' }, sort: { field: 'capture-time', direction: 'descending' },
				predicate: { kind: 'all', terms: [{ kind: 'keyword', id: 'keyword' }, { kind: 'folder', id: 'folder' }] } } });
	}
	function state(revision = MAXIMUM, collectionCount = 1) {
		return { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog', revision, collectionCount };
	}
	async function candidate(savedState: unknown = state(), count = 66, name = scratch(), signal?: AbortSignal) {
		const stage = await createPhotoCatalogRestoreStageV1({ indexedDB, databaseName: name, root: root(count), savedState, signal });
		stages.add(stage); return stage;
	}
	async function connection(name: string) {
		const database = await request(indexedDB.open(name)); connections.add(database); return database;
	}
	async function value(database: IDBDatabase, store: string, key: string): Promise<unknown> {
		return catalogTransaction(database, [store], 'readonly', stores => request(stores[store]!.get(key)));
	}
	async function fingerprint(database: IDBDatabase) {
		const hash = sha256.create();
		for (const store of PHOTO_CATALOG_STORES) {
			hash.update(encoder.encode(store)); let after: IDBValidKey | undefined;
			for (;;) {
				const page = await catalogTransaction(database, [store], 'readonly', stores => readCursorPage(stores[store]!, {
					query: after === undefined ? undefined : IDBKeyRange.lowerBound(after, true), limit: 64,
					project: (record: unknown, key) => ({ key, record }),
				}));
				for (const record of page) hash.update(encoder.encode(JSON.stringify(record)));
				if (page.length < 64) break; after = page.at(-1)!.key;
			}
		}
		return bytesToHex(hash.digest());
	}
	async function refused(operation: () => Promise<unknown>) {
		try { await operation(); return false; } catch { return true; }
	}
	async function preservation() {
		const stage = await candidate(); for (let index = 0; index < 66; index++) await stage.writePhoto(photo(index));
		const saved = definition(), stack = { schemaVersion: 1, kind: 'photo-stack', catalogId: 'catalog', id: 'stack',
			revision: MAXIMUM, photoIds: [photo(65).id, photo(0).id, photo(64).id], coverPhotoId: photo(64).id };
		await stage.writeStack(stack); await stage.writeSavedCollection(saved); const ready = await stage.finish(); await stage.close();
		const owner = new PhotoCatalogRepositoryV1({ indexedDB, databaseName: stage.databaseName, verifyOriginal: async () => undefined });
		owners.add(owner); const database = await connection(stage.databaseName);
		const storedStack = await value(database, 'photoStacks', 'catalog|stack') as { document: unknown };
		const unchanged = JSON.stringify(await owner.loadCatalog('catalog')) === JSON.stringify(root());
		const first = await owner.loadPhoto('catalog', photo(0).id), last = await owner.loadPhoto('catalog', photo(65).id);
		const loaded = await owner.loadSmartCollection('catalog', saved.id);
		const nullState = await candidate(null, 0); await nullState.finish(); await nullState.close();
		const zeroState = await candidate(state(0, 0), 0); await zeroState.finish(); await zeroState.close();
		const tombstone = await candidate(state(MAXIMUM, 0), 0); await tombstone.finish(); await tombstone.close();
		const rich = await richMetadata();
		return { ready, rootUnchanged: unchanged, firstPhotoExact: JSON.stringify(first) === JSON.stringify(photo(0)),
			lastPhotoExact: JSON.stringify(last) === JSON.stringify(photo(65)), stackExact: JSON.stringify(storedStack.document) === JSON.stringify(stack),
			fullSavedExact: JSON.stringify(loaded) === JSON.stringify(saved), savedState: await value(database, 'photoSmartCollectionStates', 'catalog'),
			index: await value(database, 'catalogStates', 'catalog'), stackState: await value(database, 'photoStackStates', 'catalog'),
			queryReady: await value(database, 'photoQueryBuildStatesV2', 'catalog'),
			legacyReady: await value(database, 'photoQueryBuildStates', 'catalog'),
			absentSavedState: await value(await connection(nullState.databaseName), 'photoSmartCollectionStates', 'catalog') === undefined,
			zeroSavedState: await value(await connection(zeroState.databaseName), 'photoSmartCollectionStates', 'catalog'),
			tombstoneSavedState: await value(await connection(tombstone.databaseName), 'photoSmartCollectionStates', 'catalog'), rich };
	}
	async function richMetadata() {
		const ids = (prefix: string) => Array.from({ length: 1_024 }, (_, index) => `${prefix}${String(index).padStart(4, '0')}${'x'.repeat(123)}`);
		const keywordIds = ids('k'), collectionIds = ids('c'), words = '\ud800'.repeat(16_384), camera = '\ud800'.repeat(1_024);
		const largeRoot = { ...root(1), folders: [], keywords: keywordIds.map(id => ({ id, name: 'Keyword', parentId: null })),
			collections: collectionIds.map(id => ({ id, name: 'Manual', kind: 'manual' })) };
		const base = photo(), source = normalizePhotoDocumentV1({ ...base, folderId: null, keywordIds, collectionIds,
			metadata: { ...base.metadata, cameraMake: camera, cameraModel: camera, lens: camera,
				title: words, caption: words, creator: words, copyright: words, location: words } });
		const stage = await createPhotoCatalogRestoreStageV1({ indexedDB, databaseName: scratch(), root: largeRoot, savedState: null });
		stages.add(stage); await stage.writePhoto(source); await stage.finish(); await stage.close();
		const database = await connection(stage.databaseName), stored = await value(database, 'photos', `catalog|${source.id}`) as { document: unknown };
		return { exact: JSON.stringify(stored.document) === JSON.stringify(source), sourceBytes: encoder.encode(JSON.stringify(source)).byteLength,
			legacy: await value(database, 'photoQueryBuildStates', 'catalog'), current: await value(database, 'photoQueryBuildStatesV2', 'catalog') };
	}
	async function collision() {
		const stage = await candidate(null, 1); await stage.writePhoto(photo()); await stage.finish(); await stage.close();
		const database = await connection(stage.databaseName), before = await fingerprint(database);
		const collisionRefused = await refused(() => candidate(null, 0, stage.databaseName));
		return { collisionRefused, existingUnchanged: before === await fingerprint(database), version: database.version };
	}
	async function corruption() {
		const refusals: string[] = []; let auditDidNotRepair = true;
		for (const kind of ['projection', 'coherent-photo', 'saved-query', 'foreign-row']) {
			const stage = await candidate(); for (let index = 0; index < 66; index++) await stage.writePhoto(photo(index));
			await stage.writeSavedCollection(definition()); const database = await connection(stage.databaseName), key = `catalog|${photo(65).id}`;
			await catalogTransaction(database, PHOTO_CATALOG_STORES, 'readwrite', async stores => {
				if (kind === 'projection') {
					const summary = await request(stores.summaries!.get(key)) as Record<string, unknown>;
					await request(stores.summaries!.put({ ...summary, fileName: 'Valid but counterfeit.png' }));
				} else if (kind === 'coherent-photo') {
					const source = photo(65), records = photoCatalogRestorePhotoRecordsV1(root(), { ...source,
						metadata: { ...source.metadata, title: 'Valid same-revision replacement' } });
					await request(stores.photos!.put(records.photo)); await request(stores.summaries!.put(records.summary));
					await request(stores.photoQueryRows!.put(records.queryV1)); await request(stores.photoQueryRowsV2!.put(records.queryV2));
				} else if (kind === 'saved-query') {
					const source = definition(); await request(stores.photoSmartCollections!.put(photoSmartCollectionRecordV1({ ...source,
						query: { ...source.query, text: 'Valid same-revision replacement' } })));
				} else {
					const document = normalizePhotoDocumentV1({ ...photo(), catalogId: 'foreign' });
					await request(stores.photos!.put({ key: `foreign|${document.id}`, document }));
				}
			});
			const before = await fingerprint(database); if (await refused(() => stage.finish())) refusals.push(kind);
			auditDidNotRepair &&= before === await fingerprint(database);
		}
		return { refusals, auditDidNotRepair };
	}
	async function cancellation() {
		const stop = new AbortController(), reason = new Error('native restore final audit cancelled');
		const stage = await candidate(null, 2, scratch(), stop.signal); await stage.writePhoto(photo()); await stage.writePhoto(photo(1));
		const stack = { schemaVersion: 1, kind: 'photo-stack', catalogId: 'catalog', id: 'stack',
			revision: 91, photoIds: [photo().id, photo(1).id], coverPhotoId: photo().id };
		const overlappingWrite = stage.writeStack(stack); let overlapSourceReads = 0;
		const next = new Proxy({ ...stack, id: 'another-stack' }, {
			ownKeys(target) { overlapSourceReads++; return Reflect.ownKeys(target); },
		});
		const overlapRefused = await refused(() => stage.writeStack(next)); await overlappingWrite;
		const database = await connection(stage.databaseName), before = await fingerprint(database);
		observer.onRead = store => { if (store === 'photos') { observer.onRead = null; stop.abort(reason); } };
		let failure: unknown; try { await stage.finish(); } catch (error) { failure = error; }
		observer.onRead = null; await stage.close(); await observer.settle();
		const cancelledJoined = observer.activeTransactions === 0;
		const cancellationUnchanged = before === await fingerprint(database);
		database.close(); connections.delete(database); await stage.rollback();
		const replacement = await candidate(null, 0, stage.databaseName); await replacement.finish(); await replacement.close();
		const late = new AbortController(), acknowledged = await candidate(null, 1, scratch(), late.signal);
		await acknowledged.writePhoto(photo()); observer.onReadinessComplete = () => { observer.onReadinessComplete = null; late.abort(reason); };
		const ready = await acknowledged.finish(); await acknowledged.close(); observer.onReadinessComplete = null;
		return { overlapRefused, overlapSourceReads, exactCancellation: failure === reason, cancelledJoined, cancellationUnchanged, candidateRollbackDeleted: true, lateAborted: late.signal.aborted,
			readinessAcknowledged: ready.photoCount === 1, readyRevision: ready.catalogRevision };
	}
}
