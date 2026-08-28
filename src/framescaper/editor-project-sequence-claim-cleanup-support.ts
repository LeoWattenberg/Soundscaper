/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoProxyCleanupTombstoneRecord,
	type VideoProxyCleanupTombstoneRecord,
} from '../common/editor/storage/video-proxy-cleanup-tombstone.ts';
import {
	MAX_VIDEO_PROXY_CLAIMS,
	type VideoProxyClaimRecord,
} from '../common/editor/storage/video-proxy-claim-repository.ts';
import { request } from '../common/editor/storage/indexeddb-backend.ts';
import { mediaAssetChunkKey, mediaAssetChunkRecord } from '../common/editor/storage/media-asset-chunk-records.ts';
import { MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME } from '../common/editor/storage/media-asset-chunk-schema.ts';

const OPERATION_FIELDS = ['operationId', 'projectId', 'sourceId', 'baseFingerprint'] as const;

export interface CleanupOperationIdentity {
	readonly operationId: string;
	readonly projectId: string;
	readonly sourceId: string;
	readonly baseFingerprint: string;
}

export function normalizeCleanupOperation(value: unknown): Readonly<CleanupOperationIdentity> {
	const raw = cleanupClosedRecord(value, OPERATION_FIELDS, 'Framescaper sequence claim cleanup operation');
	const baseFingerprint = String(raw.baseFingerprint);
	if (!/^[a-f0-9]{64}$/u.test(baseFingerprint)) {
		throw new TypeError('A lowercase SHA-256 cleanup base fingerprint is required.');
	}
	return Object.freeze({
		operationId: cleanupIdentifier(raw.operationId, 'operation id'),
		projectId: cleanupIdentifier(raw.projectId, 'project id'),
		sourceId: cleanupIdentifier(raw.sourceId, 'source id'),
		baseFingerprint,
	});
}

export async function hasOnlyExactCleanupPhysicalReference(
	store: IDBObjectStore,
	claim: Readonly<VideoProxyClaimRecord>,
): Promise<boolean> {
	const identity = claim.rowIdentity;
	const indexName = identity.storage === 'opfs' ? 'path' : 'mediaChunkToken';
	const value = identity.storage === 'opfs' ? identity.path! : identity.mediaChunkToken!;
	const rows = await request(store.index(indexName).getAll(value, 2));
	return rows.length === 1 && sameCleanupBodyRow(rows[0], claim);
}

export async function hasAnyCleanupPhysicalReference(
	store: IDBObjectStore,
	tombstone: Readonly<VideoProxyCleanupTombstoneRecord>,
): Promise<boolean> {
	const indexName = tombstone.claim.rowIdentity.storage === 'opfs' ? 'path' : 'mediaChunkToken';
	const value = tombstone.claim.rowIdentity.storage === 'opfs' ? tombstone.path : tombstone.mediaChunkToken;
	return (await request(store.index(indexName).count(value))) > 0;
}

export async function exactCleanupChunks(
	store: IDBObjectStore,
	claim: Readonly<VideoProxyClaimRecord>,
	remove: boolean,
	requireAbsent = false,
): Promise<boolean> {
	const identity = claim.rowIdentity;
	if (identity.storage === 'opfs') return true;
	const token = identity.mediaChunkToken!;
	const values = await request(store.index(MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME)
		.getAll(token, identity.mediaChunkCount! + 1));
	if (requireAbsent) return values.length === 0;
	if (values.length !== identity.mediaChunkCount) return false;
	let consumed = 0;
	for (let index = 0; index < values.length; index += 1) {
		const chunk = mediaAssetChunkRecord(values[index]);
		const size = Math.min(identity.mediaChunkBytes!, identity.byteLength - consumed);
		if (!chunk || chunk.key !== mediaAssetChunkKey(token, index)
			|| chunk.sourceId !== claim.bodyKey || chunk.mediaChunkToken !== token
			|| chunk.index !== index || chunk.byteLength !== size) return false;
		consumed += size;
	}
	if (consumed !== identity.byteLength) return false;
	if (remove) {
		for (let index = 0; index < values.length; index += 1) {
			await request(store.delete(mediaAssetChunkKey(token, index)));
		}
	}
	return true;
}

