/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { catalogTransaction } from './catalog-transaction.ts';
import { validateLightscaperDocumentV1 } from './documents.ts';
import { readIndexState, photoStorageKey } from './repository-records.ts';
import { PhotoCatalogRevisionConflictError, type PhotoSummaryV1, type PhotoCatalogIndexStateV1 } from './repository-types.ts';
import { field, id, record } from './value-validation.ts';
import { normalizePhotoStackStateV1, type PhotoStackV1 } from './photo-stack-v1.ts';
import { readPhotoStackRecordV1 } from './photo-stack-record-v1.ts';
import { PhotoQueryIndexNotReadyError } from './photo-query-index-v1.ts';
import type { PhotoCatalogQueryV1 } from './photo-query-types-v1.ts';
import type { PhotoCatalogRootV1 } from './types.ts';
import { auditPhotoStackQueryCountV1 } from './photo-stack-query-audit-v1.ts';
import { PHOTO_STACK_QUERY_LIMITS_V1 as LIMITS, type PhotoStackQueryContinuationV1 } from './photo-stack-query-types-v1.ts';
import type { PhotoQueryInclusivePosition } from './photo-query-position.ts';

interface QueryRowIdentity { readonly key: string; readonly catalogId: string; readonly photoId: string; readonly captureBucket: 0 | 1 }
export type PhotoStackQueryKernelProgress = Omit<PhotoStackQueryContinuationV1, 'schemaVersion' | 'kind' | 'querySha256' | 'progressSha256'>;

/** Private per-read state, retained only while fresh destination audit phases join. */
export interface PhotoStackQueryDestinationStart {
	readonly position: PhotoQueryInclusivePosition;
	inclusivePending: boolean;
	auditComplete: boolean;
	stateRevision: number | null;
}

/** Internal constants supplied by the two closed protocol adapters, never caller-owned profiles. */
export interface PhotoStackQueryKernelProfile<Row extends QueryRowIdentity, Query extends PhotoCatalogQueryV1, Continuation extends PhotoStackQueryKernelProgress> {
	readonly rowStore: 'photoQueryRows' | 'photoQueryRowsV2';
	readonly buildStore: 'photoQueryBuildStates' | 'photoQueryBuildStatesV2';
	readonly readRow: (value: unknown) => Row;
	readonly readBuild: (value: unknown, catalogId: string) => Readonly<{ ready: boolean; indexedCount: number }>;
	readonly rowKey: (row: Row, sort: Query['sort']['field']) => (string | number)[];
	readonly summarize: (row: Row) => PhotoSummaryV1;
	readonly matcher: (root: PhotoCatalogRootV1, query: Query) => (row: Row) => boolean;
	readonly issueProgress: (progress: PhotoStackQueryKernelProgress) => Continuation;
}

/** One native readonly transaction and one shared representative/authentication algorithm. */
export async function readPhotoStackQueryKernel<Row extends QueryRowIdentity, Query extends PhotoCatalogQueryV1, Continuation extends PhotoStackQueryKernelProgress>(
	database: IDBDatabase, catalogId: string, query: Query, continuation: Continuation | null,
	profile: PhotoStackQueryKernelProfile<Row, Query, Continuation>, privateSignal?: AbortSignal,
) {
	const storesOwned = ['catalogs', 'catalogStates', profile.rowStore, profile.buildStore, 'photoStacks', 'photoStackStates', 'photoStackMemberships'];
	return catalogTransaction(database, storesOwned, 'readonly', async stores => {
		const root = validateLightscaperDocumentV1(await request(stores.catalogs.get(catalogId)) as unknown);
		if (root.kind !== 'photo-catalog' || root.id !== catalogId) throw new TypeError('Collapsed query requires its selected catalog root.');
		const index = readIndexState(await request(stores.catalogStates.get(catalogId)) as unknown);
		if (index.id !== catalogId || index.rootRevision !== root.revision || index.photoCount !== root.photoCount) throw new TypeError('Collapsed query index differs from its root.');
		return readPhotoStackQueryInTransaction(stores, root, index, catalogId, query, continuation, profile, privateSignal);
	}, privateSignal);
}

