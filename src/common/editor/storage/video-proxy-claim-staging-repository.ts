/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { request, transact } from './indexeddb-backend.ts';
import {
	MEDIA_ASSET_CHUNK_STORAGE_TYPE,
} from './media-asset-chunk-schema.ts';
import {
	MediaAssetChunkRecords,
	mediaAssetChunkKey,
	mediaAssetChunkRecord,
} from './media-asset-chunk-records.ts';
import { MEDIA_CONTENT_DIGEST_CHUNK_BYTES } from './media-content-digest.ts';
import { trustedMediaContentSha256 } from './media-content-provenance.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from './media-asset-staging-schema.ts';
import type { StorageRecord } from './media-records.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { StorageRepositoryPort } from './repository-port.ts';
import {
	MAX_VIDEO_PROXY_CLAIMS,
	normalizeVideoProxyClaimRecord,
	type VideoProxyClaimBodyKind,
	type VideoProxyClaimRecord,
	type VideoProxyClaimRowIdentity,
	VIDEO_PROXY_CLAIM_KIND,
	VIDEO_PROXY_CLAIM_SCHEMA_VERSION,
	videoProxyClaimKey,
} from './video-proxy-claim-repository.ts';

const CLAIM_LEASE_MS = 24 * 60 * 60 * 1000;
const MAX_PROXY_BYTES = 512 * 1024 * 1024;
const MAX_TIMING_BYTES = 16_000_032;
const TIMING_MIME_TYPE = 'application/vnd.soundscaper.video-timing';
const INPUT_FIELDS = [
	'operationId', 'projectId', 'sourceId', 'baseFingerprint', 'bodyKind',
	'bodyKey', 'byteLength', 'mimeType',
] as const;

