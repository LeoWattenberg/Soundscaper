/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from './indexeddb-backend.ts';
import {
	MEDIA_ASSET_STAGING_STORE_NAME,
} from './media-asset-staging-schema.ts';
import {
	isMediaContentSha256,
	isMediaContentToken,
} from './media-content-provenance.ts';
import { MEDIA_ASSET_CHUNK_STORAGE_TYPE } from './media-asset-chunk-schema.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export const VIDEO_PROXY_CLAIM_SCHEMA_VERSION = 1 as const;
export const VIDEO_PROXY_CLAIM_KIND = 'video-proxy-claim' as const;
export const MAX_VIDEO_PROXY_CLAIMS = 100_000;

const CLAIM_KEY_PREFIX = 'video-proxy-claim:';
const PROXY_KEY_PREFIX = 'video-proxy-sha256:';
const TIMING_KEY_PREFIX = 'video-timing-sha256:';
const TIMING_ENCODING = 'soundscaper-video-timing-v1';
const TIMING_MIME_TYPE = 'application/vnd.soundscaper.video-timing';
const MAX_PROXY_BYTES = 512 * 1024 * 1024;
const MAX_TIMING_BYTES = 16_000_032;
const IDENTIFIER_PATTERN = /^[\x21-\x7e]{1,256}$/u;

const CLAIM_FIELDS = [
	'key', 'kind', 'schemaVersion', 'status', 'operationId', 'projectId', 'sourceId',
	'baseFingerprint', 'bodyKind', 'bodyKey', 'generation', 'createdAt', 'updatedAt',
	'expiresAt', 'rowIdentity',
] as const;
const ROW_FIELDS = [
	'sourceId', 'kind', 'encoding', 'storage', 'path', 'mediaChunkToken',
	'mediaChunkBytes', 'mediaChunkCount',
	'mediaContentDigestVersion', 'mediaContentToken', 'sha256', 'byteLength', 'mimeType',
] as const;
const REQUEST_FIELDS = [
	'operationId', 'projectId', 'sourceId', 'baseFingerprint', 'proxyClaimKey', 'timingClaimKey',
] as const;

export type VideoProxyClaimBodyKind = 'proxy' | 'timing';

export interface VideoProxyClaimRowIdentity {
	readonly sourceId: string;
	readonly kind: 'video-proxy' | 'video-timing';
	readonly encoding: 'video-proxy-v1' | typeof TIMING_ENCODING;
	readonly storage: 'opfs' | typeof MEDIA_ASSET_CHUNK_STORAGE_TYPE;
	readonly path: string | null;
	readonly mediaChunkToken: string | null;
	readonly mediaChunkBytes: number | null;
	readonly mediaChunkCount: number | null;
	readonly mediaContentDigestVersion: 1;
	readonly mediaContentToken: string;
	readonly sha256: string;
	readonly byteLength: number;
	readonly mimeType: string;
}

export interface VideoProxyClaimRecord {
	readonly key: string;
	readonly kind: typeof VIDEO_PROXY_CLAIM_KIND;
	readonly schemaVersion: typeof VIDEO_PROXY_CLAIM_SCHEMA_VERSION;
	readonly status: 'unverified' | 'verified';
	readonly operationId: string;
	readonly projectId: string;
	readonly sourceId: string;
	readonly baseFingerprint: string;
	readonly bodyKind: VideoProxyClaimBodyKind;
	readonly bodyKey: string;
	readonly generation: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly expiresAt: number;
	readonly rowIdentity: Readonly<VideoProxyClaimRowIdentity>;
}

export interface VideoProxyPreservationPlanRequest {
	readonly operationId: string;
	readonly projectId: string;
	readonly sourceId: string;
	readonly baseFingerprint: string;
	readonly proxyClaimKey: string;
	readonly timingClaimKey: string;
}

export interface VideoProxyPreservationPlan {
	readonly __videoProxyPreservationPlan?: never;
}

export interface ConsumedVideoProxyPreservationClaims {
	readonly proxy: Readonly<VideoProxyClaimRecord>;
	readonly timing: Readonly<VideoProxyClaimRecord>;
}

interface PlanState {
	readonly database: IDBDatabase;
	readonly proxy: Readonly<VideoProxyClaimRecord>;
	readonly timing: Readonly<VideoProxyClaimRecord>;
}

interface VideoProxyClaimRepositoryOptions {
	readonly now?: () => number;
}

/**
 * Dormant V18 claim authority. It authenticates exact durable records and
 * exposes only a repository-local, one-use transaction capability.
 */