/** Transaction-local entrypoint; adapters supply only freshly admitted owning context. */
export async function readPhotoStackQueryInTransaction<Row extends QueryRowIdentity, Query extends PhotoCatalogQueryV1, Continuation extends PhotoStackQueryKernelProgress>(
	stores: Readonly<Record<string, IDBObjectStore>>, root: PhotoCatalogRootV1, index: PhotoCatalogIndexStateV1,
	catalogId: string, query: Query, continuation: Continuation | null,
	profile: PhotoStackQueryKernelProfile<Row, Query, Continuation>, privateSignal?: AbortSignal, destination?: PhotoStackQueryDestinationStart,
) {
	const rawState: unknown = await request(stores.photoStackStates.get(catalogId));
	const state = normalizePhotoStackStateV1(rawState === undefined ? { schemaVersion: 1, kind: 'photo-stack-state', catalogId, revision: 0, stackCount: 0 } : rawState);
	if (state.catalogId !== catalogId || state.stackCount > Math.floor(root.photoCount / 2)) throw new TypeError('Collapsed query grouping state differs from its catalog.');
	if (state.stackCount === 0 && (await hasKey(stores.photoStacks.index('catalogId'), catalogId)
		|| await hasKey(stores.photoStackMemberships.index('catalogId'), catalogId))) throw new TypeError('Empty grouping state retains stack rows.');
	if (continuation && (continuation.catalogRevision !== root.revision || continuation.indexRevision !== index.indexRevision
		|| continuation.stateRevision !== state.revision)) throw new PhotoCatalogRevisionConflictError('catalog');
	if (destination) {
		if (destination.stateRevision !== null && destination.stateRevision !== state.revision) throw new PhotoCatalogRevisionConflictError('catalog');
		destination.stateRevision = state.revision;
	}
	const buildRaw: unknown = await request(stores[profile.buildStore].get(catalogId));
	if (buildRaw === undefined) throw new PhotoQueryIndexNotReadyError();
	const build = profile.readBuild(buildRaw, catalogId);
	if (!build.ready) throw new PhotoQueryIndexNotReadyError();
	if (build.indexedCount !== root.photoCount) throw new TypeError('Ready collapsed query count differs from its catalog.');
	const matches = profile.matcher(root, query), items: PhotoSummaryV1[] = [];
	let scanned = 0, captureBucket: 0 | 1 = continuation?.captureBucket ?? 0;
	let afterKey: readonly (string | number)[] | null = continuation?.afterKey ?? null, pending = continuation?.pending ?? null;
	let stackAudit = continuation?.stackAudit ?? null;
	if (state.stackCount > 0 && (!continuation || stackAudit) && !destination?.auditComplete) {
		const audit = await auditPhotoStackQueryCountV1(stores.photoStacks, catalogId, state.stackCount, stackAudit);
		scanned = audit.scanned; stackAudit = audit.continuation;
	}
	if (destination && stackAudit === null) {
		destination.auditComplete = true;
		if (destination.inclusivePending) { captureBucket = destination.position.captureBucket; afterKey = destination.position.key; }
	}
	let exhausted = false;
	while (stackAudit === null && scanned < LIMITS.candidates) {
		privateSignal?.throwIfAborted();
		const row = pending ? await pointRow(pending.photoId) : await nextRow(stores[profile.rowStore].index(query.sort.field), catalogId, query, captureBucket, afterKey, profile.readRow, profile.rowKey, destination?.inclusivePending === true);
		if (destination) destination.inclusivePending = false;
		if (row === null) {
			if (query.sort.field === 'capture-time' && captureBucket === 0) { captureBucket = 1; afterKey = null; continue; }
			exhausted = true; break;
		}
		if (!pending) scanned++;
		const key = profile.rowKey(row, query.sort.field);
		if (pending && JSON.stringify(key) !== JSON.stringify(afterKey)) throw new TypeError('Pending collapsed query row moved from its captured position.');
		afterKey = Object.freeze(key);
		if (!matches(row)) {
			if (pending) throw new TypeError('Pending collapsed query row no longer matches its query.');
			continue;
		}
		const stackId = await membership(row.photoId);
		if (stackId === null) {
			if (pending) throw new TypeError('Pending collapsed query row lost its stack.');
			items.push(profile.summarize(row)); continue;
		}
		if (pending && stackId !== pending.stackId) throw new TypeError('Pending collapsed query row has another stack.');
		const stack = await loadStack(stackId);
		if (!stack.photoIds.includes(row.photoId) || state.stackCount === 0) throw new TypeError('Collapsed query reverse membership differs from its stack.');
		if (pending && (stack.revision !== pending.stackRevision || pending.nextMember > stack.photoIds.length)) throw new PhotoCatalogRevisionConflictError('catalog');
		const isCover = stack.coverPhotoId === row.photoId;
		let position = pending?.nextMember ?? 0, show: boolean | null = null;
		if (!isCover && scanned < LIMITS.candidates) {
			const cover = await pointRow(stack.coverPhotoId);
			if (await membership(cover.photoId) !== stack.id) throw new TypeError('Collapsed query cover membership differs from its stack.');
			if (matches(cover)) show = false;
		}
		while (show === null && position < stack.photoIds.length && scanned < LIMITS.candidates) {
			const photoId = stack.photoIds[position++]!;
			if (photoId === row.photoId || (!isCover && photoId === stack.coverPhotoId)) continue;
			const member = await pointRow(photoId);
			if (await membership(photoId) !== stack.id) throw new TypeError('Collapsed query member binding differs from its stack.');
			if (!isCover && matches(member) && precedes(member, row, query, profile.rowKey)) show = false;
		}
		if (show === null && position === stack.photoIds.length) show = true;
		if (show === null) {
			pending = Object.freeze({ photoId: row.photoId, stackId, stackRevision: stack.revision, nextMember: position }); break;
		}
		if (show) items.push(profile.summarize(row));
		pending = null;
	}
	return Object.freeze({ catalogName: root.name, totalCount: root.photoCount, catalogRevision: root.revision,
		indexRevision: index.indexRevision, stateRevision: state.revision, items: Object.freeze(items), scanned,
		continuation: exhausted ? null : profile.issueProgress({ catalogId, catalogRevision: root.revision,
			indexRevision: index.indexRevision, stateRevision: state.revision, captureBucket, afterKey, pending, stackAudit }) });

	async function pointRow(photoId: string): Promise<Row> {
		scanned++;
		const value: unknown = await request(stores[profile.rowStore].get(photoStorageKey(catalogId, photoId)));
		if (value === undefined) throw new ReferenceError('Collapsed query stack member is missing from the ready query index.');
		const row = profile.readRow(value);
		if (row.catalogId !== catalogId || row.photoId !== photoId) throw new TypeError('Collapsed query point row has another identity.');
		return row;
	}
	async function membership(photoId: string): Promise<string | null> {
		const key = photoStorageKey(catalogId, photoId), raw: unknown = await request(stores.photoStackMemberships.get(key));
		const forward: unknown = await request(stores.photoStacks.index('memberKey').getKey(key));
		if (raw === undefined) {
			if (forward !== undefined) throw new TypeError('Collapsed query forward membership is missing its reverse row.');
			return null;
		}
		const entry = record(raw, 'collapsed query membership', ['key', 'catalogId', 'photoId', 'stackId', 'scope']);
		const stackId = id(field(entry, 'stackId'), 'collapsed member stack ID');
		if (field(entry, 'key') !== key || field(entry, 'catalogId') !== catalogId || field(entry, 'photoId') !== photoId
			|| field(entry, 'scope') !== photoStorageKey(catalogId, stackId)
			|| forward !== photoStorageKey(catalogId, stackId)) throw new TypeError('Collapsed query forward and reverse membership disagree.');
		return stackId;
	}
	async function loadStack(stackId: string): Promise<PhotoStackV1> {
		const key = photoStorageKey(catalogId, stackId), raw: unknown = await request(stores.photoStacks.get(key));
		return readPhotoStackRecordV1(raw, catalogId, key);
	}
}