export interface VideoProxyClaimStagingInput {
	readonly operationId: string;
	readonly projectId: string;
	readonly sourceId: string;
	readonly baseFingerprint: string;
	readonly bodyKind: VideoProxyClaimBodyKind;
	readonly bodyKey: string;
	readonly byteLength: number;
	readonly mimeType: string;
}

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

	constructor(
		port: StorageRepositoryPort,
		opfs: OpfsRepository,
		options: VideoProxyClaimStagingOptions = {},
	) {
		this.#port = port;
		this.#opfs = opfs;
		this.#chunks = new MediaAssetChunkRecords(port);
		this.#now = options.now ?? Date.now;
		this.#maximumClaims = boundedMaximumClaims(options.maximumClaims);
		this.#createGeneration = options.createGeneration ?? createGeneration;
	}

	async createVerifiedClaim(
		value: VideoProxyClaimStagingInput,
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<Readonly<VideoProxyClaimRecord>> {
		const input = normalizeInput(value);
		throwIfAborted(options.signal);
		const database = await this.#port.database();
		throwIfAborted(options.signal);
		if (!database) {
			throw new Error('Durable storage is required; memory proxy claim staging is unsupported.');
		}
		const state = await this.#createUnverified(database, input);
		try {
			await this.#verifyBody(state, options.signal);
			return await this.#markVerified(state);
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

	async #createUnverified(
		database: IDBDatabase,
		input: VideoProxyClaimStagingInput,
	): Promise<ClaimState> {
		const claim = await transact(
			database,
			['mediaAssets', MEDIA_ASSET_STAGING_STORE_NAME],
			'readwrite',
			async ({ mediaAssets, mediaAssetStaging }) => {
				const inventory = await request(mediaAssetStaging
					.index('kind')
					.getAll(VIDEO_PROXY_CLAIM_KIND, this.#maximumClaims + 1));
				for (const candidate of inventory) normalizeVideoProxyClaimRecord(candidate);
				if (inventory.length >= this.#maximumClaims) {
					throw new RangeError('The bounded video proxy claim inventory limit was reached.');
				}
				const key = videoProxyClaimKey(input.operationId, input.bodyKind, input.bodyKey);
				if (await request(mediaAssetStaging.get(key)) !== undefined) {
					throw new Error('The video proxy claim generation already exists.');
				}
				const row = await request(mediaAssets.get(input.bodyKey));
				if (row === undefined) throw new Error('The claimed video proxy body row is missing.');
				const rowIdentity = normalizeStoredRow(row, input);
				const now = safeNow(this.#now());
				const next = normalizeVideoProxyClaimRecord({
					key,
					kind: VIDEO_PROXY_CLAIM_KIND,
					schemaVersion: VIDEO_PROXY_CLAIM_SCHEMA_VERSION,
					status: 'unverified',
					operationId: input.operationId,
					projectId: input.projectId,
					sourceId: input.sourceId,
					baseFingerprint: input.baseFingerprint,
					bodyKind: input.bodyKind,
					bodyKey: input.bodyKey,
					generation: this.#createGeneration(),
					createdAt: now,
					updatedAt: now,
					expiresAt: expiry(now),
					rowIdentity,
				});
				await request(mediaAssetStaging.put(next));
				return next;
			},
		);
		return { database, input, claim };
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
				assertCurrentRow(row, state.input, state.claim.rowIdentity);
				assertCurrentClaim(stored, state.claim);
				const now = safeNow(this.#now());
				if (state.claim.expiresAt <= now) throw new Error('The video proxy claim generation expired.');
				const renewed = normalizeVideoProxyClaimRecord({
					...state.claim,
					updatedAt: Math.max(state.claim.updatedAt, now),
					expiresAt: expiry(now),
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
				assertCurrentRow(row, state.input, state.claim.rowIdentity);
				assertCurrentClaim(stored, state.claim);
				const now = safeNow(this.#now());
				if (state.claim.expiresAt <= now) throw new Error('The video proxy claim generation expired.');
				const verified = normalizeVideoProxyClaimRecord({
					...state.claim,
					status: 'verified',
					updatedAt: Math.max(state.claim.updatedAt, now),
					expiresAt: expiry(now),
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
				if (sameClaim(stored, state.claim)) await request(mediaAssetStaging.delete(state.claim.key));
			},
		);
	}
}

function normalizeInput(value: unknown): VideoProxyClaimStagingInput {
	const raw = closedRecord(value, INPUT_FIELDS, 'video proxy claim staging input');
	const bodyKind = raw.bodyKind === 'proxy' || raw.bodyKind === 'timing'
		? raw.bodyKind
		: invalid<VideoProxyClaimBodyKind>('A video proxy claim body kind is required.');
	const bodyKey = string(raw.bodyKey, 'claim body key');
	const expectedPrefix = bodyKind === 'proxy' ? 'video-proxy-sha256:' : 'video-timing-sha256:';
	const digest = bodyKey.slice(expectedPrefix.length);
	if (!bodyKey.startsWith(expectedPrefix) || !/^[a-f0-9]{64}$/u.test(digest)) {
		throw new TypeError('A content-addressed video proxy claim body key is required.');
	}
	const byteLength = positiveSafeInteger(raw.byteLength, 'claim body byte length');
	if (byteLength > (bodyKind === 'proxy' ? MAX_PROXY_BYTES : MAX_TIMING_BYTES)) {
		throw new RangeError('The claimed video proxy body exceeds its fixed byte limit.');
	}
	const mimeType = string(raw.mimeType, 'claim body MIME type');
	if (mimeType.length > 128
		|| (bodyKind === 'proxy' ? !mimeType.startsWith('video/') : mimeType !== TIMING_MIME_TYPE)) {
		throw new TypeError('The claimed video proxy body MIME type is noncanonical.');
	}
	return Object.freeze({
		operationId: identifier(raw.operationId, 'claim operation id'),
		projectId: identifier(raw.projectId, 'claim project id'),
		sourceId: identifier(raw.sourceId, 'claim source id'),
		baseFingerprint: digestValue(raw.baseFingerprint, 'claim base fingerprint'),
		bodyKind,
		bodyKey,
		byteLength,
		mimeType,
	});
}

function normalizeStoredRow(
	value: unknown,
	input: VideoProxyClaimStagingInput,
): Readonly<VideoProxyClaimRowIdentity> {
	const row = dataRecord(value, 'claimed media row');
	if (row.sourceId !== input.bodyKey) throw new Error('The claimed media row has the wrong body key.');
	const expectedKind = input.bodyKind === 'proxy' ? 'video-proxy' : 'video-timing';
	const expectedEncoding = input.bodyKind === 'proxy' ? 'video-proxy-v1' : 'soundscaper-video-timing-v1';
	if (row.kind !== expectedKind
		|| (input.bodyKind === 'proxy' ? row.encoding !== expectedEncoding
			: row.encoding !== undefined && row.encoding !== expectedEncoding)) {
		throw new Error('The claimed media row has the wrong body role or encoding.');
	}
	if (row.blob !== undefined) throw new Error('A durable claimed media row cannot retain an inline Blob.');
	const sha256 = trustedMediaContentSha256(row as StorageRecord);
	if (!sha256 || !input.bodyKey.endsWith(sha256)) {
		throw new Error('The claimed media row lacks exact verified content provenance.');
	}
	if (row.size !== input.byteLength || row.mimeType !== input.mimeType) {
		throw new Error('The claimed media row metadata does not match the requested body.');
	}
	let storage: VideoProxyClaimRowIdentity['storage'];
	let path: string | null;
	let mediaChunkToken: string | null;
	let mediaChunkBytes: number | null;
	let mediaChunkCount: number | null;
	if (row.storage === 'opfs') {
		storage = 'opfs';
		path = string(row.path, 'claimed OPFS path');
		mediaChunkToken = null;
		mediaChunkBytes = null;
		mediaChunkCount = null;
		if (row.mediaChunkToken !== undefined || row.mediaChunkBytes !== undefined
			|| row.mediaChunkCount !== undefined) {
			throw new Error('The claimed OPFS row has conflicting chunk identity.');
		}
	} else if (row.storage === MEDIA_ASSET_CHUNK_STORAGE_TYPE) {
		storage = MEDIA_ASSET_CHUNK_STORAGE_TYPE;
		path = null;
		mediaChunkToken = identifier(row.mediaChunkToken, 'claimed media chunk token');
		mediaChunkBytes = positiveSafeInteger(row.mediaChunkBytes, 'claimed media chunk bytes');
		mediaChunkCount = positiveSafeInteger(row.mediaChunkCount, 'claimed media chunk count');
		if (row.path !== undefined
			|| mediaChunkBytes !== MEDIA_CONTENT_DIGEST_CHUNK_BYTES
			|| mediaChunkCount !== Math.ceil(input.byteLength / mediaChunkBytes)) {
			throw new Error('The claimed IndexedDB row has invalid chunk geometry.');
		}
	} else {
		throw new Error('A claimed video proxy body requires durable OPFS or IndexedDB chunk storage.');
	}
	return normalizeVideoProxyClaimRecord({
		key: videoProxyClaimKey('row-identity-projection', input.bodyKind, input.bodyKey),
		kind: VIDEO_PROXY_CLAIM_KIND,
		schemaVersion: VIDEO_PROXY_CLAIM_SCHEMA_VERSION,
		status: 'unverified',
		operationId: 'row-identity-projection',
		projectId: input.projectId,
		sourceId: input.sourceId,
		baseFingerprint: input.baseFingerprint,
		bodyKind: input.bodyKind,
		bodyKey: input.bodyKey,
		generation: 'row-identity-projection',
		createdAt: 0,
		updatedAt: 0,
		expiresAt: 1,
		rowIdentity: {
			sourceId: input.bodyKey,
			kind: expectedKind,
			encoding: expectedEncoding,
			storage,
			path,
			mediaChunkToken,
			mediaChunkBytes,
			mediaChunkCount,
			mediaContentDigestVersion: 1,
			mediaContentToken: row.mediaContentToken,
			sha256,
			byteLength: input.byteLength,
			mimeType: input.mimeType,
		},
	}).rowIdentity;
}

function assertCurrentRow(
	value: unknown,
	input: VideoProxyClaimStagingInput,
	expected: Readonly<VideoProxyClaimRowIdentity>,
): void {
	let current: Readonly<VideoProxyClaimRowIdentity>;
	try { current = normalizeStoredRow(value, input); } catch {
		throw new Error('The claimed video proxy body row generation changed.');
	}
	if (JSON.stringify(current) !== JSON.stringify(expected)) {
		throw new Error('The claimed video proxy body row generation changed.');
	}
}

function assertCurrentClaim(value: unknown, expected: Readonly<VideoProxyClaimRecord>): void {
	if (!sameClaim(value, expected)) throw new Error('The video proxy claim generation changed.');
}

function sameClaim(value: unknown, expected: Readonly<VideoProxyClaimRecord>): boolean {
	try {
		return JSON.stringify(normalizeVideoProxyClaimRecord(value)) === JSON.stringify(expected);
	} catch {
		return false;
	}
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

function boundedMaximumClaims(value: unknown): number {
	if (value === undefined) return MAX_VIDEO_PROXY_CLAIMS;
	const requested = positiveSafeInteger(value, 'maximum video proxy claims');
	return Math.min(requested, MAX_VIDEO_PROXY_CLAIMS);
}

function expiry(now: number): number {
	const value = now + CLAIM_LEASE_MS;
	if (!Number.isSafeInteger(value)) throw new RangeError('The video proxy claim expiry is outside the safe range.');
	return value;
}

function safeNow(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError('The video proxy claim clock is outside the safe range.');
	}
	return Number(value);
}

function createGeneration(): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (!uuid) throw new Error('Secure random generation is required for video proxy claims.');
	return `video-proxy-generation-${uuid}`;
}

function dataRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a plain record.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain record.`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const result: Record<string, unknown> = {};
	for (const key of Reflect.ownKeys(descriptors)) {
		if (typeof key !== 'string') throw new TypeError(`${label} cannot contain symbol fields.`);
		const descriptor = descriptors[key]!;
		if (!descriptor.enumerable || !('value' in descriptor)) {
			throw new TypeError(`${label} requires enumerable data fields.`);
		}
		result[key] = descriptor.value;
	}
	return result;
}

function closedRecord<const Fields extends readonly string[]>(
	value: unknown,
	fields: Fields,
	label: string,
): Record<Fields[number], unknown> {
	const record = dataRecord(value, label);
	if (Object.keys(record).length !== fields.length || fields.some((field) => !Object.hasOwn(record, field))) {
		throw new TypeError(`${label} has an unsupported or missing field.`);
	}
	return record as Record<Fields[number], unknown>;
}

function digestValue(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError(`A lowercase SHA-256 ${label} is required.`);
	}
	return value;
}

function identifier(value: unknown, label: string): string {
	const result = string(value, label);
	if (!/^[\x21-\x7e]{1,256}$/u.test(result)) throw new TypeError(`A bounded printable ${label} is required.`);
	return result;
}

function string(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`A ${label} is required.`);
	return value;
}

function positiveSafeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(`${label} must be a positive safe integer.`);
	return Number(value);
}

function invalid<Result>(message: string): Result {
	throw new TypeError(message);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('Video proxy claim staging was cancelled.', 'AbortError');
}
