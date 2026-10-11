/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from './indexeddb-backend.ts';
import {
	MEDIA_ASSET_STAGING_LEASE_MS, MEDIA_ASSET_STAGING_KIND_INDEX_NAME,
	MEDIA_ASSET_STAGING_PATH_INDEX_NAME, MEDIA_ASSET_STAGING_STATE_KEY, MEDIA_ASSET_STAGING_STORE_NAME,
	type MediaAssetStagingLeaseRecord, type MediaAssetStagingStateRecord,
} from './media-asset-staging-schema.ts';
import { normalizeOpfsWorkerPath } from './opfs-sync-worker-protocol.ts';
import {
	addMediaAssetOpfsDirectoryBinding, captureMediaAssetOpfsDirectoryBinding,
	consumeMediaAssetOpfsDirectoryBinding, isMediaAssetOpfsDirectoryBindingCloneRefusal,
	readMediaAssetOpfsDirectoryBinding,
} from './media-asset-opfs-startup-namespace.ts';

const pathAdmissionErrors = new WeakSet<object>();

/** Durable lease lost through expiry, clear, or another maintenance generation. */
export class MediaAssetStagingLeaseError extends Error {
	constructor() {
		super('The media staging lease was invalidated by storage maintenance.');
		this.name = 'MediaAssetStagingLeaseError';
	}
}

export interface MediaAssetPathLeaseSnapshot {
	readonly state: Readonly<MediaAssetStagingStateRecord>;
	readonly leases: readonly Readonly<MediaAssetStagingLeaseRecord>[];
}

export function isMediaAssetPathLeaseAdmissionError(value: unknown): boolean {
	return value !== null && typeof value === 'object' && pathAdmissionErrors.has(value);
}

/** Complete native path inventory; expiry never erases an owned file's evidence. */
export async function readMediaAssetPathLeaseSnapshot(store: IDBObjectStore): Promise<MediaAssetPathLeaseSnapshot> {
	const state: unknown = await request(store.get(MEDIA_ASSET_STAGING_STATE_KEY));
	if (!closedState(state)) throw pathAdmissionError(new MediaAssetStagingLeaseError());
	const leases = await new Promise<MediaAssetStagingLeaseRecord[]>((resolve, reject) => {
		const rows: MediaAssetStagingLeaseRecord[] = [];
		const cursor = store.index(MEDIA_ASSET_STAGING_PATH_INDEX_NAME).openCursor();
		cursor.onerror = () => { reject(cursor.error ?? new Error('Could not inspect OPFS path leases.')); };
		cursor.onsuccess = () => {
			const entry = cursor.result;
			if (!entry) { resolve(rows); return; }
			try {
				if (rows.length === 64) throw pathAdmissionError(new RangeError('OPFS path staging exceeds its complete 64-entry inventory.'));
				rows.push(closedMediaAssetPathLease(entry.value));
				entry.continue();
			} catch (error) { reject(error); }
		};
	});
	return Object.freeze({ state: Object.freeze({ ...state }), leases: Object.freeze(leases) });
}

/** Consume only the exact inspected row under its unchanged maintenance state. */
export async function consumeMediaAssetPathLeaseIfCurrent(
	store: IDBObjectStore, snapshot: MediaAssetPathLeaseSnapshot, lease: Readonly<MediaAssetStagingLeaseRecord>,
): Promise<boolean> {
	const [state, current]: unknown[] = await Promise.all([
		request(store.get(MEDIA_ASSET_STAGING_STATE_KEY)), request(store.get(lease.key)),
	]);
	if (!sameClosedRecord(state, snapshot.state) || !sameClosedRecord(current, lease)) return false;
	await request(store.delete(lease.key));
	return true;
}

/** Whole-Blob path ownership always has a genuine native database and directory witness. */
export class MediaAssetPathLease {
	readonly #database: IDBDatabase;
	readonly #record: Readonly<MediaAssetStagingLeaseRecord>;

	constructor(database: IDBDatabase, record: Readonly<MediaAssetStagingLeaseRecord>) {
		this.#database = database;
		this.#record = record;
	}

