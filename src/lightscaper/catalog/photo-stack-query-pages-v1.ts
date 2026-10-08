/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { catalogTransaction } from './catalog-transaction.ts';
import { validateLightscaperDocumentV1 } from './documents.ts';
import { readIndexState, photoStorageKey } from './repository-records.ts';
import { PhotoCatalogRevisionConflictError, type PhotoSummaryV1 } from './repository-types.ts';
import { field, id, record } from './value-validation.ts';
import { normalizePhotoStackStateV1, type PhotoStackV1 } from './photo-stack-v1.ts';
import { readPhotoStackRecordV1 } from './photo-stack-record-v1.ts';
import { readPhotoQueryBuildStateV1, readPhotoQueryRowV1, photoQueryRowKeyV1, PhotoQueryIndexNotReadyError, type PhotoQueryRowV1 } from './photo-query-index-v1.ts';
import { photoQueryMatcherV1 } from './photo-query-matcher-v1.ts';
import { photoQueryDigestV1, type PhotoCatalogQueryV1 } from './photo-query-types-v1.ts';
import { authenticatePhotoStackQueryProgressV1, issuePhotoStackQueryProgressV1 } from './photo-stack-query-progress-v1.ts';
import { auditPhotoStackQueryCountV1 } from './photo-stack-query-audit-v1.ts';
import { withPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { admitPhotoStackQueryPageRequestV1, PHOTO_STACK_QUERY_LIMITS_V1 as LIMITS,
	type PhotoStackQueryPageRequestV1, type PhotoStackQueryPageV1 } from './photo-stack-query-types-v1.ts';

const STORES = ['catalogs', 'catalogStates', 'photoQueryRows', 'photoQueryBuildStates', 'photoStacks', 'photoStackStates', 'photoStackMemberships'] as const;

/** Global representative decisions resume within the same budget as ordinary candidate scans. */
export async function readPhotoStackQueryPageV1(database: IDBDatabase, catalogValue: string,
	options: PhotoStackQueryPageRequestV1 = {}): Promise<PhotoStackQueryPageV1> {
	const catalogId = id(catalogValue, 'collapsed query catalog ID'), admitted = admitPhotoStackQueryPageRequestV1(catalogId, options);
	const { query, signal, continuation } = admitted;
	authenticatePhotoStackQueryProgressV1(database, continuation);
	return withPhotoStackQuerySignalV1(signal, privateSignal => catalogTransaction(database, STORES, 'readonly', async stores => {
		const root = validateLightscaperDocumentV1(await request(stores.catalogs.get(catalogId)) as unknown);
		if (root.kind !== 'photo-catalog' || root.id !== catalogId) throw new TypeError('Collapsed query requires its selected catalog root.');
		const index = readIndexState(await request(stores.catalogStates.get(catalogId)) as unknown);
		if (index.id !== catalogId || index.rootRevision !== root.revision || index.photoCount !== root.photoCount) throw new TypeError('Collapsed query index differs from its root.');
		const rawState: unknown = await request(stores.photoStackStates.get(catalogId));
		const state = normalizePhotoStackStateV1(rawState === undefined ? { schemaVersion: 1, kind: 'photo-stack-state', catalogId, revision: 0, stackCount: 0 } : rawState);
		if (state.catalogId !== catalogId || state.stackCount > Math.floor(root.photoCount / 2)) throw new TypeError('Collapsed query grouping state differs from its catalog.');
		if (state.stackCount === 0 && (await hasKey(stores.photoStacks.index('catalogId'), catalogId)
			|| await hasKey(stores.photoStackMemberships.index('catalogId'), catalogId))) throw new TypeError('Empty grouping state retains stack rows.');
		if (continuation && (continuation.catalogRevision !== root.revision || continuation.indexRevision !== index.indexRevision
			|| continuation.stateRevision !== state.revision)) throw new PhotoCatalogRevisionConflictError('catalog');
		const buildRaw: unknown = await request(stores.photoQueryBuildStates.get(catalogId));
		if (buildRaw === undefined || !readPhotoQueryBuildStateV1(buildRaw, catalogId).ready) throw new PhotoQueryIndexNotReadyError();
		if (readPhotoQueryBuildStateV1(buildRaw, catalogId).indexedCount !== root.photoCount) throw new TypeError('Ready collapsed query count differs from its catalog.');
		const matches = photoQueryMatcherV1(root, query), items: PhotoSummaryV1[] = [];
		let scanned = 0, captureBucket: 0 | 1 = continuation?.captureBucket ?? 0;
		let afterKey: readonly (string | number)[] | null = continuation?.afterKey ?? null, pending = continuation?.pending ?? null;
		let stackAudit = continuation?.stackAudit ?? null;
		if (state.stackCount > 0 && (!continuation || stackAudit)) {
			const audit = await auditPhotoStackQueryCountV1(stores.photoStacks, catalogId, state.stackCount, stackAudit);
			scanned = audit.scanned; stackAudit = audit.continuation;
		}
		let exhausted = false;
		while (stackAudit === null && scanned < LIMITS.candidates) {
			privateSignal?.throwIfAborted();
			const row = pending ? await pointRow(pending.photoId) : await nextRow(stores.photoQueryRows.index(query.sort.field), catalogId, query, captureBucket, afterKey);
			if (row === null) {
				if (query.sort.field === 'capture-time' && captureBucket === 0) { captureBucket = 1; afterKey = null; continue; }
				exhausted = true; break;
			}
			if (!pending) scanned++;
			const key = photoQueryRowKeyV1(row, query.sort.field);
			if (pending && JSON.stringify(key) !== JSON.stringify(afterKey)) throw new TypeError('Pending collapsed query row moved from its captured position.');
			afterKey = Object.freeze(key);
			if (!matches(row)) {
				if (pending) throw new TypeError('Pending collapsed query row no longer matches its query.');
				continue;
			}
			const stackId = await membership(row.photoId);
			if (stackId === null) {
				if (pending) throw new TypeError('Pending collapsed query row lost its stack.');
				items.push(row.summary); continue;
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
				if (!isCover && matches(member) && precedes(member, row, query)) show = false;
			}
			if (show === null && position === stack.photoIds.length) show = true;
			if (show === null) {
				pending = Object.freeze({ photoId: row.photoId, stackId, stackRevision: stack.revision, nextMember: position }); break;
			}
			if (show) items.push(row.summary);
			pending = null;
		}
		return Object.freeze({ catalogName: root.name, totalCount: root.photoCount, items: Object.freeze(items), scanned,
			continuation: exhausted ? null : issuePhotoStackQueryProgressV1(database, { schemaVersion: 1, kind: 'collapsed-photo-query', catalogId,
				catalogRevision: root.revision, indexRevision: index.indexRevision, stateRevision: state.revision,
				querySha256: photoQueryDigestV1(query), captureBucket, afterKey, pending, stackAudit }, query) });

		async function pointRow(photoId: string): Promise<PhotoQueryRowV1> {
			scanned++;
			const value: unknown = await request(stores.photoQueryRows.get(photoStorageKey(catalogId, photoId)));
			if (value === undefined) throw new ReferenceError('Collapsed query stack member is missing from the ready query index.');
			const row = readPhotoQueryRowV1(value);
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
	}, privateSignal));
}

async function nextRow(index: IDBIndex, catalogId: string, query: PhotoCatalogQueryV1, bucket: 0 | 1,
	afterKey: readonly (string | number)[] | null): Promise<PhotoQueryRowV1 | null> {
	const prefix: IDBValidKey[] = query.sort.field === 'capture-time' ? [catalogId, bucket] : [catalogId], maximum: IDBValidKey[] = [...prefix, []];
	const after = afterKey ? [...afterKey] : null, descending = query.sort.direction === 'descending';
	const range = descending ? IDBKeyRange.bound(prefix, after ?? maximum, false, true) : IDBKeyRange.bound(after ?? prefix, maximum, after !== null, true);
	return new Promise((resolve, reject) => {
		const cursor = index.openCursor(range, descending ? 'prev' : 'next');
		cursor.onerror = () => reject(cursor.error ?? new Error('Could not read collapsed query cursor.'));
		cursor.onsuccess = () => {
			try {
				const current = cursor.result; if (!current) { resolve(null); return; }
				const row = readPhotoQueryRowV1(current.value as unknown);
				if (row.catalogId !== catalogId || current.primaryKey !== row.key || JSON.stringify(current.key) !== JSON.stringify(photoQueryRowKeyV1(row, query.sort.field))) {
					throw new TypeError('Collapsed query cursor index projection differs from its row.');
				}
				resolve(row);
			} catch (error) { reject(error); }
		};
	});
}
function precedes(left: PhotoQueryRowV1, right: PhotoQueryRowV1, query: PhotoCatalogQueryV1): boolean {
	const a = photoQueryRowKeyV1(left, query.sort.field), b = photoQueryRowKeyV1(right, query.sort.field);
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
