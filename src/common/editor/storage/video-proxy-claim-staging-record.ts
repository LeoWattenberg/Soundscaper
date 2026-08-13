/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from './indexeddb-backend.ts';
import { MEDIA_ASSET_CHUNK_STORAGE_TYPE } from './media-asset-chunk-schema.ts';
import { MEDIA_CONTENT_DIGEST_CHUNK_BYTES } from './media-content-digest.ts';
import { trustedMediaContentSha256 } from './media-content-provenance.ts';
import type { StorageRecord } from './media-records.ts';
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
import {
	normalizeVideoProxyCleanupTombstoneRecord,
	VIDEO_PROXY_CLEANUP_TOMBSTONE_KIND,
	videoProxyCleanupTombstoneKey,
} from './video-proxy-cleanup-tombstone.ts';

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

export function normalizeVideoProxyClaimStagingInput(value: unknown): VideoProxyClaimStagingInput {
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

export async function assertVideoProxyClaimPublicationAvailable(
	store: IDBObjectStore,
	inputValue: VideoProxyClaimStagingInput | unknown,
	options: Readonly<{
		maximum?: unknown;
		requireUnclaimedBody?: boolean;
	}> = {},
): Promise<void> {
	const input = normalizeVideoProxyClaimStagingInput(inputValue);
	const maximum = boundedVideoProxyClaimMaximum(options.maximum);
	const inventory = await request(store.index('kind').getAll(VIDEO_PROXY_CLAIM_KIND, maximum + 1));
	const claims = inventory.map(normalizeVideoProxyClaimRecord);
	if (inventory.length >= maximum) {
		throw new RangeError('The bounded video proxy claim inventory limit was reached.');
	}
	if (options.requireUnclaimedBody && claims.some((claim) => claim.bodyKey === input.bodyKey)) {
		throw new Error('The video proxy body key already has a durable claim root.');
	}
	const tombstones = await request(store.index('kind').getAll(
		VIDEO_PROXY_CLEANUP_TOMBSTONE_KIND,
		maximum - inventory.length + 1,
	));
	for (const candidate of tombstones) normalizeVideoProxyCleanupTombstoneRecord(candidate);
	if (inventory.length + tombstones.length >= maximum) {
		throw new RangeError('The bounded video proxy claim inventory limit was reached.');
	}
	const key = videoProxyClaimKey(input.operationId, input.bodyKind, input.bodyKey);
	if (await request(store.get(key)) !== undefined
		|| await request(store.get(videoProxyCleanupTombstoneKey(input.bodyKey))) !== undefined) {
		throw new Error('The video proxy claim generation already exists.');
	}
}

export function createUnverifiedVideoProxyClaim(
	rowValue: unknown,
	inputValue: VideoProxyClaimStagingInput | unknown,
	options: Readonly<{ now?: number; generation?: string }> = {},
): Readonly<VideoProxyClaimRecord> {
	const input = normalizeVideoProxyClaimStagingInput(inputValue);
	const now = safeNow(options.now ?? Date.now());
	const generation = options.generation ?? createGeneration();
	return normalizeVideoProxyClaimRecord({
		key: videoProxyClaimKey(input.operationId, input.bodyKind, input.bodyKey),
		kind: VIDEO_PROXY_CLAIM_KIND,
		schemaVersion: VIDEO_PROXY_CLAIM_SCHEMA_VERSION,
		status: 'unverified',
		operationId: input.operationId,
		projectId: input.projectId,
		sourceId: input.sourceId,
		baseFingerprint: input.baseFingerprint,
		bodyKind: input.bodyKind,
		bodyKey: input.bodyKey,
		generation,
		createdAt: now,
		updatedAt: now,
		expiresAt: expiry(now),
		rowIdentity: normalizeVideoProxyClaimedRow(rowValue, input),
	});
}

export function normalizeVideoProxyClaimedRow(
	value: unknown,
	inputValue: VideoProxyClaimStagingInput | unknown,
): Readonly<VideoProxyClaimRowIdentity> {
	const input = normalizeVideoProxyClaimStagingInput(inputValue);
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
	const physical = physicalIdentity(row, input);
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
			...physical,
			mediaContentDigestVersion: 1,
			mediaContentToken: row.mediaContentToken,
			sha256,
			byteLength: input.byteLength,
			mimeType: input.mimeType,
		},
	}).rowIdentity;
}

export function assertVideoProxyClaimedRowCurrent(
	value: unknown,
	input: VideoProxyClaimStagingInput,
	expected: Readonly<VideoProxyClaimRowIdentity>,
): void {
	let current: Readonly<VideoProxyClaimRowIdentity>;
	try { current = normalizeVideoProxyClaimedRow(value, input); } catch {
		throw new Error('The claimed video proxy body row generation changed.');
	}
	if (JSON.stringify(current) !== JSON.stringify(expected)) {
		throw new Error('The claimed video proxy body row generation changed.');
	}
}

export function sameVideoProxyClaim(
	value: unknown,
	expected: Readonly<VideoProxyClaimRecord>,
): boolean {
	try {
		return JSON.stringify(normalizeVideoProxyClaimRecord(value)) === JSON.stringify(expected);
	} catch {
		return false;
	}
}

export function boundedVideoProxyClaimMaximum(value: unknown): number {
	if (value === undefined) return MAX_VIDEO_PROXY_CLAIMS;
	const requested = positiveSafeInteger(value, 'maximum video proxy claims');
	return Math.min(requested, MAX_VIDEO_PROXY_CLAIMS);
}

export function safeVideoProxyClaimNow(value: unknown): number {
	return safeNow(value);
}

export function videoProxyClaimExpiry(now: number): number {
	return expiry(now);
}

function physicalIdentity(
	row: Record<string, unknown>,
	input: VideoProxyClaimStagingInput,
): Pick<VideoProxyClaimRowIdentity, 'storage' | 'path' | 'mediaChunkToken' | 'mediaChunkBytes' | 'mediaChunkCount'> {
	if (row.storage === 'opfs') {
		if (row.mediaChunkToken !== undefined || row.mediaChunkBytes !== undefined
			|| row.mediaChunkCount !== undefined) {
			throw new Error('The claimed OPFS row has conflicting chunk identity.');
		}
		return {
			storage: 'opfs', path: string(row.path, 'claimed OPFS path'),
			mediaChunkToken: null, mediaChunkBytes: null, mediaChunkCount: null,
		};
	}
	if (row.storage !== MEDIA_ASSET_CHUNK_STORAGE_TYPE) {
		throw new Error('A claimed video proxy body requires durable OPFS or IndexedDB chunk storage.');
	}
	const mediaChunkToken = identifier(row.mediaChunkToken, 'claimed media chunk token');
	const mediaChunkBytes = positiveSafeInteger(row.mediaChunkBytes, 'claimed media chunk bytes');
	const mediaChunkCount = positiveSafeInteger(row.mediaChunkCount, 'claimed media chunk count');
	if (row.path !== undefined
		|| mediaChunkBytes !== MEDIA_CONTENT_DIGEST_CHUNK_BYTES
		|| mediaChunkCount !== Math.ceil(input.byteLength / mediaChunkBytes)) {
		throw new Error('The claimed IndexedDB row has invalid chunk geometry.');
	}
	return {
		storage: MEDIA_ASSET_CHUNK_STORAGE_TYPE, path: null,
		mediaChunkToken, mediaChunkBytes, mediaChunkCount,
	};
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
