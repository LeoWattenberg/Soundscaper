/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from './indexeddb-backend.ts';
import {
	MEDIA_ASSET_STAGING_LEASE_MS,
	MEDIA_ASSET_STAGING_STATE_KEY,
	MEDIA_ASSET_STAGING_STORE_NAME,
	type MediaAssetStagingLeaseRecord,
	type MediaAssetStagingStateRecord,
} from './media-asset-staging-schema.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export interface MediaAssetStagingIdentity {
	readonly mediaChunkToken?: string;
	readonly path?: string;
}

export interface ActiveMediaAssetStaging {
	readonly mediaChunkTokens: ReadonlySet<string>;
	readonly paths: ReadonlySet<string>;
}

/** Durable lease lost through expiry, clear, or another maintenance generation. */
export class MediaAssetStagingLeaseError extends Error {
	constructor() {
		super('The media staging lease was invalidated by storage maintenance.');
		this.name = 'MediaAssetStagingLeaseError';
	}
}

/** One writer-owned lease, fenced by a database-wide maintenance generation. */
export class MediaAssetStagingLease {
	readonly #port: StorageRepositoryPort;
	readonly #database: IDBDatabase | null;
	readonly #record: MediaAssetStagingLeaseRecord;

	constructor(
		port: StorageRepositoryPort,
		database: IDBDatabase | null,
		record: MediaAssetStagingLeaseRecord,
	) {
		this.#port = port;
		this.#database = database;
		this.#record = record;
	}