async function nextRow<Row extends QueryRowIdentity>(index: IDBIndex, catalogId: string, query: PhotoCatalogQueryV1, bucket: 0 | 1,
	afterKey: readonly (string | number)[] | null, readRow: (value: unknown) => Row,
	rowKey: (row: Row, sort: PhotoCatalogQueryV1['sort']['field']) => (string | number)[], inclusive = false): Promise<Row | null> {
	const prefix: IDBValidKey[] = query.sort.field === 'capture-time' ? [catalogId, bucket] : [catalogId], maximum: IDBValidKey[] = [...prefix, []];
	const after = afterKey ? [...afterKey] : null, descending = query.sort.direction === 'descending';
	const range = descending ? IDBKeyRange.bound(prefix, after ?? maximum, false, !inclusive) : IDBKeyRange.bound(after ?? prefix, maximum, after !== null && !inclusive, true);
	return new Promise((resolve, reject) => {
		const cursor = index.openCursor(range, descending ? 'prev' : 'next');
		cursor.onerror = () => reject(cursor.error ?? new Error('Could not read collapsed query cursor.'));
		cursor.onsuccess = () => {
			try {
				const current = cursor.result; if (!current) { resolve(null); return; }
				const row = readRow(current.value as unknown);
				if (row.catalogId !== catalogId || current.primaryKey !== row.key || JSON.stringify(current.key) !== JSON.stringify(rowKey(row, query.sort.field))) {
					throw new TypeError('Collapsed query cursor index projection differs from its row.');
				}
				resolve(row);
			} catch (error) { reject(error); }
		};
	});
}
function precedes<Row extends QueryRowIdentity>(left: Row, right: Row, query: PhotoCatalogQueryV1,
	rowKey: (row: Row, sort: PhotoCatalogQueryV1['sort']['field']) => (string | number)[]): boolean {
	const a = rowKey(left, query.sort.field), b = rowKey(right, query.sort.field);
	if (query.sort.field === 'capture-time' && a[1] !== b[1]) return left.captureBucket < right.captureBucket;
	for (let index = 0; index < a.length; index++) {
		if (a[index] === b[index]) continue;
		return query.sort.direction === 'ascending' ? a[index]! < b[index]! : a[index]! > b[index]!;
	}
	return false;
}
function hasKey(index: IDBIndex, catalogId: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const cursor = index.openKeyCursor(catalogId);
		cursor.onerror = () => reject(cursor.error ?? new Error('Could not inspect collapsed grouping state.'));
		cursor.onsuccess = () => resolve(cursor.result !== null);
	});
}
