/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord as record, readClosedDomainField as field } from '../closed-domain-value.ts';
import { isMediaContentSha256, isMediaContentToken } from './media-content-provenance.ts';
import type { StorageRecord } from './media-records.ts';

export const BINARY_DERIVATIVE_CACHE_TYPE_V1 = 'binary-derivative-cache-v1';

export interface BinaryDerivativeCacheProfileV1 {
	readonly kind: string;
	readonly keyPrefix: string;
	readonly maximumBytes: number;
	readonly maximumEntries: number;
	readonly maximumManifestBytes: number;
	readonly maximumEvictions: number;
}

export interface BinaryDerivativeCacheIdentityV1 {
	readonly schemaVersion: 1;
	readonly kind: string;
	readonly key: string;
	readonly sourceId: string;
	readonly originalSha256: string;
	readonly originalByteLength: number;
	readonly recipeId: string;
	readonly recipeVersion: number;
	readonly byteLength: number;
	/** Canonical inert JSON interpreted only by the trusted domain adapter. */
	readonly metadata: string;
}

export interface BinaryDerivativeCacheRecordV1 extends StorageRecord {
	readonly type: typeof BINARY_DERIVATIVE_CACHE_TYPE_V1;
	readonly key: string;
	readonly sourceId: string;
	readonly binaryDerivativeManifest: string;
	readonly originalSha256: string;
	readonly originalByteLength: number;
	readonly originalMediaContentToken: string;
	readonly recipeId: string;
	readonly recipeVersion: number;
	readonly cacheToken: string;
	readonly storage: 'opfs' | 'indexeddb-blob';
	readonly path: string | null;
	readonly size: number;
	readonly committedAt: string;
	readonly outputSha256: string;
	readonly mimeType: string;
}

const IDENTITY_FIELDS = ['schemaVersion', 'kind', 'key', 'sourceId', 'originalSha256', 'originalByteLength', 'recipeId', 'recipeVersion', 'byteLength', 'metadata'];
const RECORD_FIELDS = ['type', 'key', 'sourceId', 'binaryDerivativeManifest', 'originalSha256', 'originalByteLength', 'originalMediaContentToken',
	'recipeId', 'recipeVersion', 'cacheToken', 'storage', 'path', 'size', 'committedAt', 'outputSha256', 'mimeType'];

export function normalizeBinaryDerivativeCacheProfileV1(value: unknown): BinaryDerivativeCacheProfileV1 {
	const input = record(value, 'binary cache profile', ['kind', 'keyPrefix', 'maximumBytes', 'maximumEntries', 'maximumManifestBytes', 'maximumEvictions']);
	const kind = identifier(field(input, 'kind', 'cache profile'), 128);
	const keyPrefix = identifier(field(input, 'keyPrefix', 'cache profile'), 128);
	if (!keyPrefix.endsWith(':')) throw new TypeError('A binary cache key prefix must end with a namespace colon.');
	return Object.freeze({ kind, keyPrefix,
		maximumBytes: integer(field(input, 'maximumBytes', 'cache profile'), 0, 128 * 1024 * 1024),
		maximumEntries: integer(field(input, 'maximumEntries', 'cache profile'), 0, 1_024),
		maximumManifestBytes: integer(field(input, 'maximumManifestBytes', 'cache profile'), 1, 4_096),
		maximumEvictions: integer(field(input, 'maximumEvictions', 'cache profile'), 1, 16) });
}

export function normalizeBinaryDerivativeCacheIdentityV1(value: unknown, profile?: BinaryDerivativeCacheProfileV1): BinaryDerivativeCacheIdentityV1 {
	const input = record(value, 'binary cache identity', IDENTITY_FIELDS);
	if (field(input, 'schemaVersion', 'cache identity') !== 1) throw new RangeError('Unsupported or future binary cache identity.');
	const metadata = boundedText(field(input, 'metadata', 'cache identity'), 4_096);
	const parsed: unknown = JSON.parse(metadata);
	canonicalJson(parsed); // Bound parsed depth and numeric values; the adapter owns object key order.
	if (JSON.stringify(parsed) !== metadata) throw new TypeError('Binary cache metadata must be canonical JSON.');
	const result = Object.freeze({ schemaVersion: 1 as const,
		kind: identifier(field(input, 'kind', 'cache identity'), 128), key: identifier(field(input, 'key', 'cache identity'), 256),
		sourceId: identifier(field(input, 'sourceId', 'cache identity'), 128), originalSha256: digest(field(input, 'originalSha256', 'cache identity')),
		originalByteLength: integer(field(input, 'originalByteLength', 'cache identity'), 0, Number.MAX_SAFE_INTEGER),
		recipeId: identifier(field(input, 'recipeId', 'cache identity'), 128), recipeVersion: integer(field(input, 'recipeVersion', 'cache identity'), 1, Number.MAX_SAFE_INTEGER),
		byteLength: integer(field(input, 'byteLength', 'cache identity'), 0, 128 * 1024 * 1024), metadata });
	if (profile && (result.kind !== profile.kind || !result.key.startsWith(profile.keyPrefix) || result.key.length <= profile.keyPrefix.length)) {
		throw new TypeError('Binary cache identity belongs to another kind or key namespace.');
	}
	assertManifestBudget(canonicalJson(result), profile?.maximumManifestBytes ?? 4_096);
	return result;
}

