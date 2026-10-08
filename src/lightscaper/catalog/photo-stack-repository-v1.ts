/* SPDX-License-Identifier: AGPL-3.0-only */

import { readCursorPage, request } from '../../common/editor/storage/indexeddb-backend.ts';
import { catalogTransaction } from './catalog-transaction.ts';
import { validateLightscaperDocumentV1 } from './documents.ts';
import { indexState, photoStorageKey, readIndexState, readPhotoSummary } from './repository-records.ts';
import { PhotoCatalogRevisionConflictError, type PhotoCatalogIndexStateV1 } from './repository-types.ts';
import { normalizePhotoStackV1, normalizePhotoStackStateV1, PHOTO_STACK_LIMITS_V1 as LIMITS, type PhotoStackV1, type PhotoStackStateV1 } from './photo-stack-v1.ts';
import { photoStackRecordV1, readPhotoStackRecordV1 } from './photo-stack-record-v1.ts';
import type { PhotoCatalogRootV1 } from './types.ts';
import { array, field, id, integer, record, unique } from './value-validation.ts';

const STORES = ['catalogs', 'catalogStates', 'photos', 'photoStacks', 'photoStackMemberships', 'photoStackStates'] as const;
const throwIfAborted = AbortSignal.prototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const nativeAddListener = EventTarget.prototype.addEventListener;
const nativeRemoveListener = EventTarget.prototype.removeEventListener;
type Stores = Readonly<Record<string, IDBObjectStore>>;

export interface PhotoStackWriteOptionsV1 {
	readonly expectedCatalogRevision: number;
	readonly expectedStateRevision: number;
	readonly signal?: AbortSignal;
}
export interface PhotoStackContinuationV1 {
	readonly catalogId: string;
	readonly scope: 'stacks' | 'memberships';
	readonly catalogRevision: number;
	readonly indexRevision: number;
	readonly stateRevision: number;
	readonly afterKey: string;
}
export interface PhotoStackPageOptionsV1 {
	readonly continuation?: PhotoStackContinuationV1 | null;
	readonly signal?: AbortSignal;
}
export interface PhotoStackMembershipPageOptionsV1 extends PhotoStackPageOptionsV1 {
	readonly photoIds?: readonly string[];
}
export interface PhotoStackSummaryV1 {
	readonly catalogId: string;
	readonly id: string;
	readonly revision: number;
	readonly photoCount: number;
	readonly coverPhotoId: string;
}
export interface PhotoStackMembershipV1 {
	readonly catalogId: string;
	readonly photoId: string;
	readonly stackId: string;
}
export interface PhotoStackMemberSummaryV1 { readonly photoId: string; readonly fileName: string; readonly photoRevision: number }
export interface PhotoStackPageV1<Item> {
	readonly items: readonly Item[];
	readonly continuation: Readonly<PhotoStackContinuationV1> | null;
}
interface Capture { readonly root: PhotoCatalogRootV1; readonly index: PhotoCatalogIndexStateV1; readonly state: PhotoStackStateV1 }
interface Reverse extends PhotoStackMembershipV1 { readonly key: string; readonly scope: string }

export class PhotoStackRevisionConflictError extends Error {
	readonly code = 'STACK_REVISION_CONFLICT';
	constructor() { super('The stack or stack state revision changed; reload before publishing.'); this.name = 'PhotoStackRevisionConflictError'; }
}

