/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoProxyClaimRecord,
	type VideoProxyClaimRecord,
} from './video-proxy-claim-repository.ts';
import {
	VIDEO_PROXY_CLEANUP_TOMBSTONE_KIND,
	VIDEO_PROXY_CLEANUP_TOMBSTONE_SCHEMA_VERSION,
	videoProxyCleanupTombstoneKey,
} from './video-proxy-cleanup-tombstone-schema.ts';

export {
	VIDEO_PROXY_CLEANUP_TOMBSTONE_KIND,
	VIDEO_PROXY_CLEANUP_TOMBSTONE_SCHEMA_VERSION,
	videoProxyCleanupTombstoneKey,
} from './video-proxy-cleanup-tombstone-schema.ts';
const BASE_FIELDS = [
	'key', 'kind', 'schemaVersion', 'status', 'claim', 'createdAt', 'updatedAt', 'failureCount',
] as const;

export type VideoProxyCleanupTombstoneStatus = 'cleanup-pending' | 'cleanup-failed';

interface VideoProxyCleanupTombstoneBase extends Record<string, unknown> {
	readonly key: string;
	readonly kind: typeof VIDEO_PROXY_CLEANUP_TOMBSTONE_KIND;
	readonly schemaVersion: typeof VIDEO_PROXY_CLEANUP_TOMBSTONE_SCHEMA_VERSION;
	readonly status: VideoProxyCleanupTombstoneStatus;
	readonly claim: Readonly<VideoProxyClaimRecord>;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly failureCount: number;
}

export type VideoProxyCleanupTombstoneRecord = Readonly<VideoProxyCleanupTombstoneBase & (
	| { readonly path: string; readonly mediaChunkToken?: never }
	| { readonly mediaChunkToken: string; readonly path?: never }
)>;

/** Convert one exact claim generation into its durable physical reservation. */
export function createVideoProxyCleanupTombstone(
	claimValue: VideoProxyClaimRecord | unknown,
	nowValue: unknown,
): Readonly<VideoProxyCleanupTombstoneRecord> {
	const claim = normalizeVideoProxyClaimRecord(claimValue);
	const now = timestamp(nowValue, 'cleanup creation time');
	const physical = claim.rowIdentity.storage === 'opfs'
		? { path: claim.rowIdentity.path! }
		: { mediaChunkToken: claim.rowIdentity.mediaChunkToken! };
	return normalizeVideoProxyCleanupTombstoneRecord({
		key: videoProxyCleanupTombstoneKey(claim.bodyKey),
		kind: VIDEO_PROXY_CLEANUP_TOMBSTONE_KIND,
		schemaVersion: VIDEO_PROXY_CLEANUP_TOMBSTONE_SCHEMA_VERSION,
		status: 'cleanup-pending',
		claim,
		createdAt: now,
		updatedAt: now,
		failureCount: 0,
		...physical,
	});
}

/** Retain retryable evidence when external physical deletion is indeterminate. */
export function failVideoProxyCleanupTombstone(
	value: VideoProxyCleanupTombstoneRecord | unknown,
	nowValue: unknown,
): Readonly<VideoProxyCleanupTombstoneRecord> {
	const tombstone = normalizeVideoProxyCleanupTombstoneRecord(value);
	const now = timestamp(nowValue, 'cleanup failure time');
	if (now < tombstone.updatedAt) {
		throw new RangeError('Video proxy cleanup tombstone timestamps must be monotonic.');
	}
	if (tombstone.failureCount === Number.MAX_SAFE_INTEGER) {
		throw new RangeError('The video proxy cleanup failure count cannot be incremented safely.');
	}
	return normalizeVideoProxyCleanupTombstoneRecord({
		...tombstone,
		status: 'cleanup-failed',
		updatedAt: now,
		failureCount: tombstone.failureCount + 1,
	});
}

/** Strict closed-record snapshot for the staging-store cleanup reservation role. */
export function normalizeVideoProxyCleanupTombstoneRecord(
	value: unknown,
): Readonly<VideoProxyCleanupTombstoneRecord> {
	const raw = dataRecord(value, 'video proxy cleanup tombstone');
	const claim = normalizeVideoProxyClaimRecord(dataProperty(raw, 'claim', 'video proxy cleanup tombstone'));
	const physicalField = claim.rowIdentity.storage === 'opfs' ? 'path' : 'mediaChunkToken';
	const expectedFields = new Set<string>([...BASE_FIELDS, physicalField]);
	const keys = Reflect.ownKeys(raw);
	if (keys.length !== expectedFields.size
		|| keys.some((key) => typeof key !== 'string' || !expectedFields.has(key))) {
		throw new TypeError('A video proxy cleanup tombstone has unsupported, missing, or extra fields.');
	}
	for (const field of expectedFields) dataProperty(raw, field, 'video proxy cleanup tombstone');
	if (raw.kind !== VIDEO_PROXY_CLEANUP_TOMBSTONE_KIND
		|| raw.schemaVersion !== VIDEO_PROXY_CLEANUP_TOMBSTONE_SCHEMA_VERSION
		|| (raw.status !== 'cleanup-pending' && raw.status !== 'cleanup-failed')) {
		throw new TypeError('A current video proxy cleanup tombstone is required.');
	}
	const key = string(raw.key, 'cleanup tombstone key');
	if (key !== videoProxyCleanupTombstoneKey(claim.bodyKey)) {
		throw new TypeError('A cleanup tombstone key must match its exact claimed body.');
	}
	const createdAt = timestamp(raw.createdAt, 'cleanup creation time');
	const updatedAt = timestamp(raw.updatedAt, 'cleanup update time');
	if (updatedAt < createdAt) {
		throw new RangeError('Video proxy cleanup tombstone timestamps must be monotonic.');
	}
	const failureCount = timestamp(raw.failureCount, 'cleanup failure count');
	if ((raw.status === 'cleanup-pending' && failureCount !== 0)
		|| (raw.status === 'cleanup-failed' && failureCount < 1)) {
		throw new RangeError('A cleanup tombstone status must match its failure count.');
	}
	const base = {
		key,
		kind: VIDEO_PROXY_CLEANUP_TOMBSTONE_KIND,
		schemaVersion: VIDEO_PROXY_CLEANUP_TOMBSTONE_SCHEMA_VERSION,
		status: raw.status as VideoProxyCleanupTombstoneStatus,
		claim,
		createdAt,
		updatedAt,
		failureCount,
	};
	if (physicalField === 'path') {
		const path = string(raw.path, 'cleanup tombstone path');
		if (path !== claim.rowIdentity.path) {
			throw new TypeError('A cleanup tombstone path must match its exact claim generation.');
		}
		return Object.freeze({ ...base, path });
	}
	const mediaChunkToken = string(raw.mediaChunkToken, 'cleanup tombstone media chunk token');
	if (mediaChunkToken !== claim.rowIdentity.mediaChunkToken) {
		throw new TypeError('A cleanup tombstone chunk token must match its exact claim generation.');
	}
	return Object.freeze({ ...base, mediaChunkToken });
}

function timestamp(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`The ${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function string(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`A ${name} is required.`);
	return value;
}

function dataProperty(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}