export class VideoProxyClaimRepository {
	readonly #port: StorageRepositoryPort;
	readonly #now: () => number;
	readonly #plans = new WeakMap<object, PlanState>();

	constructor(port: StorageRepositoryPort, options: VideoProxyClaimRepositoryOptions = {}) {
		this.#port = port;
		this.#now = options.now ?? Date.now;
	}

	async preparePreservationPlan(input: VideoProxyPreservationPlanRequest): Promise<VideoProxyPreservationPlan> {
		const requested = normalizePlanRequest(input);
		const database = await this.#port.database();
		if (!database) {
			throw new Error('Durable storage is required; memory proxy preservation is unsupported.');
		}
		const [proxyValue, timingValue] = await transact(
			database,
			MEDIA_ASSET_STAGING_STORE_NAME,
			'readonly',
			({ mediaAssetStaging }) => Promise.all([
				request(mediaAssetStaging.get(requested.proxyClaimKey)),
				request(mediaAssetStaging.get(requested.timingClaimKey)),
			]),
		);
		if (proxyValue === undefined || timingValue === undefined) {
			throw new Error('A required video proxy preservation claim is missing.');
		}
		const proxy = normalizeVideoProxyClaimRecord(proxyValue);
		const timing = normalizeVideoProxyClaimRecord(timingValue);
		assertRequestedClaim(proxy, requested, 'proxy', requested.proxyClaimKey);
		assertRequestedClaim(timing, requested, 'timing', requested.timingClaimKey);
		assertClaimsLive(proxy, timing, this.#now());

		const plan = Object.freeze(Object.create(null) as VideoProxyPreservationPlan);
		this.#plans.set(plan, { database, proxy, timing });
		return plan;
	}

	async consumePreservationPlan(
		plan: VideoProxyPreservationPlan,
		stagingStore: IDBObjectStore,
	): Promise<Readonly<ConsumedVideoProxyPreservationClaims>> {
		if (!plan || typeof plan !== 'object') throw new TypeError('An authentic preservation plan is required.');
		const state = this.#plans.get(plan);
		if (!state) throw new TypeError('The preservation plan is not authentic or was already consumed.');
		this.#plans.delete(plan);
		const transaction = stagingStore.transaction as IDBTransaction & { readonly database?: IDBDatabase };
		const transactionDatabase = transaction.db ?? transaction.database;
		if ((stagingStore.name !== undefined && stagingStore.name !== MEDIA_ASSET_STAGING_STORE_NAME)
			|| stagingStore.keyPath !== 'key'
			|| transactionDatabase !== state.database
			|| transaction.mode !== 'readwrite') {
			throw new TypeError('The preservation plan requires its owning durable readwrite transaction.');
		}
		const [proxyValue, timingValue] = await Promise.all([
			request(stagingStore.get(state.proxy.key)),
			request(stagingStore.get(state.timing.key)),
		]);
		if (!sameClaim(proxyValue, state.proxy) || !sameClaim(timingValue, state.timing)) {
			throw new Error('A video proxy preservation claim changed before commit.');
		}
		assertClaimsLive(state.proxy, state.timing, this.#now());
		stagingStore.delete(state.proxy.key);
		stagingStore.delete(state.timing.key);
		return Object.freeze({ proxy: state.proxy, timing: state.timing });
	}
}

export function videoProxyClaimKey(
	operationIdValue: unknown,
	bodyKind: VideoProxyClaimBodyKind,
	bodyKeyValue: unknown,
): string {
	const operationId = identifier(operationIdValue, 'claim operation id');
	const bodyKey = storageKey(bodyKeyValue, bodyKind);
	return `${CLAIM_KEY_PREFIX}${operationId}:${bodyKind}:${bodyKey}`;
}

/** Strict closed-record snapshot for the shared staging-store claim role. */
export function normalizeVideoProxyClaimRecord(value: unknown): Readonly<VideoProxyClaimRecord> {
	const raw = closedRecord(value, CLAIM_FIELDS, 'video proxy claim');
	const bodyKind = raw.bodyKind === 'proxy' || raw.bodyKind === 'timing'
		? raw.bodyKind
		: invalid<VideoProxyClaimBodyKind>('A video proxy claim body kind is required.');
	const operationId = identifier(raw.operationId, 'claim operation id');
	const bodyKey = storageKey(raw.bodyKey, bodyKind);
	const key = string(raw.key, 'claim key');
	if (key !== videoProxyClaimKey(operationId, bodyKind, bodyKey)) {
		throw new TypeError('The video proxy claim key does not match its operation and body.');
	}
	if (raw.kind !== VIDEO_PROXY_CLAIM_KIND || raw.schemaVersion !== VIDEO_PROXY_CLAIM_SCHEMA_VERSION
		|| (raw.status !== 'unverified' && raw.status !== 'verified')) {
		throw new TypeError('A current video proxy claim is required.');
	}
	const projectId = identifier(raw.projectId, 'claim project id');
	const sourceId = identifier(raw.sourceId, 'claim source id');
	const baseFingerprint = digest(raw.baseFingerprint, 'base fingerprint');
	const generation = identifier(raw.generation, 'claim generation');
	const createdAt = nonNegativeSafeInteger(raw.createdAt, 'claim creation time');
	const updatedAt = nonNegativeSafeInteger(raw.updatedAt, 'claim update time');
	const expiresAt = nonNegativeSafeInteger(raw.expiresAt, 'claim expiry time');
	if (updatedAt < createdAt || expiresAt <= updatedAt) {
		throw new RangeError('Video proxy claim timestamps are not monotonic.');
	}
	const rowIdentity = normalizeRowIdentity(raw.rowIdentity, bodyKind, bodyKey);
	return Object.freeze({
		key, kind: VIDEO_PROXY_CLAIM_KIND, schemaVersion: VIDEO_PROXY_CLAIM_SCHEMA_VERSION,
		status: raw.status, operationId, projectId, sourceId, baseFingerprint, bodyKind,
		bodyKey, generation, createdAt, updatedAt, expiresAt, rowIdentity,
	});
}

function normalizeRowIdentity(
	value: unknown,
	bodyKind: VideoProxyClaimBodyKind,
	bodyKey: string,
): Readonly<VideoProxyClaimRowIdentity> {
	const raw = closedRecord(value, ROW_FIELDS, 'video proxy claim row identity');
	if (raw.sourceId !== bodyKey) throw new TypeError('A claim row must own its exact body key.');
	const expectedKind = bodyKind === 'proxy' ? 'video-proxy' : 'video-timing';
	const expectedEncoding = bodyKind === 'proxy' ? 'video-proxy-v1' : TIMING_ENCODING;
	if (raw.kind !== expectedKind || raw.encoding !== expectedEncoding) {
		throw new TypeError('A claim row has the wrong body role or encoding.');
	}
	const storage = raw.storage === 'opfs' || raw.storage === MEDIA_ASSET_CHUNK_STORAGE_TYPE
		? raw.storage
		: invalid<'opfs' | typeof MEDIA_ASSET_CHUNK_STORAGE_TYPE>('A durable claim row storage kind is required.');
	const path = raw.path === null ? null : string(raw.path, 'claim row path');
	const mediaChunkToken = raw.mediaChunkToken === null
		? null
		: identifier(raw.mediaChunkToken, 'claim row chunk token');
	const mediaChunkBytes = raw.mediaChunkBytes === null
		? null
		: positiveSafeInteger(raw.mediaChunkBytes, 'claim row chunk bytes');
	const mediaChunkCount = raw.mediaChunkCount === null
		? null
		: positiveSafeInteger(raw.mediaChunkCount, 'claim row chunk count');
	if ((storage === 'opfs' && (!path || mediaChunkToken !== null))
		|| (storage === MEDIA_ASSET_CHUNK_STORAGE_TYPE && (path !== null || !mediaChunkToken))
		|| (storage === 'opfs' && (mediaChunkBytes !== null || mediaChunkCount !== null))
		|| (storage === MEDIA_ASSET_CHUNK_STORAGE_TYPE
			&& (mediaChunkBytes === null || mediaChunkCount === null))) {
		throw new TypeError('A claim row requires exactly its durable physical payload identity.');
	}
	if (raw.mediaContentDigestVersion !== 1 || !isMediaContentToken(raw.mediaContentToken)) {
		throw new TypeError('A claim row requires verified media content provenance.');
	}
	const sha256 = digest(raw.sha256, 'claim row');
	if (!bodyKey.endsWith(sha256)) throw new TypeError('A claim row digest does not match its body key.');
	const byteLength = positiveSafeInteger(raw.byteLength, 'claim row byte length');
	if (byteLength > (bodyKind === 'proxy' ? MAX_PROXY_BYTES : MAX_TIMING_BYTES)) {
		throw new RangeError('A claim row exceeds its body byte limit.');
	}
	const mimeType = string(raw.mimeType, 'claim row MIME type');
	if (mimeType.length > 128 || (bodyKind === 'proxy' ? !mimeType.startsWith('video/') : mimeType !== TIMING_MIME_TYPE)) {
		throw new TypeError('A claim row has a noncanonical MIME type.');
	}
	return Object.freeze({
		sourceId: bodyKey, kind: expectedKind, encoding: expectedEncoding, storage, path,
		mediaChunkToken, mediaChunkBytes, mediaChunkCount,
		mediaContentDigestVersion: 1, mediaContentToken: raw.mediaContentToken,
		sha256, byteLength, mimeType,
	});
}

function normalizePlanRequest(value: unknown): VideoProxyPreservationPlanRequest {
	const raw = closedRecord(value, REQUEST_FIELDS, 'video proxy preservation request');
	const request = {
		operationId: identifier(raw.operationId, 'claim operation id'),
		projectId: identifier(raw.projectId, 'claim project id'),
		sourceId: identifier(raw.sourceId, 'claim source id'),
		baseFingerprint: digest(raw.baseFingerprint, 'base fingerprint'),
		proxyClaimKey: string(raw.proxyClaimKey, 'proxy claim key'),
		timingClaimKey: string(raw.timingClaimKey, 'timing claim key'),
	};
	if (request.proxyClaimKey === request.timingClaimKey) {
		throw new TypeError('Proxy and timing preservation claims must be distinct.');
	}
	return request;
}

function assertRequestedClaim(
	claim: Readonly<VideoProxyClaimRecord>,
	requestValue: VideoProxyPreservationPlanRequest,
	bodyKind: VideoProxyClaimBodyKind,
	key: string,
): void {
	if (claim.key !== key || claim.bodyKind !== bodyKind
		|| claim.status !== 'verified'
		|| claim.operationId !== requestValue.operationId
		|| claim.projectId !== requestValue.projectId
		|| claim.sourceId !== requestValue.sourceId
		|| claim.baseFingerprint !== requestValue.baseFingerprint) {
		throw new Error('The stored video proxy claim does not match the preservation request.');
	}
}

function assertClaimsLive(
	proxy: Readonly<VideoProxyClaimRecord>,
	timing: Readonly<VideoProxyClaimRecord>,
	nowValue: unknown,
): void {
	const now = nonNegativeSafeInteger(nowValue, 'claim repository clock');
	if (proxy.expiresAt <= now || timing.expiresAt <= now) {
		throw new Error('An expired video proxy preservation claim cannot be consumed.');
	}
}

function sameClaim(value: unknown, expected: Readonly<VideoProxyClaimRecord>): boolean {
	try {
		return JSON.stringify(normalizeVideoProxyClaimRecord(value)) === JSON.stringify(expected);
	} catch {
		return false;
	}
}

function closedRecord<const Fields extends readonly string[]>(
	value: unknown,
	fields: Fields,
	label: string,
): Record<Fields[number], unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a plain record.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain record.`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const expected = new Set<string>(fields);
	for (const key of Reflect.ownKeys(descriptors)) {
		if (typeof key !== 'string' || !expected.has(key)) throw new TypeError(`${label} has an unsupported field.`);
	}
	for (const field of fields) {
		const descriptor = descriptors[field];
		if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
			throw new TypeError(`${label} requires enumerable data fields.`);
		}
	}
	return Object.fromEntries(fields.map((field) => [field, descriptors[field]!.value])) as Record<Fields[number], unknown>;
}

function storageKey(value: unknown, bodyKind: VideoProxyClaimBodyKind): string {
	const result = string(value, 'claim body key');
	const prefix = bodyKind === 'proxy' ? PROXY_KEY_PREFIX : TIMING_KEY_PREFIX;
	if (!result.startsWith(prefix) || !isMediaContentSha256(result.slice(prefix.length))) {
		throw new TypeError('A content-addressed claim body key is required.');
	}
	return result;
}

function digest(value: unknown, label: string): string {
	if (!isMediaContentSha256(value)) throw new TypeError(`A lowercase SHA-256 ${label} is required.`);
	return value;
}

function identifier(value: unknown, label: string): string {
	const result = string(value, label);
	if (!IDENTIFIER_PATTERN.test(result)) throw new TypeError(`A bounded printable ${label} is required.`);
	return result;
}

function string(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`A ${label} is required.`);
	return value;
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${label} must be a non-negative safe integer.`);
	return Number(value);
}

function positiveSafeInteger(value: unknown, label: string): number {
	const result = nonNegativeSafeInteger(value, label);
	if (result === 0) throw new RangeError(`${label} must be positive.`);
	return result;
}

function invalid<Result>(message: string): Result {
	throw new TypeError(message);
}