/** Admission is exported so the repository can refuse hostile data before opening IndexedDB. */
export function readPhotoStackWriteOptionsV1(value: unknown): Readonly<PhotoStackWriteOptionsV1> {
	const input = record(value, 'stack write options', ['expectedCatalogRevision', 'expectedStateRevision', 'signal'], ['expectedCatalogRevision', 'expectedStateRevision']);
	return Object.freeze({ expectedCatalogRevision: revision(field(input, 'expectedCatalogRevision')),
		expectedStateRevision: revision(field(input, 'expectedStateRevision')), ...readSignal(input) });
}
export function readPhotoStackPageOptionsV1(value: unknown, catalogId: string, scope: 'stacks' | 'memberships'): Readonly<PhotoStackMembershipPageOptionsV1> {
	const input = record(value, 'stack page options', scope === 'stacks' ? ['continuation', 'signal'] : ['continuation', 'signal', 'photoIds'], []);
	const raw = Object.hasOwn(input, 'continuation') ? field(input, 'continuation') : null;
	const continuation = raw === null ? null : readContinuation(raw, catalogId, scope);
	const photoIds = Object.hasOwn(input, 'photoIds') ? array(field(input, 'photoIds'), 'stack annotation photos', 0, LIMITS.pageSize).map((entry) => id(entry, 'annotation photo ID')) : undefined;
	if (photoIds) unique(photoIds, 'annotation photos');
	if (photoIds && continuation) throw new TypeError('Point annotations cannot carry a cursor.');
	return Object.freeze({ continuation, ...(photoIds ? { photoIds: Object.freeze(photoIds) } : {}), ...readSignal(input) });
}
export function readPhotoStackSignalOptionsV1(value: unknown): Readonly<{ signal?: AbortSignal }> {
	return Object.freeze(readSignal(record(value, 'stack read options', ['signal'], [])));
}
export function admitPhotoStackSaveV1(value: unknown, expectedRevision: unknown): PhotoStackV1 {
	const stack = normalizePhotoStackV1(value);
	const expected = expectedRevision === null ? null : revision(expectedRevision);
	if (stack.revision !== (expected ?? 0)) throw new RangeError('Stack candidate revision disagrees with expected revision.');
	return stack;
}
export function admitPhotoStackMemberIdsV1(value: unknown): readonly string[] {
	const ids = array(value, 'stack member page IDs', 1, LIMITS.pageSize).map(entry => id(entry, 'stack member photo ID'));
	unique(ids, 'stack member page IDs'); return Object.freeze(ids);
}