	async checkpoint(): Promise<void> {
		if (!this.#database) {
			this.assertInMemory({ renew: true });
			return;
		}
		await transact(this.#database, MEDIA_ASSET_STAGING_STORE_NAME, 'readwrite', async (stores) => {
			await this.assertInStore(stores[MEDIA_ASSET_STAGING_STORE_NAME], { renew: true });
		});
	}

	async release(): Promise<void> {
		if (!this.#database) {
			const current = this.#port.memory.mediaAssetStaging.get(this.#record.key);
			if (sameLease(current, this.#record)) this.#port.memory.mediaAssetStaging.delete(this.#record.key);
			return;
		}
		await transact(this.#database, MEDIA_ASSET_STAGING_STORE_NAME, 'readwrite', async (stores) => {
			const store = stores[MEDIA_ASSET_STAGING_STORE_NAME];
			const current = await request(store.get(this.#record.key));
			if (sameLease(current, this.#record)) await request(store.delete(this.#record.key));
		});
	}

	async assertInStore(
		store: IDBObjectStore,
		{ renew = false }: Readonly<{ renew?: boolean }> = {},
	): Promise<void> {
		const [stateValue, leaseValue] = await Promise.all([
			request(store.get(MEDIA_ASSET_STAGING_STATE_KEY)),
			request(store.get(this.#record.key)),
		]);
		const state = stagingState(stateValue);
		const lease = stagingLease(leaseValue);
		const now = Date.now();
		if (!state
			|| !lease
			|| state.generation !== this.#record.generation
			|| !sameLease(lease, this.#record)
			|| lease.expiresAt <= now) throw new MediaAssetStagingLeaseError();
		if (renew) {
			await request(store.put({
				...lease,
				updatedAt: now,
				expiresAt: leaseExpiry(now),
			}));
		}
	}

	assertInMemory({ renew = false }: Readonly<{ renew?: boolean }> = {}): void {
		const records = this.#port.memory.mediaAssetStaging;
		const state = stagingState(records.get(MEDIA_ASSET_STAGING_STATE_KEY));
		const lease = stagingLease(records.get(this.#record.key));
		const now = Date.now();
		if (!state
			|| !lease
			|| state.generation !== this.#record.generation
			|| !sameLease(lease, this.#record)
			|| lease.expiresAt <= now) throw new MediaAssetStagingLeaseError();
		if (renew) records.set(this.#record.key, {
			...lease,
			updatedAt: now,
			expiresAt: leaseExpiry(now),
		});
	}

	async completeInStore(store: IDBObjectStore): Promise<void> {
		await this.assertInStore(store);
		await request(store.delete(this.#record.key));
	}

	completeInMemory(): void {
		this.assertInMemory();
		this.#port.memory.mediaAssetStaging.delete(this.#record.key);
	}
}

/** Durable retained-media staging ownership shared by every store instance. */
export class MediaAssetStagingRepository {
	readonly #port: StorageRepositoryPort;

	constructor(port: StorageRepositoryPort) {
		this.#port = port;
	}

	async acquire(
		sourceId: string,
		identity: MediaAssetStagingIdentity,
		database: IDBDatabase | null,
	): Promise<MediaAssetStagingLease> {
		const now = Date.now();
		const leaseId = createId('media-lease');
		let record: MediaAssetStagingLeaseRecord;
		if (!database) {
			record = acquireMemoryLease(this.#port, sourceId, identity, leaseId, now);
		} else {
			record = await transact(database, MEDIA_ASSET_STAGING_STORE_NAME, 'readwrite', async (stores) => (
				acquireStoreLease(
					stores[MEDIA_ASSET_STAGING_STORE_NAME],
					sourceId,
					identity,
					leaseId,
					now,
				)
			));
		}
		return new MediaAssetStagingLease(this.#port, database, record);
	}

	async activeIdentities(): Promise<ActiveMediaAssetStaging> {
		const now = Date.now();
		const database = await this.#port.database();
		if (!database) return activeMemoryIdentities(this.#port, now);
		return transact(database, MEDIA_ASSET_STAGING_STORE_NAME, 'readwrite', async (stores) => (
			activeStoreIdentities(stores[MEDIA_ASSET_STAGING_STORE_NAME], now)
		));
	}

	async isActive(identity: Partial<MediaAssetStagingIdentity>): Promise<boolean> {
		const active = await this.activeIdentities();
		return (typeof identity.path === 'string' && active.paths.has(identity.path))
			|| (typeof identity.mediaChunkToken === 'string'
				&& active.mediaChunkTokens.has(identity.mediaChunkToken));
	}

	invalidateMemory(): ActiveMediaAssetStaging {
		const records = this.#port.memory.mediaAssetStaging;
		const invalidated = identitiesFrom(records.values());
		records.clear();
		records.set(MEDIA_ASSET_STAGING_STATE_KEY, createState());
		return invalidated;
	}

	async invalidateStore(store: IDBObjectStore): Promise<ActiveMediaAssetStaging> {
		const invalidated = identitiesFrom(await request(store.getAll()));
		await request(store.clear());
		await request(store.put(createState()));
		return invalidated;
	}
}

async function acquireStoreLease(
	store: IDBObjectStore,
	sourceId: string,
	identity: MediaAssetStagingIdentity,
	leaseId: string,
	now: number,
): Promise<MediaAssetStagingLeaseRecord> {
	const state = await storeState(store);
	for (const value of await request(store.getAll())) {
		const lease = stagingLease(value);
		if (!lease) continue;
		if (lease.generation !== state.generation || lease.expiresAt <= now) {
			await request(store.delete(lease.key));
			continue;
		}
		if (lease.sourceId === sourceId) throw new Error(`Media source ${sourceId} already has an active staging lease.`);
	}
	const record = createLease(sourceId, identity, leaseId, state.generation, now);
	await request(store.put(record));
	return record;
}

function acquireMemoryLease(
	port: StorageRepositoryPort,
	sourceId: string,
	identity: MediaAssetStagingIdentity,
	leaseId: string,
	now: number,
): MediaAssetStagingLeaseRecord {
	const records = port.memory.mediaAssetStaging;
	const state = memoryState(records);
	for (const [key, value] of records) {
		const lease = stagingLease(value);
		if (!lease) continue;
		if (lease.generation !== state.generation || lease.expiresAt <= now) {
			records.delete(key);
			continue;
		}
		if (lease.sourceId === sourceId) throw new Error(`Media source ${sourceId} already has an active staging lease.`);
	}
	const record = createLease(sourceId, identity, leaseId, state.generation, now);
	records.set(record.key, record);
	return record;
}

async function activeStoreIdentities(
	store: IDBObjectStore,
	now: number,
): Promise<ActiveMediaAssetStaging> {
	const state = await storeState(store);
	const active: MediaAssetStagingLeaseRecord[] = [];
	for (const value of await request(store.getAll())) {
		const lease = stagingLease(value);
		if (!lease) continue;
		if (lease.generation !== state.generation || lease.expiresAt <= now) {
			await request(store.delete(lease.key));
		} else active.push(lease);
	}
	return identitiesFrom(active);
}

function activeMemoryIdentities(port: StorageRepositoryPort, now: number): ActiveMediaAssetStaging {
	const records = port.memory.mediaAssetStaging;
	const state = memoryState(records);
	const active: MediaAssetStagingLeaseRecord[] = [];
	for (const [key, value] of records) {
		const lease = stagingLease(value);
		if (!lease) continue;
		if (lease.generation !== state.generation || lease.expiresAt <= now) records.delete(key);
		else active.push(lease);
	}
	return identitiesFrom(active);
}

async function storeState(store: IDBObjectStore): Promise<MediaAssetStagingStateRecord> {
	const value = await request(store.get(MEDIA_ASSET_STAGING_STATE_KEY));
	if (value !== undefined) {
		const state = stagingState(value);
		if (!state) throw new Error('The media staging maintenance state is invalid.');
		return state;
	}
	const state = createState();
	await request(store.put(state));
	return state;
}

function memoryState(records: Map<string, unknown>): MediaAssetStagingStateRecord {
	const value = records.get(MEDIA_ASSET_STAGING_STATE_KEY);
	if (value !== undefined) {
		const state = stagingState(value);
		if (!state) throw new Error('The media staging maintenance state is invalid.');
		return state;
	}
	const state = createState();
	records.set(state.key, state);
	return state;
}

function createState(): MediaAssetStagingStateRecord {
	return { key: MEDIA_ASSET_STAGING_STATE_KEY, kind: 'state', generation: createId('media-generation') };
}

function createLease(
	sourceId: string,
	identity: MediaAssetStagingIdentity,
	leaseId: string,
	generation: string,
	now: number,
): MediaAssetStagingLeaseRecord {
	assertIdentity(identity);
	return {
		key: `lease:${leaseId}`,
		kind: 'lease',
		leaseId,
		generation,
		sourceId,
		mediaChunkToken: identity.mediaChunkToken,
		path: identity.path,
		createdAt: now,
		updatedAt: now,
		expiresAt: leaseExpiry(now),
	};
}

function identitiesFrom(values: Iterable<unknown>): ActiveMediaAssetStaging {
	const mediaChunkTokens = new Set<string>();
	const paths = new Set<string>();
	for (const value of values) {
		const lease = stagingLease(value);
		if (!lease) continue;
		if (lease.mediaChunkToken) mediaChunkTokens.add(lease.mediaChunkToken);
		if (lease.path) paths.add(lease.path);
	}
	return { mediaChunkTokens, paths };
}

function stagingState(value: unknown): MediaAssetStagingStateRecord | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Partial<MediaAssetStagingStateRecord>;
	return record.key === MEDIA_ASSET_STAGING_STATE_KEY
		&& record.kind === 'state'
		&& typeof record.generation === 'string'
		&& record.generation.length > 0
		? record as MediaAssetStagingStateRecord
		: null;
}

function stagingLease(value: unknown): MediaAssetStagingLeaseRecord | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Partial<MediaAssetStagingLeaseRecord>;
	return record.kind === 'lease'
		&& typeof record.leaseId === 'string'
		&& record.leaseId.length > 0
		&& record.key === `lease:${record.leaseId}`
		&& typeof record.generation === 'string'
		&& record.generation.length > 0
		&& typeof record.sourceId === 'string'
		&& record.sourceId.length > 0
		&& hasExactIdentity(record)
		&& Number.isFinite(record.createdAt)
		&& Number.isFinite(record.updatedAt)
		&& Number.isFinite(record.expiresAt)
		? record as MediaAssetStagingLeaseRecord
		: null;
}

function sameLease(value: unknown, expected: MediaAssetStagingLeaseRecord): boolean {
	const current = stagingLease(value);
	return Boolean(current
		&& current.key === expected.key
		&& current.leaseId === expected.leaseId
		&& current.generation === expected.generation
		&& current.sourceId === expected.sourceId
		&& current.mediaChunkToken === expected.mediaChunkToken
		&& current.path === expected.path);
}

function assertIdentity(identity: MediaAssetStagingIdentity): void {
	if (!hasExactIdentity(identity)) {
		throw new TypeError('A media staging lease requires exactly one chunk token or OPFS path.');
	}
}

function hasExactIdentity(value: Partial<MediaAssetStagingIdentity>): boolean {
	const hasToken = typeof value.mediaChunkToken === 'string' && value.mediaChunkToken.length > 0;
	const hasPath = typeof value.path === 'string' && value.path.length > 0;
	return hasToken !== hasPath;
}

function leaseExpiry(now: number): number {
	const expiresAt = now + MEDIA_ASSET_STAGING_LEASE_MS;
	if (!Number.isSafeInteger(expiresAt)) throw new RangeError('The media staging lease expiry is outside the safe range.');
	return expiresAt;
}

function createId(prefix: string): string {
	const random = globalThis.crypto?.randomUUID?.()
		?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	return `${prefix}-${random}`;
}
