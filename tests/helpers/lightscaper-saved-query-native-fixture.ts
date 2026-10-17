/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { openPhotoCatalogDatabaseV1 } from '../../src/lightscaper/catalog/catalog-database.ts';
import { PHOTO_CATALOG_STORES } from '../../src/lightscaper/catalog/repository-types.ts';
import { catalogTransaction } from '../../src/lightscaper/catalog/catalog-transaction.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoCatalogQueryV2, type PhotoCatalogQueryV2 } from '../../src/lightscaper/catalog/photo-query-types-v2.ts';
import { photoSmartCollectionKeyV1, photoSmartCollectionRecordV1 } from '../../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { normalizePhotoSmartCollectionV1 } from '../../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { photoSmartCollectionSummaryRecordV1, PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1,
	readPhotoSmartCollectionStorageContextV1 } from '../../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { readPhotoSmartCollectionQueryPageV1, readPhotoSmartCollectionStackQueryPageV1 } from '../../src/lightscaper/catalog/photo-smart-collection-query-v1.ts';
import type { PhotoSavedQueryModeV1, PhotoSavedQueryContinuationV1, PhotoSavedQueryPageV1 } from '../../src/lightscaper/catalog/photo-smart-collection-query-types-v1.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './lightscaper-catalog-query-fixture.ts';
import { nativeSmartCollectionBytesV1 as bytes, nativeSmartCollectionTransactionV1 as transaction,
	nativeSmartCollectionFingerprintV1 as fingerprint } from './lightscaper-smart-collections-native-observer.ts';
import { observeNativeSavedQueryExecutionV1, type NativeSavedQueryMeasurementV1 } from './lightscaper-saved-query-native-observer.ts';

type Mode = 'ordinary' | 'authority' | 'collapsed' | 'audit' | 'lifetime';
const ordinary = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', sort: { field: 'photo-id', direction: 'ascending' } });
const photoId = (index: number) => `photo-${String(index).padStart(6, '0')}`;
const photoIds = () => Array.from({ length: 130 }, (_, index) => photoId(index));
type Fixture = Readonly<{ owner: PhotoCatalogRepositoryV1; database: IDBDatabase; name: string }>;
type ReadResult = Readonly<{ value: PhotoSavedQueryPageV1; measurement: NativeSavedQueryMeasurementV1 }>;

/** Actual native IndexedDB only. Synthetic original verification qualifies catalog mechanics, not media or decoding.
 * Each scratch scope owns <=130 small canonical photos, <=65 stacks and <=2 definitions, publication batches<=16.
 * Fingerprints inspect only these owned bounded stores (or one2MiB root+one escaped recipe), never the user's catalog.
 * Returned data<=256KiB; read phases keep only scalar counters/IDs, <=64 summaries and one<=4KiB continuation.
 * Serialized component budgets are asserted separately; no source-equivalent8MiB or engine/RSS scan claim. */