export async function loadPhotoStackV1(database: IDBDatabase, catalogId: string, stackId: string, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoStackV1 | null> {
	const catalog = id(catalogId, 'catalog ID'); const key = photoStorageKey(catalog, stackId);
	const admitted = readPhotoStackSignalOptionsV1(options);
	return stackTransaction(database, STORES, 'readonly', async stores => {
		const captured = await capture(stores, catalog);
		const stack = await readStack(stores, key);
		if (stack) {
			if (captured.state.stackCount === 0) throw new TypeError('Stack state disagrees with stored stack.');
			await verifyReverse(stores, stack);
		}
		return stack;
	}, admitted.signal);
}
export async function readPhotoStackStateV1(database: IDBDatabase, catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoStackStateV1> {
	const catalog = id(catalogId, 'catalog ID'); const admitted = readPhotoStackSignalOptionsV1(options);
	return stackTransaction(database, STORES, 'readonly', async stores => (await capture(stores, catalog)).state, admitted.signal);
}
export async function readPhotoStackPageV1(database: IDBDatabase, catalogId: string, options: PhotoStackPageOptionsV1 = {}): Promise<PhotoStackPageV1<PhotoStackSummaryV1>> {
	const catalog = id(catalogId, 'catalog ID'); const admitted = readPhotoStackPageOptionsV1(options, catalog, 'stacks');
	return stackTransaction(database, STORES, 'readonly', async stores => {
		const captured = await capture(stores, catalog); checkContinuation(admitted.continuation, captured);
		// Each document is validated inside the cursor projector, then discarded.
		// Retained page memory is 64 scalar summaries, never 64 stack documents.
		const entries = await readCursorPage(stores.photoStacks.index('catalogId'), { query: catalog, afterPrimaryKey: admitted.continuation?.afterKey,
			limit: LIMITS.pageSize, project: (value, key) => {
				const stack = readPhotoStackRecordV1(value, catalog, key);
				return Object.freeze({ catalogId: catalog, id: stack.id, revision: stack.revision, photoCount: stack.photoIds.length, coverPhotoId: stack.coverPhotoId });
			} });
		// Full reverse authentication belongs to the explicit one-stack loader.
		if (entries.length > captured.state.stackCount) throw new TypeError('Stack state count disagrees with its page.');
		return page(entries, captured, 'stacks', entries.at(-1)?.id);
	}, admitted.signal);
}
export async function readPhotoStackMembershipPageV1(database: IDBDatabase, catalogId: string, options: PhotoStackMembershipPageOptionsV1 = {}): Promise<PhotoStackPageV1<PhotoStackMembershipV1>> {
	const catalog = id(catalogId, 'catalog ID'); const admitted = readPhotoStackPageOptionsV1(options, catalog, 'memberships');
	return stackTransaction(database, STORES, 'readonly', async stores => {
		const captured = await capture(stores, catalog); checkContinuation(admitted.continuation, captured);
		const rows: Reverse[] = [];
		if (admitted.photoIds) {
			for (const photoId of admitted.photoIds) {
				const row = await readMembership(stores, catalog, photoStorageKey(catalog, photoId));
				if (row) rows.push(row);
			}
		} else rows.push(...await readCursorPage(stores.photoStackMemberships.index('catalogId'), { query: catalog,
			afterPrimaryKey: admitted.continuation?.afterKey, limit: LIMITS.pageSize, project: (value, key) => readReverse(value, catalog, key) }));
		const items: PhotoStackMembershipV1[] = [];
		for (const row of rows) {
			await verifyForward(stores, row);
			const stack = await readStack(stores, photoStorageKey(catalog, row.stackId));
			if (!stack?.photoIds.includes(row.photoId)) throw new TypeError('Reverse membership disagrees with its stack.');
			if (await request(stores.photos.getKey(row.key)) !== row.key) throw new ReferenceError('Stack member photo is missing.');
			items.push(Object.freeze({ catalogId: catalog, photoId: row.photoId, stackId: row.stackId }));
		}
		if (rows.length && captured.state.stackCount === 0) throw new TypeError('Stack state disagrees with reverse membership.');
		return admitted.photoIds ? Object.freeze({ items: Object.freeze(items), continuation: null }) : page(items, captured, 'memberships', rows.at(-1)?.photoId);
	}, admitted.signal);
}
export async function readPhotoStackMemberPageV1(database: IDBDatabase, catalogId: string, stackId: string, expectedRevision: number,
	photoIds: readonly string[], options: Readonly<{ signal?: AbortSignal }> = {}): Promise<readonly PhotoStackMemberSummaryV1[]> {
	const catalog = id(catalogId, 'catalog ID'), key = photoStorageKey(catalog, stackId), expected = revision(expectedRevision);
	const selected = admitPhotoStackMemberIdsV1(photoIds), admitted = readPhotoStackSignalOptionsV1(options);
	return stackTransaction(database, [...STORES, 'summaries'], 'readonly', async stores => {
		await capture(stores, catalog); const stack = await readStack(stores, key);
		if (!stack || stack.revision !== expected) throw new PhotoStackRevisionConflictError();
		await verifyReverse(stores, stack);
		if (selected.some(photoId => !stack.photoIds.includes(photoId))) throw new ReferenceError('Requested photo does not belong to the authenticated stack membership.');
		const rows: PhotoStackMemberSummaryV1[] = [];
		for (const photoId of selected) {
			const summary = readPhotoSummary(await request(stores.summaries.get(photoStorageKey(catalog, photoId))) as unknown);
			if (summary.catalogId !== catalog || summary.photoId !== photoId) throw new TypeError('Stack member summary disagrees with its requested identity.');
			rows.push(Object.freeze({ photoId, fileName: summary.fileName, photoRevision: summary.photoRevision }));
		}
		return Object.freeze(rows);
	}, admitted.signal);
}

export async function savePhotoStackV1(database: IDBDatabase, value: unknown, expectedRevision: number | null, options: PhotoStackWriteOptionsV1): Promise<PhotoStackV1> {
	const candidate = admitPhotoStackSaveV1(value, expectedRevision); const admitted = readPhotoStackWriteOptionsV1(options);
	return stackTransaction(database, STORES, 'readwrite', async stores => {
		const captured = await capture(stores, candidate.catalogId); checkWrite(admitted, captured);
		const previous = await readStack(stores, photoStorageKey(candidate.catalogId, candidate.id));
		if (expectedRevision === null ? previous !== null : previous?.revision !== expectedRevision) throw new PhotoStackRevisionConflictError();
		if (previous) await verifyReverse(stores, previous);
		else if (await hasIndexedKey(stores.photoStackMemberships.index('scope'), photoStorageKey(candidate.catalogId, candidate.id))) throw new TypeError('Absent stack has retained reverse membership.');
		for (const photoId of candidate.photoIds) {
			const key = photoStorageKey(candidate.catalogId, photoId);
			if (await request(stores.photos.getKey(key)) !== key) throw new ReferenceError('Stack member photo is missing.');
			const row = await readMembership(stores, candidate.catalogId, key);
			if (row !== null) {
				if (row.stackId !== candidate.id) throw new RangeError('Photo already belongs to another stack.');
				if (!previous?.photoIds.includes(photoId)) throw new TypeError('Reverse membership disagrees with previous stack.');
			}
		}
		const next = normalizePhotoStackV1({ ...candidate, revision: previous ? increment(previous.revision) : 0 });
		const state = nextState(captured, previous ? 0 : 1);
		const root = nextRoot(captured); const index = indexState(root, increment(captured.index.indexRevision));
		const previousIds = new Set(previous?.photoIds ?? []), nextIds = new Set(next.photoIds);
		for (const photoId of previousIds) if (!nextIds.has(photoId)) await request(stores.photoStackMemberships.delete(photoStorageKey(candidate.catalogId, photoId)));
		for (const photoId of nextIds) if (!previousIds.has(photoId)) await request(stores.photoStackMemberships.put({ key: photoStorageKey(next.catalogId, photoId),
			catalogId: next.catalogId, photoId, stackId: next.id, scope: photoStorageKey(next.catalogId, next.id) }));
		await request(stores.photoStacks.put(photoStackRecordV1(next)));
		await publishState(stores, root, index, state);
		return next;
	}, admitted.signal);
}
export async function dissolvePhotoStackV1(database: IDBDatabase, catalogId: string, stackId: string, expectedRevision: number, options: PhotoStackWriteOptionsV1): Promise<PhotoStackStateV1> {
	const catalog = id(catalogId, 'catalog ID'); const key = photoStorageKey(catalog, stackId); const expected = revision(expectedRevision);
	const admitted = readPhotoStackWriteOptionsV1(options);
	return stackTransaction(database, STORES, 'readwrite', async stores => {
		const captured = await capture(stores, catalog); checkWrite(admitted, captured);
		const previous = await readStack(stores, key);
		if (!previous || previous.revision !== expected) throw new PhotoStackRevisionConflictError();
		await verifyReverse(stores, previous);
		const state = nextState(captured, -1); const root = nextRoot(captured); const index = indexState(root, increment(captured.index.indexRevision));
		for (const photoId of previous.photoIds) await request(stores.photoStackMemberships.delete(photoStorageKey(catalog, photoId)));
		await request(stores.photoStacks.delete(key)); await publishState(stores, root, index, state);
		return state;
	}, admitted.signal);
}

async function capture(stores: Stores, catalogId: string): Promise<Capture> {
	const raw: unknown = await request(stores.catalogs.get(catalogId));
	if (raw === undefined) throw new ReferenceError('Photo catalog is missing.');
	const root = validateLightscaperDocumentV1(raw);
	if (root.kind !== 'photo-catalog' || root.id !== catalogId) throw new TypeError('Stack catalog identity disagrees with its key.');
	const index = readIndexState(await request(stores.catalogStates.get(catalogId)) as unknown);
	if (index.id !== catalogId || index.rootRevision !== root.revision || index.photoCount !== root.photoCount) throw new TypeError('Catalog index disagrees with root.');
	const stateRaw: unknown = await request(stores.photoStackStates.get(catalogId));
	const state = stateRaw === undefined ? normalizePhotoStackStateV1({ schemaVersion: 1, kind: 'photo-stack-state', catalogId, revision: 0, stackCount: 0 }) : normalizePhotoStackStateV1(stateRaw);
	if (state.catalogId !== catalogId || state.stackCount > Math.floor(root.photoCount / 2)) throw new TypeError('Stack state disagrees with catalog.');
	if (stateRaw === undefined || state.stackCount === 0) {
		if (await hasIndexedKey(stores.photoStacks.index('catalogId'), catalogId)
			|| await hasIndexedKey(stores.photoStackMemberships.index('catalogId'), catalogId)) throw new TypeError('Empty or missing stack state has retained grouping rows.');
	}
	return { root, index, state };
}
async function readStack(stores: Stores, key: string): Promise<PhotoStackV1 | null> {
	const raw: unknown = await request(stores.photoStacks.get(key));
	return raw === undefined ? null : readPhotoStackRecordV1(raw, key.slice(0, key.indexOf('|')), key);
}
async function readMembership(stores: Stores, catalogId: string, key: string): Promise<Reverse | null> {
	const raw: unknown = await request(stores.photoStackMemberships.get(key));
	const forward: unknown = await request(stores.photoStacks.index('memberKey').getKey(key));
	if (raw === undefined) {
		if (forward !== undefined) throw new TypeError('Forward stack membership has no reverse row.');
		return null;
	}
	const row = readReverse(raw, catalogId, key);
	if (forward !== row.scope) throw new TypeError('Reverse stack membership differs from its forward index.');
	return row;
}
async function verifyForward(stores: Stores, row: Reverse): Promise<void> {
	if (await request(stores.photoStacks.index('memberKey').getKey(row.key)) !== row.scope) {
		throw new TypeError('Reverse stack membership differs from its forward index.');
	}
}
function readReverse(value: unknown, catalogId: string, key: IDBValidKey): Reverse {
	const input = record(value, 'stack reverse membership', ['key', 'catalogId', 'photoId', 'stackId', 'scope']);
	const photoId = id(field(input, 'photoId'), 'member photo ID'); const stackId = id(field(input, 'stackId'), 'member stack ID');
	if (field(input, 'key') !== key || key !== photoStorageKey(catalogId, photoId) || field(input, 'catalogId') !== catalogId
		|| field(input, 'scope') !== photoStorageKey(catalogId, stackId)) throw new TypeError('Reverse membership identity disagrees with its key or scope.');
	return { key, catalogId, photoId, stackId, scope: photoStorageKey(catalogId, stackId) };
}
async function verifyReverse(stores: Stores, stack: PhotoStackV1): Promise<void> {
	await verifyScopeKeys(stores.photoStackMemberships.index('scope'), stack);
	for (const photoId of stack.photoIds) {
		const key = photoStorageKey(stack.catalogId, photoId);
		const row = readReverse(await request(stores.photoStackMemberships.get(key)) as unknown, stack.catalogId, key);
		if (row.stackId !== stack.id) throw new TypeError('Stack reverse membership disagrees with its record.');
		await verifyForward(stores, row);
		if (await request(stores.photos.getKey(key)) !== key) throw new ReferenceError('Stack member photo is missing.');
	}
}
function hasIndexedKey(index: IDBIndex, key: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const cursor = index.openKeyCursor(key);
		cursor.onerror = () => reject(cursor.error ?? new Error('Could not inspect grouping keys.'));
		cursor.onsuccess = () => resolve(cursor.result !== null);
	});
}
function verifyScopeKeys(index: IDBIndex, stack: PhotoStackV1): Promise<void> {
	const allowed = new Set(stack.photoIds); const prefix = `${stack.catalogId}|`;
	return new Promise((resolve, reject) => {
		const cursor = index.openKeyCursor(photoStorageKey(stack.catalogId, stack.id)); let count = 0;
		cursor.onerror = () => reject(cursor.error ?? new Error('Could not inspect reverse membership.'));
		cursor.onsuccess = () => {
			const row = cursor.result;
			if (!row) {
				if (count !== allowed.size) reject(new TypeError('Stack reverse membership count disagrees with its record.'));
				else resolve();
				return;
			}
			count += 1;
			if (count > LIMITS.maximumPhotos || typeof row.primaryKey !== 'string'
				|| !row.primaryKey.startsWith(prefix) || !allowed.has(row.primaryKey.slice(prefix.length))) {
				reject(new TypeError('Stack has extra or invalid reverse membership.')); return;
			}
			row.continue();
		};
	});
}
function checkWrite(options: PhotoStackWriteOptionsV1, captured: Capture): void {
	if (captured.root.revision !== options.expectedCatalogRevision) throw new PhotoCatalogRevisionConflictError('catalog');
	if (captured.state.revision !== options.expectedStateRevision) throw new PhotoStackRevisionConflictError();
}
function nextRoot(captured: Capture): PhotoCatalogRootV1 {
	const root = validateLightscaperDocumentV1({ ...captured.root, revision: increment(captured.root.revision) });
	if (root.kind !== 'photo-catalog') throw new TypeError('A catalog root is required.');
	return root;
}
function nextState(captured: Capture, delta: number): PhotoStackStateV1 {
	return normalizePhotoStackStateV1({ ...captured.state, revision: increment(captured.state.revision), stackCount: captured.state.stackCount + delta });
}
async function publishState(stores: Stores, root: PhotoCatalogRootV1, index: PhotoCatalogIndexStateV1, state: PhotoStackStateV1): Promise<void> {
	await request(stores.catalogs.put(root)); await request(stores.catalogStates.put(index)); await request(stores.photoStackStates.put(state));
}
function page<Item>(items: readonly Item[], captured: Capture, scope: 'stacks' | 'memberships', lastId?: string): PhotoStackPageV1<Item> {
	return Object.freeze({ items: Object.freeze(items), continuation: lastId && items.length === LIMITS.pageSize ? Object.freeze({
		catalogId: captured.root.id, scope, catalogRevision: captured.root.revision, indexRevision: captured.index.indexRevision,
		stateRevision: captured.state.revision, afterKey: photoStorageKey(captured.root.id, lastId) }) : null });
}
function readContinuation(value: unknown, catalogId: string, scope: 'stacks' | 'memberships'): PhotoStackContinuationV1 {
	const input = record(value, 'stack continuation', ['catalogId', 'scope', 'catalogRevision', 'indexRevision', 'stateRevision', 'afterKey']);
	const key = field(input, 'afterKey');
	if (field(input, 'catalogId') !== catalogId || field(input, 'scope') !== scope || typeof key !== 'string'
		|| !key.startsWith(`${catalogId}|`) || key !== photoStorageKey(catalogId, key.slice(catalogId.length + 1))) throw new TypeError('Stack continuation belongs to another catalog or scope.');
	return Object.freeze({ catalogId, scope, afterKey: key, catalogRevision: revision(field(input, 'catalogRevision')),
		indexRevision: revision(field(input, 'indexRevision')), stateRevision: revision(field(input, 'stateRevision')) });
}
function checkContinuation(continuation: PhotoStackContinuationV1 | null | undefined, captured: Capture): void {
	if (continuation && (continuation.catalogRevision !== captured.root.revision || continuation.indexRevision !== captured.index.indexRevision
		|| continuation.stateRevision !== captured.state.revision)) throw new PhotoStackRevisionConflictError();
}
function readSignal(input: Readonly<Record<string, unknown>>): Readonly<{ signal?: AbortSignal }> {
	if (!Object.hasOwn(input, 'signal')) return {};
	const signal = field(input, 'signal'); if (signal === undefined) return {};
	if (!signal || typeof signal !== 'object' || Object.getPrototypeOf(signal) !== AbortSignal.prototype
		|| ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(signal, key))) throw new TypeError('Stack operation requires a native AbortSignal.');
	Reflect.apply(throwIfAborted, signal, []);
	return { signal: signal as AbortSignal };
}
function revision(value: unknown): number { return integer(value, 0, Number.MAX_SAFE_INTEGER, 'stack expected revision'); }
function increment(value: number): number { return integer(value + 1, 0, Number.MAX_SAFE_INTEGER, 'next revision'); }

/** Caller signals never enter the transaction owner; late shadows cannot erase ACKs. */
async function stackTransaction<Result>(database: IDBDatabase, stores: readonly string[], mode: IDBTransactionMode,
	operation: (stores: Stores) => Promise<Result>, signal?: AbortSignal): Promise<Result> {
	const stop = signal ? new AbortController() : undefined;
	const forward = (): void => {
		const reason: unknown = Reflect.apply(nativeReason, signal!, []);
		stop!.abort(reason);
	};
	if (signal) {
		Reflect.apply(nativeAddListener, signal, ['abort', forward, { once: true }]);
		if (Reflect.apply(nativeAborted, signal, [])) forward();
	}
	try { return await catalogTransaction(database, stores, mode, operation, stop?.signal); }
	finally { if (signal) Reflect.apply(nativeRemoveListener, signal, ['abort', forward]); }
}
