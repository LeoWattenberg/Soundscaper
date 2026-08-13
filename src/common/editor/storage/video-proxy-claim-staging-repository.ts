/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { request, transact } from './indexeddb-backend.ts';
import {
	MediaAssetChunkRecords,
	mediaAssetChunkKey,
	mediaAssetChunkRecord,
} from './media-asset-chunk-records.ts';
import { MEDIA_CONTENT_DIGEST_CHUNK_BYTES } from './media-content-digest.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from './media-asset-staging-schema.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { StorageRepositoryPort } from './repository-port.ts';
import {
	normalizeVideoProxyClaimRecord,
	type VideoProxyClaimRecord,
} from './video-proxy-claim-repository.ts';
import {
	assertVideoProxyClaimedRowCurrent,
	assertVideoProxyClaimPublicationAvailable,
	boundedVideoProxyClaimMaximum,
	createUnverifiedVideoProxyClaim,
	normalizeVideoProxyClaimStagingInput,
	safeVideoProxyClaimNow,
	sameVideoProxyClaim,
	type VideoProxyClaimStagingInput,
	videoProxyClaimExpiry,
} from './video-proxy-claim-staging-record.ts';

export type { VideoProxyClaimStagingInput } from './video-proxy-claim-staging-record.ts';

interface VideoProxyClaimStagingOptions {
	readonly now?: () => number;
	readonly maximumClaims?: number;
	readonly createGeneration?: () => string;
}

interface ClaimState {
	readonly database: IDBDatabase;
	readonly input: VideoProxyClaimStagingInput;
	claim: Readonly<VideoProxyClaimRecord>;
}

/**
 * Dormant durable body verifier. It roots one exact row before external body
 * reads and promotes only that unchanged generation to a verified claim.
 */
export class VideoProxyClaimStagingRepository {
	readonly #port: StorageRepositoryPort;
	readonly #opfs: OpfsRepository;
	readonly #chunks: MediaAssetChunkRecords;
	readonly #now: () => number;
	readonly #maximumClaims: number;
	readonly #createGeneration: () => string;
	readonly #issued = new WeakMap<object, Readonly<{ database: IDBDatabase; claim: Readonly<VideoProxyClaimRecord> }>>();

	constructor(
		port: StorageRepositoryPort,
		opfs: OpfsRepository,
		options: VideoProxyClaimStagingOptions = {},
	) {
		this.#port = port;
		this.#opfs = opfs;
		this.#chunks = new MediaAssetChunkRecords(port);
		this.#now = options.now ?? Date.now;
		this.#maximumClaims = boundedVideoProxyClaimMaximum(options.maximumClaims);
		this.#createGeneration = options.createGeneration ?? createGeneration;
	}

	async createVerifiedClaim(
		value: VideoProxyClaimStagingInput,
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<Readonly<VideoProxyClaimRecord>> {
		const input = normalizeVideoProxyClaimStagingInput(value);
		throwIfAborted(options.signal);
		const database = await this.#port.database();
		throwIfAborted(options.signal);
		if (!database) {
			throw new Error('Durable storage is required; memory proxy claim staging is unsupported.');
		}
		const state = await this.#createUnverified(database, input);
		try {
			await this.#verifyBody(state, options.signal);
			const claim = await this.#markVerified(state);
			this.#issued.set(claim, Object.freeze({ database, claim }));
			return claim;
		} catch (error) {
			try {
				await this.#releaseIfCurrent(state);
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'Video proxy body verification and claim cleanup both failed.',
					{ cause: error },
				);
			}
			throw error;
		}
	}

