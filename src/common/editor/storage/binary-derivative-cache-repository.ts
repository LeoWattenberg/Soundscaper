/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField } from '../closed-domain-value.ts';
import { BINARY_DERIVATIVE_CACHE_TYPE_V1, binaryDerivativeManifestV1, normalizeBinaryDerivativeCacheIdentityV1, normalizeBinaryDerivativeCacheProfileV1,
	readBinaryDerivativeCacheRecordV1, type BinaryDerivativeCacheIdentityV1, type BinaryDerivativeCacheProfileV1,
	type BinaryDerivativeCacheRecordV1 } from './binary-derivative-cache-records.ts';
import { cacheStore, sameDerivativeCacheRecord } from './binary-derivative-cache-pairs.ts';
import { DERIVATIVE_CACHE_ENTRY_STORE_NAME as INVENTORY, VIDEO_DERIVATIVE_STORE_NAME as PAYLOAD } from './derivative-cache-entry.ts';
import { planDerivativeCacheEviction } from './derivative-cache-policy.ts';
import { readCursorPage, request, transact } from './indexeddb-backend.ts';
import { MediaAssetWriteAdmission } from './media-asset-write-admission.ts';
import type { MediaAssetLifecycleCoordinator } from './media-asset-lifecycle-coordinator.ts';
import { hasStoredBinaryPathReference } from './media-binary-reference-query.ts';
import { canonicalMediaContentBlob, digestMediaContent, MEDIA_CONTENT_DIGEST_CHUNK_BYTES } from './media-content-digest.ts';
import { isMediaContentSha256, isMediaContentToken } from './media-content-provenance.ts';
import type { OpfsRepository, OpfsBinaryWriter } from './opfs-repository.ts';
import type { StorageRecord } from './media-records.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export interface BinaryDerivativeCacheLoadedV1 {
	readonly identity: BinaryDerivativeCacheIdentityV1;
	readonly body: Blob;
	readonly outputSha256: string;
}
export interface BinaryDerivativeCacheStoreResultV1 {
	readonly outcome: 'stored' | 'pressure';
	readonly cleanupErrors?: readonly unknown[];
}
export interface BinaryDerivativeCacheTrimResultV1 {
	readonly removedEntries: number;
	readonly removedBytes: number;
	readonly more: boolean;
	readonly cleanupErrors?: readonly unknown[];
}
export interface BinaryDerivativeCachePortV1 {
	load(identity: unknown, signal?: AbortSignal): Promise<BinaryDerivativeCacheLoadedV1 | null>;
	store(identity: unknown, body: unknown, expectedOutputSha256: string, signal?: AbortSignal): Promise<BinaryDerivativeCacheStoreResultV1>;
	trim(signal?: AbortSignal): Promise<BinaryDerivativeCacheTrimResultV1>;
}
type BinaryPort = Pick<OpfsRepository, 'planBinaryWriter' | 'loadBinaryRecord' | 'deletePath'>;
export type { BinaryDerivativeCacheIdentityV1, BinaryDerivativeCacheProfileV1 } from './binary-derivative-cache-records.ts';

/** Disposable paired bodies, independently bound to a current trusted retained original. */
export class BinaryDerivativeCacheRepositoryV1 implements BinaryDerivativeCachePortV1 {
	readonly #profile: BinaryDerivativeCacheProfileV1;
	readonly #port: StorageRepositoryPort;
	readonly #binary: BinaryPort;
	readonly #lifecycle: MediaAssetLifecycleCoordinator;
	constructor(port: StorageRepositoryPort, binary: BinaryPort,
		lifecycle: MediaAssetLifecycleCoordinator, profile: BinaryDerivativeCacheProfileV1) {
		this.#port = port; this.#binary = binary; this.#lifecycle = lifecycle;
		this.#profile = normalizeBinaryDerivativeCacheProfileV1(profile);
	}

