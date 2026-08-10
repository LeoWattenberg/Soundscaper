/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StorageRecord } from './media-records.ts';

export const MEDIA_CONTENT_DIGEST_CLAIM_VERSION = 0;
export const MEDIA_CONTENT_DIGEST_VERIFIED_VERSION = 1;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const TOKEN_PATTERN = /^media-content-[a-z0-9][a-z0-9-]{15,127}$/u;

export interface MediaContentDigestClaim {
	readonly mediaContentDigestVersion: typeof MEDIA_CONTENT_DIGEST_CLAIM_VERSION;
	readonly mediaContentToken: string;
}

export interface VerifiedMediaContentDigest {
	readonly mediaContentDigestVersion: typeof MEDIA_CONTENT_DIGEST_VERIFIED_VERSION;
	readonly mediaContentToken: string;
	readonly sha256: string;
}

/** Exact lowercase SHA-256 syntax accepted for verified retained-media rows. */
export function isMediaContentSha256(value: unknown): value is string {
	return typeof value === 'string' && SHA256_PATTERN.test(value);
}

/** Opaque bounded token syntax used to fence digest publication races. */
export function isMediaContentToken(value: unknown): value is string {
	return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

export function claimedMediaContentToken(record: StorageRecord): string | null {
	return record.mediaContentDigestVersion === MEDIA_CONTENT_DIGEST_CLAIM_VERSION
		&& isMediaContentToken(record.mediaContentToken)
		? record.mediaContentToken
		: null;
}

export function trustedMediaContentSha256(record: StorageRecord): string | null {
	return record.mediaContentDigestVersion === MEDIA_CONTENT_DIGEST_VERIFIED_VERSION
		&& isMediaContentToken(record.mediaContentToken)
		&& isMediaContentSha256(record.sha256)
		? record.sha256
		: null;
}

/** Internal markers are fail-closed unless they form a complete claim or verification. */
export function hasMalformedMediaContentProvenance(record: StorageRecord): boolean {
	const hasInternalField = Object.hasOwn(record, 'mediaContentDigestVersion')
		|| Object.hasOwn(record, 'mediaContentToken');
	return hasInternalField
		&& !claimedMediaContentToken(record)
		&& !trustedMediaContentSha256(record);
}

/** Reuses a valid in-progress claim; all other rows receive a fresh fence. */
export function mediaContentDigestClaim(record: StorageRecord): MediaContentDigestClaim {
	return {
		mediaContentDigestVersion: MEDIA_CONTENT_DIGEST_CLAIM_VERSION,
		mediaContentToken: claimedMediaContentToken(record) ?? createMediaContentToken(),
	};
}

/** Verified fields for a digest produced while holding an existing claim. */
export function verifiedMediaContentDigest(
	sha256: unknown,
	mediaContentToken: unknown,
): VerifiedMediaContentDigest {
	if (!isMediaContentSha256(sha256)) throw new TypeError('A verified media SHA-256 digest is required.');
	if (!isMediaContentToken(mediaContentToken)) throw new TypeError('A valid media content token is required.');
	return {
		mediaContentDigestVersion: MEDIA_CONTENT_DIGEST_VERIFIED_VERSION,
		mediaContentToken,
		sha256,
	};
}

/** Fresh verified provenance for newly published retained media. */
export function freshVerifiedMediaContentDigest(sha256: unknown): VerifiedMediaContentDigest {
	return verifiedMediaContentDigest(sha256, createMediaContentToken());
}

export function createMediaContentToken(): string {
	if (globalThis.crypto?.randomUUID) return `media-content-${globalThis.crypto.randomUUID()}`;
	if (globalThis.crypto?.getRandomValues) {
		const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
		return `media-content-${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
	}
	throw new Error('Secure random generation is required for retained-media provenance.');
}
