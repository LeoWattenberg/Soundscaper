/* SPDX-License-Identifier: AGPL-3.0-only */

import { reviewedEffectError } from './errors.ts';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	if (!(bytes instanceof Uint8Array)) throw new TypeError('Reviewed effect bytes must be a Uint8Array.');
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) {
		throw reviewedEffectError('HASH_MISMATCH', 'SHA-256 verification is unavailable in this runtime.');
	}
	const copy = Uint8Array.from(bytes);
	const digest = new Uint8Array(await subtle.digest('SHA-256', copy.buffer));
	return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyReviewedEffectDigest(
	bytes: Uint8Array,
	expectedSha256: string,
): Promise<void> {
	if (!SHA256_PATTERN.test(expectedSha256)) {
		throw reviewedEffectError('HASH_MISMATCH', 'The release catalog contains an invalid SHA-256 pin.');
	}
	const actual = await sha256Hex(bytes);
	if (actual !== expectedSha256) {
		throw reviewedEffectError('HASH_MISMATCH', 'Reviewed effect package SHA-256 does not match the release catalog.');
	}
}