export function binaryDerivativeManifestV1(identity: BinaryDerivativeCacheIdentityV1): string { return canonicalJson(identity); }

/** Strict scalar projection; payload Blob is allowed but is never retained in inventory. */
export function readBinaryDerivativeCacheRecordV1(value: unknown, key: string, profile?: BinaryDerivativeCacheProfileV1, payload = false): BinaryDerivativeCacheRecordV1 {
	const input = record(value, 'binary cache record', payload ? [...RECORD_FIELDS, 'blob'] : RECORD_FIELDS, RECORD_FIELDS);
	if (field(input, 'type', 'cache record') !== BINARY_DERIVATIVE_CACHE_TYPE_V1) throw new TypeError('Unsupported binary cache record type.');
	const manifest = boundedText(field(input, 'binaryDerivativeManifest', 'cache record'), 4_096);
	assertManifestBudget(manifest, profile?.maximumManifestBytes ?? 4_096);
	const identity = normalizeBinaryDerivativeCacheIdentityV1(JSON.parse(manifest) as unknown, profile);
	if (binaryDerivativeManifestV1(identity) !== manifest) throw new TypeError('Binary cache manifest is not canonical.');
	const storage = field(input, 'storage', 'cache record'), path = field(input, 'path', 'cache record');
	if (storage !== 'opfs' && storage !== 'indexeddb-blob') throw new TypeError('Unsupported binary cache storage.');
	if (storage === 'opfs' ? typeof path !== 'string' || !/^[A-Za-z0-9._-]{1,256}$/u.test(path) : path !== null) throw new TypeError('Invalid binary cache path.');
	const committedAt = boundedText(field(input, 'committedAt', 'cache record'), 24);
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(committedAt) || !Number.isFinite(Date.parse(committedAt)) || new Date(committedAt).toISOString() !== committedAt) throw new TypeError('Invalid binary cache publication time.');
	const token = field(input, 'originalMediaContentToken', 'cache record');
	if (!isMediaContentToken(token)) throw new TypeError('Invalid binary cache original token.');
	const result = Object.freeze({ type: BINARY_DERIVATIVE_CACHE_TYPE_V1, key: identifier(field(input, 'key', 'cache record'), 256),
		sourceId: identifier(field(input, 'sourceId', 'cache record'), 128), binaryDerivativeManifest: manifest,
		originalSha256: digest(field(input, 'originalSha256', 'cache record')), originalByteLength: integer(field(input, 'originalByteLength', 'cache record'), 0, Number.MAX_SAFE_INTEGER),
		originalMediaContentToken: token, recipeId: identifier(field(input, 'recipeId', 'cache record'), 128), recipeVersion: integer(field(input, 'recipeVersion', 'cache record'), 1, Number.MAX_SAFE_INTEGER),
		cacheToken: identifier(field(input, 'cacheToken', 'cache record'), 128), storage, path: storage === 'opfs' ? String(path) : null,
		size: integer(field(input, 'size', 'cache record'), 0, 128 * 1024 * 1024), committedAt,
		outputSha256: digest(field(input, 'outputSha256', 'cache record')), mimeType: boundedText(field(input, 'mimeType', 'cache record'), 256) });
	if (result.key !== key || result.key !== identity.key || result.sourceId !== identity.sourceId
		|| result.originalSha256 !== identity.originalSha256 || result.originalByteLength !== identity.originalByteLength
		|| result.recipeId !== identity.recipeId || result.recipeVersion !== identity.recipeVersion || result.size !== identity.byteLength) {
		throw new TypeError('Binary cache record disagrees with its manifest or primary key.');
	}
	return result;
}

/** Only normalized own data or freshly parsed JSON reaches this serializer. */
function canonicalJson(value: unknown, depth = 0): string {
	if (depth > 32) throw new RangeError('Binary cache metadata exceeds its nesting budget.');
	if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item, depth + 1)).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		const input = value as Record<string, unknown>;
		return `{${Object.keys(input).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(input[key], depth + 1)}`).join(',')}}`;
	}
	if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Binary cache JSON requires finite numbers.');
	return JSON.stringify(value);
}

function assertManifestBudget(value: string, maximum: number): void {
	if (new TextEncoder().encode(value).byteLength > maximum) throw new RangeError('Binary cache manifest exceeds its byte budget.');
}

function boundedText(value: unknown, maximum: number): string {
	if (typeof value !== 'string' || value.length > maximum) throw new TypeError('Binary cache requires bounded text.');
	return value;
}

function identifier(value: unknown, maximum: number): string {
	if (typeof value !== 'string' || value.length > maximum || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) throw new TypeError('Binary cache requires a bounded identifier.');
	return value;
}

function integer(value: unknown, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError('Binary cache integer exceeds its supported bounds.');
	return value;
}

function digest(value: unknown): string { if (!isMediaContentSha256(value)) throw new TypeError('Binary cache requires a lowercase SHA-256 digest.'); return value; }