export function sameCleanupBodyRow(value: unknown, claim: Readonly<VideoProxyClaimRecord>): boolean {
	if (!value || typeof value !== 'object') return false;
	const row = value as Record<string, unknown>;
	const identity = claim.rowIdentity;
	return row.sourceId === identity.sourceId && row.kind === identity.kind
		&& row.encoding === identity.encoding && row.storage === identity.storage
		&& (row.path ?? null) === identity.path && (row.mediaChunkToken ?? null) === identity.mediaChunkToken
		&& (row.mediaChunkBytes ?? null) === identity.mediaChunkBytes
		&& (row.mediaChunkCount ?? null) === identity.mediaChunkCount
		&& row.mediaContentDigestVersion === identity.mediaContentDigestVersion
		&& row.mediaContentToken === identity.mediaContentToken && row.sha256 === identity.sha256
		&& row.size === identity.byteLength && row.mimeType === identity.mimeType;
}

/** A claim is live while its owner renews the lease or the body row still holds its staging grace. */
export function isLiveCleanupClaim(
	claim: Readonly<VideoProxyClaimRecord>,
	row: unknown,
	now: number,
): boolean {
	if (claim.expiresAt > now) return true;
	if (!row || typeof row !== 'object') return false;
	const grace = Date.parse(String((row as Record<string, unknown>).pendingProjectUntil ?? ''));
	return Number.isFinite(grace) && grace > now;
}

export function groupCleanupClaims(
	claims: readonly Readonly<VideoProxyClaimRecord>[],
): Map<string, Readonly<VideoProxyClaimRecord>[]> {
	const result = new Map<string, Readonly<VideoProxyClaimRecord>[]>();
	for (const claim of claims) appendCleanupMapValue(result, claim.bodyKey, claim);
	return result;
}

export function appendCleanupMapValue<Value>(target: Map<string, Value[]>, key: string, value: Value): void {
	const values = target.get(key) ?? [];
	values.push(value);
	target.set(key, values);
}

export function cleanupPhysicalKey(value: Readonly<VideoProxyCleanupTombstoneRecord>): string {
	return value.claim.rowIdentity.storage === 'opfs'
		? `path:${value.path}` : `chunks:${value.mediaChunkToken}`;
}

export function cleanupPhysicalKeyForClaim(value: Readonly<VideoProxyClaimRecord>): string {
	return value.rowIdentity.storage === 'opfs'
		? `path:${String(value.rowIdentity.path)}` : `chunks:${String(value.rowIdentity.mediaChunkToken)}`;
}

export function sameCleanupTombstone(
	value: unknown,
	expected: Readonly<VideoProxyCleanupTombstoneRecord>,
): boolean {
	try { return JSON.stringify(normalizeVideoProxyCleanupTombstoneRecord(value)) === JSON.stringify(expected); }
	catch { return false; }
}

export function cleanupCollection(value: unknown, name: string): unknown[] {
	if (Array.isArray(value)) return cleanupDenseArray(value, name);
	if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Set.prototype) {
		throw new TypeError(`${name} must be a dense array or plain Set.`);
	}
	return [...Set.prototype.values.call(value as Set<unknown>)];
}

export function cleanupDenseArray(value: unknown, name: string): unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must be a dense ordinary array.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name} is sparse.`);
		result.push(descriptor.value);
	}
	return result;
}

export function cleanupClosedRecord<const Fields extends readonly string[]>(
	value: unknown,
	fields: Fields,
	name: string,
): Record<Fields[number], unknown> {
	return cleanupOptionalClosedRecord(value, fields, fields, name) as Record<Fields[number], unknown>;
}

export function cleanupOptionalClosedRecord(
	value: unknown,
	fields: readonly string[],
	required: readonly string[],
	name: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a plain record.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} has an unsupported field.`);
	}
	for (const field of required) {
		const descriptor = descriptors[field];
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name}.${field} is required.`);
	}
	const result: Record<string, unknown> = {};
	for (const field of fields) {
		const descriptor = descriptors[field];
		if (!descriptor) continue;
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name}.${field} must be data.`);
		result[field] = descriptor.value;
	}
	return result;
}

export function boundedCleanupInventory(value: unknown): number {
	if (value === undefined) return MAX_VIDEO_PROXY_CLAIMS;
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError('The sequence cleanup inventory limit must be a positive safe integer.');
	}
	return Math.min(Number(value), MAX_VIDEO_PROXY_CLAIMS);
}

export function safeCleanupNow(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError('The sequence cleanup clock is invalid.');
	return Number(value);
}

export function isCleanupNotFound(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && (error as { readonly name?: unknown }).name === 'NotFoundError');
}

function cleanupIdentifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/u.test(value)) {
		throw new TypeError(`A bounded printable cleanup ${name} is required.`);
	}
	return value;
}

export class CleanupInventoryError extends Error {
	constructor(options?: unknown) {
		super('The bounded sequence cleanup inventory is invalid', options === undefined ? undefined : { cause: options });
	}
}