	load(value: unknown, signal?: AbortSignal): Promise<BinaryDerivativeCacheLoadedV1 | null> {
		return this.#run(signal, async admission => {
			const identity = normalizeBinaryDerivativeCacheIdentityV1(value, this.#profile), database = await this.#database(admission);
			const pair = await cacheTransaction(database, ['mediaAssets', INVENTORY, PAYLOAD], 'readonly', admission.signal, async stores => {
				const original = readOriginal(await request(cacheStore(stores, 'mediaAssets').get(identity.sourceId)), identity);
				const current = await readPair(stores, identity.key, this.#profile);
				if (!current || !original || current.scalar.originalMediaContentToken !== original
					|| current.scalar.binaryDerivativeManifest !== binaryDerivativeManifestV1(identity)) return null;
				return current;
			});
			if (!pair) return null;
			if (pair.scalar.path) admission.setIdentity({ path: pair.scalar.path });
			admission.throwIfCancelled();
			const body = canonicalMediaContentBlob(await this.#binary.loadBinaryRecord(pair.payload, 'The cached binary body is missing.', 'derivative-payload-read'));
			if (body.size !== pair.scalar.size || await digestMediaContent(body, { signal: admission.signal }) !== pair.scalar.outputSha256) {
				throw new Error('Cached binary body failed its size or digest integrity check.');
			}
			// Loading can yield; an original replaced during the body read is a miss.
			const stillCurrent = await cacheTransaction(database, 'mediaAssets', 'readonly', admission.signal,
				async stores => readOriginal(await request(cacheStore(stores, 'mediaAssets').get(identity.sourceId)), identity));
			if (stillCurrent !== pair.scalar.originalMediaContentToken) return null;
			admission.throwIfCancelled();
			return Object.freeze({ identity, body, outputSha256: pair.scalar.outputSha256 });
		});
	}

	store(value: unknown, input: unknown, expectedOutputSha256: string, signal?: AbortSignal): Promise<BinaryDerivativeCacheStoreResultV1> {
		return this.#run(signal, async admission => {
			const identity = normalizeBinaryDerivativeCacheIdentityV1(value, this.#profile), blob = canonicalMediaContentBlob(input);
			if (!isMediaContentSha256(expectedOutputSha256)) throw new TypeError('A binary cache output digest is required.');
			if (blob.size !== identity.byteLength) throw new RangeError('Binary cache body size disagrees with its identity length.');
			if (blob.size > this.#profile.maximumBytes || this.#profile.maximumEntries === 0) return Object.freeze({ outcome: 'pressure' });
			const database = await this.#database(admission);
			const original = await cacheTransaction(database, 'mediaAssets', 'readonly', admission.signal,
				async stores => readOriginal(await request(cacheStore(stores, 'mediaAssets').get(identity.sourceId)), identity));
			if (!original) throw new Error('The retained original is missing or untrusted.');
			if (await digestMediaContent(blob, { signal: admission.signal }) !== expectedOutputSha256) throw new Error('Binary cache body digest disagrees with the prepared output.');
			let path: string | null = null, writer: OpfsBinaryWriter | null = null;
			let committed = false;
			try {
				({ path, writer } = await this.#stage(database, blob, admission));
				admission.throwIfCancelled();
				const scalar = readBinaryDerivativeCacheRecordV1({ type: BINARY_DERIVATIVE_CACHE_TYPE_V1, key: identity.key, sourceId: identity.sourceId,
					binaryDerivativeManifest: binaryDerivativeManifestV1(identity), originalSha256: identity.originalSha256,
					originalByteLength: identity.originalByteLength, originalMediaContentToken: original,
					recipeId: identity.recipeId, recipeVersion: identity.recipeVersion, cacheToken: `cache-${crypto.randomUUID()}`,
					storage: path ? 'opfs' : 'indexeddb-blob', path, size: blob.size, committedAt: new Date().toISOString(),
					outputSha256: expectedOutputSha256, mimeType: blob.type }, identity.key, this.#profile);
				const publication = await cacheTransaction(database, ['mediaAssets', INVENTORY, PAYLOAD], 'readwrite', admission.signal, async stores => {
					if (readOriginal(await request(cacheStore(stores, 'mediaAssets').get(identity.sourceId)), identity) !== original) throw new Error('The retained original changed during binary cache publication.');
					const records = await readInventory(cacheStore(stores, INVENTORY), this.#profile, admission);
					const previous = await readPair(stores, identity.key, this.#profile);
					const plan = planDerivativeCacheEviction(records.filter(entry => entry.key !== identity.key), {
						maximumBytes: this.#profile.maximumBytes - blob.size, maximumEntries: this.#profile.maximumEntries - 1 });
					if (plan.removals.length > this.#profile.maximumEvictions) return null;
					const removed: BinaryDerivativeCacheRecordV1[] = [];
					for (const expected of plan.removals) {
						const current = await readPair(stores, String(expected.key), this.#profile);
						if (!current || !sameDerivativeCacheRecord(current.scalar, expected)) return null;
						removed.push(current.scalar);
					}
					admission.throwIfCancelled();
					for (const record of removed) await deletePair(stores, record.key);
					await Promise.all([request(cacheStore(stores, PAYLOAD).put({ ...scalar, ...(path ? {} : { blob }) })), request(cacheStore(stores, INVENTORY).put(scalar))]);
					return [...removed, ...(previous ? [previous.scalar] : [])];
				});
				committed = publication !== null;
				admission.setIdentity({});
				const errors = await this.#dispose(database, publication ?? (path ? [{ storage: 'opfs', path }] : []));
				return Object.freeze({ outcome: committed ? 'stored' : 'pressure', ...(errors.length ? { cleanupErrors: Object.freeze(errors) } : {}) });
			} catch (error) {
				if (committed) throw error;
				const errors: unknown[] = [];
				try { await writer?.abort(); } catch (failure) { errors.push(failure); }
				admission.setIdentity({});
				errors.push(...await this.#dispose(database, path ? [{ storage: 'opfs', path }] : []));
				if (errors.length) {
					const failure = new AggregateError([error, ...errors], 'Binary cache publication and cleanup failed.', { cause: error });
					admission.failCleanup(failure); throw failure;
				}
				throw error;
			}
		});
	}

	trim(signal?: AbortSignal): Promise<BinaryDerivativeCacheTrimResultV1> {
		return this.#run(signal, async admission => {
			const database = await this.#database(admission);
			const result = await cacheTransaction(database, [INVENTORY, PAYLOAD], 'readwrite', admission.signal, async stores => {
				const records = await readInventory(cacheStore(stores, INVENTORY), this.#profile, admission);
				const plan = planDerivativeCacheEviction(records, this.#profile), removed: BinaryDerivativeCacheRecordV1[] = [];
				for (const expected of plan.removals.slice(0, this.#profile.maximumEvictions)) {
					const current = await readPair(stores, String(expected.key), this.#profile);
					if (!current || !sameDerivativeCacheRecord(current.scalar, expected)) continue;
					admission.throwIfCancelled(); await deletePair(stores, current.scalar.key); removed.push(current.scalar);
				}
				return { removed, more: removed.length < plan.removals.length };
			});
			const errors = await this.#dispose(database, result.removed);
			return Object.freeze({ removedEntries: result.removed.length, removedBytes: result.removed.reduce((sum, record) => sum + record.size, 0),
				more: result.more, ...(errors.length ? { cleanupErrors: Object.freeze(errors) } : {}) });
		});
	}

	#run<Value>(signal: AbortSignal | undefined, operation: (admission: MediaAssetWriteAdmission) => Promise<Value>): Promise<Value> {
		let admission: MediaAssetWriteAdmission;
		try { admission = new MediaAssetWriteAdmission(this.#lifecycle, signal); } catch (error) { return Promise.reject(error); }
		return Promise.resolve().then(() => { admission.throwIfCancelled(); return operation(admission); })
			.finally(() => { admission.complete(); admission.release(); });
	}

	async #database(admission: MediaAssetWriteAdmission): Promise<IDBDatabase> {
		const database = await this.#port.database(); admission.throwIfCancelled();
		if (!database) throw new Error('Binary derivative cache requires durable IndexedDB.'); return database;
	}

	async #stage(database: IDBDatabase, blob: Blob, admission: MediaAssetWriteAdmission): Promise<{ path: string | null; writer: OpfsBinaryWriter | null }> {
		const plan = await this.#binary.planBinaryWriter(`binary-cache-${this.#profile.kind}`, { signal: admission.signal });
		if (!plan) return { path: null, writer: null };
		admission.setIdentity({ path: plan.path });
		let writer: OpfsBinaryWriter | null = null;
		try {
			admission.throwIfCancelled(); writer = await plan.open();
			if (!writer) throw new Error('OPFS binary cache storage is unavailable.');
			for (let start = 0; start < blob.size; start += MEDIA_CONTENT_DIGEST_CHUNK_BYTES) {
				admission.throwIfCancelled();
				const bytes = new Uint8Array(await blob.slice(start, start + MEDIA_CONTENT_DIGEST_CHUNK_BYTES).arrayBuffer());
				try { await writer.write(bytes, { signal: admission.signal }); } finally { bytes.fill(0); }
			}
			await writer.close({ signal: admission.signal });
			return { path: plan.path, writer };
		} catch (error) {
			const errors: unknown[] = [];
			try { await writer?.abort(); } catch (failure) { errors.push(failure); }
			admission.setIdentity({});
			errors.push(...await this.#dispose(database, [{ storage: 'opfs', path: plan.path }]));
			if (errors.length) {
				const failure = new AggregateError([error, ...errors], 'OPFS binary cache staging and cleanup failed.', { cause: error });
				admission.failCleanup(failure); throw failure;
			}
			admission.throwIfCancelled();
			return { path: null, writer: null };
		}
	}

	async #dispose(database: IDBDatabase, records: readonly StorageRecord[]): Promise<unknown[]> {
		const errors: unknown[] = [], paths = new Set(records.filter(record => record.storage === 'opfs' && record.path).map(record => String(record.path)));
		for (const path of paths) {
			try {
				if (this.#lifecycle.activePaths().has(path) || await hasStoredBinaryPathReference({ memory: this.#port.memory, database: async () => database }, path)) continue;
				await this.#binary.deletePath(path);
			} catch (error) { errors.push(error); }
		}
		return errors;
	}
}

async function readInventory(store: IDBObjectStore, profile: BinaryDerivativeCacheProfileV1, admission: MediaAssetWriteAdmission): Promise<BinaryDerivativeCacheRecordV1[]> {
	const records: BinaryDerivativeCacheRecordV1[] = [];
	let after: string = profile.keyPrefix;
	while (records.length <= 1_024) {
		admission.throwIfCancelled();
		const page = await readCursorPage(store, { afterPrimaryKey: after, maximumPrimaryKey: `${profile.keyPrefix}\uffff`, limit: Math.min(64, 1_025 - records.length),
			project: (value, key) => { if (typeof key !== 'string') throw new TypeError('A binary cache cursor key is required.'); return readBinaryDerivativeCacheRecordV1(value, key, profile); } });
		records.push(...page);
		if (records.length > 1_024) throw new RangeError('Binary cache inventory exceeds its 1024-record hard bound.');
		if (page.length === 0) break;
		const last = page.at(-1);
		if (!last) break;
		after = last.key;
	}
	return records;
}

async function readPair(stores: Readonly<Record<string, IDBObjectStore>>, key: string, profile: BinaryDerivativeCacheProfileV1) {
	const [payload, entry] = await Promise.all([request(cacheStore(stores, PAYLOAD).get(key)) as Promise<unknown>, request(cacheStore(stores, INVENTORY).get(key)) as Promise<unknown>]);
	if (payload === undefined && entry === undefined) return null;
	const scalar = readBinaryDerivativeCacheRecordV1(entry, key, profile), bodyScalar = readBinaryDerivativeCacheRecordV1(payload, key, profile, true);
	if (!sameDerivativeCacheRecord(bodyScalar, scalar)) throw new Error('Binary cache pair failed its manifest/token integrity check.');
	return { scalar, payload: payload as StorageRecord };
}

async function deletePair(stores: Readonly<Record<string, IDBObjectStore>>, key: string): Promise<void> {
	await Promise.all([request(cacheStore(stores, PAYLOAD).delete(key)), request(cacheStore(stores, INVENTORY).delete(key))]);
}

function readOriginal(value: unknown, identity: BinaryDerivativeCacheIdentityV1): string | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	const pick = (key: string) => readClosedDomainField(record, key, 'binary cache original');
	const token = pick('mediaContentToken');
	return pick('sourceId') === identity.sourceId && pick('mediaContentDigestVersion') === 1 && pick('sha256') === identity.originalSha256
		&& pick('size') === identity.originalByteLength && isMediaContentToken(token) ? token : null;
}

async function cacheTransaction<Value>(database: IDBDatabase, names: string | readonly string[], mode: IDBTransactionMode, signal: AbortSignal,
	operation: (stores: Readonly<Record<string, IDBObjectStore>>) => Promise<Value>): Promise<Value> {
	signal.throwIfAborted(); let abort: (() => void) | undefined;
	try {
		return await transact(database, names, mode, (stores, transaction) => {
			abort = () => { try { transaction.abort(); } catch { /* Acknowledged transactions stay committed. */ } };
			signal.addEventListener('abort', abort, { once: true }); signal.throwIfAborted();
			return operation(stores);
		});
	} catch (error) {
		signal.throwIfAborted();
		throw error;
	} finally { if (abort) signal.removeEventListener('abort', abort); }
}