export async function qualifyNativeSavedQueryExecutionV1(mode: Mode) {
	const prefix = `saved-execution-native-${crypto.randomUUID()}`, names: string[] = [], owners: PhotoCatalogRepositoryV1[] = [];
	const connections: IDBDatabase[] = [], observer = observeNativeSavedQueryExecutionV1(prefix);
	let result: unknown, failed = false, failure: unknown;
	try {
		switch (mode) {
			case 'ordinary': result = await qualifyOrdinary(); break;
			case 'authority': result = await qualifyAuthority(); break;
			case 'collapsed': result = await qualifyCollapsed(); break;
			case 'audit': result = await qualifyAudit(); break;
			case 'lifetime': result = await qualifyLifetime(); break;
			default: throw new RangeError('Unsupported native saved-execution qualification mode.');
		}
	} catch (error) { failed = true; failure = error; }
	observer.onRead = null; observer.onComplete = null;
	const cleanup: unknown[] = [];
	for (const outcome of await Promise.allSettled(owners.map(owner => owner.close()))) if (outcome.status === 'rejected') cleanup.push(outcome.reason);
	for (const database of connections) { try { database.close(); } catch (error) { cleanup.push(error); } }
	await observer.settle(); observer.restore();
	for (const name of names) {
		try { await new Promise<void>((resolve, reject) => {
			const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
			request.onblocked = () => reject(new Error('Owned native saved-execution cleanup was blocked.'));
		}); } catch (error) { cleanup.push(error); }
	}
	if (cleanup.length) throw new AggregateError(failed ? [failure, ...cleanup] : cleanup, 'Native saved-execution cleanup failed.');
	if (failed) throw failure;
	const report = { result, forbiddenRequests: observer.forbiddenRequests, activeTransactions: observer.activeTransactions };
	check(bytes(report) <= 262_144, 'Native saved-execution report exceeds256KiB.'); return report;

	async function connection(name: string) {
		const database = await openPhotoCatalogDatabaseV1(indexedDB, name, () => undefined); connections.push(database); return database;
	}
	async function prepare(suffix: string, count = 130, root = queryCatalogRootV1()): Promise<Fixture> {
		const name = `${prefix}-${suffix}`; names.push(name);
		const owner = new PhotoCatalogRepositoryV1({ indexedDB, databaseName: name, verifyOriginal: async () => undefined }); owners.push(owner);
		let current = root; await owner.createCatalog(root);
		for (let offset = 0; offset < count; offset += 16) current = await owner.publishPhotos(root.id, current.revision,
			Array.from({ length: Math.min(16, count - offset) }, (_, delta) => {
				const index = offset + delta, photo = queryPhotoV1(index);
				return normalizePhotoDocumentV1({ ...photo, metadata: { ...photo.metadata, cameraMake: index % 2 === 0 ? 'Canon' : 'Nikon',
					cameraModel: 'Native model', lens: 'Native lens', iso: index % 2 === 0 ? 200 : 800 } });
			}));
		const fixture = { owner, name, database: await connection(name) }; await save(fixture, ordinary); return fixture;
	}
	async function context(f: Fixture) {
		return catalogTransaction(f.database, PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, 'readonly', stores =>
			readPhotoSmartCollectionStorageContextV1(stores, 'catalog'));
	}
	async function save(f: Fixture, query: PhotoCatalogQueryV2, definitionId = 'saved', name = 'Saved full criteria') {
		const current = await f.owner.loadSmartCollection('catalog', definitionId), captured = await context(f);
		return f.owner.saveSmartCollection({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: 'catalog', id: definitionId,
			revision: current?.revision ?? 0, name, query }, current?.revision ?? null,
		{ expectedCatalogRevision: captured.root.revision, expectedIndexRevision: captured.index.indexRevision, expectedStateRevision: captured.state.revision });
	}
	async function group(f: Fixture, ids = photoIds(), cover = ids[0]!, id = 'stack') {
		const root = await f.owner.loadCatalog('catalog'), state = await f.owner.readStackState('catalog'), previous = await f.owner.loadStack('catalog', id);
		check(root !== null, 'Native grouping catalog is missing.');
		return f.owner.saveStack({ schemaVersion: 1, kind: 'photo-stack', catalogId: 'catalog', id, revision: previous?.revision ?? 0,
			photoIds: ids, coverPhotoId: cover }, previous?.revision ?? null, { expectedCatalogRevision: root.revision, expectedStateRevision: state.revision });
	}
	async function read(f: Fixture, mode: PhotoSavedQueryModeV1, continuation: PhotoSavedQueryContinuationV1 | null = null): Promise<ReadResult> {
		const readPage = mode === 'ordinary' ? readPhotoSmartCollectionQueryPageV1 : readPhotoSmartCollectionStackQueryPageV1;
		return observer.measure(() => readPage(f.database, 'catalog', 'saved', { continuation }));
	}
	function union(result: ReadResult, mode: PhotoSavedQueryModeV1): boolean {
		const expected = [...PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, 'photoQueryRowsV2', 'photoQueryBuildStatesV2',
			...(mode === 'collapsed' ? ['photoStacks', 'photoStackStates', 'photoStackMemberships'] : [])].sort();
		return result.measurement.transactionCount === 1 && result.measurement.transactions[0]!.mode === 'readonly'
			&& JSON.stringify(result.measurement.transactions[0]!.stores) === JSON.stringify(expected)
			&& result.measurement.definitionReads === 1 && result.measurement.writeAttempts === 0;
	}
	async function unchanged<T>(f: Fixture, operation: () => Promise<T>): Promise<T> {
		const before = await fingerprint(f.database, PHOTO_CATALOG_STORES), result = await operation();
		check(before === await fingerprint(f.database, PHOTO_CATALOG_STORES), 'A native saved read changed durable stores.'); return result;
	}
	async function refusedBeforeRows(f: Fixture, operation: () => Promise<unknown>, beforeTransaction = false) {
		return unchanged(f, async () => {
			const outcome = await observer.measure(async () => {
				try { await operation(); return false; } catch (error) {
					if (!(error instanceof Error) || !/revision|changed|digest|definition|summary|query|reference|missing|saved|hierarchy|signature|authentication/iu.test(error.message)) throw error;
					return true;
				}
			});
			check(outcome.value && outcome.measurement.rowRequests === 0 && outcome.measurement.rowDeliveries === 0
				&& outcome.measurement.writeAttempts === 0, 'Saved authority refused after Row2 work or did not refuse.');
			if (beforeTransaction) check(outcome.measurement.transactionCount === 0, 'Counterfeit or foreign saved continuation opened a transaction.');
			return outcome.measurement.transactionCount;
		});
	}
	async function collect(f: Fixture, mode: PhotoSavedQueryModeV1, first?: ReadResult, observePage?: (page: PhotoSavedQueryPageV1) => void) {
		const ids: string[] = [], stats = { maximumScanned: 0, maximumRowWorkAndAuditKeys: 0, maximumItems: 0,
			maximumSummaryBytes: 0, maximumContinuationBytes: 0, maximumEmptySeeks: 0, steps: 0 };
		const empty: boolean[] = []; let selected = first ?? await read(f, mode);
		while (true) {
			const { value: page, measurement } = selected;
			observePage?.(page);
			check(union(selected, mode), 'Saved execution did not retain its entire authority and Row2 work in one readonly transaction.');
			const work = measurement.rowDeliveries + measurement.auditKeyDeliveries;
			check(page.scanned <= 64 && work <= 64 && page.items.length <= 64 && measurement.emptySeeks <= 2, 'Native saved page exceeded its work bounds.');
			stats.maximumScanned = Math.max(stats.maximumScanned, page.scanned); stats.maximumRowWorkAndAuditKeys = Math.max(stats.maximumRowWorkAndAuditKeys, work);
			stats.maximumItems = Math.max(stats.maximumItems, page.items.length); stats.maximumEmptySeeks = Math.max(stats.maximumEmptySeeks, measurement.emptySeeks);
			stats.maximumContinuationBytes = Math.max(stats.maximumContinuationBytes, bytes(page.continuation));
			for (const item of page.items) stats.maximumSummaryBytes = Math.max(stats.maximumSummaryBytes, bytes(item));
			check(stats.maximumContinuationBytes <= 4096 && stats.maximumSummaryBytes <= 4096, 'Native saved scalar output exceeds its closed byte budgets.');
			ids.push(...page.items.map(item => item.photoId)); empty.push(page.items.length === 0);
			check(ids.length <= 130 && ++stats.steps <= 24, 'Native saved scan duplicated rows or did not progress.');
			if (page.continuation === null) break;
			selected = await read(f, mode, page.continuation);
		}
		return { ids, empty, ...stats };
	}

	async function qualifyOrdinary() {
		const f = await prepare('ordinary');
		const complete = normalizePhotoCatalogQueryV2({ ...ordinary, text: 'LANDSCAPE', filter: { kind: 'collection', id: 'manual' },
			predicate: { kind: 'all', terms: [{ kind: 'rating', minimum: 2, maximum: 5 },
				{ kind: 'text', column: 'camera-make', operator: 'equals', value: 'Canon' },
				{ kind: 'number', column: 'iso', minimum: 200, maximum: 200 }] } });
		await save(f, complete); const full = await unchanged(f, () => collect(f, 'ordinary'));
		const loaded = await f.owner.loadSmartCollection('catalog', 'saved');
		const fullCriteriaPreserved = JSON.stringify(loaded?.query) === JSON.stringify(complete);
		const root = await f.owner.loadCatalog('catalog'); check(root !== null, 'Native root is missing.');
		await f.owner.saveCatalog({ ...root, keywords: root.keywords.map(node => ({ ...node, name: 'Renamed keyword' })) }, root.revision);
		const renamed = await unchanged(f, () => collect(f, 'ordinary'));
		await save(f, normalizePhotoCatalogQueryV2({ ...ordinary, predicate: { kind: 'file-name', contains: '99871' } }));
		const sparse = await unchanged(f, () => collect(f, 'ordinary'));
		let knownBeforeUnknownBothDirections = true, clocksOrderedBothDirections = true;
		const measured = [full, sparse];
		for (const direction of ['ascending', 'descending'] as const) {
			await save(f, normalizePhotoCatalogQueryV2({ ...ordinary, sort: { field: 'capture-time', direction } }));
			const capture = await unchanged(f, () => collect(f, 'ordinary'));
			measured.push(capture);
			const known = capture.ids.filter(id => queryPhotoV1(Number(id.slice(-6))).metadata.captureTime !== null);
			knownBeforeUnknownBothDirections &&= JSON.stringify(capture.ids.slice(0, known.length)) === JSON.stringify(known);
			const clocks = known.map(id => queryPhotoV1(Number(id.slice(-6))).metadata.captureTime!.local);
			clocksOrderedBothDirections &&= JSON.stringify(clocks) === JSON.stringify([...clocks].sort((a, b) => direction === 'ascending' ? a.localeCompare(b) : b.localeCompare(a)));
		}
		const maximum = { ...full };
		for (const reading of measured) for (const key of ['maximumScanned', 'maximumRowWorkAndAuditKeys', 'maximumItems',
			'maximumSummaryBytes', 'maximumContinuationBytes', 'maximumEmptySeeks'] as const) maximum[key] = Math.max(maximum[key], reading[key]);
		return { ...maximum, fullIds: full.ids, sparseIds: sparse.ids, fullCriteriaPreserved,
			liveKeywordRenameRemovedMatches: renamed.ids.length === 0, sparseFirstPagesEmpty: sparse.empty[0] && sparse.empty[1],
			knownBeforeUnknownBothDirections, clocksOrderedBothDirections, unionReadonly: true, storesUnchanged: true };
	}

	async function qualifyAuthority() {
		const f = await prepare('connections'); await group(f);
		const second = await connection(f.name); check(second !== f.database, 'Native indexedDB.open reused a physical connection.');
		const ordinaryPage = await read(f, 'ordinary'), collapsedPage = await read(f, 'collapsed');
		check(ordinaryPage.value.continuation !== null && collapsedPage.value.continuation !== null
			&& collapsedPage.value.continuation.pending !== null, 'Expected real native signed progress.');
		const ordinaryForeignTransactions = await refusedBeforeRows(f, () => readPhotoSmartCollectionQueryPageV1(second, 'catalog', 'saved', { continuation: ordinaryPage.value.continuation }), true);
		const collapsedForeignTransactions = await refusedBeforeRows(f, () => readPhotoSmartCollectionStackQueryPageV1(second, 'catalog', 'saved', { continuation: collapsedPage.value.continuation }), true);
		const refusals = ['edited', 'recreated', 'same-revision-query', 'summary', 'hidden-reference', 'orphan'];
		for (const corruption of refusals) {
			const target = await prepare(corruption), first = await read(target, 'ordinary'); check(first.value.continuation !== null, 'Expected native ordinary continuation.');
			const current = await target.owner.loadSmartCollection('catalog', 'saved'); check(current !== null, 'Expected selected definition.');
			if (corruption === 'edited') await save(target, normalizePhotoCatalogQueryV2({ ...ordinary, text: 'Changed' }));
			else if (corruption === 'recreated') {
				const captured = await context(target); await target.owner.deleteSmartCollection('catalog', 'saved', current.revision,
					{ expectedCatalogRevision: captured.root.revision, expectedIndexRevision: captured.index.indexRevision, expectedStateRevision: captured.state.revision });
				await save(target, ordinary);
			} else await transaction(target.database, ['photoSmartCollections', 'photoSmartCollectionSummaries'], 'readwrite', stores => {
				if (corruption === 'orphan') stores.photoSmartCollectionSummaries!.delete(photoSmartCollectionKeyV1('catalog', 'saved'));
				else if (corruption === 'summary') stores.photoSmartCollectionSummaries!.put(photoSmartCollectionSummaryRecordV1({ ...current, name: 'Corrupt paired name' }));
				else {
					const query = corruption === 'hidden-reference' ? normalizePhotoCatalogQueryV2({ ...ordinary, predicate: { kind: 'any', terms: [
						{ kind: 'rating', minimum: 0, maximum: 5 }, { kind: 'not', term: { kind: 'keyword', id: 'missing-keyword' } }] } })
						: normalizePhotoCatalogQueryV2({ ...ordinary, text: 'Changed at same revision' });
					stores.photoSmartCollections!.put(photoSmartCollectionRecordV1({ ...current, query }));
				}
			});
			// Fresh execution proves hidden-reference admission itself, independently of a changed cursor digest.
			await refusedBeforeRows(target, () => readPhotoSmartCollectionQueryPageV1(target.database, 'catalog', 'saved', {
				continuation: corruption === 'hidden-reference' ? null : first.value.continuation,
			}));
		}
		return { distinctNativeConnections: true, ordinaryForeignTransactions, collapsedForeignTransactions, ordinaryForeignRefused: true,
			collapsedForeignRefused: true, allRefusalsBeforeRows: true, refusals, storesUnchanged: true };
	}

	async function qualifyCollapsed() {
		const f = await prepare('collapsed'); await group(f);
		const members = new Set<string>(); observer.onRead = (store, method, key) => {
			if (store === 'photoStackMemberships' && method === 'get' && typeof key === 'string') members.add(key);
		};
		const first = await unchanged(f, () => read(f, 'collapsed')); check(first.value.continuation !== null
			&& first.value.continuation.pending !== null, 'Native130-member cover did not require pending progress.');
		const eligible = await unchanged(f, () => collect(f, 'collapsed', first, page => {
			check(page.items.length === 0 || (members.size === 130 && photoIds().every(id => members.has(`catalog|${id}`))),
				'Native cover was published before all130 members were authenticated.');
		})); observer.onRead = null;
		await group(f, photoIds(), photoId(129));
		await save(f, normalizePhotoCatalogQueryV2({ ...ordinary, predicate: { kind: 'number', column: 'iso', minimum: 200, maximum: 200 } }));
		const fallback = await unchanged(f, () => collect(f, 'collapsed'));
		const pending = await read(f, 'collapsed'), cursor = pending.value.continuation;
		check(cursor !== null && cursor.pending !== null, 'Expected full-auth fallback pending progress.');
		const counterfeitTransactions = await refusedBeforeRows(f, () => readPhotoSmartCollectionStackQueryPageV1(f.database, 'catalog', 'saved', {
			continuation: { ...cursor, pending: { ...cursor.pending, nextMember: 130 } },
		}), true);
		await transaction(f.database, ['photoStackMemberships'], 'readwrite', stores => { stores.photoStackMemberships!.delete(`catalog|${photoId(100)}`); });
		await unchanged(f, async () => {
			const outcome = await observer.measure(async () => {
				try { await readPhotoSmartCollectionStackQueryPageV1(f.database, 'catalog', 'saved', { continuation: cursor }); return false; }
				catch (error) { if (!(error instanceof Error) || !/membership|reverse|missing/iu.test(error.message)) throw error; return true; }
			});
			check(outcome.value && outcome.measurement.rowDeliveries > 0 && outcome.measurement.writeAttempts === 0, 'Native later member loss was not authenticated during resume.');
		});
		return { ...eligible, first: { items: first.value.items.length, scanned: first.value.scanned, pending: first.value.continuation.pending !== null },
			eligibleIds: eligible.ids, fallbackIds: fallback.ids, authenticatedMembers: members.size, counterfeitTransactions,
			counterfeitRefused: true, laterMemberRefused: true, storesUnchanged: true };
	}

	async function qualifyAudit() {
		const f = await prepare('audit');
		for (let index = 0; index < 65; index++) await group(f, [photoId(index * 2), photoId(index * 2 + 1)], photoId(index * 2), `pair-${String(index).padStart(3, '0')}`);
		const first = await unchanged(f, () => read(f, 'collapsed')), result = await unchanged(f, () => collect(f, 'collapsed', first));
		return { ...result, first: { items: first.value.items.length, scanned: first.value.scanned,
			auditCount: first.value.continuation?.stackAudit?.count ?? 0, rowRequests: first.measurement.rowRequests, rowDeliveries: first.measurement.rowDeliveries }, storesUnchanged: true };
	}

	async function qualifyLifetime() {
		const f = await prepare('lifetime', 2); let exactReasons = true, reasonInspections = 0, signalShadowsRead = 0, cancellations = 0;
		for (const mode of ['ordinary', 'collapsed'] as const) for (const kind of [17, 'opaque', null, 'proxy']) {
			const stop = new AbortController(), reason: unknown = kind === 'proxy' ? new Proxy({}, {
				get() { reasonInspections++; throw new Error('Opaque native reason inspected.'); },
				getPrototypeOf() { reasonInspections++; throw new Error('Opaque native reason prototype inspected.'); },
			}) : kind;
			observer.onRead = store => {
				if (store !== 'photoSmartCollections') return;
				observer.onRead = null;
				Object.defineProperty(stop.signal, 'throwIfAborted', { get() { signalShadowsRead++; return () => undefined; } });
				Object.defineProperty(stop.signal, 'aborted', { get() { signalShadowsRead++; return false; } }); stop.abort(reason);
			};
			const outcome = await unchanged(f, () => observer.measure(async () => {
				const readPage = mode === 'ordinary' ? readPhotoSmartCollectionQueryPageV1 : readPhotoSmartCollectionStackQueryPageV1;
				try { await readPage(f.database, 'catalog', 'saved', { signal: stop.signal }); return false; } catch (error) { return error === reason; }
			}));
			exactReasons &&= outcome.value; cancellations++; observer.onRead = null;
			check(outcome.measurement.rowRequests === 0 && outcome.measurement.writeAttempts === 0 && observer.activeTransactions === 0, 'Cancelled native admission leaked work or lifetime.');
		}
		let postCompleteRejected = true;
		for (const mode of ['ordinary', 'collapsed'] as const) {
			const stop = new AbortController(), reason = new Proxy({}, {
				get() { reasonInspections++; throw new Error('Late native reason inspected.'); },
				getPrototypeOf() { reasonInspections++; throw new Error('Late native reason prototype inspected.'); },
			});
			observer.onComplete = () => { observer.onComplete = null; stop.abort(reason); };
			const late = await unchanged(f, () => observer.measure(async () => {
				const readPage = mode === 'ordinary' ? readPhotoSmartCollectionQueryPageV1 : readPhotoSmartCollectionStackQueryPageV1;
				try { await readPage(f.database, 'catalog', 'saved', { signal: stop.signal }); return false; } catch (error) { return error === reason; }
			}));
			postCompleteRejected &&= late.value; observer.onComplete = null;
		}
		const large = await prepare('large', 0, maximumRoot()), selected = normalizePhotoSmartCollectionV1({ schemaVersion: 1, kind: 'photo-smart-collection',
			catalogId: 'catalog', id: 'saved', revision: 0, name: '\ud800'.repeat(256), query: { ...ordinary, text: '\ud800'.repeat(256), predicate: {
				kind: 'all', terms: Array.from({ length: 255 }, () => ({ kind: 'text', column: 'camera-model', operator: 'starts-with', value: '\ud800'.repeat(256) })) } } });
		await save(large, selected.query, selected.id, selected.name);
		const loaded = await large.owner.loadSmartCollection('catalog', 'saved'), root = await large.owner.loadCatalog('catalog');
		check(loaded !== null && root !== null, 'Large native saved authority is missing.');
		const result = await unchanged(large, () => read(large, 'ordinary'));
		return { cancellations, exactReasons, reasonInspections, signalShadowsRead, postCompleteRejected, storesUnchanged: true,
			large: { items: result.value.items.length, rootBytes: bytes(root), definitionBytes: bytes(loaded), privateRowBytes: bytes(photoSmartCollectionRecordV1(loaded)),
				predicateSourceBytes: bytes({ schemaVersion: 2, kind: 'photo-smart-query', predicate: loaded.query.predicate }),
				intact: JSON.stringify(loaded.query) === JSON.stringify(selected.query) && result.value.collectionName === selected.name,
				unionReadonly: union(result, 'ordinary') } };
	}
}

function maximumRoot() {
	const root = queryCatalogRootV1(), keywords = [...root.keywords.map(node => ({ ...node })),
		...Array.from({ length: 6900 }, (_, index) => ({ id: `z-${String(index)}`, name: '界'.repeat(80), parentId: null }))];
	const value = { ...root, keywords };
	let remaining = 2_097_152 - bytes(value);
	check(remaining >= 0, 'Native large root starts above its exact2MiB budget.');
	for (const keyword of keywords) {
		const added = Math.min(remaining, 256 - keyword.name.length); keyword.name += 'x'.repeat(added); remaining -= added;
		if (remaining === 0) break;
	}
	check(remaining === 0, 'Native large root cannot fill its legal exact2MiB budget.'); return normalizePhotoCatalogRootV1(value);
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