	/** Verify a writer-rooted new body without ever releasing its durable cleanup root. */
	async verifyNewBodyClaim(
		value: Readonly<VideoProxyClaimRecord>,
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<Readonly<VideoProxyClaimRecord>> {
		const claim = normalizeVideoProxyClaimRecord(value);
		if (claim.status !== 'unverified') {
			throw new TypeError('A new video proxy body requires its exact unverified publication claim.');
		}
		const input = normalizeVideoProxyClaimStagingInput({
			operationId: claim.operationId,
			projectId: claim.projectId,
			sourceId: claim.sourceId,
			baseFingerprint: claim.baseFingerprint,
			bodyKind: claim.bodyKind,
			bodyKey: claim.bodyKey,
			byteLength: claim.rowIdentity.byteLength,
			mimeType: claim.rowIdentity.mimeType,
		});
		throwIfAborted(options.signal);
		const database = await this.#port.database();
		throwIfAborted(options.signal);
		if (!database) {
			throw new Error('Durable storage is required; memory proxy claim staging is unsupported.');
		}
		const state: ClaimState = { database, input, claim };
		await this.#assertStoredUnverified(state);
		await this.#verifyBody(state, options.signal);
		return this.#markVerified(state);
	}

	/** Release one authenticated reused-body claim without touching its immutable owned body. */
	async releaseVerifiedClaimIfCurrent(value: Readonly<VideoProxyClaimRecord>): Promise<boolean> {
		if (!value || typeof value !== 'object') throw new TypeError('An authentic verified video proxy claim is required.');
		const issued = this.#issued.get(value);
		if (!issued) throw new TypeError('The verified video proxy claim is foreign or already released.');
		this.#issued.delete(value);
		return transact(
			issued.database,
			MEDIA_ASSET_STAGING_STORE_NAME,
			'readwrite',
			async ({ mediaAssetStaging }) => {
				const stored = await request(mediaAssetStaging.get(issued.claim.key));
				if (stored === undefined) return false;
				if (!sameVideoProxyClaim(stored, issued.claim)) {
					throw new Error('The verified video proxy claim changed before release.');
				}
				await request(mediaAssetStaging.delete(issued.claim.key));
				return true;
			},
		);
	}

	async #createUnverified(
		database: IDBDatabase,
		input: VideoProxyClaimStagingInput,
	): Promise<ClaimState> {
		const claim = await transact(
			database,
			['mediaAssets', MEDIA_ASSET_STAGING_STORE_NAME],
			'readwrite',
			async ({ mediaAssets, mediaAssetStaging }) => {
				await assertVideoProxyClaimPublicationAvailable(
					mediaAssetStaging,
					input,
					{ maximum: this.#maximumClaims },
				);
				const row = await request(mediaAssets.get(input.bodyKey));
				if (row === undefined) throw new Error('The claimed video proxy body row is missing.');
				const next = createUnverifiedVideoProxyClaim(row, input, {
					now: safeVideoProxyClaimNow(this.#now()),
					generation: this.#createGeneration(),
				});
				await request(mediaAssetStaging.put(next));
				return next;
			},
		);
		return { database, input, claim };
	}

	async #assertStoredUnverified(state: ClaimState): Promise<void> {
		await transact(
			state.database,
			['mediaAssets', MEDIA_ASSET_STAGING_STORE_NAME],
			'readonly',
			async ({ mediaAssets, mediaAssetStaging }) => {
				const [row, stored] = await Promise.all([
					request(mediaAssets.get(state.input.bodyKey)),
					request(mediaAssetStaging.get(state.claim.key)),
				]);
				assertVideoProxyClaimedRowCurrent(row, state.input, state.claim.rowIdentity);
				assertCurrentClaim(stored, state.claim);
			},
		);
	}

	async #verifyBody(state: ClaimState, signal?: AbortSignal): Promise<void> {
		if (state.claim.rowIdentity.storage === 'opfs') {
			const body = await loadOpfsBody(this.#opfs, state.claim.rowIdentity.path!);
			if (body.size !== state.input.byteLength) {
				throw new Error('The claimed video proxy body length changed.');
			}
			const digest = sha256.create();
			for (let offset = 0; offset < body.size; offset += MEDIA_CONTENT_DIGEST_CHUNK_BYTES) {
				throwIfAborted(signal);
				await this.#renew(state);
				const length = Math.min(MEDIA_CONTENT_DIGEST_CHUNK_BYTES, body.size - offset);
				const buffer = await body.slice(offset, offset + length).arrayBuffer();
				throwIfAborted(signal);
				if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== length) {
					throw new Error('The claimed OPFS body returned an inexact bounded slice.');
				}
				digest.update(new Uint8Array(buffer));
			}
			assertDigest(digest.digest(), state.claim.rowIdentity.sha256);
			await this.#renew(state);
			return;
		}

		const identity = state.claim.rowIdentity;
		const token = identity.mediaChunkToken!;
		const expectedChunks = identity.mediaChunkCount!;
		const digest = sha256.create();
		let size = 0;
		let index = 0;
		for await (const { primaryKey, value } of this.#chunks.chunks(token)) {
			throwIfAborted(signal);
			await this.#renew(state);
			const chunk = mediaAssetChunkRecord(value);
			const expectedBytes = Math.min(identity.mediaChunkBytes!, identity.byteLength - size);
			if (!chunk
				|| primaryKey !== chunk.key
				|| chunk.key !== mediaAssetChunkKey(token, index)
				|| chunk.sourceId !== identity.sourceId
				|| chunk.mediaChunkToken !== token
				|| chunk.index !== index
				|| expectedBytes < 1
				|| expectedBytes > MEDIA_CONTENT_DIGEST_CHUNK_BYTES
				|| chunk.byteLength !== expectedBytes
				|| chunk.payload.size !== expectedBytes) {
				throw new Error('The claimed IndexedDB body chunk identity is invalid.');
			}
			const buffer = await chunk.payload.arrayBuffer();
			throwIfAborted(signal);
			if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== expectedBytes) {
				throw new Error('The claimed IndexedDB body returned an inexact bounded chunk.');
			}
			digest.update(new Uint8Array(buffer));
			size += expectedBytes;
			index += 1;
		}
		if (size !== identity.byteLength || index !== expectedChunks) {
			throw new Error('The claimed IndexedDB body geometry changed.');
		}
		assertDigest(digest.digest(), identity.sha256);
		await this.#renew(state);
	}

	async #renew(state: ClaimState): Promise<void> {
		state.claim = await transact(
			state.database,
			['mediaAssets', MEDIA_ASSET_STAGING_STORE_NAME],
			'readwrite',
			async ({ mediaAssets, mediaAssetStaging }) => {
				const [row, stored] = await Promise.all([
					request(mediaAssets.get(state.input.bodyKey)),
					request(mediaAssetStaging.get(state.claim.key)),
				]);
				assertVideoProxyClaimedRowCurrent(row, state.input, state.claim.rowIdentity);
				assertCurrentClaim(stored, state.claim);
				const now = safeVideoProxyClaimNow(this.#now());
				if (state.claim.expiresAt <= now) throw new Error('The video proxy claim generation expired.');
				const renewed = normalizeVideoProxyClaimRecord({
					...state.claim,
					updatedAt: Math.max(state.claim.updatedAt, now),
					expiresAt: videoProxyClaimExpiry(now),
				});
				await request(mediaAssetStaging.put(renewed));
				return renewed;
			},
		);
	}

	async #markVerified(state: ClaimState): Promise<Readonly<VideoProxyClaimRecord>> {
		return transact(
			state.database,
			['mediaAssets', MEDIA_ASSET_STAGING_STORE_NAME],
			'readwrite',
			async ({ mediaAssets, mediaAssetStaging }) => {
				const [row, stored] = await Promise.all([
					request(mediaAssets.get(state.input.bodyKey)),
					request(mediaAssetStaging.get(state.claim.key)),
				]);
				assertVideoProxyClaimedRowCurrent(row, state.input, state.claim.rowIdentity);
				assertCurrentClaim(stored, state.claim);
				const now = safeVideoProxyClaimNow(this.#now());
				if (state.claim.expiresAt <= now) throw new Error('The video proxy claim generation expired.');
				const verified = normalizeVideoProxyClaimRecord({
					...state.claim,
					status: 'verified',
					updatedAt: Math.max(state.claim.updatedAt, now),
					expiresAt: videoProxyClaimExpiry(now),
				});
				await request(mediaAssetStaging.put(verified));
				return verified;
			},
		);
	}

	async #releaseIfCurrent(state: ClaimState): Promise<void> {
		await transact(
			state.database,
			MEDIA_ASSET_STAGING_STORE_NAME,
			'readwrite',
			async ({ mediaAssetStaging }) => {
				const stored = await request(mediaAssetStaging.get(state.claim.key));
				if (sameVideoProxyClaim(stored, state.claim)) await request(mediaAssetStaging.delete(state.claim.key));
			},
		);
	}
}

function assertCurrentClaim(value: unknown, expected: Readonly<VideoProxyClaimRecord>): void {
	if (!sameVideoProxyClaim(value, expected)) throw new Error('The video proxy claim generation changed.');
}

async function loadOpfsBody(opfs: OpfsRepository, path: string): Promise<Blob> {
	try {
		const directory = await opfs.directory();
		const handle = await directory?.getFileHandle(path);
		if (!handle) throw new Error('missing');
		return await handle.getFile();
	} catch {
		throw new Error('The claimed video proxy body is missing.');
	}
}

function assertDigest(actual: Uint8Array, expected: string): void {
	if (bytesToHex(actual) !== expected) throw new Error('The claimed video proxy body failed digest verification.');
}

function createGeneration(): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (!uuid) throw new Error('Secure random generation is required for video proxy claims.');
	return `video-proxy-generation-${uuid}`;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('Video proxy claim staging was cancelled.', 'AbortError');
}