	async assertInStore(staging: IDBObjectStore, settings: IDBObjectStore): Promise<void> {
		const [state, current, revoked, binding]: unknown[] = await Promise.all([
			request(staging.get(MEDIA_ASSET_STAGING_STATE_KEY)), request(staging.get(this.#record.key)),
			request(staging.get(sourceStageRevocationKey(this.#record.sourceId))),
			readMediaAssetOpfsDirectoryBinding(settings, this.#record),
		]);
		if (!closedState(state) || state.generation !== this.#record.generation
			|| !sameClosedRecord(current, this.#record) || revoked !== undefined
			|| this.#record.expiresAt <= Date.now() || !binding) throw new MediaAssetStagingLeaseError();
	}

	async completeInStore(staging: IDBObjectStore, settings: IDBObjectStore): Promise<void> {
		await this.assertInStore(staging, settings);
		if (!await consumeMediaAssetOpfsDirectoryBinding(settings, this.#record)) throw new MediaAssetStagingLeaseError();
		await request(staging.delete(this.#record.key));
	}

	/** Call only after the original physical path has been proved absent. */
	async release(): Promise<void> {
		await transact(this.#database, ['settings', MEDIA_ASSET_STAGING_STORE_NAME], 'readwrite', async stores => {
			const staging = stores[MEDIA_ASSET_STAGING_STORE_NAME]!;
			const current: unknown = await request(staging.get(this.#record.key));
			if (!sameClosedRecord(current, this.#record)) return;
			if (!await consumeMediaAssetOpfsDirectoryBinding(stores.settings!, this.#record)) throw new MediaAssetStagingLeaseError();
			await request(staging.delete(this.#record.key));
		});
	}
}

/** A clone refusal rolls back both rows and falls back before any file creation. */
export async function acquireMediaAssetPathLease(
	database: IDBDatabase, sourceId: string, pathValue: string, directory: FileSystemDirectoryHandle,
): Promise<MediaAssetPathLease | null> {
	const path = normalizeOpfsWorkerPath(pathValue);
	if (!sourceId) throw new TypeError('A path lease requires a media source id.');
	const admission = await captureMediaAssetOpfsDirectoryBinding(directory);
	if (!admission) return null;
	const leaseId = createId('media-lease'), now = Date.now();
	let record: MediaAssetStagingLeaseRecord;
	try {
		record = await transact(database, ['settings', MEDIA_ASSET_STAGING_STORE_NAME], 'readwrite', async stores => {
			const lease = await acquireMediaAssetPathLeaseRecord(stores[MEDIA_ASSET_STAGING_STORE_NAME]!, sourceId, path, leaseId, now);
			await addMediaAssetOpfsDirectoryBinding(stores.settings!, lease, admission);
			return lease;
		});
	} catch (error) {
		if (isMediaAssetOpfsDirectoryBindingCloneRefusal(error)) return null;
		throw error;
	}
	return new MediaAssetPathLease(database, record);
}

/** Shared with legacy maintenance controls; no witness is invented for old path writers. */
export async function acquireMediaAssetPathLeaseRecord(
	store: IDBObjectStore, sourceId: string, path: string, leaseId: string, now: number,
): Promise<MediaAssetStagingLeaseRecord> {
	if (await request(store.get(MEDIA_ASSET_STAGING_STATE_KEY)) === undefined) {
		await request(store.put({ key: MEDIA_ASSET_STAGING_STATE_KEY, kind: 'state', generation: createId('media-generation') }));
	}
	const snapshot = await readMediaAssetPathLeaseSnapshot(store);
	if (snapshot.leases.length === 64) throw new RangeError('OPFS path staging exceeds its complete 64-entry inventory.');
	if (snapshot.leases.some(lease => lease.sourceId === sourceId || lease.path === path)
		|| await request(store.get(sourceStageRevocationKey(sourceId))) !== undefined) throw new MediaAssetStagingLeaseError();
	await assertPathSourceAvailable(store, sourceId, snapshot.state.generation, now);
	const expiresAt = now + MEDIA_ASSET_STAGING_LEASE_MS;
	if (!Number.isSafeInteger(expiresAt)) throw new RangeError('The media staging lease expiry is outside the safe range.');
	const next: MediaAssetStagingLeaseRecord = {
		key: `lease:${leaseId}`, kind: 'lease', leaseId, generation: snapshot.state.generation, sourceId,
		mediaChunkToken: undefined, path, createdAt: now, updatedAt: now, expiresAt,
	};
	await request(store.add(next));
	return next;
}

export function closedMediaAssetPathLease(value: unknown): MediaAssetStagingLeaseRecord {
	const fields = ['key', 'kind', 'leaseId', 'generation', 'sourceId', 'mediaChunkToken', 'path', 'createdAt', 'updatedAt', 'expiresAt'];
	if (!value || typeof value !== 'object') throw pathAdmissionError(new MediaAssetStagingLeaseError());
	const lease = value as Partial<MediaAssetStagingLeaseRecord>;
	if (lease.kind !== 'lease' || typeof lease.leaseId !== 'string' || !lease.leaseId
		|| lease.key !== `lease:${lease.leaseId}` || typeof lease.generation !== 'string' || !lease.generation
		|| typeof lease.sourceId !== 'string' || !lease.sourceId || typeof lease.path !== 'string' || !lease.path
		|| lease.mediaChunkToken !== undefined || lease.path !== lease.path.trim()
		|| lease.path.split('').some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
		|| Object.keys(lease).some(key => !fields.includes(key))
		|| ![lease.createdAt, lease.updatedAt, lease.expiresAt].every(time => typeof time === 'number' && Number.isSafeInteger(time) && time >= 0)
		|| typeof lease.createdAt !== 'number' || typeof lease.updatedAt !== 'number' || typeof lease.expiresAt !== 'number'
		|| lease.updatedAt < lease.createdAt || lease.expiresAt <= lease.updatedAt) throw pathAdmissionError(new MediaAssetStagingLeaseError());
	try { normalizeOpfsWorkerPath(lease.path); }
	catch { throw pathAdmissionError(new MediaAssetStagingLeaseError()); }
	return Object.freeze({ ...lease }) as MediaAssetStagingLeaseRecord;
}

export function sourceStageRevocationKey(sourceToken: string): string {
	return `source-stage-revoked:${sourceToken}`;
}

function closedState(value: unknown): value is MediaAssetStagingStateRecord {
	if (!value || typeof value !== 'object') return false;
	const state = value as Partial<MediaAssetStagingStateRecord>;
	return Object.keys(state).length === 3 && state.key === MEDIA_ASSET_STAGING_STATE_KEY
		&& state.kind === 'state' && typeof state.generation === 'string' && state.generation.length > 0;
}

function sameClosedRecord(value: unknown, expected: Readonly<Record<string, unknown>>): boolean {
	if (!value || typeof value !== 'object') return false;
	const current = value as Record<string, unknown>, keys = Object.keys(expected);
	return Object.keys(current).length === keys.length
		&& keys.every(key => Object.hasOwn(current, key) && Object.is(current[key], expected[key]));
}

async function assertPathSourceAvailable(store: IDBObjectStore, sourceId: string, generation: string, now: number): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		let count = 0;
		const cursor = store.index(MEDIA_ASSET_STAGING_KIND_INDEX_NAME).openCursor('lease');
		cursor.onerror = () => { reject(cursor.error ?? new Error('Could not admit an OPFS source lease.')); };
		cursor.onsuccess = () => {
			const entry = cursor.result;
			if (!entry) { resolve(); return; }
			const value: unknown = entry.value;
			const lease = value && typeof value === 'object' ? value as Partial<MediaAssetStagingLeaseRecord> : null;
			const token = typeof lease?.mediaChunkToken === 'string' && lease.mediaChunkToken.length > 0;
			const path = typeof lease?.path === 'string' && lease.path.length > 0;
			if (++count > 64 || !lease || lease.kind !== 'lease' || typeof lease.leaseId !== 'string'
				|| !lease.leaseId || lease.key !== `lease:${lease.leaseId}` || typeof lease.sourceId !== 'string' || !lease.sourceId
				|| typeof lease.generation !== 'string' || !lease.generation || token === path
				|| ![lease.createdAt, lease.updatedAt, lease.expiresAt].every(time => typeof time === 'number' && Number.isFinite(time))
				|| (lease.sourceId === sourceId && (lease.path || (lease.generation === generation
					&& typeof lease.expiresAt === 'number' && lease.expiresAt > now)))) {
				reject(new MediaAssetStagingLeaseError()); return;
			}
			entry.continue();
		};
	});
}

function createId(prefix: string): string {
	const random = globalThis.crypto?.randomUUID?.()
		?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	return `${prefix}-${random}`;
}

function pathAdmissionError(error: Error): Error {
	pathAdmissionErrors.add(error);
	return error;
}
